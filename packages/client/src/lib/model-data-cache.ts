import type { LocoSyncClient } from './client';
import type {
  ModelData,
  ModelField,
  ModelFilter,
  Models,
  ModelsConfig,
  ModelsSpec,
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

export class ModelDataCache<MS extends ModelsSpec> {
  #store: ModelDataStore<MS['models']>;
  #config: ModelsConfig<MS>;
  #storage: StorageAdapter<MS>;
  #observers: Set<AnyQueryObserver<MS>>;
  #loadedModelFilters: Map<
    keyof MS['models'] & string,
    // Idea: To incrementally remove data that is no longer used,
    // maybe keep track of which observers are using which filters,
    // remove observers when removed from here, and remove filters and data associated
    // with filters from store when no observers.
    // Would want to have exception for preloaded models, those should not get dropped
    ModelFilter<MS['models'], keyof MS['models'] & string>[]
  >;
  #pendingModelFilters: Map<
    keyof MS['models'] & string,
    {
      filter: ModelFilter<MS['models'], keyof MS['models'] & string>;
      promise: Promise<ModelData<MS['models'], keyof MS['models'] & string>[]>;
    }[]
  >;

  constructor(client: LocoSyncClient<MS>, config: ModelsConfig<MS>) {
    this.#store = createModelDataStore();
    this.#storage = client.getStorage();
    this.#config = config;
    this.#observers = new Set();
    const modelNames = Object.keys(
      this.#config.modelDefs,
    ) as (keyof MS['models'] & string)[];

    this.#loadedModelFilters = new Map(modelNames.map((name) => [name, []]));
    this.#pendingModelFilters = new Map(modelNames.map((name) => [name, []]));

    client.addListener((message) => {
      if (message.type === 'started') {
        for (const modelName of modelNames) {
          const modelDef = this.#config.modelDefs[modelName];
          if (modelDef.preload) {
            this.loadModelDataAsync(modelName, undefined, () => {});
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
    this.loadResultsForObserver(observer);
  }

  removeObserver(observer: AnyQueryObserver<MS>) {
    // TODO: How to unsubscribe this observer from store?
    // I think the unsubscribe fns would created in “loadDataForObserver” would need to be stored on the object for access here

    // TBD: Could detect data and drop data that no longer has any observers associated with it
    // TBD: Would probably want to wait for a bit before dropping data in case an equivalent observer is re-added
    this.#observers.delete(observer);
  }

  processMessage(message: ToProcessMessage<MS['models']>) {
    if (message.type === 'sync') {
      const filteredSync: typeof message.sync = [];
      for (const syncAction of message.sync) {
        if (syncAction.action === 'insert') {
          const matchingLoadedFilter = this.#loadedModelFilters
            .get(syncAction.modelName)!
            .find((f) => dataPassesFilter(syncAction.data, f));

          // Should we also check the pendingModelFilters here?
          // If data matches one, should that be applied store or accrued to apply afterwards?
          if (matchingLoadedFilter) {
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
    } else {
      // Pass all transaction methods for now, since those should relate to local data, which should be in the store
      // Eventually might need to filter further here, especially if data is dropped from store
      // Also this is making the assumption that only data that is loaded will be modified - seems reasonable for now though
      this.#store.processMessage(message);
    }

    // this.#store.processMessage(message);
  }

  private loadResultsForObserver(observer: AnyQueryObserver<MS>) {
    const loadedFromStore = this.loadResultsForObserverFromStore(observer);
    if (!loadedFromStore) {
      this.loadResultsForObserverAsync(observer);
    }
  }

  private loadResultsForObserverFromStore(
    observer: AnyQueryObserver<MS>,
  ): boolean {
    const unsubscribers: (() => void)[] = [];
    const unsubscribe = () => {
      // Unsubscribe current listeners
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };

    const storeListener = () => {
      unsubscribe();
      this.loadResultsForObserver(observer);
    };

    const modelData = this.loadModelDataFromStore(
      observer.modelName,
      observer.modelFilter,
    );
    if (!modelData) {
      return false;
    }

    unsubscribers.push(
      this.#store.subscribe(
        observer.modelName,
        observer.modelFilter,
        storeListener,
      ),
    );

    const modelResults: ModelResult<
      MS['models'],
      MS['relationshipDefs'],
      any,
      any
    >[] = [];
    let dataNotInStore = false;
    for (const data of modelData) {
      const { result, unsubscribers } = this.applyRelationshipsFromStore(
        observer.modelName,
        data,
        observer.selection,
        storeListener,
      );
      unsubscribers.push(...unsubscribers);

      if (result) {
        modelResults.push(result);
      } else {
        dataNotInStore = true;
        break;
      }
    }

    if (dataNotInStore) {
      unsubscribe();
      return false;
    }

    observer.setResult(modelResults);
    return true;
  }

  private async loadResultsForObserverAsync(observer: AnyQueryObserver<MS>) {
    const storeListener = () => {
      // Unsubscribe current listeners
      baseUnsubscriber?.();
      for (const { unsubscribers } of visitResults ?? []) {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      }

      // Resubscribe and update results
      this.loadResultsForObserver(observer);
    };

    const modelData = await this.loadModelDataAsync(
      observer.modelName,
      observer.modelFilter,
      () => observer.setNotHydrated(),
    );

    const baseUnsubscriber = this.#store.subscribe(
      observer.modelName,
      observer.modelFilter,
      storeListener,
    );
    const visitResults = await Promise.all(
      modelData.map((data) =>
        this.applyRelationshipsAsync(
          observer.modelName,
          data,
          observer.selection,
          storeListener,
          () => observer.setNotHydrated(),
        ),
      ),
    );

    observer.setResult(visitResults.map((r) => r.result));
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
    setNotHydrated: () => void,
  ) {
    const { modelIndex, toLoadFilter } = indexAndFilterForLoad(
      modelName,
      modelFilter,
      this.#config.indexes,
    );

    if (!this.isModelDataInStore(modelName, toLoadFilter)) {
      const matchingPendingFilter = this.#pendingModelFilters
        .get(modelName)!
        .find((filter) => isExistingFilterSubset(filter.filter, toLoadFilter));

      if (matchingPendingFilter) {
        setNotHydrated();
        await matchingPendingFilter.promise;
      } else {
        const promise = this.#storage.loadModelData(
          modelName,
          modelIndex ? { index: modelIndex, filter: toLoadFilter } : undefined,
        );

        const pendingFilterValue = { filter: toLoadFilter, promise };
        this.#pendingModelFilters.get(modelName)!.push(pendingFilterValue);
        setNotHydrated();

        const loadedModelData = await promise;

        this.#loadedModelFilters.get(modelName)!.push(toLoadFilter);
        this.#pendingModelFilters
          .get(modelName)!
          .splice(
            this.#pendingModelFilters
              .get(modelName)!
              .indexOf(pendingFilterValue),
            1,
          );

        this.#store.setMany(modelName, loadedModelData);
      }
    }

    return this.#store.getMany(modelName, modelFilter);
  }

  private loadModelDataFromStore<MS extends ModelsSpec>(
    modelName: keyof MS['models'] & string,
    modelFilter:
      | ModelFilter<MS['models'], keyof MS['models'] & string>
      | undefined,
  ) {
    const { toLoadFilter } = indexAndFilterForLoad(
      modelName,
      modelFilter,
      this.#config.indexes,
    );

    if (this.isModelDataInStore(modelName, toLoadFilter)) {
      return this.#store.getMany(modelName, modelFilter);
    }
    return null;
  }

  private isModelDataInStore(
    modelName: keyof MS['models'] & string,
    loadFilter: ModelFilter<MS['models'], keyof MS['models'] & string>,
  ): boolean {
    const matchingLoadedFilter = this.#loadedModelFilters
      .get(modelName)!
      .find((filter) => isExistingFilterSubset(filter, loadFilter));
    return !!matchingLoadedFilter;
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
    storeListener: () => void,
    setNotHydrated: () => void,
  ): Promise<
    VisitResult<MS['models'], MS['relationshipDefs'], ModelName, Selection>
  > {
    type M = MS['models'];
    type R = MS['relationshipDefs'];

    const result = { ...modelData } as ModelResult<M, R, ModelName, Selection>;

    if (!selection) {
      return {
        result,
        unsubscribers: [],
      };
    }

    const unsubscribers: Array<() => void> = [];

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
        const referencedModels = await this.loadModelDataAsync(
          relationshipDef.referencesModelName,
          filter,
          setNotHydrated,
        );
        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            storeListener,
          ),
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
            storeListener,
            setNotHydrated,
          );

          unsubscribers.push(...subVisitResult.unsubscribers);
          oneResult = subVisitResult.result;
        } else {
          oneResult = undefined;
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          oneResult as any;
      } else {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        const referencedModels = await this.loadModelDataAsync(
          relationshipDef.referencesModelName,
          filter,
          setNotHydrated,
        );
        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            storeListener,
          ),
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
            storeListener,
            setNotHydrated,
          );
          if (subVisitResult) {
            unsubscribers.push(...subVisitResult.unsubscribers);
            many.push(subVisitResult.result);
          }
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          many as any;
      }
    }

    return { result, unsubscribers };
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
    storeListener: () => void,
  ): VisitResultFromStore<
    MS['models'],
    MS['relationshipDefs'],
    ModelName,
    Selection
  > {
    type M = MS['models'];
    type R = MS['relationshipDefs'];

    const result = { ...modelData } as ModelResult<M, R, ModelName, Selection>;

    if (!selection) {
      return {
        result,
        unsubscribers: [],
      };
    }

    const unsubscribers: Array<() => void> = [];

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
        const referencedModels = this.loadModelDataFromStore(
          relationshipDef.referencesModelName,
          filter,
        );
        if (!referencedModels) {
          return { result: null, unsubscribers };
        }

        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            storeListener,
          ),
        );
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
            storeListener,
          );
          unsubscribers.push(...subVisitResult.unsubscribers);
          if (!subVisitResult.result) {
            return { result: null, unsubscribers };
          }
          oneResult = subVisitResult.result;
        } else {
          oneResult = undefined;
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          oneResult as any;
      } else {
        const filter = filterForModelRelationship(relationshipDef, modelData);
        const referencedModels = this.loadModelDataFromStore(
          relationshipDef.referencesModelName,
          filter,
        );
        if (!referencedModels) {
          return { result: null, unsubscribers };
        }

        unsubscribers.push(
          this.#store.subscribe(
            relationshipDef.referencesModelName,
            filter,
            storeListener,
          ),
        );

        const many: ModelResult<M, R, ReferencedModelName, SubSelection>[] = [];
        for (const model of referencedModels) {
          const subVisitResult = this.applyRelationshipsFromStore<
            ReferencedModelName,
            SubSelection
          >(
            relationshipDef.referencesModelName,
            model,
            subSelection,
            storeListener,
          );
          unsubscribers.push(...subVisitResult.unsubscribers);
          if (!subVisitResult.result) {
            return { result: null, unsubscribers };
          }

          many.push(subVisitResult.result);
        }
        result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
          many as any;
      }
    }

    return { result, unsubscribers };
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
    filter[reference] = modelData[base] as unknown as ModelData<
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
  unsubscribers: Array<() => void>;
};

type VisitResultFromStore<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
> = {
  result: ModelResult<M, R, ModelName, Selection> | null;
  unsubscribers: Array<() => void>;
};

// Types of changes
// - creates
//   - matches query many (maybe because it passes a filter?). In theory should work if query one matches id but idk why that would be the case..
//   - matches a relationship being fetched
// - updates
//   - scalar not involved with a relationship (or eventually filter?)
//   - scalar used in "references" ?
// - deletes
//   -

// Selection is needed to build sub-tree + set up subscriptions
// Subscriptions of sub-tree are needed to clean up if that node no longer matches criteria

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
