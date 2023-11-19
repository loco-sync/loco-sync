import type {
  Models,
  ModelResult,
  ModelsRelationshipDefs,
  ModelRelationshipSelection,
  ModelData,
  ModelRelationshipDef,
  ModelFilter,
} from '@loco-sync/client';
import type { LocoSyncReactStore } from './store';

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
  store: LocoSyncReactStore<M>,
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
      // TODO: Any way to make this type work?
      const filter = {
        [relationshipDef.references]: modelData[relationshipDef.field],
      } as unknown as ModelFilter<M, ReferencedModelName>;
      const referencedModels = store.getMany(
        relationshipDef.referencesModelName,
        filter,
      );
      unsubscribers.push(
        store.subMany(relationshipDef.referencesModelName, filter, listener),
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
      // TODO: Any way to make this type work?
      const filter = {
        [relationshipDef.references]: modelData[relationshipDef.field],
      } as unknown as ModelFilter<M, ReferencedModelName>;
      const referencedModels = store.getMany(
        relationshipDef.referencesModelName,
        filter,
      );
      unsubscribers.push(
        store.subMany(relationshipDef.referencesModelName, filter, listener),
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

export class QueryManyWatcher<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
> {
  #store: LocoSyncReactStore<M>;
  #relationshipDefs: R;
  #listeners: Set<() => void>;

  #current:
    | {
        modelName: ModelName;
        modelFilter: ModelFilter<M, ModelName> | undefined;
        selection: Selection | undefined;
        visitResults: VisitResult<M, R, ModelName, Selection>[];
        baseUnsubscriber: () => void;
      }
    | undefined;
  #result: ModelResult<M, R, ModelName, Selection>[];

  constructor(store: LocoSyncReactStore<M>, relationshipDefs: R) {
    this.#store = store;
    this.#relationshipDefs = relationshipDefs;

    this.#listeners = new Set();
    this.#result = [];
  }

  private refresh(
    modelName: ModelName,
    modelFilter: ModelFilter<M, ModelName> | undefined,
    selection: Selection | undefined,
  ) {
    const baseModelData = this.#store.getMany(modelName, modelFilter);
    const baseUnsubscriber = this.#store.subMany(modelName, modelFilter, () =>
      this.onChange(),
    );
    const visitResults: VisitResult<M, R, ModelName, Selection>[] = [];
    for (const data of baseModelData) {
      const visitResult = applyRelationships(
        modelName,
        data,
        selection,
        this.#relationshipDefs,
        this.#store,
        () => this.onChange(),
      );
      if (visitResult) {
        visitResults.push(visitResult);
      }
    }

    this.#current = {
      modelName,
      modelFilter,
      selection,
      visitResults,
      baseUnsubscriber,
    };
    this.#result = visitResults.map((r) => r.result);
  }

  // At some point this should be smart enough to only un and re-subscribe to the parts that changed
  private onChange() {
    if (!this.#current) {
      return;
    }

    // Unsubscribe current listeners
    this.#current.baseUnsubscriber();
    for (const { unsubscribers } of this.#current.visitResults) {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    }

    // Resubscribe and update results
    this.refresh(
      this.#current.modelName,
      this.#current.modelFilter,
      this.#current.selection,
    );

    for (const callback of this.#listeners) {
      callback();
    }
  }

  subscribe(
    callback: () => void,
    modelName: ModelName,
    modelFilter: ModelFilter<M, ModelName> | undefined,
    selection: Selection | undefined,
  ) {
    this.refresh(modelName, modelFilter, selection);

    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  getSnapshot() {
    return this.#result;
  }
}

// TODO: Generalize to work with many as well?
export class QueryOneWatcher<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
> {
  #store: LocoSyncReactStore<M>;
  #relationshipDefs: R;
  #listeners: Set<() => void>;

  #current:
    | {
        modelName: ModelName;
        selection: Selection | undefined;
        modelId: string;
        visitResult: VisitResult<M, R, ModelName, Selection> | undefined;
        baseUnsubscriber: () => void;
      }
    | undefined;
  #result: ModelResult<M, R, ModelName, Selection> | undefined;

  constructor(store: LocoSyncReactStore<M>, relationshipDefs: R) {
    this.#store = store;
    this.#relationshipDefs = relationshipDefs;

    this.#listeners = new Set();
    this.#result = undefined;
  }

  private refresh(
    modelName: ModelName,
    modelId: string,
    selection: Selection | undefined,
  ) {
    const baseModelData = this.#store.getOne(modelName, modelId);
    const baseUnsubscriber = this.#store.subOne(modelName, modelId, () =>
      this.onChange(),
    );
    const visitResult =
      baseModelData &&
      applyRelationships(
        modelName,
        baseModelData,
        selection,
        this.#relationshipDefs,
        this.#store,
        () => this.onChange(),
      );

    this.#current = {
      modelName,
      modelId,
      selection,
      visitResult,
      baseUnsubscriber,
    };
    this.#result = visitResult?.result;
  }

  // At some point this should be smart enough to only un and re-subscribe to the parts that changed
  private onChange() {
    if (!this.#current) {
      return;
    }

    // Unsubscribe current listeners
    this.#current.baseUnsubscriber();
    if (this.#current.visitResult) {
      for (const unsubscribe of this.#current.visitResult.unsubscribers) {
        unsubscribe();
      }
    }

    // Resubscribe and update results
    this.refresh(
      this.#current.modelName,
      this.#current.modelId,
      this.#current.selection,
    );

    for (const callback of this.#listeners) {
      callback();
    }
  }

  subscribe(
    callback: () => void,
    modelName: ModelName,
    modelId: string,
    selection: Selection | undefined,
  ) {
    this.refresh(modelName, modelId, selection);

    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  getSnapshot() {
    return this.#result;
  }
}
