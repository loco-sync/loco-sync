import type { ModelField, Models } from './core';
import {
  InArrayFilter,
  type LiteralModelFilter,
  type ModelFilter,
} from './filters';

export type ModelsIndexes<M extends Models> = {
  [ModelName in keyof M & string]?: ModelIndex<M, ModelName>[];
};

export type ModelIndex<M extends Models, ModelName extends keyof M & string> = {
  name: string;
  fields: ModelField<M, ModelName>[];
};

export type ModelIndexValues<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  index: ModelIndex<M, ModelName>;
  values: LiteralModelFilter<M, ModelName>[];
};

export type EmptyModelIndexValues<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  index: undefined;
  // This is important, since it will cause downstream code to load all of the data because no index was found
  values: [{}];
};

export type MaybeModelIndexValues<
  M extends Models,
  ModelName extends keyof M & string,
> = ModelIndexValues<M, ModelName> | EmptyModelIndexValues<M, ModelName>;

function findIndexForFilter<
  M extends Models,
  ModelName extends keyof M & string,
>(
  indexes: ModelIndex<M, ModelName>[],
  modelFilter: ModelFilter<M, ModelName>,
): ModelIndex<M, ModelName> | undefined {
  const filterFields = Object.keys(modelFilter ?? {});
  for (const index of indexes) {
    const indexFields = Array.isArray(index.fields)
      ? index.fields
      : [index.fields];
    const isSubset = indexFields.every((key) => filterFields.includes(key));
    if (isSubset) {
      return index;
    }
  }

  return;
}

function modelIndexValuesFromFilter<
  M extends Models,
  ModelName extends keyof M & string,
>(
  index: ModelIndex<M, ModelName>,
  filter: ModelFilter<M, ModelName>,
): ModelIndexValues<M, ModelName> | undefined {
  let modelIndexValuesFilters: LiteralModelFilter<M, ModelName>[] | undefined =
    undefined;
  for (const field of index.fields) {
    const filterValue = filter[field];
    if (filterValue instanceof InArrayFilter) {
      const inArrayFilterValue = filterValue as InArrayFilter<
        M,
        ModelName,
        typeof field
      >;
      if (modelIndexValuesFilters) {
        modelIndexValuesFilters = modelIndexValuesFilters.flatMap(
          (existingValue) =>
            inArrayFilterValue.values.map((inArrayValue) => ({
              ...existingValue,
              [field]: inArrayValue,
            })),
        );
      } else {
        modelIndexValuesFilters = inArrayFilterValue.values.map(
          (inArrayValue) =>
            ({
              [field]: inArrayValue,
            }) as LiteralModelFilter<M, ModelName>,
        );
      }
    } else {
      if (modelIndexValuesFilters) {
        modelIndexValuesFilters = modelIndexValuesFilters.map((value) => ({
          ...value,
          [field]: filterValue,
        }));
      } else {
        modelIndexValuesFilters = [
          { [field]: filterValue } as LiteralModelFilter<M, ModelName>,
        ];
      }
    }
  }

  return (
    modelIndexValuesFilters && {
      index,
      values: modelIndexValuesFilters,
    }
  );
}

export function indexAndFilterForLoad<
  M extends Models,
  ModelName extends keyof M & string,
>(
  modelName: ModelName,
  modelFilter: ModelFilter<M, ModelName> | undefined,
  indexes: ModelsIndexes<M> | undefined,
): MaybeModelIndexValues<M, ModelName> {
  if (modelFilter) {
    const index = findIndexForFilter(indexes?.[modelName] ?? [], modelFilter);
    if (index) {
      const result = modelIndexValuesFromFilter(index, modelFilter);
      if (result) {
        return result;
      }
    }
  }

  return {
    index: undefined,
    values: [{}],
  };
}
