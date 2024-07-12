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
import type { CreateModelDataStoreOptions } from './model-data-store';
import type { NetworkAdapter } from './network';
import type { StorageAdapter } from './storage';

export type LocoSyncOptions<MS extends ModelsSpec> = {
  network: NetworkAdapter<MS>;
  storage: StorageAdapter<MS>;
  config: ModelsConfig<MS>;
  storeOptions?: CreateModelDataStoreOptions;
};

export type LocalSyncClientListener<MS extends ModelsSpec> = (args: {
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
  #modelDataLoader: ModelDataLoader<MS>;

  #listeners: Set<LocalSyncClientListener<MS>>;
  #lastClientTransactionId: number;
  #networkUnsubscribe?: () => void;
  #pendingTransactionQueue: CombinedPendingTransaction<MS>[];
  #futureSyncActions: SyncAction<MS['models'], keyof MS['models'] & string>[];
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
    this.#futureSyncActions = [];
    this.#pendingTransactionQueue = [];
    this.#tombstoneModelObjectKeys = new Set();

    this.#lastClientTransactionId = 0;
    this.#lastSyncId = 0;
    this.#status = 'ready';
    this.#pushInFlight = false;
    this.#catchUpSyncCompleted = false;

    this.#cache = new ModelDataCache(this, this.#config, opts.storeOptions);
    this.#modelDataLoader = new ModelDataLoader(
      this.#config,
      this.#network,
      this.#storage,
    );
  }

  getCache() {
    return this.#cache;
  }

  addListener(listener: LocalSyncClientListener<MS>) {
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
      this.#modelDataLoader.addSyncGroupsFromStorage(metadata.syncGroups);

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
        models: this.#modelDataLoader.eagerModels,
      });
      if (bootstrapResult.ok) {
        await this.#storage.saveEagerBootstrap(
          bootstrapResult.value.bootstrap,
          bootstrapResult.value.firstSyncId,
        );
        this.#lastSyncId = bootstrapResult.value.firstSyncId;
        void this.#modelDataLoader.addNewSyncGroups(
          bootstrapResult.value.syncGroups,
          this.#tombstoneModelObjectKeys,
        );
      } else {
        // TODO: Should probably retry in this case
        this.#status = 'failed';
        return;
      }
    }

    this.#networkUnsubscribe = await this.#network.initSync(
      async (response) => {
        if (response.type === 'handshake') {
          await this.deltaSync(this.#lastSyncId, response.lastSyncId);
          this.#modelDataLoader.handleBootstrapsFromHandshake(
            response.syncGroups,
            this.#tombstoneModelObjectKeys,
          );
        } else if (response.type === 'sync') {
          const { lastSyncId, sync } = response;
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
            this.#futureSyncActions.push(...sync);
          }
        } else if (response.type === 'disconnected') {
          this.#catchUpSyncCompleted = false;
          this.#futureSyncActions = [];
        }
      },
    );

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

      const fullSync = result.value.sync.concat(this.#futureSyncActions);
      this.#cache.processMessage({
        type: 'sync',
        lastSyncId: toSyncId,
        sync: fullSync,
      });
      await this.#storage.applySyncActions(toSyncId, fullSync);
      this.#futureSyncActions = [];
      this.#lastSyncId = toSyncId;
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
    const loadResult = this.#modelDataLoader.isModelLoaded(modelName);
    if (!loadResult.loaded) {
      await loadResult.promise;
    }
    return this.#storage.loadModelData(modelName, args);
  }
}

class ModelDataLoader<MS extends ModelsSpec> {
  #config: ModelsConfig<MS>;
  #network: NetworkAdapter<MS>;
  #storage: StorageAdapter<MS>;

  #eagerModels: Set<keyof MS['models'] & string>;
  #lazyModelsToSyncGroups: Map<keyof MS['models'] & string, MS['syncGroup'][]>;
  #syncGroupLoadStatuses: Map<
    MS['syncGroup'],
    { loaded: true } | { loaded: false; listeners: Set<() => void> }
  >;

  constructor(
    config: ModelsConfig<MS>,
    network: NetworkAdapter<MS>,
    storage: StorageAdapter<MS>,
  ) {
    this.#config = config;
    this.#network = network;
    this.#storage = storage;

    this.#eagerModels = new Set();
    this.#lazyModelsToSyncGroups = new Map();
    this.#syncGroupLoadStatuses = new Map();

    for (const key in config.modelDefs) {
      const modelName = key as keyof MS['models'] & string;
      const modelDef = config.modelDefs[modelName];
      if (modelDef.initialBootstrap) {
        this.#eagerModels.add(modelName);
      }
    }
  }

