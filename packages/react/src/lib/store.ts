import type {
  ModelData,
  ModelId,
  Models,
  ModelChangeSnapshot,
  PendingTransaction,
  StateUpdate,
  BootstrapPayload,
  ModelFilter,
} from '@loco-sync/client';
import { applyChangeSnapshotsToData } from '@loco-sync/client';
import { v4 } from 'uuid';

export type LocoSyncReactStore<M extends Models> = {
  lastSyncId: () => number;
  pendingTransactions: () => readonly PendingTransaction<M>[];

  /**
   *
   * @param modelName
   * @param modelId
   * @returns optimistic data (by applying change snapshots)
   */
  getMany: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter?: ModelFilter<M, ModelName>
  ) => ModelData<M, ModelName>[];
  /**
   *
   * @param modelName
   * @param modelId
   * @returns optimistic data (by applying change snapshots)
   */
  getOne: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => ModelData<M, ModelName> | undefined;

  loadBootstrap: (payload: BootstrapPayload<M>) => void;
  update: (update: StateUpdate<M>) => void;

  subMany: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter: ModelFilter<M, ModelName> | undefined,
    listener: () => void
  ) => () => void;
  subOne: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    listener: () => void
  ) => () => void;

  /**
   *
   * @param modelName
   * @param modelId
   * @returns confirmed data, to be used by transaction utils
   */
  getConfirmedData: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => ModelData<M, ModelName> | undefined;

  /**
   * to be used by transaction utils
   */
  getChangeSnapshots: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => readonly ModelChangeSnapshot<M, ModelName>[] | undefined;

  listenerCount(): number;
};

type Listener = () => void;
type Listeners = Map<string, Listener>;

export const createLocoSyncReactStore = <
  M extends Models
