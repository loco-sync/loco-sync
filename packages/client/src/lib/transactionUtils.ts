import type {
  LocalChanges,
  ModelData,
  ModelField,
  Models,
  SyncAction,
} from './core';
import type { Result } from './typeUtils';

export type ModelId = string;

export type ModelChangeSnapshot<
  M extends Models,
  ModelName extends keyof M & string,
> =
  | {
      transactionId: number;
      type: 'insert';
      data: ModelData<M, ModelName>;
    }
  | {
      transactionId: number;
      type: 'update';
      changes: ModelPendingChange<M, ModelName>;
    }
  | {
      transactionId: number;
      type: 'delete';
      // originalData: ModelData<M, ModelName>;
    };

export type PendingTransaction<M extends Models> = {
  transactionId: number;
  lastSyncId: number | null;
  affectedModels: readonly {
    modelName: keyof M & string;
    modelId: ModelId;
  }[];
};

// TODO: What's the point of this if we aren't storing the "optimistic" version of the data?
// Would a downstream consumer find this interesting?
type ModelPendingChange<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  [K in keyof ModelData<M, ModelName>]?: {
    // original: ModelData<M, ModelName>[K];
    updated: ModelData<M, ModelName>[K];
  };
};

export type InMemoryTransactionalState<M extends Models> = {
  lastSyncId: number;
  getChangeSnapshots: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
  ) => readonly ModelChangeSnapshot<M, ModelName>[] | undefined;
  pendingTransactions: readonly PendingTransaction<M>[];
};

export type ToProcessMessage<M extends Models> =
  | SyncMessage<M>
  | StartTransactionMessage<M>
  | CommitTransactionMessage
  | RollbackTransactionMessage
  | SyncCatchUpMessage<M>;
type SyncMessage<M extends Models> = {
  type: 'sync';
  lastSyncId: number;
  sync: SyncAction<M, keyof M & string>[];
};
type StartTransactionMessage<M extends Models> = {
  type: 'startTransaction';
  transactionId: number;
  changes: LocalChanges<M>;
};
type CommitTransactionMessage = {
  type: 'commitTransaction';
  transactionId: number;
  lastSyncId: number;
};
type RollbackTransactionMessage = {
  type: 'rollbackTransaction';
  transactionId: number;
};
export type SyncCatchUpMessage<M extends Models> = {
  type: 'syncCatchUp';
  lastSyncId: number;
  sync: SyncAction<M, keyof M & string>[];
};

type ModelChangeSnapshots<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  modelName: ModelName;
  modelId: string;
  changeSnapshots: ModelChangeSnapshot<M, ModelName>[];
};

export type ModelDataPatch<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  modelName: ModelName;
  modelId: string;
  data: ModelData<M, ModelName> | undefined;
};

export type StateUpdate<M extends Models> = {
  lastSyncId: number | undefined;
  modelDataPatches: readonly ModelDataPatch<M, keyof M & string>[];
  modelChangeSnapshots: readonly ModelChangeSnapshots<M, keyof M & string>[];
  addPendingTransaction: PendingTransaction<M> | undefined;
  commitPendingTransaction:
    | { transactionId: number; lastSyncId: number }
    | undefined;
  removePendingTransactionIds: readonly number[];
};

export const getStateUpdate = <M extends Models>(
  state: InMemoryTransactionalState<M>,
  message: ToProcessMessage<M>,
): StateUpdate<M> | null => {
  if (message.type === 'sync' || message.type === 'syncCatchUp') {
    return getUpdatedStateForSync(state, message);
  }

  if (message.type === 'startTransaction') {
    return getOptimisticUpdateForTransactionStart(state, message);
  } else if (message.type === 'commitTransaction') {
    const result = getOptimisticUpdateForTransactionCommit(state, message);
    if (!result.ok) {
      console.error(`Could not process commit transactions message`, {
        message,
        error: result.error,
      });
      return null;
    }
    return result.value;
  } else {
    const result = getUpdatedStateForTransactionRollback(state, message);
    if (!result.ok) {
      console.error(`Could not process rollback transactions message`, {
        message,
        error: result.error,
      });
      return null;
    }
    return result.value;
  }
};

