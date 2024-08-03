import {
  type SyncAction,
  type ModelsSpec,
  type MutationArgs,
  type MutationOptions,
  getMutationLocalChanges,
  type ModelsConfig,
  type ModelFilter,
  type ModelData,
  modelObjectKey,
} from './core';
import type { ModelIndex } from './indexes';
import { ModelDataCache } from './model-data-cache';
import { ModelDataLoader } from './model-data-loader';
import type { CreateModelDataStoreOptions } from './model-data-store';
import type { NetworkAdapter } from './network';
import type { StorageAdapter } from './storage';

export type LocoSyncOptions<MS extends ModelsSpec> = {
  network: NetworkAdapter<MS>;
  storage: StorageAdapter<MS>;
  config: ModelsConfig<MS>;
  storeOptions?: CreateModelDataStoreOptions;
};

export type LocoSyncClientListener<MS extends ModelsSpec> = (args: {
  type: 'started';
}) => void;

type CombinedPendingTransaction<MS extends ModelsSpec> = {
  clientTransactionId: number;
  storageTransactionId: number;
  args: MutationArgs<MS>;
  options: MutationOptions | undefined;
};

export type LocoSyncClientStatus =
  | 'ready'
  | 'initializing'
  | 'running'
  | 'failed';

export class LocoSyncClient<MS extends ModelsSpec> {
  #network: NetworkAdapter<MS>;
  #storage: StorageAdapter<MS>;
  #config: ModelsConfig<MS>;
  #cache: ModelDataCache<MS>;
  #loader: ModelDataLoader<MS>;

  #listeners: Set<LocoSyncClientListener<MS>>;
  #lastClientTransactionId: number;
  #networkUnsubscribe?: () => void;
  #pendingTransactionQueue: CombinedPendingTransaction<MS>[];
  #futureSyncs:
    | {
        lastSyncId: number;
        syncActions: SyncAction<MS['models'], keyof MS['models'] & string>[];
      }
    | undefined;
  #tombstoneModelObjectKeys: Set<string>;

  #catchUpSyncCompleted: boolean;
  #lastSyncId: number;
  #pushInFlight: boolean;

  #status: LocoSyncClientStatus;

