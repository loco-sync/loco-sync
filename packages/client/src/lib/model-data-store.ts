import { modelObjectKey, type ModelData, type Models } from './core';
import { dataPassesFilter, type ModelFilter } from './filters';
import {
  getOptimisticData,
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

  processMessage: (message: ToProcessMessage<M>) => void;

  subscribe: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter: ModelFilter<M, ModelName> | undefined,
    listener: () => void,
  ) => () => void;

  setMany: <ModelName extends keyof M & string>(
    modelName: ModelName,
    data: ModelData<M, ModelName>[],
    tombstoneModelObjectKeys: Set<string>,
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

export type CreateModelDataStoreOptions = {
  verbose?: boolean;
};

export const createModelDataStore = <M extends Models>(
  opts?: CreateModelDataStoreOptions,
): ModelDataStore<M> => {
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
    const newOptimisticData = getOptimisticData(data, newChangeSnapshots);
    modelMap.set(modelId, {
      confirmedData: data,
      changeSnapshots: newChangeSnapshots,
      optimisticData: newOptimisticData,
    });
    addListenersForModel(
      listeners,
      modelName,
      modelId,
      prev?.optimisticData,
      newOptimisticData,
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
    const newOptimisticData = getOptimisticData(
      prev?.confirmedData,
      changeSnapshots,
    );
    modelMap.set(modelId, {
      confirmedData: prev?.confirmedData,
      changeSnapshots,
      optimisticData: newOptimisticData,
    });
    addListenersForModel(
      listeners,
      modelName,
      modelId,
      prev?.optimisticData,
      newOptimisticData,
    );
  };

  const setMany = <ModelName extends keyof M & string>(
    modelName: ModelName,
    allData: ModelData<M, ModelName>[],
    tombstoneModelObjectKeys: Set<string>,
  ) => {
    const listeners: Listeners = new Set();
    for (const data of allData) {
      const modelId = data.id;
      const key = modelObjectKey<M>({ modelName, modelId });
      if (tombstoneModelObjectKeys.has(key)) {
        continue;
      }

      let modelMap = modelsData.get(modelName);
      if (!modelMap) {
        modelMap = new Map();
        modelsData.set(modelName, modelMap);
      }

      // Data passed to setMany shouldn't be in the store yet, so skip if it is
      // There may be some edge cases where we want to allow this
      // We may also need to treat data from "storage" and data from "lazy bootstrap" differently
      const prev = modelMap.get(data.id);
      if (prev) {
        continue;
      }

      const newOptimisticData = getOptimisticData(data, undefined);
      modelMap.set(modelId, {
        confirmedData: data,
        changeSnapshots: undefined,
        optimisticData: newOptimisticData,
      });
      addListenersForModel(
        listeners,
        modelName,
        modelId,
        undefined,
        newOptimisticData,
      );
    }
    for (const listener of listeners) {
      listener();
    }
  };

  const processMessage = (message: ToProcessMessage<M>) => {
    if (opts?.verbose) {
      console.log('processMessage', message);
    }
    const update = getStateUpdate(
      {
        lastSyncId,
        pendingTransactions,
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
    subscribe,
    listenerCount,
    logModelsData,
  };
};
