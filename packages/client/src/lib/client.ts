import type {
  BootstrapPayload,
  Models,
  SyncAction,
  ModelsSpec,
  MutationArgs,
} from './core';
import type { NetworkClient } from './network';
import type { LocalDbClient } from './local';

type LocoSyncOptions<MS extends ModelsSpec> = {
  networkClient: NetworkClient<MS>;
  localDbClient: LocalDbClient<MS>;
};

type SyncListenerCallback<M extends Models> = (
  lastSyncId: number,
  sync: SyncAction<M, keyof M & string>[],
) => void;

type LocalChangeListenerCallback<MS extends ModelsSpec> = (
  args:
    | {
        type: 'start';
        clientTransactionId: number;
        args: MutationArgs<MS>;
      }
    | {
        type: 'commit';
        clientTransactionId: number;
        lastSyncId: number;
      }
    | {
        type: 'rollback';
        clientTransactionId: number;
      }
    | {
        type: 'bootstrap';
        bootstrap: BootstrapPayload<MS['models']>;
      },
) => void;

// Only used in this file, other components use LocalDbPendingTransaction or ClientPendingTransaction
type CombinedPendingTransaction<MS extends ModelsSpec> = {
  clientTransactionId: number;
  localDbTransactionId: number;
  args: MutationArgs<MS>;
};

export class LocoSyncClient<MS extends ModelsSpec> {
  #networkClient: NetworkClient<MS>;
  #localDbClient: LocalDbClient<MS>;

  #syncListeners: Set<SyncListenerCallback<MS['models']>>;
  #localChangeListeners: Set<LocalChangeListenerCallback<MS>>;
  #lastClientTransactionId: number;
  #pendingTransactionQueue: CombinedPendingTransaction<MS>[];
  #networkClientUnsubscribe?: () => void;
  #futureSyncActions: SyncAction<MS['models'], keyof MS['models'] & string>[];
  #catchUpSyncCompleted: boolean;
  #lastSyncId: number;
  #pushInFlight: boolean;
  #syncStarted: boolean;

  #initStatus: 'ready' | 'running' | 'done' | 'failed';
  #isClosed: boolean;

  constructor(opts: LocoSyncOptions<MS>) {
    this.#networkClient = opts.networkClient;
    this.#localDbClient = opts.localDbClient;

    this.#localChangeListeners = new Set();
    this.#syncListeners = new Set();
    this.#futureSyncActions = [];
    this.#pendingTransactionQueue = [];

    this.#lastClientTransactionId = 0;
    this.#lastSyncId = 0;
    this.#initStatus = 'ready';
    this.#syncStarted = false;
    this.#isClosed = false;
    this.#pushInFlight = false;
    this.#catchUpSyncCompleted = false;

    this.init();
  }

  async init(): Promise<void> {
    if (this.#initStatus !== 'ready') {
      console.error('Client.init() has already been called');
      return;
    }
    if (this.#isClosed) {
      console.error('Client.init() cannot be called on closed client');
      return;
    }
    this.#initStatus = 'running';

    const result =
      await this.#localDbClient.getMetadataAndPendingTransactions();

    if (result) {
      // DB Exists, so add pending transactions to queue and set lastSyncId
      const { metadata, pendingTransactions } = result;
      this.#lastSyncId = metadata.lastSyncId;

      if (this.#localChangeListeners.size > 0) {
        const bootstrap = await this.loadLocalBootstrap();
        for (const cb of this.#localChangeListeners.values()) {
          cb({
            type: 'bootstrap',
            bootstrap,
          });
        }
      }

      const combinedPendingTransactions: CombinedPendingTransaction<MS>[] = [];
      for (const { args, id } of pendingTransactions) {
        const clientTransactionId = ++this.#lastClientTransactionId;
        combinedPendingTransactions.push({
          clientTransactionId,
          localDbTransactionId: id,
          args,
        });
      }
      this.addPendingTransactionsToQueue(combinedPendingTransactions);
    } else {
      const bootstrapResult = await this.#networkClient.loadBootstrap();
      if (bootstrapResult.ok) {
        await this.#localDbClient.saveBootstrap(
          bootstrapResult.value.bootstrap,
          bootstrapResult.value.lastSyncId,
        );
        this.#lastSyncId = bootstrapResult.value.lastSyncId;

        for (const cb of this.#localChangeListeners.values()) {
          cb({
            type: 'bootstrap',
            bootstrap: bootstrapResult.value.bootstrap,
          });
        }
      } else {
        // TODO: Should probably retry in this case
        this.#initStatus = 'failed';
        return;
      }
    }

