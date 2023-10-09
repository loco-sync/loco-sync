import type {
  LocalChange,
  LocalChanges,
  ModelData,
  Models,
  SyncAction,
} from './core';
import type { Result } from './typeUtils';

export type ModelId = string;

export type ModelChangeSnapshot<
  M extends Models,
  ModelName extends keyof M & string
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
  ModelName extends keyof M & string
> = {
  [K in keyof ModelData<M, ModelName>]?: {
    // original: ModelData<M, ModelName>[K];
    updated: ModelData<M, ModelName>[K];
  };
};

export type InMemoryTransactionalState<M extends Models> = {
  lastSyncId: number;
  getData: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => ModelData<M, ModelName> | undefined;
  getChangeSnapshots: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => readonly ModelChangeSnapshot<M, ModelName>[] | undefined;
  pendingTransactions: readonly PendingTransaction<M>[];
};

export type ToProcessMessage<M extends Models> =
  | SyncMessage<M>
  | StartTransactionMessage<M>
  | CommitTransactionMessage
  | RollbackTransactionMessage;
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

type ModelChangeSnapshots<
  M extends Models,
  ModelName extends keyof M & string
> = {
  modelName: ModelName;
  modelId: string;
  changeSnapshots: ModelChangeSnapshot<M, ModelName>[];
};

export type ModelDataPatch<
  M extends Models,
  ModelName extends keyof M & string
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
  message: ToProcessMessage<M>
): StateUpdate<M> | null => {
  if (message.type === 'sync') {
    const result = getUpdatedStateForSync(state, message);
    if (!result.ok) {
      console.error(`Could not process sync message`, {
        message,
        errors: result.error,
      });
      return null;
    }
    return result.value;
  }

  if (message.type === 'startTransaction') {
    const result = getOptimisticUpdateForTransactionStart(state, message);
    if (!result.ok) {
      console.error(`Could not process start transactions message`, {
        message,
        errors: result.error,
      });
      return null;
    }
    return result.value;
  } else if (message.type === 'commitTransaction') {
    const result = getOptimisticUpdateForTransactionCommit(state, message);
    if (!result.ok) {
      console.error(`Could not process commit transactions message`, {
        message,
        errors: result.error,
      });
      return null;
    }
    return result.value;
  } else {
    const result = getUpdatedStateForTransactionRollback(state, message);
    if (!result.ok) {
      console.error(`Could not process rollback transactions message`, {
        message,
        errors: result.error,
      });
      return null;
    }
    return result.value;
  }
};