function getUpdatedStateForSync<M extends Models>(
  {
    lastSyncId: stateLastSyncId,
    getChangeSnapshots,
    pendingTransactions,
  }: InMemoryTransactionalState<M>,
  message: SyncMessage<M> | SyncCatchUpMessage<M>,
): StateUpdate<M> {
  let newLastSyncId: number | undefined = message.lastSyncId;
  const sync = message.sync;
  if (newLastSyncId <= stateLastSyncId) {
    if (message.type === 'sync') {
      return {
        lastSyncId: undefined,
        modelChangeSnapshots: [],
        modelDataPatches: [],
        addPendingTransaction: undefined,
        commitPendingTransaction: undefined,
        removePendingTransactionIds: [],
      };
    } else {
      newLastSyncId = undefined;
    }
  }

  // Step 1: Get updated data
  // Go through all syncActions to determine what the latest data is
  // Create state patches w/o changeSnapshots - these will be set below only once based on the final data
  const modelDataPatches: ModelDataPatch<M, keyof M & string>[] = [];
  for (const syncAction of sync) {
    if (message.type === 'sync' && syncAction.syncId <= stateLastSyncId) {
      continue;
    }

    const existingDataPatch = modelDataPatches.find(
      (p) =>
        p.modelId === syncAction.modelId &&
        p.modelName === syncAction.modelName,
    );

    if (syncAction.action === 'insert') {
      if (existingDataPatch) {
        existingDataPatch.data = syncAction.data;
      } else {
        modelDataPatches.push({
          modelId: syncAction.modelId,
          modelName: syncAction.modelName,
          data: syncAction.data,
        });
      }
    } else if (syncAction.action === 'update') {
      if (existingDataPatch) {
        existingDataPatch.data = syncAction.data;
      } else {
        modelDataPatches.push({
          modelId: syncAction.modelId,
          modelName: syncAction.modelName,
          data: syncAction.data,
        });
      }
    } else if (syncAction.action === 'delete') {
      if (existingDataPatch) {
        existingDataPatch.data = undefined;
      } else {
        modelDataPatches.push({
          modelId: syncAction.modelId,
          modelName: syncAction.modelName,
          data: undefined,
        });
      }
    }
  }

  // Step 2: Find transactions that occurred before or at lastSyncId
  const removeTransactions: PendingTransaction<M>[] = [];
  if (newLastSyncId !== undefined) {
    for (const transaction of pendingTransactions) {
      if (
        transaction.lastSyncId !== null &&
        transaction.lastSyncId <= newLastSyncId
      ) {
        removeTransactions.push(transaction);
      }
    }
  }

  // Step 3: rollback all of the "removed transactions"
  let modelChangeSnapshots: readonly ModelChangeSnapshots<
    M,
    keyof M & string
  >[] = [];
  for (const transaction of removeTransactions) {
    modelChangeSnapshots = removeChangeSnapshotsOfTransaction(
      transaction,
      getChangeSnapshots,
      modelChangeSnapshots,
    );
  }

  return {
    lastSyncId: newLastSyncId,
    modelDataPatches,
    modelChangeSnapshots,
    addPendingTransaction: undefined,
    commitPendingTransaction: undefined,
    removePendingTransactionIds: removeTransactions.map((t) => t.transactionId),
  };
}

function getOptimisticUpdateForTransactionStart<M extends Models>(
  { getChangeSnapshots }: InMemoryTransactionalState<M>,
  { transactionId, changes }: StartTransactionMessage<M>,
): StateUpdate<M> {
  const modelChangeSnapshots: ModelChangeSnapshots<M, keyof M & string>[] = [];

  for (const change of changes) {
    const pendingModelChangeSnapshots = modelChangeSnapshots.find(
      (c) => c.modelId === change.modelId && c.modelName === change.modelName,
    );
    const initialModelChangeSnapshots =
      getChangeSnapshots(change.modelName, change.modelId) ?? [];

    let newSnapshot: ModelChangeSnapshot<M, keyof M & string>;
    if (change.action === 'create') {
      newSnapshot = {
        transactionId,
        type: 'insert',
        data: change.data,
      };
    } else if (change.action === 'update') {
      const changes: ModelPendingChange<M, keyof M & string> = {};
      for (const key in change.data) {
        const modelKey = key as keyof typeof change.data & string;
        const updated = change.data[modelKey] as
          | ModelData<M, keyof M & string>[typeof modelKey]
          | undefined;

        if (updated !== undefined) {
          changes[modelKey] = {
            updated,
          };
        }
      }
      newSnapshot = {
        transactionId,
        type: 'update',
        changes,
      };
    } else {
      newSnapshot = {
        transactionId,
        type: 'delete',
      };
    }

    if (pendingModelChangeSnapshots) {
      pendingModelChangeSnapshots.changeSnapshots.push(newSnapshot);
    } else {
      modelChangeSnapshots.push({
        modelId: change.modelId,
        modelName: change.modelName,
        changeSnapshots: [...initialModelChangeSnapshots, newSnapshot],
      });
    }
  }

  return {
    lastSyncId: undefined,
    modelDataPatches: [],
    modelChangeSnapshots,
    addPendingTransaction: {
      transactionId,
      lastSyncId: null,
      affectedModels: modelChangeSnapshots.map((u) => ({
        modelId: u.modelId,
        modelName: u.modelName,
      })),
    },
    commitPendingTransaction: undefined,
    removePendingTransactionIds: [],
  };
}