    this.#networkClientUnsubscribe = this.#networkClient.addListener(
      async (response) => {
        if (response.type === 'handshake') {
          await this.deltaSync(this.#lastSyncId, response.lastSyncId);
        } else if (response.type === 'sync') {
          const { lastSyncId, sync } = response;
          if (this.#catchUpSyncCompleted) {
            // TODO: Does ordering or sending sync events to memory vs. local db matter?
            // local db seems safer, but potentially slower?
            for (const cb of this.#syncListeners.values()) {
              cb(lastSyncId, sync);
            }
            await this.#localDbClient.applySyncActions(lastSyncId, sync);
          } else {
            this.#futureSyncActions.push(...sync);
          }
        } else if (response.type === 'disconnected') {
          this.#catchUpSyncCompleted = false;
          this.#futureSyncActions = [];
        }
      },
    );

    this.#initStatus = 'done';
  }

  addSyncListener(callback: SyncListenerCallback<MS['models']>): () => void {
    this.#syncListeners.add(callback);
    return () => this.#syncListeners.delete(callback);
  }

  startSync() {
    if (this.#syncStarted) {
      return;
    }
    this.#syncStarted = true;
    this.#networkClient.initHandshake();
  }

  async close(): Promise<void> {
    if (this.#isClosed) {
      return;
    }
    this.#isClosed = true;

    // TODO: What else needs to be cleaned up?
    if (this.#networkClientUnsubscribe) {
      this.#networkClientUnsubscribe();
    }
  }

  isSyncing() {
    return this.#pendingTransactionQueue.length > 0;
  }

  // TODO: Implement, probably based on some analysis of requests. Or maybe this just forwards some events from the request?
  // Could also provide API to let users determine this for themselves, maybe based on stream of request attempts + times + outcomes
  // Or maybe just forward this to the NetworkClient, which should implement via checking e.g. websocket state
  isOnline() {
    return false;
  }

  /**
   *
   * @param callback called with new local change events
   * @returns
   * unsubscribe: method to remove the callback fn as a listener.
   * initialized: true if init is done (and therefore a bootstrap event will not be emitted), false otherwise
   */
  addLocalChangeListener(callback: LocalChangeListenerCallback<MS>): {
    unsubscribe: () => void;
    initialized: boolean;
  } {
    this.#localChangeListeners.add(callback);
    return {
      unsubscribe: () => this.#localChangeListeners.delete(callback),
      initialized: this.#initStatus === 'done',
    };
  }

  async addMutation(args: MutationArgs<MS>) {
    if (this.#isClosed) {
      console.error('Client is closed, cannot add new transactions');
      return;
    }

    this.#lastClientTransactionId += 1;
    const clientTransactionId = this.#lastClientTransactionId;

    for (const cb of this.#localChangeListeners.values()) {
      cb({
        type: 'start',
        clientTransactionId,
        args,
      });
    }

    const localDbTransactionId =
      await this.#localDbClient.createPendingTransaction(args);

    this.addPendingTransactionsToQueue([
      {
        clientTransactionId,
        localDbTransactionId,
        args,
      },
    ]);
  }

  async loadLocalBootstrap(): Promise<BootstrapPayload<MS['models']>> {
    return this.#localDbClient.loadBootstrap();
  }

  // Execute this function on the handshake message to catch up to the server state
  // Afterwards, sync messages can be applied because we are guaranteed to receive them in order without gaps
  // If the websocket connection closes and a new one is re-opened, we may have missed messages, and this function will be run again
  // NOTE: THIS ASSUMPTION SHOULD BE COMMUNICATED TO IMPLEMENTERS OF NETWORK CLIENT
  private async deltaSync(fromSyncId: number, toSyncId: number) {
    try {
      const result = await this.#networkClient.deltaSync(fromSyncId, toSyncId);
      if (!result.ok) {
        // TODO: Need to clear up details of how exactly to re-try on errors
        // Not sure what would happen if we kept re-trying a syncDelta request
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
      for (const cb of this.#syncListeners.values()) {
        cb(toSyncId, fullSync);
      }
      await this.#localDbClient.applySyncActions(toSyncId, fullSync);
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
      const result = await this.#networkClient.sendTransaction(
        nextTransaction.args,
      );
      if (!result.ok) {
        if (result.error === 'server') {
          console.error(
            `Transaction(localDbTransactionId=${nextTransaction.localDbTransactionId}, clientTransactionId=${nextTransaction.clientTransactionId}) failed, rolling back`,
          );
          await this.#localDbClient.removePendingTransaction(
            nextTransaction.localDbTransactionId,
          );
          for (const cb of this.#localChangeListeners.values()) {
            cb({
              type: 'rollback',
              clientTransactionId: nextTransaction.clientTransactionId,
            });
          }
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
        await this.#localDbClient.removePendingTransaction(
          nextTransaction.localDbTransactionId,
        );
        for (const cb of this.#localChangeListeners.values()) {
          cb({
            type: 'commit',
            clientTransactionId: nextTransaction.clientTransactionId,
            lastSyncId: result.value.lastSyncId,
          });
        }
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
