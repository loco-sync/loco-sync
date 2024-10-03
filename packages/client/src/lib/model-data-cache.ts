import type { LocoSyncClient } from './client';
import {
  type ModelData,
  type ModelField,
  type Models,
  type ModelsConfig,
  type ModelsSpec,
  type SyncAction,
} from './core';
import { indexAndFilterForLoad } from './indexes';
import {
  dataPassesFilter,
  type LiteralModelFilter,
  type ModelFilter,
} from './filters';
import {
  createModelDataStore,
  type CreateModelDataStoreOptions,
  type ModelDataStore,
} from './model-data-store';
import type { Query } from './query';
import type {
  ModelRelationshipDef,
  ModelRelationshipSelection,
  ModelResult,
  ModelsRelationshipDefs,
} from './relationships';
import type { StorageAdapter } from './storage';
import type { SyncCatchUpMessage, ToProcessMessage } from './transactionUtils';

type AnyQuery<MS extends ModelsSpec> = Query<MS, any, any>;

export type CacheMessage<MS extends ModelsSpec> =
  | ToProcessMessage<MS['models']>
  | ModelLoadingMessage<MS>;

// TODO: Probably add "filter" variety here once we support
// loading from network via model + index + filter value, rather than just via bootstraps at model level
export type ModelLoadingMessage<
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string = keyof MS['models'] & string,
> =
  | {
      type: 'modelDataLoading';
      modelName: ModelName;
      syncGroup: MS['syncGroup'];
    }
  | {
      type: 'modelDataLoaded';
      modelName: ModelName;
      syncGroup: MS['syncGroup'];
      data: ModelData<MS['models'], ModelName>[];
    };

export class ModelDataCache<MS extends ModelsSpec> {
  #store: ModelDataStore<MS['models']>;
  #config: ModelsConfig<MS>;
  #loadModelDataFromStorage: StorageAdapter<MS>['loadModelData'];
  #queries: Set<AnyQuery<MS>>;
  #modelFilterStatuses: ModelMap<MS, ModelFilterStatus<MS>[]>;
  #activeModelLoadOperations: ModelMap<
    MS,
    Set<SyncGroupModelLoadOperation<MS>>
  >;
  #tombstoneModelObjectKeys: Set<string>;

  constructor(
    addClientListener: LocoSyncClient<MS>['addListener'],
    loadModelDataFromStorage: StorageAdapter<MS>['loadModelData'],
    config: ModelsConfig<MS>,
    tombstoneModelObjectKeys: Set<string>,
    storeOpts?: CreateModelDataStoreOptions,
  ) {
    this.#store = createModelDataStore(storeOpts);
    this.#loadModelDataFromStorage = loadModelDataFromStorage;
    this.#config = config;
    this.#tombstoneModelObjectKeys = tombstoneModelObjectKeys;
    this.#queries = new Set();
    const modelNames = Object.keys(
      this.#config.modelDefs,
    ) as (keyof MS['models'] & string)[];

    this.#modelFilterStatuses = new Map(modelNames.map((name) => [name, []]));
    this.#activeModelLoadOperations = new Map(
      modelNames.map((name) => [name, new Set()]),
    );

