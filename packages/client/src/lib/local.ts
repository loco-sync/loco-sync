import type {
  Metadata,
  Models,
  BootstrapPayload,
  SyncAction,
  ModelsConfig,
  MutationArgs,
} from './core';

export type LocalDbPendingTransaction<
  M extends Models,
  MC extends ModelsConfig<M>
> = {
  id: number;
  args: MutationArgs<M, MC>;
};

// TODO: Name. LocalStorageClient? StorageClient?
export interface LocalDbClient<M extends Models, MC extends ModelsConfig<M>> {
  /**
   * Returns metadata and pending transactions, if the database exists
   * Otherwise, returns undefined
   */
  getMetadataAndPendingTransactions(): Promise<
    | {
        metadata: Metadata;
        pendingTransactions: LocalDbPendingTransaction<M, MC>[];
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
    sync: SyncAction<M, keyof M & string>[]
  ): Promise<void>;

  /**
   * Create a new transaction with the provided changes
   *
   * Return the id of the new transaction
   *
   * @param changes
   */
  createPendingTransaction(args: MutationArgs<M, MC>): Promise<number>;

  /**
   * Remove a transaction by id
   *
   * @param transactionId
   */
  removePendingTransaction(transactionId: number): Promise<void>;

  /**
   * Load all model data to bootstrap the client
   */
  loadBootstrap(): Promise<BootstrapPayload<M>>;

  /**
   * Load all model data to bootstrap the client
   */
  saveBootstrap(
    bootstrap: BootstrapPayload<M>,
    lastSyncId: number
  ): Promise<void>;
}