>(): LocoSyncReactStore<M> => {
  const modelsData: Map<
    keyof M & string,
    Map<
      ModelId,
      {
        confirmedData: ModelData<M, keyof M & string> | undefined;
        changeSnapshots:
          | readonly ModelChangeSnapshot<M, keyof M & string>[]
          | undefined;
        optimisticData: ModelData<M, keyof M & string> | undefined;
      }
    >
  > = new Map();

  type FilterListeners = Map<
    string,
    {
      filter?: ModelFilter<M, keyof M & string>;
      listener: Listener;
    }
  >;

  const allModelNameListeners: Map<keyof M & string, FilterListeners> =
    new Map();
  const allModelNameIdListeners: Map<string, Listeners> = new Map();

  let lastSyncId = 0;
  let pendingTransactions: PendingTransaction<M>[] = [];

  const getConfirmedData = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => {
    return modelsData.get(modelName)?.get(modelId)?.confirmedData as
      | ModelData<M, ModelName>
      | undefined;
  };

  const getChangeSnapshots = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => {
    return modelsData.get(modelName)?.get(modelId)?.changeSnapshots as
      | readonly ModelChangeSnapshot<M, ModelName>[]
      | undefined;
  };

  const getOne = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => {
    return modelsData.get(modelName)?.get(modelId)?.optimisticData as
      | ModelData<M, ModelName>
      | undefined;
  };

  const getMany = <ModelName extends keyof M & string>(
    modelName: ModelName,
    filters?: ModelFilter<M, ModelName>
  ) => {
    const result: ModelData<M, ModelName>[] = [];
    const modelMap = modelsData.get(modelName);
    if (!modelMap) {
      return [];
    }
    for (const { optimisticData } of modelMap.values()) {
      if (optimisticData) {
        if (!filters || modelPredicateFn(optimisticData, filters)) {
          result.push(optimisticData as ModelData<M, ModelName>);
        }
      }
    }
    return result;
  };

  const setData = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    data: ModelData<M, ModelName>,
    maybeChangeSnapshots: ModelChangeSnapshot<M, ModelName>[]
  ) => {
    let modelMap = modelsData.get(modelName);
    if (!modelMap) {
      modelMap = new Map();
      modelsData.set(modelName, modelMap);
    }
    const prev = modelsData.get(modelName)?.get(modelId);
    const newChangeSnapshots = maybeChangeSnapshots ?? prev?.changeSnapshots;
    const newOptimisticData = applyChangeSnapshotsToData(
      data,
      newChangeSnapshots
    );
    if (typeof newOptimisticData === 'string') {
      console.error(newOptimisticData);
      return;
    }
    modelMap.set(modelId, {
      confirmedData: data,
      changeSnapshots: newChangeSnapshots,
      optimisticData: newOptimisticData,
    });
    notifyListenersForModel(
      modelName,
      modelId,
      prev?.optimisticData,
      newOptimisticData
    );
  };

  const deleteData = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => {
    const modelMap = modelsData.get(modelName);
    if (modelMap) {
      const prev = modelsData.get(modelName)?.get(modelId);
      const newOptimisticData = applyChangeSnapshotsToData(
        prev?.confirmedData,
        prev?.changeSnapshots
      );
      if (typeof newOptimisticData === 'string') {
        console.error(newOptimisticData);
        return;
      }

      modelMap.delete(modelId);
      notifyListenersForModel(
        modelName,
        modelId,
        prev?.optimisticData,
        undefined
      );
    }
  };

  const setChangeSnapshots = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    changeSnapshots: readonly ModelChangeSnapshot<M, ModelName>[]
  ) => {
    let modelMap = modelsData.get(modelName);
    if (!modelMap) {
      modelMap = new Map();
      modelsData.set(modelName, modelMap);
    }
    const prev = modelsData.get(modelName)?.get(modelId);
    const newOptimisticData = applyChangeSnapshotsToData(
      prev?.confirmedData,
      changeSnapshots
    );
    if (typeof newOptimisticData === 'string') {
      console.error(newOptimisticData);
      return;
    }
    modelMap.set(modelId, {
      confirmedData: prev?.confirmedData,
      changeSnapshots,
      optimisticData: newOptimisticData,
    });
    notifyListenersForModel(
      modelName,
      modelId,
      prev?.optimisticData,
      newOptimisticData
    );
  };

  const loadBootstrap = (payload: BootstrapPayload<M>) => {
    if (modelsData.size !== 0) {
      console.error('Cannot loadBootstrap if store is not empty');
      return;
    }

    for (const key in payload) {
      const modelName: keyof M & string = key;
      const modelPayload = payload[modelName];
      if (!modelPayload) {
        continue;
      }

      modelsData.set(
        modelName,
        new Map(
          modelPayload.map((p) => [
            p.id,
            {
              confirmedData: p,
              changeSnapshots: undefined,
              optimisticData: p,
            },
          ])
        )
      );
    }

    notifyAllListeners();
  };

  const update = ({
    lastSyncId: _lastSyncId,
    addPendingTransaction,
    commitPendingTransaction,
    removePendingTransactionIds,
    modelDataPatches,
    modelChangeSnapshots,
  }: StateUpdate<M>) => {
    if (_lastSyncId) {
      lastSyncId = _lastSyncId;
    }

    if (addPendingTransaction) {
      pendingTransactions.push(addPendingTransaction);
    }

    if (commitPendingTransaction) {
      const toCommit = pendingTransactions.find(
        (t) => t.transactionId === commitPendingTransaction.transactionId
      );
      if (toCommit) {
        toCommit.lastSyncId = commitPendingTransaction.lastSyncId;
      }
    }

    if (removePendingTransactionIds) {
      pendingTransactions = pendingTransactions.filter(
        (t) => !removePendingTransactionIds.includes(t.transactionId)
      );
    }

    const processedModels = new Set<string>();

    for (const patch of modelDataPatches) {
      if (patch.data) {
        const maybeModelChangeSnapshots = modelChangeSnapshots.find(
          (c) => c.modelId === patch.modelId && c.modelName === patch.modelName
        );
        setData(
          patch.modelName,
          patch.modelId,
          patch.data,
          maybeModelChangeSnapshots?.changeSnapshots ?? []
        );
      } else {
        // TODO: Would there ever be changeSnapshots for this case?
        deleteData(patch.modelName, patch.modelId);
      }
      processedModels.add(getModelNameId(patch.modelName, patch.modelId));
    }

    for (const patch of modelChangeSnapshots) {
      if (
        !processedModels.has(getModelNameId(patch.modelName, patch.modelId))
      ) {
        setChangeSnapshots(
          patch.modelName,
          patch.modelId,
          patch.changeSnapshots
        );
      }
    }
  };

  const subOne = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    listener: () => void
  ) => {
    const modelNameId = `${modelName}:${modelId}`;
    const listenerId = v4();
    let modelNameIdListeners = allModelNameIdListeners.get(modelNameId);
    if (!modelNameIdListeners) {
      modelNameIdListeners = new Map();
      allModelNameIdListeners.set(modelNameId, modelNameIdListeners);
    }
    modelNameIdListeners.set(listenerId, listener);
    return () => {
      modelNameIdListeners?.delete(listenerId);
    };
  };

  const subMany = <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter: ModelFilter<M, ModelName> | undefined,
    listener: () => void
  ) => {
    const listenerId = v4();
    let modelNameListeners = allModelNameListeners.get(modelName);
    if (!modelNameListeners) {
      modelNameListeners = new Map();
      allModelNameListeners.set(modelName, modelNameListeners);
    }
    modelNameListeners.set(listenerId, { filter, listener });
    return () => {
      modelNameListeners?.delete(listenerId);
    };
  };

  const notifyListenersForModel = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    prevData: ModelData<M, ModelName> | undefined,
    nextData: ModelData<M, ModelName> | undefined
  ) => {
    const listenersToCall: Array<() => void> = [];

    const modelNameListeners = allModelNameListeners.get(modelName);
    if (modelNameListeners) {
      for (const { filter, listener } of modelNameListeners.values()) {
        if (!filter) {
          listenersToCall.push(listener);
        } else if (prevData && modelPredicateFn(prevData, filter)) {
          listenersToCall.push(listener);
        } else if (nextData && modelPredicateFn(nextData, filter)) {
          listenersToCall.push(listener);
        }
      }
    }

    const modelNameIdListeners = allModelNameIdListeners.get(
      getModelNameId(modelName, modelId)
    );
    if (modelNameIdListeners) {
      for (const listener of modelNameIdListeners.values()) {
        listenersToCall.push(listener);
      }
    }

    for (const listener of listenersToCall) {
      listener();
    }
  };

  const notifyAllListeners = () => {
    const listenersToCall: Array<() => void> = [];

    for (const filterListeners of allModelNameListeners.values()) {
      for (const { listener } of filterListeners.values()) {
        listenersToCall.push(listener);
      }
    }
    for (const listeners of allModelNameIdListeners.values()) {
      for (const listener of listeners.values()) {
        listenersToCall.push(listener);
      }
    }

    for (const listener of listenersToCall) {
      listener();
    }
  };

  const getModelNameId = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId
  ) => `${modelName}:${modelId}`;

  const listenerCount = () => {
    let count = 0;
    for (const l of allModelNameListeners.values()) {
      count += l.size;
    }
    for (const l of allModelNameIdListeners.values()) {
      count += l.size;
    }
    return count;
  };

  return {
    lastSyncId: () => lastSyncId,
    pendingTransactions: () => pendingTransactions,
    getConfirmedData,
    getChangeSnapshots,
    getOne,
    getMany,
    update,
    loadBootstrap,
    subOne,
    subMany,
    listenerCount,
  };
};

const modelPredicateFn = <M extends Models, ModelName extends keyof M & string>(
  data: ModelData<M, ModelName>,
  filter: ModelFilter<M, ModelName>
): boolean => {
  for (const filterKey in filter) {
    const filterValue = filter[filterKey];
    if (data[filterKey] !== filterValue) {
      return false;
    }
  }
  return true;
};