    addClientListener((message) => {
      if (message.type === 'started') {
        for (const modelName of modelNames) {
          const modelDef = this.#config.modelDefs[modelName];
          if (modelDef.preloadFromStorage) {
            this.loadModelDataAsync(modelName, undefined, {
              called: false,
              unsubscribers: [],
            });
          }
        }
      }
    });
  }

  getStore() {
    return this.#store;
  }

  addQuery(query: AnyQuery<MS>) {
    this.#queries.add(query);
    return this.loadResultsForQuery(query);
  }

  removeQuery(query: AnyQuery<MS>) {
    // TODO: How to unsubscribe this query from store?
    // I think the unsubscribe fns would created in “loadDataForQuery” would need to be stored on the object for access here

    // TBD: Could detect data and drop data that no longer has any queries associated with it
    // TBD: Would probably want to wait for a bit before dropping data in case an equivalent query is re-added
    this.#queries.delete(query);
  }

  processMessage(message: CacheMessage<MS>) {
    if (message.type === 'sync') {
      const filteredSync: typeof message.sync = [];
      for (const syncAction of message.sync) {
        if (syncAction.action === 'insert' || syncAction.action === 'update') {
          const modelFilterStatus = this.#modelFilterStatuses
            .get(syncAction.modelName)
            ?.find((modelFilterStatus) =>
              modelFilterStatus.dataPassesFilter(syncAction.data),
            );

          if (!modelFilterStatus) {
            continue;
          } else if (!modelFilterStatus.isLoaded()) {
            modelFilterStatus.addToPendingSync(syncAction, message.lastSyncId);
          } else {
            filteredSync.push(syncAction);
          }
        } else {
          filteredSync.push(syncAction);
        }
      }

      this.#store.processMessage({
        ...message,
        sync: filteredSync,
      });
    } else if (message.type === 'modelDataLoading') {
      const operation = syncGroupModelLoadOperation(message.syncGroup);
      this.#activeModelLoadOperations.get(message.modelName)?.add(operation);

      // Add to all modelFilterStatuses for this model, because we don't know which filter this data will match
      // In the future we may load by filter, in which case we would only add to the relevant modelFilterStatus
      for (const modelFilterStatus of this.#modelFilterStatuses.get(
        message.modelName,
      ) ?? []) {
        const alreadyLoaded = modelFilterStatus.isLoaded();
        modelFilterStatus.addLoadOperation(operation);
        if (alreadyLoaded) {
          // If this modelFilterStatus is now fully loaded, update the store
          // We need to call this from here, because there is no current call to "loadModelDataAsync" that would trigger this
          void this.updateStoreAfterModelFilterStatusLoaded(
            message.modelName,
            modelFilterStatus,
          );
        }
      }
    } else if (message.type === 'modelDataLoaded') {
      let matchingOperation: SyncGroupModelLoadOperation<MS> | undefined;
      const modelOperations = this.#activeModelLoadOperations.get(
        message.modelName,
      );
      if (!modelOperations) {
        return;
      }
      for (const operation of modelOperations) {
        if (
          this.#config.syncGroupDefs?.equals(
            operation.syncGroup,
            message.syncGroup,
          )
        ) {
          matchingOperation = operation;
          break;
        }
      }
      if (!matchingOperation) {
        return;
      }

      const relevantModelFilterStatuses =
        this.#modelFilterStatuses
          .get(message.modelName)
          ?.filter(
            (status) =>
              matchingOperation && status.hasLoadOperation(matchingOperation),
          ) ?? [];

      for (const data of message.data) {
        const modelFilterStatus = relevantModelFilterStatuses.find((status) =>
          status.dataPassesFilter(data),
        );
        if (modelFilterStatus) {
          modelFilterStatus.addToPendingData(data);
        }
      }

      matchingOperation.resolve();
      modelOperations.delete(matchingOperation);
    } else {
      // Pass all transaction methods for now, since those should relate to local data, which should be in the store
      // Eventually might need to filter further here, especially if data is dropped from store
      // Also this is making the assumption that only data that is loaded will be modified - seems reasonable for now though
      this.#store.processMessage(message);
    }
  }

  private async loadResultsForQuery(query: AnyQuery<MS>): Promise<void> {
    const { allDataInStore, data } = this.loadResultsForQueryFromStore(query);
    query.setResult(data, allDataInStore);
    if (!allDataInStore) {
      const { data, isStale } = await this.loadResultsForQueryAsync(query);
      if (!isStale) {
        query.setResult(data, true);
      }
    }
  }

  private loadResultsForQueryFromStore(query: AnyQuery<MS>): {
    allDataInStore: boolean;
    data: ModelResult<MS['models'], MS['relationshipDefs'], any, any>[];
  } {
    const unsubscriberHandle: UnsubscriberHandle = {
      called: false,
      unsubscribers: [],
    };
    const subscribeToStore = () => {
      if (unsubscriberHandle.called) {
        return;
      }
      unsubscriberHandle.called = true;
      for (const unsubscribe of unsubscriberHandle.unsubscribers) {
        unsubscribe();
      }
      void this.loadResultsForQuery(query);
    };

    unsubscriberHandle.unsubscribers.push(
      this.#store.subscribe(
        query.modelName,
        query.modelFilter,
        subscribeToStore,
      ),
    );
    const { inStore, data: modelData } = this.loadModelDataFromStore(
      query.modelName,
      query.modelFilter,
      unsubscriberHandle,
    );
    let allDataInStore = inStore;

    const modelResults: ModelResult<
      MS['models'],
      MS['relationshipDefs'],
      any,
      any
    >[] = [];
    for (const data of modelData) {
      const applyRelationshipsResult = this.applyRelationshipsFromStore(
        query.modelName,
        data,
        query.selection,
        subscribeToStore,
        unsubscriberHandle,
      );

      allDataInStore =
        allDataInStore && applyRelationshipsResult.allDataInStore;
      modelResults.push(applyRelationshipsResult.result);
    }

    if (!allDataInStore) {
      for (const unsubscribe of unsubscriberHandle.unsubscribers) {
        unsubscribe();
      }
    }

    return {
      allDataInStore,
      data: modelResults,
    };
  }

  private async loadResultsForQueryAsync(query: AnyQuery<MS>): Promise<{
    data: ModelResult<MS['models'], MS['relationshipDefs'], any, any>[];
    isStale: boolean;
  }> {
    const unsubscriberHandle: UnsubscriberHandle = {
      called: false,
      unsubscribers: [],
    };
    const subscribeToStore = () => {
      if (unsubscriberHandle.called) {
        return;
      }
      unsubscriberHandle.called = true;
      for (const unsubscribe of unsubscriberHandle.unsubscribers) {
        unsubscribe();
      }
      void this.loadResultsForQuery(query);
    };

    unsubscriberHandle.unsubscribers.push(
      this.#store.subscribe(
        query.modelName,
        query.modelFilter,
        subscribeToStore,
      ),
    );

    const modelData = await this.loadModelDataAsync(
      query.modelName,
      query.modelFilter,
      unsubscriberHandle,
    );

    if (unsubscriberHandle.called) {
      return {
        data: [],
        isStale: true,
      };
    }

    const visitResults = await Promise.all(
      modelData.map((data) =>
        this.applyRelationshipsAsync(
          query.modelName,
          data,
          query.selection,
          subscribeToStore,
          unsubscriberHandle,
        ),
      ),
    );

    return {
      data: visitResults.map((r) => r.result),
      isStale: unsubscriberHandle.called,
    };
  }

  /**
   * Loads data for a model name + filter combo
   *
   * Data is loaded from the store if it exists, otherwise from the storage adapter
   * If data is loaded from the storage adapter, this function will also
   *  - call the setNotHydrated function
   *  - add the data returned from the storage adapter to the store
   *
   * @param modelName
   * @param modelFilter
   * @param setNotHydrated
   * @returns
   */
  private async loadModelDataAsync<MS extends ModelsSpec>(
    modelName: keyof MS['models'] & string,
    modelFilter:
      | ModelFilter<MS['models'], keyof MS['models'] & string>
      | undefined,
    unsubscriberHandle: UnsubscriberHandle,
  ) {
    if (unsubscriberHandle.called) {
      return [];
    }

    const modelIndexValues = indexAndFilterForLoad(
      modelName,
      modelFilter,
      this.#config.indexes,
    );

    await Promise.all(
      modelIndexValues.values.map(async (toLoadFilter) => {
        const { inStore, modelFilterStatus } = this.isModelDataInStore(
          modelName,
          toLoadFilter,
        );
        if (!inStore) {
          if (modelFilterStatus) {
            await modelFilterStatus.promiseForAllLoadingListeners();
          } else {
            const newModelFilterStatus = new ModelFilterStatus<MS>(
              toLoadFilter,
            );
            const loadModelDataFromStoragePromise =
              this.#loadModelDataFromStorage(
                modelName,
                modelIndexValues.index
                  ? { index: modelIndexValues.index, filter: toLoadFilter }
                  : undefined,
              ).then((loadedModelData) => {
                newModelFilterStatus.addToPendingData(...loadedModelData);
              });
            newModelFilterStatus.addLoadOperation(
              modelLoadOperationFromPromise(loadModelDataFromStoragePromise),
            );

            for (const operation of this.#activeModelLoadOperations.get(
              modelName,
            ) ?? []) {
              newModelFilterStatus.addLoadOperation(operation);
            }

            this.#modelFilterStatuses
              .get(modelName)
              ?.push(newModelFilterStatus);

            await this.updateStoreAfterModelFilterStatusLoaded(
              modelName,
              newModelFilterStatus,
            );
          }
        }
      }),
    );

    if (unsubscriberHandle.called) {
      return [];
    }

    return this.#store.getMany(modelName, modelFilter);
  }

  private async updateStoreAfterModelFilterStatusLoaded(
    modelName: keyof MS['models'] & string,
    modelFilterStatus: ModelFilterStatus<MS>,
  ) {
    await modelFilterStatus.promiseForAllLoadingListeners();

    const { pendingData, message } = modelFilterStatus.resetAndOtherThings();

    this.#store.setMany(modelName, pendingData, this.#tombstoneModelObjectKeys);

    // TODO: Maybe move this to be part of the above operation?
    this.#store.processMessage(message);
  }

  private loadModelDataFromStore(
    modelName: keyof MS['models'] & string,
    modelFilter:
      | ModelFilter<MS['models'], keyof MS['models'] & string>
      | undefined,
    unsubscriberHandle: UnsubscriberHandle,
  ): {
    data: ModelData<MS['models'], keyof MS['models'] & string>[];
    inStore: boolean;
  } {
    if (unsubscriberHandle.called) {
      return {
        inStore: false,
        data: [],
      };
    }

    const modelIndexValues = indexAndFilterForLoad(
      modelName,
      modelFilter,
      this.#config.indexes,
    );

    let inStore = true;
    for (const toLoadFilter of modelIndexValues.values) {
      const inStoreResult = this.isModelDataInStore(modelName, toLoadFilter);
      inStore = inStore && inStoreResult.inStore;
    }
    const data = this.#store.getMany(modelName, modelFilter);
    return {
      inStore,
      data,
    };
  }

  private isModelDataInStore(
    modelName: keyof MS['models'] & string,
    loadFilter: LiteralModelFilter<MS['models'], keyof MS['models'] & string>,
  ): {
    inStore: boolean;
    modelFilterStatus: ModelFilterStatus<MS> | undefined;
  } {
    const modelFilterStatus = this.#modelFilterStatuses
      .get(modelName)
      ?.find((modelFilterStatus) =>
        modelFilterStatus.isSubsetOfFilter(loadFilter),
      );
    if (!modelFilterStatus) {
      return { inStore: false, modelFilterStatus: undefined };
    }
    return {
      inStore: modelFilterStatus.isLoaded(),
      modelFilterStatus,
    };
  }

  private async applyRelationshipsAsync<
    ModelName extends keyof MS['models'] & string,
    Selection extends ModelRelationshipSelection<
      MS['models'],
      MS['relationshipDefs'],
      ModelName
    >,
  >(
    modelName: ModelName,
    modelData: ModelData<MS['models'], ModelName>,
    selection: Selection | undefined,
    subscribeToStore: () => void,
    unsubscriberHandle: UnsubscriberHandle,
  ): Promise<
    VisitResult<MS['models'], MS['relationshipDefs'], ModelName, Selection>
  > {
    type M = MS['models'];
    type R = MS['relationshipDefs'];

    const result = { ...modelData } as ModelResult<M, R, ModelName, Selection>;

    if (!selection) {
      return {
        result,
      };
    }

    if (unsubscriberHandle.called) {
      return {
        result,
      };
    }

    for (const relKey in selection) {
      const relationshipDef:
        | ModelRelationshipDef<M, ModelName, keyof M & string, 'one' | 'many'>
        | undefined = this.#config?.relationshipDefs?.[modelName]?.[relKey];
      const subSelection:
        | ModelRelationshipSelection<M, R, keyof M & string>
        | undefined = selection[relKey];

      if (!relationshipDef) {
        continue;
      }

      type ReferencedModelName = typeof relationshipDef.referencesModelName;
      type SubSelection = ModelRelationshipSelection<M, R, ReferencedModelName>;

      if (relationshipDef.type === 'one') {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        unsubscriberHandle.unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const referencedModels = await this.loadModelDataAsync(
          relationshipDef.referencesModelName,
          filter,
          unsubscriberHandle,
        );
        const oneReferencedModel = referencedModels[0];

        let oneResult:
          | ModelResult<M, R, ReferencedModelName, SubSelection>
          | undefined;
        if (oneReferencedModel) {
          const subVisitResult = await this.applyRelationshipsAsync<
            ReferencedModelName,
            SubSelection
          >(
            relationshipDef.referencesModelName,
            oneReferencedModel,
            subSelection,
            subscribeToStore,
            unsubscriberHandle,
          );

          oneResult = subVisitResult.result;
        } else {
          oneResult = undefined;
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          oneResult as any;
      } else {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        unsubscriberHandle.unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const referencedModels = await this.loadModelDataAsync(
          relationshipDef.referencesModelName,
          filter,
          unsubscriberHandle,
        );

        const many: ModelResult<M, R, ReferencedModelName, SubSelection>[] = [];
        for (const model of referencedModels) {
          const subVisitResult = await this.applyRelationshipsAsync<
            ReferencedModelName,
            SubSelection
          >(
            relationshipDef.referencesModelName,
            model,
            subSelection,
            subscribeToStore,
            unsubscriberHandle,
          );
          many.push(subVisitResult.result);
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          many as any;
      }
    }

    return { result };
  }

  private applyRelationshipsFromStore<
    ModelName extends keyof MS['models'] & string,
    Selection extends ModelRelationshipSelection<
      MS['models'],
      MS['relationshipDefs'],
      ModelName
    >,
  >(
    modelName: ModelName,
    modelData: ModelData<MS['models'], ModelName>,
    selection: Selection | undefined,
    subscribeToStore: () => void,
    unsubscriberHandle: UnsubscriberHandle,
  ): VisitResultFromStore<
    MS['models'],
    MS['relationshipDefs'],
    ModelName,
    Selection
  > {
    type M = MS['models'];
    type R = MS['relationshipDefs'];

    const result = { ...modelData } as ModelResult<M, R, ModelName, Selection>;
    let allDataInStore = true;

    if (!selection) {
      return {
        allDataInStore,
        result,
      };
    }

    if (unsubscriberHandle.called) {
      return {
        allDataInStore,
        result,
      };
    }

    for (const relKey in selection) {
      const relationshipDef:
        | ModelRelationshipDef<M, ModelName, keyof M & string, 'one' | 'many'>
        | undefined = this.#config?.relationshipDefs?.[modelName]?.[relKey];
      const subSelection:
        | ModelRelationshipSelection<M, R, keyof M & string>
        | undefined = selection[relKey];

      if (!relationshipDef) {
        continue;
      }

      type ReferencedModelName = typeof relationshipDef.referencesModelName;
      type SubSelection = ModelRelationshipSelection<M, R, ReferencedModelName>;

      if (relationshipDef.type === 'one') {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        unsubscriberHandle.unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const { inStore, data: referencedModels } = this.loadModelDataFromStore(
          relationshipDef.referencesModelName,
          filter,
          unsubscriberHandle,
        );
        allDataInStore = allDataInStore && inStore;
        const oneReferencedModel = referencedModels[0];

        let oneResult:
          | ModelResult<M, R, ReferencedModelName, SubSelection>
          | undefined;
        if (oneReferencedModel) {
          const subVisitResult = this.applyRelationshipsFromStore<
            ReferencedModelName,
            SubSelection
          >(
            relationshipDef.referencesModelName,
            oneReferencedModel,
            subSelection,
            subscribeToStore,
            unsubscriberHandle,
          );
          allDataInStore = allDataInStore && subVisitResult.allDataInStore;
          oneResult = subVisitResult.result;
        } else {
          oneResult = undefined;
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          oneResult as any;
      } else {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        unsubscriberHandle.unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const { inStore, data: referencedModels } = this.loadModelDataFromStore(
          relationshipDef.referencesModelName,
          filter,
          unsubscriberHandle,
        );
        allDataInStore = allDataInStore && inStore;

        const many: ModelResult<M, R, ReferencedModelName, SubSelection>[] = [];
        for (const model of referencedModels) {
          const subVisitResult = this.applyRelationshipsFromStore<
            ReferencedModelName,
            SubSelection
          >(
            relationshipDef.referencesModelName,
            model,
            subSelection,
            subscribeToStore,
            unsubscriberHandle,
          );
          allDataInStore = allDataInStore && subVisitResult.allDataInStore;
          many.push(subVisitResult.result);
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          many as any;
      }
    }

    return { result, allDataInStore };
  }
}

function filterForModelRelationship<
  M extends Models,
  ModelName extends keyof M & string,
  ReferencedModelName extends keyof M & string,
>(
  relationshipDef: ModelRelationshipDef<
    M,
    ModelName,
    ReferencedModelName,
    'one' | 'many'
  >,
  modelData: ModelData<M, ModelName>,
): ModelFilter<M, ReferencedModelName> {
  const filter: ModelFilter<M, ReferencedModelName> = {};
  for (const { base, reference } of relationshipDef.fields) {
    filter[reference] = modelData[base] as unknown as ModelFilter<
      M,
      ReferencedModelName
    >[ModelField<M, ReferencedModelName>];
  }
  return filter;
}

type UnsubscriberHandle = {
  called: boolean;
  unsubscribers: Array<() => void>;
};

type VisitResult<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
> = {
  result: ModelResult<M, R, ModelName, Selection>;
};

type VisitResultFromStore<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
> = {
  result: ModelResult<M, R, ModelName, Selection>;
  allDataInStore: boolean;
};

type ModelMap<MS extends ModelsSpec, Value> = Map<
  keyof MS['models'] & string,
  Value
>;

// Represents either a load from storage or a load from a lazy bootstrap
type ModelLoadOperation = {
  subscribe: (listener: () => void) => () => void;
};

type SyncGroupModelLoadOperation<MS extends ModelsSpec> = ModelLoadOperation & {
  syncGroup: MS['syncGroup'];
  resolve: () => void;
};

function modelLoadOperationFromPromise(
  promise: Promise<any>,
): ModelLoadOperation {
  const listeners = new Set<() => void>();
  let promiseResolved = false;
  promise.then(() => {
    promiseResolved = true;
    for (const listener of listeners) {
      listener();
    }
  });
  return {
    subscribe: (listener: () => void) => {
      if (promiseResolved) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function syncGroupModelLoadOperation<MS extends ModelsSpec>(
  syncGroup: MS['syncGroup'],
): SyncGroupModelLoadOperation<MS> {
  const listeners = new Set<() => void>();
  let resolved = false;
  return {
    syncGroup,
    subscribe: (listener: () => void) => {
      if (resolved) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolve: () => {
      if (resolved) {
        return;
      }
      resolved = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

class ModelFilterStatus<MS extends ModelsSpec> {
  #filter: LiteralModelFilter<MS['models'], keyof MS['models'] & string>;

  #pendingData: ModelData<MS['models'], keyof MS['models'] & string>[];
  #pendingSync: {
    lastSyncId: number;
    syncActions: SyncAction<MS['models'], keyof MS['models'] & string>[];
  };

  #activeLoadOperations: Set<ModelLoadOperation>;
  #dataInStore: boolean;

  constructor(
    filter: LiteralModelFilter<MS['models'], keyof MS['models'] & string>,
  ) {
    this.#filter = filter;
    this.#pendingData = [];
    this.#pendingSync = { lastSyncId: 0, syncActions: [] };
    this.#activeLoadOperations = new Set([]);
    this.#dataInStore = false;
  }

  isLoaded() {
    return this.#activeLoadOperations.size === 0 && this.#dataInStore;
  }

  isSubsetOfFilter(newFilter: Record<string, unknown>): boolean {
    return isExistingFilterSubset(this.#filter, newFilter);
  }

  async promiseForAllLoadingListeners() {
    while (true) {
      if (this.#activeLoadOperations.size === 0) {
        break;
      }

      const unsubscribers: (() => void)[] = [];
      const operationPromises: Promise<void>[] = [];
      for (const operation of this.#activeLoadOperations) {
        operationPromises.push(
          new Promise<void>((res) => {
            unsubscribers.push(
              operation.subscribe(() => {
                res();
                this.#activeLoadOperations.delete(operation);
              }),
            );
          }),
        );
      }

      await Promise.all(operationPromises);
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    }
  }

  dataPassesFilter(
    data: ModelData<MS['models'], keyof MS['models'] & string>,
  ): boolean {
    return dataPassesFilter(data, this.#filter);
  }

  addToPendingSync(
    syncAction: SyncAction<MS['models'], keyof MS['models'] & string>,
    lastSyncId: number,
  ) {
    this.#pendingSync.syncActions.push(syncAction);
    this.#pendingSync.lastSyncId = Math.max(
      lastSyncId,
      this.#pendingSync.lastSyncId,
    );
  }

  addToPendingData(
    ...data: ModelData<MS['models'], keyof MS['models'] & string>[]
  ) {
    this.#pendingData.push(...data);
  }

  resetAndOtherThings() {
    const pendingData = this.#pendingData;

    const message: SyncCatchUpMessage<MS['models']> = {
      type: 'syncCatchUp',
      lastSyncId: this.#pendingSync.lastSyncId,
      sync: this.#pendingSync.syncActions,
    };

    this.#pendingData = [];
    this.#pendingSync = { lastSyncId: 0, syncActions: [] };
    this.#dataInStore = true;

    return {
      pendingData,
      message,
    };
  }

  addLoadOperation(operation: ModelLoadOperation) {
    this.#dataInStore = false;
    this.#activeLoadOperations.add(operation);
  }

  hasLoadOperation(operation: ModelLoadOperation) {
    return this.#activeLoadOperations.has(operation);
  }
}

function isExistingFilterSubset(
  existingFilter: Record<string, unknown>,
  newFilter: Record<string, unknown>,
): boolean {
  const existingKeys = Object.keys(existingFilter);
  const newKeys = Object.keys(newFilter);

  for (const existingKey of existingKeys) {
    if (!newKeys.includes(existingKey)) {
      return false;
    }
    if (existingFilter[existingKey] !== newFilter[existingKey]) {
      return false;
    }
  }

  return true;
}
