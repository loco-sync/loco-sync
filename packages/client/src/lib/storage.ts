import type {
  Metadata,
  BootstrapPayload,
  SyncAction,
  MutationArgs,
  ModelsSpec,
  ModelFilter,
  ModelData,
} from './core';
import type { ModelIndex } from './indexes';

type PendingTransaction<MS extends ModelsSpec> = {
  id: number;
  args: MutationArgs<MS>;
};

export interface StorageAdapter<MS extends ModelsSpec> {
  /**
   * Returns metadata and pending transactions, if the database exists
   * Otherwise, returns undefined
   */
  getMetadataAndPendingTransactions(): Promise<
    | {
        metadata: Metadata;
        pendingTransactions: PendingTransaction<MS>[];
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
    sync: SyncAction<MS['models'], keyof MS['models'] & string>[],
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

  loadModelData<ModelName extends keyof MS['models'] & string>(
    modelName: ModelName,
    args:
      | {
          index: ModelIndex<MS['models'], ModelName>;
          filter: ModelFilter<MS['models'], ModelName>;
        }
      | undefined,
  ): Promise<ModelData<MS['models'], ModelName>[]>;

  /**
   * Load all model data to bootstrap the client
   */
  saveBootstrap(
    bootstrap: BootstrapPayload<MS['models']>,
    lastSyncId: number,
  ): Promise<void>;
}
