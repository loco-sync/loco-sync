import type { LocoSyncClient } from './client';
import {
  type ModelData,
  type ModelField,
  type ModelFilter,
  type Models,
  type ModelsConfig,
  type ModelsSpec,
  type SyncAction,
} from './core';
import {
  findIndexForFilter,
  narrowFilterForIndex,
  type ModelIndex,
  type ModelsIndexes,
} from './indexes';
import {
  createModelDataStore,
  dataPassesFilter,
  type CreateModelDataStoreOptions,
  type ModelDataStore,
} from './model-data-store';
import type { QueryObserver } from './query-observers';
import type {
  ModelRelationshipDef,
  ModelRelationshipSelection,
  ModelResult,
  ModelsRelationshipDefs,
} from './relationships';
import type { StorageAdapter } from './storage';
import type { ToProcessMessage } from './transactionUtils';

type AnyQueryObserver<MS extends ModelsSpec> = QueryObserver<MS, any, any>;

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
  #observers: Set<AnyQueryObserver<MS>>;
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
    this.#observers = new Set();
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
            this.loadModelDataAsync(modelName, undefined);
          }
        }
      }
    });
  }

  getStore() {
    return this.#store;
  }

  addObserver(observer: AnyQueryObserver<MS>) {
    this.#observers.add(observer);
    return this.loadResultsForObserver(observer);
  }

  removeObserver(observer: AnyQueryObserver<MS>) {
    // TODO: How to unsubscribe this observer from store?
    // I think the unsubscribe fns would created in “loadDataForObserver” would need to be stored on the object for access here

    // TBD: Could detect data and drop data that no longer has any observers associated with it
    // TBD: Would probably want to wait for a bit before dropping data in case an equivalent observer is re-added
    this.#observers.delete(observer);
  }

  processMessage(message: CacheMessage<MS>) {
    if (message.type === 'sync') {
      const filteredSync: typeof message.sync = [];
      for (const syncAction of message.sync) {
        if (syncAction.action === 'insert' || syncAction.action === 'update') {
          const modelFilterStatus = this.#modelFilterStatuses
            .get(syncAction.modelName)!
            .find(({ filter }) => dataPassesFilter(syncAction.data, filter));

          if (!modelFilterStatus) {
            continue;
          } else if (modelFilterStatus.activeLoadOperations.size > 0) {
            modelFilterStatus.pendingSync.syncActions.push(syncAction);
            modelFilterStatus.pendingSync.lastSyncId = Math.max(
              message.lastSyncId,
              modelFilterStatus.pendingSync.lastSyncId,
            );
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
      this.#activeModelLoadOperations.get(message.modelName)!.add(operation);

      // Add to all modelFilterStatuses for this model, because we don't know which filter this data will match
      // In the future we may load by filter, in which case we would only add to the relevant modelFilterStatus
      for (const modelFilterStatus of this.#modelFilterStatuses.get(
        message.modelName,
      )!) {
        const alreadyLoaded = modelFilterStatus.activeLoadOperations.size === 0;
        modelFilterStatus.activeLoadOperations.add(operation);
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
      )!;
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

      const relevantModelFilterStatuses = this.#modelFilterStatuses
        .get(message.modelName)!
        .filter(
          ({ activeLoadOperations }) =>
            matchingOperation && activeLoadOperations.has(matchingOperation),
        );

      for (const data of message.data) {
        const modelFilterStatus = relevantModelFilterStatuses.find(
          ({ filter }) => dataPassesFilter(data, filter),
        );
        if (modelFilterStatus) {
          modelFilterStatus.pendingData.push(data);
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

  private async loadResultsForObserver(
    observer: AnyQueryObserver<MS>,
  ): Promise<void> {
    const { allDataInStore, data } = this.loadResultsForObserverFromStore(
      observer,
    );
    observer.setResult(data, allDataInStore);
    if (!allDataInStore) {
      const { data, isStale } = await this.loadResultsForObserverAsync(
        observer,
      );
      if (!isStale) {
        observer.setResult(data, true);
      }
    }
  }

  private loadResultsForObserverFromStore(
    observer: AnyQueryObserver<MS>,
  ): {
    allDataInStore: boolean;
    data: ModelResult<MS['models'], MS['relationshipDefs'], any, any>[];
  } {
    const unsubscribers: (() => void)[] = [];
    const unsubscribe = () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };

    const subscribeToStore = () => {
      unsubscribe();
      void this.loadResultsForObserver(observer);
    };

    unsubscribers.push(
      this.#store.subscribe(
        observer.modelName,
        observer.modelFilter,
        subscribeToStore,
      ),
    );
    const { inStore, data: modelData } = this.loadModelDataFromStore(
      observer.modelName,
      observer.modelFilter,
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
        observer.modelName,
        data,
        observer.selection,
        subscribeToStore,
        unsubscribers,
      );

      allDataInStore =
        allDataInStore && applyRelationshipsResult.allDataInStore;
      modelResults.push(applyRelationshipsResult.result);
    }

    if (!allDataInStore) {
      unsubscribe();
    }

    return {
      allDataInStore,
      data: modelResults,
    };
  }

  private async loadResultsForObserverAsync(
    observer: AnyQueryObserver<MS>,
  ): Promise<{
    data: ModelResult<MS['models'], MS['relationshipDefs'], any, any>[];
    isStale: boolean;
  }> {
    const unsubscribers: (() => void)[] = [];
    let isStale = false;
    const unsubscribe = () => {
      isStale = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
    const subscribeToStore = () => {
      unsubscribe();
      void this.loadResultsForObserver(observer);
    };

    unsubscribers.push(
      this.#store.subscribe(
        observer.modelName,
        observer.modelFilter,
        subscribeToStore,
      ),
    );

    const modelData = await this.loadModelDataAsync(
      observer.modelName,
      observer.modelFilter,
    );

    // TODO: Maybe early return here if staleResults is true?

    const visitResults = await Promise.all(
      modelData.map((data) =>
        this.applyRelationshipsAsync(
          observer.modelName,
          data,
          observer.selection,
          subscribeToStore,
          unsubscribers,
        ),
      ),
    );

    return {
      data: visitResults.map((r) => r.result),
      isStale,
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
  ) {
    const { modelIndex, toLoadFilter } = indexAndFilterForLoad(
      modelName,
      modelFilter,
      this.#config.indexes,
    );

    const { inStore, modelFilterStatus } = this.isModelDataInStore(
      modelName,
      toLoadFilter,
    );
    if (!inStore) {
      if (modelFilterStatus) {
        await promiseForAllLoadingListeners(modelFilterStatus);
      } else {
        const newModelFilterStatus: ModelFilterStatus<MS> = {
          filter: toLoadFilter,
          pendingData: [],
          pendingSync: { lastSyncId: 0, syncActions: [] },
          activeLoadOperations: new Set([]),
        };
        const loadModelDataFromStoragePromise = this.#loadModelDataFromStorage(
          modelName,
          modelIndex ? { index: modelIndex, filter: toLoadFilter } : undefined,
        ).then((loadedModelData) => {
          newModelFilterStatus.pendingData.push(...loadedModelData);
        });
        newModelFilterStatus.activeLoadOperations.add(
          modelLoadOperationFromPromise(loadModelDataFromStoragePromise),
        );

        for (const operation of this.#activeModelLoadOperations.get(
          modelName,
        )!) {
          newModelFilterStatus.activeLoadOperations.add(operation);
        }

        this.#modelFilterStatuses.get(modelName)!.push(newModelFilterStatus);

        await this.updateStoreAfterModelFilterStatusLoaded(
          modelName,
          newModelFilterStatus,
        );
      }
    }

    return this.#store.getMany(modelName, modelFilter);
  }

  private async updateStoreAfterModelFilterStatusLoaded(
    modelName: keyof MS['models'] & string,
    modelFilterStatus: ModelFilterStatus<MS>,
  ) {
    await promiseForAllLoadingListeners(modelFilterStatus);

    this.#store.setMany(
      modelName,
      modelFilterStatus.pendingData,
      this.#tombstoneModelObjectKeys,
    );

    // TODO: Maybe move this to be part of the above operation?
    this.#store.processMessage({
      type: 'syncCatchUp',
      lastSyncId: modelFilterStatus.pendingSync.lastSyncId,
      sync: modelFilterStatus.pendingSync.syncActions,
    });

    modelFilterStatus.pendingData = [];
    modelFilterStatus.pendingSync = { lastSyncId: 0, syncActions: [] };
  }

  private loadModelDataFromStore(
    modelName: keyof MS['models'] & string,
    modelFilter:
      | ModelFilter<MS['models'], keyof MS['models'] & string>
      | undefined,
  ): {
    data: ModelData<MS['models'], keyof MS['models'] & string>[];
    inStore: boolean;
  } {
    const { toLoadFilter } = indexAndFilterForLoad(
      modelName,
      modelFilter,
      this.#config.indexes,
    );

    const { inStore } = this.isModelDataInStore(modelName, toLoadFilter);
    const data = this.#store.getMany(modelName, modelFilter);
    return {
      inStore,
      data,
    };
  }

  private isModelDataInStore(
    modelName: keyof MS['models'] & string,
    loadFilter: ModelFilter<MS['models'], keyof MS['models'] & string>,
  ): {
    inStore: boolean;
    modelFilterStatus: ModelFilterStatus<MS> | undefined;
  } {
    const modelFilterStatus = this.#modelFilterStatuses
      .get(modelName)!
      .find(({ filter }) => isExistingFilterSubset(filter, loadFilter));
    if (!modelFilterStatus) {
      return { inStore: false, modelFilterStatus: undefined };
    }
    return {
      inStore: modelFilterStatus.activeLoadOperations.size === 0,
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
    unsubscribers: Array<() => void>,
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
        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const referencedModels = await this.loadModelDataAsync(
          relationshipDef.referencesModelName,
          filter,
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
            unsubscribers,
          );

          oneResult = subVisitResult.result;
        } else {
          oneResult = undefined;
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          oneResult as any;
      } else {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const referencedModels = await this.loadModelDataAsync(
          relationshipDef.referencesModelName,
          filter,
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
            unsubscribers,
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
    unsubscribers: Array<() => void>,
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
        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const { inStore, data: referencedModels } = this.loadModelDataFromStore(
          relationshipDef.referencesModelName,
          filter,
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
            unsubscribers,
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
        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            subscribeToStore,
          ),
        );
        const { inStore, data: referencedModels } = this.loadModelDataFromStore(
          relationshipDef.referencesModelName,
          filter,
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
            unsubscribers,
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

function indexAndFilterForLoad<MS extends ModelsSpec>(
  modelName: keyof MS['models'] & string,
  modelFilter:
    | ModelFilter<MS['models'], keyof MS['models'] & string>
    | undefined,
  indexes: ModelsIndexes<MS['models']> | undefined,
): {
  modelIndex: ModelIndex<MS['models'], keyof MS['models'] & string> | undefined;
  toLoadFilter: ModelFilter<MS['models'], keyof MS['models'] & string>;
} {
  if (modelFilter) {
    const modelIndex = findIndexForFilter(
      indexes?.[modelName] ?? [],
      modelFilter,
    );
    if (modelIndex) {
      return {
        modelIndex,
        toLoadFilter: narrowFilterForIndex(modelIndex, modelFilter),
      };
    }
  }

  return {
    modelIndex: undefined,
    toLoadFilter: {},
  };
}

type ModelMap<MS extends ModelsSpec, Value> = Map<
  keyof MS['models'] & string,
  Value
>;

type ModelFilterStatus<MS extends ModelsSpec> = {
  filter: ModelFilter<MS['models'], keyof MS['models'] & string>;

  pendingData: ModelData<MS['models'], keyof MS['models'] & string>[];
  pendingSync: {
    lastSyncId: number;
    syncActions: SyncAction<MS['models'], keyof MS['models'] & string>[];
  };

  // If this is empty, then data is completely in store
  activeLoadOperations: Set<ModelLoadOperation>;
};

async function promiseForAllLoadingListeners<MS extends ModelsSpec>(
  status: ModelFilterStatus<MS>,
): Promise<void> {
  while (true) {
    if (status.activeLoadOperations.size === 0) {
      break;
    }

    const unsubscribers: (() => void)[] = [];
    const operationPromises: Promise<void>[] = [];
    for (const operation of status.activeLoadOperations) {
      operationPromises.push(
        new Promise<void>((res) => {
          unsubscribers.push(
            operation.subscribe(() => {
              res();
              status.activeLoadOperations.delete(operation);
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
