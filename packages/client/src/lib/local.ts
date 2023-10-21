import type {
  Metadata,
  Models,
  BootstrapPayload,
  SyncAction,
  ModelsConfig,
  MutationArgs,
  ModelsSpec,
} from './core';

export type LocalDbPendingTransaction<MS extends ModelsSpec> = {
  id: number;
  args: MutationArgs<MS>;
};

// TODO: Name. LocalStorageClient? StorageClient?
export interface LocalDbClient<MS extends ModelsSpec> {
  /**
   * Returns metadata and pending transactions, if the database exists
   * Otherwise, returns undefined
   */
  getMetadataAndPendingTransactions(): Promise<
    | {
        metadata: Metadata;
        pendingTransactions: LocalDbPendingTransaction<MS>[];
      }
    | undefined
  >;

  /**
   * Apply sync actions to relevant models, and update lastSyncId (part of metadata)
   *
   * @param lastSyncId
   * @param sync
   */
  applySyncActions(
    lastSyncId: number,
    sync: SyncAction<MS['models'], keyof MS['models'] & string>[]
  ): Promise<void>;

  /**
   * Create a new transaction with the provided changes
   *
   * Return the id of the new transaction
   *
   * @param changes
   */
  createPendingTransaction(args: MutationArgs<MS>): Promise<number>;

  /**
   * Remove a transaction by id
   *
   * @param transactionId
   */
  removePendingTransaction(transactionId: number): Promise<void>;

  /**
   * Load all model data to bootstrap the client
   */
  loadBootstrap(): Promise<BootstrapPayload<MS['models']>>;

  /**
   * Load all model data to bootstrap the client
   */
  saveBootstrap(
    bootstrap: BootstrapPayload<MS['models']>,
    lastSyncId: number
  ): Promise<void>;
}