  get eagerModels() {
    return Array.from(this.#eagerModels);
  }

  handleBootstrapsFromHandshake(
    handshakeSyncGroups: MS['syncGroup'][],
    tombstoneModelObjectKeys: Set<string>,
  ) {
    const addedSyncGroups: MS['syncGroup'][] = [];
    const removedSyncGroups: MS['syncGroup'][] = [];
    const equals = this.#config.syncGroupDefs?.equals ?? Object.is;

    const currentSyncGroups = Array.from(this.#syncGroupLoadStatuses.keys());
    for (const currentGroup of currentSyncGroups) {
      if (
        !handshakeSyncGroups.some((newGroup) => equals(currentGroup, newGroup))
      ) {
        removedSyncGroups.push(currentGroup);
      }
    }
    for (const newGroup of handshakeSyncGroups) {
      if (
        !currentSyncGroups.some((currentGroup) =>
          equals(currentGroup, newGroup),
        )
      ) {
        addedSyncGroups.push(newGroup);
      }
    }

    if (removedSyncGroups.length > 0) {
      console.error("Removing sync groups isn't supported yet");
    }

    void this.addNewSyncGroups(addedSyncGroups, tombstoneModelObjectKeys);
  }

  /**
   * Adds new syncGroups to the client.
   * This consists of running a lazy bootstrap request for each syncGroup, and saving the results to storage.
   *
   * TODO: May want to do some sort of batching or concurrent requests here
   *
   * @param syncGroups new syncGroups (via eager bootstrap result or handshake message)
   */
  async addNewSyncGroups(
    syncGroups: MS['syncGroup'][],
    tombstoneModelObjectKeys: Set<string>,
  ) {
    if (!this.#config.syncGroupDefs) {
      console.error(
        'Cannot add new sync groups if no syncGroupDefs are defined in config',
      );
      return;
    }
    for (const syncGroup of syncGroups) {
      this.#syncGroupLoadStatuses.set(syncGroup, {
        loaded: false,
        listeners: new Set(),
      });
    }

    for (const syncGroup of syncGroups) {
      const models =
        this.#config.syncGroupDefs.modelsForPartialBootstrap(syncGroup);
      for (const model of models) {
        const lazyData = this.#lazyModelsToSyncGroups.get(model);
        if (lazyData) {
          lazyData.push(syncGroup);
        } else {
          this.#lazyModelsToSyncGroups.set(model, [syncGroup]);
        }
      }
      const bootstrapResult = await this.#network.bootstrap({
        type: 'lazy',
        models,
        syncGroups: [syncGroup],
      });
      if (bootstrapResult.ok) {
        await this.#storage.saveLazyBootstrap(
          bootstrapResult.value.bootstrap,
          [syncGroup],
          tombstoneModelObjectKeys,
        );
        const syncGroupLoadStatus = this.#syncGroupLoadStatuses.get(syncGroup);
        if (syncGroupLoadStatus && !syncGroupLoadStatus.loaded) {
          this.#syncGroupLoadStatuses.set(syncGroup, { loaded: true });
          for (const listener of syncGroupLoadStatus.listeners) {
            listener();
          }
        }
      } else {
        console.error('Failed to bootstrap new sync group');
        // TODO: Retry partial bootstrap?
      }
    }
  }

  private isSyncGroupLoaded(syncGroup: MS['syncGroup']): IsLoadedResult {
    const status = this.#syncGroupLoadStatuses.get(syncGroup);
    if (!status) {
      console.error(`Sync group "${syncGroup}" not found`);
      return { loaded: true };
    }

    if (status.loaded) {
      return { loaded: true };
    }

    const promise = new Promise<void>((resolve) => {
      status.listeners.add(resolve);
    });

    return {
      loaded: false,
      promise,
    };
  }

  addSyncGroupsFromStorage(syncGroups: MS['syncGroup'][]) {
    for (const syncGroup of syncGroups) {
      this.#syncGroupLoadStatuses.set(syncGroup, { loaded: true });
    }
  }

  isModelLoaded(modelName: keyof MS['models'] & string): IsLoadedResult {
    if (this.#eagerModels.has(modelName)) {
      return { loaded: true };
    }

    const syncGroups = this.#lazyModelsToSyncGroups.get(modelName);
    if (!syncGroups) {
      console.error(
        `Model "${modelName}" isn't part of initial bootstrap or any sync groups, so can't be loaded`,
      );
      return { loaded: true };
    }

    const promises: Promise<any>[] = [];
    for (const syncGroup of syncGroups) {
      const loadResult = this.isSyncGroupLoaded(syncGroup);
      if (!loadResult.loaded) {
        promises.push(loadResult.promise);
      }
    }
    if (promises.length > 0) {
      return { loaded: false, promise: Promise.all(promises) };
    }

    return { loaded: true };
  }
}

type IsLoadedResult =
  | {
      loaded: true;
    }
  | {
      loaded: false;
      promise: Promise<any>;
    };