  constructor(opts: LocoSyncOptions<MS>) {
    this.#network = opts.network;
    this.#config = opts.config;
    this.#storage = opts.storage;

    this.#listeners = new Set();
    this.#pendingTransactionQueue = [];
    this.#tombstoneModelObjectKeys = new Set();

    this.#lastClientTransactionId = 0;
    this.#lastSyncId = 0;
    this.#status = 'ready';
    this.#pushInFlight = false;
    this.#catchUpSyncCompleted = false;

    this.#cache = new ModelDataCache(
      (...params) => this.addListener(...params),
      (...params) => this.loadModelData(...params),
      this.#config,
      opts.storeOptions,
    );
    this.#loader = new ModelDataLoader(
      this.#config,
      this.#network,
      this.#storage,
    );
  }

  getCache() {
    return this.#cache;
  }

  addListener(listener: LocoSyncClientListener<MS>) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    const status = this.#status;
    if (status !== 'ready') {
      console.error(
        `LocoSyncClient has status "${status}", not "ready". Cannot start`,
      );
      return;
    }
    this.#status = 'initializing';

    const result = await this.#storage.getMetadataAndPendingTransactions();

    if (result) {
      // DB Exists, so add pending transactions to queue and set lastSyncId
      const { metadata, pendingTransactions } = result;
      this.#lastSyncId = metadata.lastSyncId;
      this.#loader.addSyncGroupsFromStorage(metadata.syncGroups);

      const combinedPendingTransactions: CombinedPendingTransaction<MS>[] = [];
      for (const { args, id: storageTransactionId } of pendingTransactions) {
        const clientTransactionId = ++this.#lastClientTransactionId;
        combinedPendingTransactions.push({
          clientTransactionId,
          storageTransactionId,
          args,
          options: undefined,
        });
      }
      this.addPendingTransactionsToQueue(combinedPendingTransactions);
    } else {
      const bootstrapResult = await this.#network.bootstrap({
        type: 'eager',
        models: this.#loader.eagerModels,
      });
      if (bootstrapResult.ok) {
        await this.#storage.saveEagerBootstrap(
          bootstrapResult.value.bootstrap,
          bootstrapResult.value.firstSyncId,
        );
        this.#lastSyncId = bootstrapResult.value.firstSyncId;
        void this.#loader.addNewSyncGroups(
          bootstrapResult.value.syncGroups,
          this.#tombstoneModelObjectKeys,
        );
      } else {
        // TODO: Should probably retry in this case
        this.#status = 'failed';
        return;
      }
    }

    this.#networkUnsubscribe = await this.#network.initSync(async (message) => {
      if (message.type === 'handshake') {
        await this.deltaSync(this.#lastSyncId, message.lastSyncId);
        this.#loader.handleBootstrapsFromHandshake(
          message.syncGroups,
          this.#tombstoneModelObjectKeys,
        );
      } else if (message.type === 'sync') {
        const { lastSyncId, sync } = message;
        for (const syncAction of sync) {
          if (syncAction.action === 'delete') {
            this.#tombstoneModelObjectKeys.add(modelObjectKey(syncAction));
          }
        }
        if (this.#catchUpSyncCompleted) {
          this.#cache.processMessage({
            type: 'sync',
            lastSyncId,
            sync,
          });
          await this.#storage.applySyncActions(lastSyncId, sync);
        } else {
          if (this.#futureSyncs) {
            this.#futureSyncs.lastSyncId = message.lastSyncId;
            this.#futureSyncs.syncActions.push(...sync);
          } else {
            this.#futureSyncs = {
              lastSyncId,
              syncActions: sync,
            };
          }
        }
      } else if (message.type === 'disconnected') {
        this.#catchUpSyncCompleted = false;
        this.#futureSyncs = undefined;
      }
    });

    this.#status = 'running';
    for (const listener of this.#listeners) {
      listener({ type: 'started' });
    }
  }

  stop() {
    if (this.#status !== 'running') {
      return;
    }
    this.#status = 'ready';

    // TODO: Stop in-flight requests
    // TODO: What else needs to be cleaned up?

    if (this.#networkUnsubscribe) {
      this.#networkUnsubscribe();
    }
  }

  async addMutation(args: MutationArgs<MS>, options?: MutationOptions) {
    const status = this.#status;
    if (status !== 'running') {
      console.error(
        `LocoSyncClient has status "${status}", not "running". Cannot add new transactions.`,
      );
      return;
    }

    this.#lastClientTransactionId += 1;
    const clientTransactionId = this.#lastClientTransactionId;

    this.#cache.processMessage({
      type: 'startTransaction',
      transactionId: clientTransactionId,
      changes: getMutationLocalChanges(
        this.#config,
        args,
        this.#cache.getStore(),
      ),
    });

    const storageTransactionId =
      await this.#storage.createPendingTransaction(args);

    this.addPendingTransactionsToQueue([
      {
        clientTransactionId,
        storageTransactionId,
        args,
        options,
      },
    ]);
  }

  // Execute this function on the handshake message to catch up to the server state
  // Afterwards, sync messages can be applied because we are guaranteed to receive them in order without gaps
  // If the websocket connection closes and a new one is re-opened, we may have missed messages, and this function will be run again
  // NOTE: THIS ASSUMPTION SHOULD BE COMMUNICATED TO IMPLEMENTERS OF NETWORK CLIENT
  private async deltaSync(fromSyncId: number, toSyncId: number) {
    try {
      const result = await this.#network.deltaSync(fromSyncId, toSyncId);
      if (!result.ok) {
        // TODO: Need to clear up details of how exactly to re-try on errors
        // Not sure what would happen if we kept re-trying a deltaSync request
        // but a websocket closed, new one re-opened, and this function was called again
        if (result.error === 'auth') {
          // TODO: await onAuth callback?
          this.deltaSync(fromSyncId, toSyncId);
          return;
        } else if (result.error === 'network') {
          this.deltaSync(fromSyncId, toSyncId);
          return;
        }
        throw new Error('SyncDelta request failed');
      }

      let lastSyncId = toSyncId;
      let sync = result.value.sync;
      if (this.#futureSyncs) {
        sync = result.value.sync.concat(this.#futureSyncs.syncActions);
        lastSyncId = this.#futureSyncs.lastSyncId;
      }
      this.#cache.processMessage({
        type: 'sync',
        lastSyncId,
        sync,
      });
      await this.#storage.applySyncActions(lastSyncId, sync);
      this.#futureSyncs = undefined;
      this.#lastSyncId = lastSyncId;
      this.#catchUpSyncCompleted = true;
    } catch (e) {
      console.error(e);
    }
  }

  // TODO: Invariant check that transactions are in order?
  private addPendingTransactionsToQueue(
    transactions: CombinedPendingTransaction<MS>[],
  ) {
    this.#pendingTransactionQueue.push(...transactions);
    this.pushFromQueue();
  }

  private async pushFromQueue() {
    // TODO: Do these checks actually ensure only one request is run at a time per process?
    if (this.#pushInFlight) {
      return;
    }
    this.#pushInFlight = true;

    const nextTransaction = this.#pendingTransactionQueue.shift();
    if (!nextTransaction) {
      this.#pushInFlight = false;
      return;
    }

    try {
      const result = await this.#network.sendTransaction(nextTransaction.args);
      if (!result.ok) {
        if (result.error === 'server') {
          console.error(
            `Transaction(storageTransactionId=${nextTransaction.storageTransactionId}, clientTransactionId=${nextTransaction.clientTransactionId}) failed, rolling back`,
          );
          await this.#storage.removePendingTransaction(
            nextTransaction.storageTransactionId,
          );
          this.#cache.processMessage({
            type: 'rollbackTransaction',
            transactionId: nextTransaction.clientTransactionId,
          });
          nextTransaction?.options?.onError?.();
        } else {
          // Only retry on network or auth errors, and re-auth first if relevant
          if (result.error === 'auth') {
            // onAuth callback?
          }

          // Re-add transaction to queue, and wait a bit before trying again (happens outside of try/catch)
          this.#pendingTransactionQueue.unshift(nextTransaction);
          // TODO: What should wait time be here? Should we back off?
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        await this.#storage.removePendingTransaction(
          nextTransaction.storageTransactionId,
        );
        this.#cache.processMessage({
          type: 'commitTransaction',
          transactionId: nextTransaction.clientTransactionId,
          lastSyncId: result.value.lastSyncId,
        });
        nextTransaction?.options?.onSuccess?.();
      }
    } catch (e) {
      console.error(e);
      // TODO: How to distinguish between server failure vs. offline?
      // Or do we just always retry?
      // If we don't retry, don't we need to rollback the transaction??
    }

    this.#pushInFlight = false;
    if (this.#pendingTransactionQueue.length > 0) {
      this.pushFromQueue();
    }
  }

  async loadModelData<ModelName extends keyof MS['models'] & string>(
    modelName: ModelName,
    args:
      | {
          index: ModelIndex<MS['models'], ModelName>;
          filter: ModelFilter<MS['models'], ModelName>;
        }
      | undefined,
  ): Promise<ModelData<MS['models'], ModelName>[]> {
    const loadResult = this.#loader.isModelLoaded(modelName);
    if (!loadResult.loaded) {
      await loadResult.promise;
    }
    return this.#storage.loadModelData(modelName, args);
  }
}
