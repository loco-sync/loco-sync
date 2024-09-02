import type { ModelsSpec } from './core';
import type { ModelRelationshipSelection, ModelResult } from './relationships';
import type { ModelFilter } from './filters';

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
  #resultMany: QueryManyResult<MS, ModelName, Selection>;
  #resultOne: QueryOneResult<MS, ModelName, Selection>;

  constructor(
    public readonly modelName: ModelName,
    public readonly modelFilter:
      | ModelFilter<MS['models'], ModelName>
      | undefined,
    public readonly selection: Selection | undefined,
  ) {
    this.#resultMany = { data: [], isHydrated: false };
    this.#resultOne = { data: undefined, isHydrated: false };
    this.#listeners = new Set();
  }

  setResult(
    data: ModelResult<
      MS['models'],
      MS['relationshipDefs'],
      ModelName,
      Selection
    >[],
    isHydrated: boolean,
  ) {
    this.#resultMany = {
      data,
      isHydrated,
    };
    this.#resultOne = {
      data: data[0],
      isHydrated,
    };

    for (const listener of this.#listeners) {
      listener();
    }
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
