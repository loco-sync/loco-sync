import type { ModelFilter, ModelsSpec } from './core';
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
  #listener: (() => void) | undefined;
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

    this.#listener?.();
  }

  setNotHydrated() {
    if (!this.#resultMany.isHydrated && !this.#resultOne.isHydrated) {
      return;
    }

    this.#resultMany = { data: [], isHydrated: false };
    this.#resultOne = { data: undefined, isHydrated: false };

    this.#listener?.();
  }

  subscribe(listener: () => void) {
    if (this.#listener) {
      throw new Error(
        'QueryObserver can only be subscribed by one listener at a time.',
      );
    }

    this.#listener = listener;
    return () => {
      this.#listener = undefined;
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
