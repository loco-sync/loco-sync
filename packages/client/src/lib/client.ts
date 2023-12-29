import type {
  BootstrapPayload,
  Models,
  SyncAction,
  ModelsSpec,
  MutationArgs,
  MutationOptions,
} from './core';
import type { NetworkAdapter } from './network';
import type { StorageAdapter } from './storage';

export type LocoSyncOptions<MS extends ModelsSpec> = {
  network: NetworkAdapter<MS>;
  storage: StorageAdapter<MS>;
};

export type LocalSyncClientListener<MS extends ModelsSpec> = (
  args:
    | {
        type: 'sync';
        lastSyncId: number;
        sync: SyncAction<MS['models'], keyof MS['models'] & string>[];
      }
    | {
        type: 'startTransaction';
        clientTransactionId: number;
        args: MutationArgs<MS>;
      }
    | {
        type: 'commitTransaction';
        clientTransactionId: number;
        lastSyncId: number;
      }
    | {
        type: 'rollbackTransaction';
        clientTransactionId: number;
      }
    | {
        type: 'bootstrap';
        bootstrap: BootstrapPayload<MS['models']>;
      },
) => void;

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

  #listeners: Set<LocalSyncClientListener<MS>>;
  #lastClientTransactionId: number;
  #networkUnsubscribe?: () => void;
  #pendingTransactionQueue: CombinedPendingTransaction<MS>[];
  #futureSyncActions: SyncAction<MS['models'], keyof MS['models'] & string>[];

  #catchUpSyncCompleted: boolean;
  #lastSyncId: number;
  #pushInFlight: boolean;

  #status: LocoSyncClientStatus;

  constructor(opts: LocoSyncOptions<MS>) {
    this.#network = opts.network;
    this.#storage = opts.storage;

    this.#listeners = new Set();
    this.#futureSyncActions = [];
    this.#pendingTransactionQueue = [];

    this.#lastClientTransactionId = 0;
    this.#lastSyncId = 0;
    this.#status = 'ready';
    this.#pushInFlight = false;
    this.#catchUpSyncCompleted = false;
  }

  // TODO: Should this return a result of some sort?
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

      const bootstrap = await this.#storage.loadBootstrap();
      for (const cb of this.#listeners.values()) {
        cb({
          type: 'bootstrap',
          bootstrap,
        });
      }

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
      const bootstrapResult = await this.#network.loadBootstrap();
      if (bootstrapResult.ok) {
        await this.#storage.saveBootstrap(
          bootstrapResult.value.bootstrap,
          bootstrapResult.value.lastSyncId,
        );
        this.#lastSyncId = bootstrapResult.value.lastSyncId;

        for (const cb of this.#listeners.values()) {
          cb({
            type: 'bootstrap',
            bootstrap: bootstrapResult.value.bootstrap,
          });
        }
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
        } else if (response.type === 'sync') {
          const { lastSyncId, sync } = response;
          if (this.#catchUpSyncCompleted) {
            // TODO: Does ordering of sending sync events to memory vs. storage matter?
            // storage first seems safer, but also slower?
            for (const cb of this.#listeners.values()) {
              cb({ type: 'sync', lastSyncId, sync });
            }
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
  }

  addListener(listener: LocalSyncClientListener<MS>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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

  // isSyncing() {
  //   return this.#pendingTransactionQueue.length > 0;
  // }

  // // TODO: Implement, probably based on some analysis of requests. Or maybe this just forwards some events from the request?
  // // Could also provide API to let users determine this for themselves, maybe based on stream of request attempts + times + outcomes
  // // Or maybe just forward this to the NetworkClient, which should implement via checking e.g. websocket state
  // isOnline() {
  //   return false;
  // }

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

    for (const cb of this.#listeners.values()) {
      cb({
        type: 'startTransaction',
        clientTransactionId,
        args,
      });
    }

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
      for (const cb of this.#listeners.values()) {
        cb({ type: 'sync', lastSyncId: toSyncId, sync: fullSync });
      }
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
          for (const cb of this.#listeners.values()) {
            cb({
              type: 'rollbackTransaction',
              clientTransactionId: nextTransaction.clientTransactionId,
            });
          }
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
        for (const cb of this.#listeners.values()) {
          cb({
            type: 'commitTransaction',
            clientTransactionId: nextTransaction.clientTransactionId,
            lastSyncId: result.value.lastSyncId,
          });
        }
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
}
