import type { ModelField, ModelFilter, Models } from './core';

export type ModelsIndexes<M extends Models> = {
  [ModelName in keyof M & string]?: ModelIndex<M, ModelName>[];
};

export type ModelIndex<M extends Models, ModelName extends keyof M & string> = {
  name: string;
  fields: ModelField<M, ModelName>[];
};

export function findIndexForFilter<
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

export function narrowFilterForIndex<
  M extends Models,
  ModelName extends keyof M & string,
>(
  index: ModelIndex<M, ModelName>,
  filter: ModelFilter<M, ModelName>,
): ModelFilter<M, ModelName> {
  const result: ModelFilter<M, ModelName> = {};
  for (const field of index.fields) {
    result[field] = filter[field] as ModelFilter<M, ModelName>[typeof field];
  }
  return result;
}
