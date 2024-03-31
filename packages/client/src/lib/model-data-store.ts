import type { BootstrapPayload, ModelData, ModelFilter, Models } from './core';
import {
  applyChangeSnapshotsToData,
  getStateUpdate,
  type ModelChangeSnapshot,
  type ModelId,
  type PendingTransaction,
  type ToProcessMessage,
} from './transactionUtils';

export type ModelDataStore<M extends Models> = {
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
    filter?: ModelFilter<M, ModelName>,
  ) => ModelData<M, ModelName>[];

  /**
   *
   * @param modelName
   * @param modelId
   * @returns optimistic data (by applying change snapshots)
   */
  getOne: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter?: ModelFilter<M, ModelName>,
  ) => ModelData<M, ModelName> | undefined;

  loadBootstrap: (payload: BootstrapPayload<M>) => void;
  processMessage: (message: ToProcessMessage<M>) => void;

  subscribe: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter: ModelFilter<M, ModelName> | undefined,
    listener: () => void,
  ) => () => void;

  setMany: <ModelName extends keyof M & string>(
    modelName: ModelName,
    data: ModelData<M, ModelName>[],
  ) => void;

  /**
   * @intenal
   */
  logModelsData: () => void;

  /**
   *
   * @param modelName
   * @param modelId
   * @returns confirmed data, to be used by transaction utils
   */
  getConfirmedData: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
  ) => ModelData<M, ModelName> | undefined;

  /**
   * to be used by transaction utils
   */
  getChangeSnapshots: <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
  ) => readonly ModelChangeSnapshot<M, ModelName>[] | undefined;

  listenerCount(): number;
};

type Listener = () => void;
type Listeners = Set<Listener>;