function getUpdatedStateForSync<M extends Models>(
  {
    lastSyncId: stateLastSyncId,
    getData,
    getChangeSnapshots,
    pendingTransactions,
  }: InMemoryTransactionalState<M>,
  { lastSyncId: messageLastSyncId, sync }: SyncMessage<M>
): Result<StateUpdate<M>, string[]> {
  if (messageLastSyncId <= stateLastSyncId) {
    return {
      ok: true,
      value: {
        lastSyncId: undefined,
        modelChangeSnapshots: [],
        modelDataPatches: [],
        addPendingTransaction: undefined,
        commitPendingTransaction: undefined,
        removePendingTransactionIds: [],
      },
    };
  }

  const errorMessages: string[] = [];

  // Step 1: Get updated data
  // Go through all syncActions to determine what the latest data is
  // Create state patches w/o changeSnapshots - these will be set below only once based on the final data
  const modelDataPatches: ModelDataPatch<M, keyof M & string>[] = [];
  for (const syncAction of sync) {
    if (syncAction.syncId <= stateLastSyncId) {
      continue;
    }

    const existingDataPatch = modelDataPatches.find(
      (p) =>
        p.modelId === syncAction.modelId && p.modelName === syncAction.modelName
    );
    const currentModelData = existingDataPatch
      ? existingDataPatch.data
      : getData(syncAction.modelName, syncAction.modelId);

    if (syncAction.action === 'insert') {
      if (currentModelData) {
        errorMessages.push(
          `Insert failed: ${syncAction.modelName} ${syncAction.modelId} already exists`
        );
      } else if (existingDataPatch) {
        existingDataPatch.data = syncAction.data;
      } else {
        modelDataPatches.push({
          modelId: syncAction.modelId,
          modelName: syncAction.modelName,
          data: syncAction.data,
        });
      }
    } else if (syncAction.action === 'update') {
      if (!currentModelData) {
        errorMessages.push(
          `Update failed: ${syncAction.modelName} ${syncAction.modelId} does not exist`
        );
      } else if (existingDataPatch) {
        existingDataPatch.data = syncAction.data;
      } else {
        modelDataPatches.push({
          modelId: syncAction.modelId,
          modelName: syncAction.modelName,
          data: syncAction.data,
        });
      }
    } else if (syncAction.action === 'delete') {
      if (!currentModelData) {
        errorMessages.push(
          `Delete failed: ${syncAction.modelName} ${syncAction.modelId} does not exist`
        );
      } else if (existingDataPatch) {
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
  const removedTransactions: PendingTransaction<M>[] = [];
  const nextPendingTransactions: PendingTransaction<M>[] = [];
  for (const transaction of pendingTransactions) {
    if (
      transaction.lastSyncId === null ||
      transaction.lastSyncId > messageLastSyncId
    ) {
      nextPendingTransactions.push(transaction);
    } else {
      removedTransactions.push(transaction);
    }
  }

  // Step 3: rollback all of the "removed transactions"
  let modelChangeSnapshots: readonly ModelChangeSnapshots<
    M,
    keyof M & string
  >[] = [];
  for (const transaction of removedTransactions) {
    modelChangeSnapshots = removeChangeSnapshotsOfTransaction(
      transaction,
      getChangeSnapshots,
      modelChangeSnapshots
    );
  }

  if (errorMessages.length > 0) {
    return {
      ok: false,
      error: errorMessages,
    };
  }

  return {
    ok: true,
    value: {
      lastSyncId: messageLastSyncId,
      modelDataPatches,
      modelChangeSnapshots,
      addPendingTransaction: undefined,
      commitPendingTransaction: undefined,
      removePendingTransactionIds: removedTransactions.map(
        (t) => t.transactionId
      ),
    },
  };
}

function getOptimisticUpdateForTransactionStart<M extends Models>(
  { getChangeSnapshots, getData }: InMemoryTransactionalState<M>,
  { transactionId, changes }: StartTransactionMessage<M>
): Result<StateUpdate<M>, string[]> {
  const errorMessages: string[] = [];
  const modelChangeSnapshots: ModelChangeSnapshots<M, keyof M & string>[] = [];

  const flatChanges: LocalChange<M, keyof M & string>[] = [];
  for (const modelName in changes) {
    const modelChanges = changes[modelName];
    if (modelChanges) {
      flatChanges.push(...modelChanges);
    }
  }

  for (const change of flatChanges) {
    const confirmedModelData = getData(change.modelName, change.modelId);

    const pendingModelChangeSnapshots = modelChangeSnapshots.find(
      (c) => c.modelId === change.modelId && c.modelName === change.modelName
    );
    const initialModelChangeSnapshots =
      getChangeSnapshots(change.modelName, change.modelId) ?? [];
    const currentModelChangeSnapshots =
      pendingModelChangeSnapshots?.changeSnapshots ??
      initialModelChangeSnapshots ??
      [];

    const currentModelData = applyChangeSnapshotsToData(
      confirmedModelData,
      currentModelChangeSnapshots
    );
    if (typeof currentModelData === 'string') {
      errorMessages.push(currentModelData);
      continue;
    }

    let errorMessage: string | undefined;
    let newSnapshot: ModelChangeSnapshot<M, keyof M & string> | undefined;

    if (change.action === 'create') {
      if (currentModelData) {
        errorMessage = `Insert failed: ${change.modelName} ${change.modelId} data already exists`;
      } else if (currentModelChangeSnapshots.length > 0) {
        // Would not be an error if insert after delete is allowed
        errorMessage = `Insert failed: ${change.modelName} ${change.modelId} change snapshots already exists`;
      } else {
        newSnapshot = {
          transactionId,
          type: 'insert',
          data: change.data,
        };
      }
    } else if (change.action === 'update') {
      if (!currentModelData) {
        errorMessage = `Update failed: ${change.modelName} ${change.modelId} does not exist`;
      } else {
        const changes: ModelPendingChange<M, keyof M & string> = {};
        for (const key in change.data) {
          const modelKey = key as keyof typeof change.data & string;
          const updated = change.data[modelKey] as
            | ModelData<M, keyof M & string>[typeof modelKey]
            | undefined;

          if (updated !== undefined) {
            changes[modelKey] = {
              // original: currentModelData[modelKey],
              updated,
            };
          }
        }
        newSnapshot = {
          transactionId,
          type: 'update',
          changes,
        };
      }
    } else if (change.action === 'delete') {
      if (!currentModelData) {
        errorMessage = `Delete failed: ${change.modelName} ${change.modelId} does not exist`;
      } else {
        newSnapshot = {
          transactionId,
          type: 'delete',
          // originalData: currentModelData,
        };
      }
    }

    if (errorMessage) {
      errorMessages.push(errorMessage);
    } else if (newSnapshot) {
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
  }

  if (errorMessages.length > 0) {
    return {
      ok: false,
      error: errorMessages,
    };
  }

  return {
    ok: true,
    value: {
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
    },
  };
}

function getOptimisticUpdateForTransactionCommit<M extends Models>(
  {
    lastSyncId: stateLastSyncId,
    pendingTransactions,
  }: InMemoryTransactionalState<M>,
  { transactionId, lastSyncId: messageLastSyncId }: CommitTransactionMessage
): Result<StateUpdate<M> | null, string[]> {
  if (messageLastSyncId <= stateLastSyncId) {
    // This isn't necessarily an error, just means that the sync action for this transaction already came through
    return {
      ok: true,
      value: null,
    };
  }

  const toCommitTransaction = pendingTransactions.find(
    (t) => t.transactionId === transactionId
  );
  if (!toCommitTransaction) {
    return {
      ok: false,
      error: ['Could not find transaction to commit'],
    };
  }
  if (toCommitTransaction.lastSyncId !== null) {
    return {
      ok: false,
      error: ['Cannot commit transaction that has already been committed'],
    };
  }

  return {
    ok: true,
    value: {
      lastSyncId: undefined,
      modelChangeSnapshots: [],
      modelDataPatches: [],
      addPendingTransaction: undefined,
      commitPendingTransaction: {
        lastSyncId: messageLastSyncId,
        transactionId,
      },
      removePendingTransactionIds: [],
    },
  };
}

function getUpdatedStateForTransactionRollback<M extends Models>(
  { getChangeSnapshots, pendingTransactions }: InMemoryTransactionalState<M>,
  { transactionId }: RollbackTransactionMessage
): Result<StateUpdate<M>, string[]> {
  const rollbackTransaction = pendingTransactions.find(
    (t) => t.transactionId == transactionId
  );
  if (!rollbackTransaction) {
    return {
      ok: false,
      error: ['Could not find transaction to rollback'],
    };
  }
  if (rollbackTransaction.lastSyncId !== null) {
    return {
      ok: false,
      error: ['Cannot rollback transaction that has already been committed'],
    };
  }

  const modelChangeSnapshots = removeChangeSnapshotsOfTransaction(
    rollbackTransaction,
    getChangeSnapshots
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
  >[] = []
): readonly ModelChangeSnapshots<M, keyof M & string>[] {
  const transactionId = rollbackTransaction.transactionId;
  const modelChangeSnapshots: ModelChangeSnapshots<M, keyof M & string>[] = [
    ...currentChangeSnapshots,
  ];

  for (const { modelId, modelName } of rollbackTransaction.affectedModels) {
    const pendingModelChangeSnapshots = modelChangeSnapshots.find(
      (c) => c.modelId === modelId && c.modelName === modelName
    );
    const initialModelChangeSnapshots = getChangeSnapshots(modelName, modelId);
    const currentModelChangeSnapshots =
      pendingModelChangeSnapshots?.changeSnapshots ??
      initialModelChangeSnapshots;

    if (!currentModelChangeSnapshots) {
      continue;
    }

    modelChangeSnapshots.push({
      modelId,
      modelName,
      changeSnapshots: currentModelChangeSnapshots.filter(
        (c) => c.transactionId !== transactionId
      ),
    });
  }

  return modelChangeSnapshots;
}

export const applyChangeSnapshotsToData = <
  M extends Models,
  ModelName extends keyof M & string
>(
  data: ModelData<M, ModelName> | undefined,
  changeSnapshots: readonly ModelChangeSnapshot<M, ModelName>[] | undefined
): ModelData<M, ModelName> | undefined | string => {
  if (!changeSnapshots) {
    return data;
  }

  for (const snapshot of changeSnapshots) {
    if (snapshot.type === 'insert') {
      if (data) {
        return 'Invariant violation: insert changeSnapshot on existing data';
      }
      data = snapshot.data;
    } else if (snapshot.type === 'update') {
      if (!data) {
        return 'Invariant violation: update changeSnapshot on missing data';
      }
      const patch: Partial<ModelData<M, ModelName>> = {};
      for (const key in snapshot.changes) {
        const change = snapshot.changes[key];
        if (change) {
          patch[key] = change.updated;
        }
      }
      data = {
        ...data,
        ...patch,
      };
    } else if (snapshot.type === 'delete') {
      if (!data) {
        return 'Invariant violation: delete changeSnapshot on missing data';
      }
      data = undefined;
    }
  }
  return data;
};
