import type { ModelFilter, ModelsSpec } from './core';
import type { ModelDataCache } from './model-data-cache';
import type { ModelRelationshipSelection, ModelResult } from './relationships';

export class QueryObserver<
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string,
  Selection extends ModelRelationshipSelection<
    MS['models'],
    MS['relationshipDefs'],
    ModelName
  >,
> {
  #cache: ModelDataCache<MS>;
  #listeners: Set<() => void>;
  #resultMany: QueryManyResult<MS, ModelName, Selection>;
  #resultOne: QueryOneResult<MS, ModelName, Selection>;

  constructor(
    cache: ModelDataCache<MS>,
    public readonly modelName: ModelName,
    public readonly modelFilter:
      | ModelFilter<MS['models'], ModelName>
      | undefined,
    public readonly selection: Selection | undefined,
  ) {
    this.#listeners = new Set();
    this.#resultMany = { data: [], isHydrated: false };
    this.#resultOne = { data: undefined, isHydrated: false };
    this.#cache = cache;
    cache.addObserver(this);
  }

  setResult(
    data: ModelResult<
      MS['models'],
      MS['relationshipDefs'],
      ModelName,
      Selection
    >[],
  ) {
    this.#resultMany = {
      data,
      isHydrated: true,
    };
    this.#resultOne = {
      data: data[0],
      isHydrated: true,
    };

    for (const listener of this.#listeners) {
      listener();
    }
  }

  setNotHydrated() {
    if (!this.#resultMany.isHydrated && !this.#resultOne.isHydrated) {
      return;
    }

    this.#resultMany = { data: [], isHydrated: false };
    this.#resultOne = { data: undefined, isHydrated: false };

    for (const listener of this.#listeners) {
      listener();
    }
  }

  subscribe(callback: () => void) {
    this.#listeners.add(callback);

    return () => {
      this.#listeners.delete(callback);
      if (this.#listeners.size === 0) {
        this.#cache.removeObserver(this);
      }
    };
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
