import type { Models, ModelData, ModelFilter, ModelsSpec } from './core';
import type { ModelDataCache } from './model-data-cache';
import type { ModelDataStore } from './model-data-store';
import type {
  ModelRelationshipDef,
  ModelRelationshipSelection,
  ModelResult,
  ModelsRelationshipDefs,
} from './relationships';

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

type VisitResult<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
> = {
  result: ModelResult<M, R, ModelName, Selection>;
  unsubscribers: Array<() => void>;
};

function applyRelationships<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
>(
  modelName: ModelName,
  modelData: ModelData<M, ModelName>,
  selection: Selection | undefined,
  relationshipDefs: R,
  store: ModelDataStore<M>,
  listener: () => void,
  // listener: (
  //   data: ModelData<M, ModelName> | undefined,
  //   changeSnapshots: readonly ModelChangeSnapshot<M, ModelName>[] | undefined,
  //   selection: Selection
  // ) => void
): VisitResult<M, R, ModelName, Selection> | undefined {
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
      | undefined = relationshipDefs[modelName]?.[relKey];
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
      const referencedModels = store.getMany(
        relationshipDef.referencesModelName,
        filter,
      );
      unsubscribers.push(
        store.subscribe(relationshipDef.referencesModelName, filter, listener),
      );
      const oneReferencedModel = referencedModels[0];

      let oneResult:
        | ModelResult<M, R, ReferencedModelName, SubSelection>
        | undefined;
      if (oneReferencedModel) {
        const subVisitResult = applyRelationships<
          M,
          R,
          ReferencedModelName,
          SubSelection
        >(
          relationshipDef.referencesModelName,
          oneReferencedModel,
          subSelection,
          relationshipDefs,
          store,
          listener,
        );
        if (subVisitResult) {
          unsubscribers.push(...subVisitResult.unsubscribers);
          oneResult = subVisitResult.result;
        }
      } else {
        oneResult = undefined;
      }
      result[relKey as keyof ModelResult<M, R, ModelName, Selection>] =
        oneResult as any;
    } else {
      const filter = filterForModelRelationship(relationshipDef, modelData);
      const referencedModels = store.getMany(
        relationshipDef.referencesModelName,
        filter,
      );
      unsubscribers.push(
        store.subscribe(relationshipDef.referencesModelName, filter, listener),
      );

      const many: ModelResult<M, R, ReferencedModelName, SubSelection>[] = [];
      for (const model of referencedModels) {
        const subVisitResult = applyRelationships<
          M,
          R,
          ReferencedModelName,
          SubSelection
        >(
          relationshipDef.referencesModelName,
          model,
          subSelection,
          relationshipDefs,
          store,
          listener,
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
    // TODO: Any way to make this type work?
    filter[reference] = modelData[base] as unknown as ModelData<
      M,
      ReferencedModelName
    >[keyof ModelData<M, ReferencedModelName>];
  }
  return filter;
}

export class QueryObserver<
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string,
  Selection extends ModelRelationshipSelection<
    MS['models'],
    MS['relationshipDefs'],
    ModelName
  >,
> {
  #listeners: Set<() => void>;
  #isHydrated: boolean = false;

  #current:
    | {
        visitResults: VisitResult<
          MS['models'],
          MS['relationshipDefs'],
          ModelName,
          Selection
        >[];
        baseUnsubscriber: () => void;
      }
    | undefined;
  #resultMany: QueryManyResult<MS, ModelName, Selection>;
  #resultOne: QueryOneResult<MS, ModelName, Selection>;

  constructor(
    public readonly cache: ModelDataCache<MS>,
    public readonly relationshipDefs: MS['relationshipDefs'],
    public readonly modelName: ModelName,
    public readonly modelFilter:
      | ModelFilter<MS['models'], ModelName>
      | undefined,
    public readonly selection: Selection | undefined,
  ) {
    this.#listeners = new Set();
    this.#resultMany = { data: [], isHydrated: false };
    this.#resultOne = { data: undefined, isHydrated: false };
    this.cache.addObserver(this).then(() => {
      this.#isHydrated = true;
      this.onChange();
    });
  }

  private refresh() {
    if (!this.#isHydrated) {
      return;
    }

    const store = this.cache.getStore();
    const baseModelData = store.getMany(this.modelName, this.modelFilter);
    const baseUnsubscriber = store.subscribe(
      this.modelName,
      this.modelFilter,
      () => this.onChange(),
    );
    const visitResults: VisitResult<
      MS['models'],
      MS['relationshipDefs'],
      ModelName,
      Selection
    >[] = [];
    for (const data of baseModelData) {
      const visitResult = applyRelationships(
        this.modelName,
        data,
        this.selection,
        this.relationshipDefs,
        store,
        () => this.onChange(),
      );
      if (visitResult) {
        visitResults.push(visitResult);
      }
    }

    this.#current = {
      visitResults,
      baseUnsubscriber,
    };
    this.#resultMany = {
      data: visitResults.map((r) => r.result),
      isHydrated: true,
    };
    this.#resultOne = {
      data: visitResults[0]?.result,
      isHydrated: true,
    };
  }

  // At some point this should be smart enough to only un and re-subscribe to the parts that changed
  private onChange() {
    if (this.#current) {
      // Unsubscribe current listeners
      this.#current.baseUnsubscriber();
      for (const { unsubscribers } of this.#current.visitResults) {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      }
    }

    // Resubscribe and update results
    this.refresh();

    for (const callback of this.#listeners) {
      callback();
    }
  }

  subscribe(callback: () => void) {
    this.refresh();

    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  unsubscribe(callback: () => void) {
    this.#listeners.delete(callback);
    if (this.#listeners.size === 0) {
      this.cache.removeObserver(this);
    }
  }

  getSnapshotMany(): QueryManyResult<MS, ModelName, Selection> {
    return this.#resultMany;
  }

  getSnapshotOne(): QueryOneResult<MS, ModelName, Selection> {
    return this.#resultOne;
  }
}

export type QueryOneResult<
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string,
  Selection extends
    | ModelRelationshipSelection<
        MS['models'],
        MS['relationshipDefs'],
        ModelName
      >
    | undefined,
> = {
  data:
    | ModelResult<MS['models'], MS['relationshipDefs'], ModelName, Selection>
    | undefined;
  isHydrated: boolean;
};

export type QueryManyResult<
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string,
  Selection extends
    | ModelRelationshipSelection<
        MS['models'],
        MS['relationshipDefs'],
        ModelName
      >
    | undefined,
> = {
  data: ModelResult<
    MS['models'],
    MS['relationshipDefs'],
    ModelName,
    Selection
  >[];
  isHydrated: boolean;
};
