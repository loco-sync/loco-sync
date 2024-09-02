import type {
  Metadata,
  BootstrapPayload,
  SyncAction,
  MutationArgs,
  ModelsSpec,
  ModelData,
} from './core';
import type { ModelIndex } from './indexes';
import type { ModelFilter } from './filters';

export type StoragePendingTransaction<MS extends ModelsSpec> = {
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
        metadata: Metadata<MS['syncGroup']>;
        pendingTransactions: StoragePendingTransaction<MS>[];
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
   * Save models and update metadata for an eager bootstrap
   */
  saveEagerBootstrap(
    bootstrap: BootstrapPayload<MS['models']>,
    firstSyncId: number,
  ): Promise<void>;

  /**
   * Save models and update metadata for a lazy bootstrap
   *
   * @param bootstrap
   * @param syncGroups syncGroups that data belongs to, these syncGroups should be added to metadata.syncGroups
   * @param tombstoneModelObjectKeys keys of model objects that have been deleted by sync actions.
   * Model objects in bootstrap with these keys should not be saved to storage to prevent race conditions with sync actions.
   */
  saveLazyBootstrap(
    bootstrap: BootstrapPayload<MS['models']>,
    syncGroups: MS['syncGroup'][],
    tombstoneModelObjectKeys: Set<string>,
  ): Promise<void>;
}