function getOptimisticUpdateForTransactionCommit<M extends Models>(
  {
    lastSyncId: stateLastSyncId,
    pendingTransactions,
    getChangeSnapshots,
  }: InMemoryTransactionalState<M>,
  {
    transactionId,
    lastSyncId: transactionLastSyncId,
  }: CommitTransactionMessage,
): Result<StateUpdate<M> | null, string> {
  const toCommitTransaction = pendingTransactions.find(
    (t) => t.transactionId === transactionId,
  );
  if (!toCommitTransaction) {
    return {
      ok: false,
      error: 'Could not find transaction to commit',
    };
  }
  if (toCommitTransaction.lastSyncId !== null) {
    return {
      ok: false,
      error: 'Cannot commit transaction that has already been committed',
    };
  }

  let modelChangeSnapshots: readonly ModelChangeSnapshots<
    M,
    keyof M & string
  >[] = [];
  if (transactionLastSyncId <= stateLastSyncId) {
    // This means that the sync action for this transaction already came through
    // That means the rollback of this transaction couldn't have happened when processing the sync action
    // So we need to do that here
    modelChangeSnapshots = removeChangeSnapshotsOfTransaction(
      toCommitTransaction,
      getChangeSnapshots,
      modelChangeSnapshots,
    );
  }

  return {
    ok: true,
    value: {
      lastSyncId: undefined,
      modelChangeSnapshots,
      modelDataPatches: [],
      addPendingTransaction: undefined,
      commitPendingTransaction: {
        lastSyncId: transactionLastSyncId,
        transactionId,
      },
      removePendingTransactionIds: [],
    },
  };
}

function getUpdatedStateForTransactionRollback<M extends Models>(
  { getChangeSnapshots, pendingTransactions }: InMemoryTransactionalState<M>,
  { transactionId }: RollbackTransactionMessage,
): Result<StateUpdate<M>, string> {
  const rollbackTransaction = pendingTransactions.find(
    (t) => t.transactionId == transactionId,
  );
  if (!rollbackTransaction) {
    return {
      ok: false,
      error: 'Could not find transaction to rollback',
    };
  }
  if (rollbackTransaction.lastSyncId !== null) {
    return {
      ok: false,
      error: 'Cannot rollback transaction that has already been committed',
    };
  }

  const modelChangeSnapshots = removeChangeSnapshotsOfTransaction(
    rollbackTransaction,
    getChangeSnapshots,
  );

  return {
    ok: true,
    value: {
      lastSyncId: undefined,
      modelDataPatches: [],
      modelChangeSnapshots,
      addPendingTransaction: undefined,
      commitPendingTransaction: undefined,
      removePendingTransactionIds: [transactionId],
    },
  };
}

// Used for transaction rollback AND apply sync action
function removeChangeSnapshotsOfTransaction<M extends Models>(
  rollbackTransaction: PendingTransaction<M>,
  getChangeSnapshots: InMemoryTransactionalState<M>['getChangeSnapshots'],
  currentChangeSnapshots: readonly ModelChangeSnapshots<
    M,
    keyof M & string
  >[] = [],
): readonly ModelChangeSnapshots<M, keyof M & string>[] {
  const transactionId = rollbackTransaction.transactionId;
  const modelChangeSnapshots: ModelChangeSnapshots<M, keyof M & string>[] = [
    ...currentChangeSnapshots,
  ];

  for (const { modelId, modelName } of rollbackTransaction.affectedModels) {
    const pendingModelChangeSnapshots = modelChangeSnapshots.find(
      (c) => c.modelId === modelId && c.modelName === modelName,
    );
    const initialModelChangeSnapshots = getChangeSnapshots(modelName, modelId);

    if (pendingModelChangeSnapshots) {
      pendingModelChangeSnapshots.changeSnapshots =
        pendingModelChangeSnapshots.changeSnapshots.filter(
          (c) => c.transactionId !== transactionId,
        );
    } else if (initialModelChangeSnapshots) {
      modelChangeSnapshots.push({
        modelId,
        modelName,
        changeSnapshots: initialModelChangeSnapshots.filter(
          (c) => c.transactionId !== transactionId,
        ),
      });
    }
  }

  return modelChangeSnapshots;
}

export const getOptimisticData = <
  M extends Models,
  ModelName extends keyof M & string,
>(
  data: ModelData<M, ModelName> | undefined,
  changeSnapshots: readonly ModelChangeSnapshot<M, ModelName>[] | undefined,
): ModelData<M, ModelName> | undefined => {
  if (!changeSnapshots) {
    return data;
  }

  let currentData = data;
  for (const snapshot of changeSnapshots) {
    if (snapshot.type === 'insert') {
      currentData = snapshot.data;
    } else if (snapshot.type === 'update') {
      if (currentData) {
        const patch: Partial<ModelData<M, ModelName>> = {};
        for (const key in snapshot.changes) {
          const modelKey = key as ModelField<M, ModelName>;
          const change = snapshot.changes[key];
          if (change) {
            patch[modelKey] = change.updated as Partial<
              ModelData<M, ModelName>
            >[typeof modelKey];
          }
        }
        currentData = {
          ...currentData,
          ...patch,
        };
      }
    } else if (snapshot.type === 'delete') {
      currentData = undefined;
    }
  }

  return currentData;
};