export const createModelDataStore = <M extends Models>(): ModelDataStore<M> => {
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

  type FilterListeners = Set<{
    filter?: ModelFilter<M, keyof M & string>;
    listener: Listener;
  }>;

  const allModelNameListeners: Map<keyof M & string, FilterListeners> =
    new Map();

  let lastSyncId = 0;
  let pendingTransactions: PendingTransaction<M>[] = [];

  const getConfirmedData = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
  ) => {
    return modelsData.get(modelName)?.get(modelId)?.confirmedData as
      | ModelData<M, ModelName>
      | undefined;
  };

  const getChangeSnapshots = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
  ) => {
    return modelsData.get(modelName)?.get(modelId)?.changeSnapshots as
      | readonly ModelChangeSnapshot<M, ModelName>[]
      | undefined;
  };

  const getOne = <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter?: ModelFilter<M, ModelName>,
  ) => {
    const modelMap = modelsData.get(modelName);
    if (!modelMap) {
      return undefined;
    }
    for (const { optimisticData } of modelMap.values()) {
      if (optimisticData) {
        if (!filter || dataPassesFilter(optimisticData, filter)) {
          return optimisticData as ModelData<M, ModelName>;
        }
      }
    }
    return undefined;
  };

  const getMany = <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter?: ModelFilter<M, ModelName>,
  ) => {
    const result: ModelData<M, ModelName>[] = [];
    const modelMap = modelsData.get(modelName);
    if (!modelMap) {
      return [];
    }
    for (const { optimisticData } of modelMap.values()) {
      if (optimisticData) {
        if (!filter || dataPassesFilter(optimisticData, filter)) {
          result.push(optimisticData as ModelData<M, ModelName>);
        }
      }
    }
    return result;
  };

  const setData = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    data: ModelData<M, ModelName> | undefined,
    maybeChangeSnapshots: ModelChangeSnapshot<M, ModelName>[] | undefined,
    listeners: Listeners,
  ) => {
    let modelMap = modelsData.get(modelName);
    if (!modelMap) {
      modelMap = new Map();
      modelsData.set(modelName, modelMap);
    }
    const prev = modelsData.get(modelName)?.get(modelId);
    const newChangeSnapshots = maybeChangeSnapshots ?? prev?.changeSnapshots;
    const newOptimisticDataResult = applyChangeSnapshotsToData(
      data,
      newChangeSnapshots,
    );
    if (!newOptimisticDataResult.ok) {
      console.error(
        'setData get optimistic data failed',
        newOptimisticDataResult.error,
      );
      return;
    }
    modelMap.set(modelId, {
      confirmedData: data,
      changeSnapshots: newChangeSnapshots,
      optimisticData: newOptimisticDataResult.value,
    });
    addListenersForModel(
      listeners,
      modelName,
      modelId,
      prev?.optimisticData,
      newOptimisticDataResult.value,
    );
  };

  const setChangeSnapshots = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
    changeSnapshots: readonly ModelChangeSnapshot<M, ModelName>[],
    listeners: Listeners,
  ) => {
    let modelMap = modelsData.get(modelName);
    if (!modelMap) {
      modelMap = new Map();
      modelsData.set(modelName, modelMap);
    }
    const prev = modelsData.get(modelName)?.get(modelId);
    const newOptimisticDataResult = applyChangeSnapshotsToData(
      prev?.confirmedData,
      changeSnapshots,
    );
    if (!newOptimisticDataResult.ok) {
      console.error(
        'setChangeSnapshots get optimistic data failed',
        newOptimisticDataResult.error,
      );
      return;
    }
    modelMap.set(modelId, {
      confirmedData: prev?.confirmedData,
      changeSnapshots,
      optimisticData: newOptimisticDataResult.value,
    });
    addListenersForModel(
      listeners,
      modelName,
      modelId,
      prev?.optimisticData,
      newOptimisticDataResult.value,
    );
  };

  const setMany = <ModelName extends keyof M & string>(
    modelName: ModelName,
    data: ModelData<M, ModelName>[],
  ) => {
    const listeners: Listeners = new Set();
    for (const d of data) {
      setData(modelName, d.id, d, undefined, listeners);
    }
    for (const listener of listeners) {
      listener();
    }
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
          ]),
        ),
      );
    }

    notifyAllListeners();
  };

  const processMessage = (message: ToProcessMessage<M>) => {
    const update = getStateUpdate(
      {
        lastSyncId,
        pendingTransactions,
        getData: getConfirmedData,
        getChangeSnapshots: getChangeSnapshots,
      },
      message,
    );
    if (!update) {
      return;
    }

    const {
      lastSyncId: _lastSyncId,
      addPendingTransaction,
      commitPendingTransaction,
      removePendingTransactionIds,
      modelDataPatches,
      modelChangeSnapshots,
    } = update;

    if (_lastSyncId) {
      lastSyncId = _lastSyncId;
    }

    if (addPendingTransaction) {
      pendingTransactions.push(addPendingTransaction);
    }

    if (commitPendingTransaction) {
      const toCommit = pendingTransactions.find(
        (t) => t.transactionId === commitPendingTransaction.transactionId,
      );
      if (toCommit) {
        toCommit.lastSyncId = commitPendingTransaction.lastSyncId;
      }
    }

    if (removePendingTransactionIds) {
      pendingTransactions = pendingTransactions.filter(
        (t) => !removePendingTransactionIds.includes(t.transactionId),
      );
    }

    const processedModels = new Set<string>();
    const listeners: Listeners = new Set();

    for (const patch of modelDataPatches) {
      const maybeModelChangeSnapshots = modelChangeSnapshots.find(
        (c) => c.modelId === patch.modelId && c.modelName === patch.modelName,
      );
      setData(
        patch.modelName,
        patch.modelId,
        patch.data,
        maybeModelChangeSnapshots?.changeSnapshots,
        listeners,
      );
      processedModels.add(getModelNameId(patch.modelName, patch.modelId));
    }

    for (const patch of modelChangeSnapshots) {
      if (
        !processedModels.has(getModelNameId(patch.modelName, patch.modelId))
      ) {
        setChangeSnapshots(
          patch.modelName,
          patch.modelId,
          patch.changeSnapshots,
          listeners,
        );
      }
    }

    for (const listener of listeners) {
      listener();
    }
  };

  const subscribe = <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter: ModelFilter<M, ModelName> | undefined,
    listener: () => void,
  ) => {
    let modelNameListeners = allModelNameListeners.get(modelName);
    if (!modelNameListeners) {
      modelNameListeners = new Set();
      allModelNameListeners.set(modelName, modelNameListeners);
    }
    const filterListener = { filter, listener };
    modelNameListeners.add(filterListener);
    return () => modelNameListeners?.delete(filterListener);
  };

  const addListenersForModel = <ModelName extends keyof M & string>(
    listeners: Listeners,
    modelName: ModelName,
    modelId: ModelId,
    prevData: ModelData<M, ModelName> | undefined,
    nextData: ModelData<M, ModelName> | undefined,
  ) => {
    const modelNameListeners = allModelNameListeners.get(modelName);
    if (modelNameListeners) {
      for (const { filter, listener } of modelNameListeners.values()) {
        if (!filter) {
          listeners.add(listener);
        } else if (prevData && dataPassesFilter(prevData, filter)) {
          listeners.add(listener);
        } else if (nextData && dataPassesFilter(nextData, filter)) {
          listeners.add(listener);
        }
      }
    }
  };

  const notifyAllListeners = () => {
    const listeners: Listeners = new Set();

    for (const filterListeners of allModelNameListeners.values()) {
      for (const { listener } of filterListeners.values()) {
        listeners.add(listener);
      }
    }

    for (const listener of listeners) {
      listener();
    }
  };

  const getModelNameId = <ModelName extends keyof M & string>(
    modelName: ModelName,
    modelId: ModelId,
  ) => `${modelName}:${modelId}`;

  const listenerCount = () => {
    let count = 0;
    for (const l of allModelNameListeners.values()) {
      count += l.size;
    }

    return count;
  };

  const logModelsData = () => {
    JSON.stringify(modelsData, null, 2);
  };

  return {
    lastSyncId: () => lastSyncId,
    pendingTransactions: () => pendingTransactions,
    getConfirmedData,
    getChangeSnapshots,
    getOne,
    getMany,
    setMany,
    processMessage,
    loadBootstrap,
    subscribe,
    listenerCount,
    logModelsData,
  };
};

export const dataPassesFilter = <
  M extends Models,
  ModelName extends keyof M & string,
>(
  data: ModelData<M, ModelName>,
  filter: ModelFilter<M, ModelName>,
): boolean => {
  for (const filterKey in filter) {
    const filterValue = filter[filterKey];
    if (data[filterKey] !== filterValue) {
      return false;
    }
  }
  return true;
};
