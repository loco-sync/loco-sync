import type { ModelData, ModelField, Models } from './core';

export type ModelFilter<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  [Field in ModelField<M, ModelName>]?: ModelFilterFieldValue<
    M,
    ModelName,
    Field
  >;
};

export type LiteralModelFilter<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  [Field in ModelField<M, ModelName>]?: LiteralFilter<M, ModelName, Field>;
};

type ModelFilterFieldValue<
  M extends Models,
  ModelName extends keyof M & string,
  Field extends ModelField<M, ModelName>,
> = LiteralFilter<M, ModelName, Field> | InArrayFilter<M, ModelName, Field>;

type LiteralFilter<
  M extends Models,
  ModelName extends keyof M & string,
  Field extends ModelField<M, ModelName>,
> = ModelData<M, ModelName>[Field];

export class InArrayFilter<
  M extends Models,
  ModelName extends keyof M & string,
  Field extends ModelField<M, ModelName>,
> {
  private constructor(readonly values: ModelData<M, ModelName>[Field][]) {}

  static create = <
    M extends Models,
    ModelName extends keyof M & string,
    Field extends ModelField<M, ModelName>,
  >(
    values: ModelData<M, ModelName>[Field][],
  ) => {
    return new InArrayFilter<M, ModelName, Field>(values);
  };
}

export const inArray = InArrayFilter.create;

export const dataPassesFilter = <
  M extends Models,
  ModelName extends keyof M & string,
>(
  data: ModelData<M, ModelName>,
  filter: ModelFilter<M, ModelName>,
): boolean => {
  for (const key in filter) {
    const filterKey = key as ModelField<M, ModelName>;
    const filterValue = filter[filterKey];
    const dataValue = data[filterKey];
    if (filterValue instanceof InArrayFilter) {
      if (!filterValue.values.includes(dataValue)) {
        return false;
      }
    } else {
      if (dataValue !== filterValue) {
        return false;
      }
    }
  }
  return true;
};
