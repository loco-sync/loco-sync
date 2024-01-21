import type { ModelData, Models } from './core';
import type { Simplify } from './typeUtils';

// Only difference in this file is the imports

export type ModelsRelationshipDefs<M extends Models> = {
  [ModelName in keyof M & string]?: Record<
    string,
    ModelRelationshipDef<M, ModelName, any, any>
  >;
};

export type ModelRelationshipType = 'one' | 'many';

export type ModelRelationshipDef<
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string,
  Type extends ModelRelationshipType,
> = {
  referencesModelName: ReferencesModelName;
  fields: {
    reference: ModelField<M, ReferencesModelName>;
    base: ModelField<M, ModelName>;
  }[];
  type: Type;
};

// TODO: Support for relationship where one of "fields" is an array of ids
// many-to-many's can represented this way

type RelationshipConfig<
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string,
  TFields extends ModelField<M, ModelName>[],
> = {
  fields: TFields;
  references: MatchingModelFields<M, ModelName, ReferencesModelName, TFields>;
};

type MatchingModelFields<
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string,
  TFields extends ModelField<M, ModelName>[],
> = {
  [Key in keyof TFields]: ModelField<M, ReferencesModelName>;
};

type ModelField<
  M extends Models,
  ModelName extends keyof M & string,
> = keyof ModelData<M, ModelName>;

export const many = <
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string,
  TFields extends [ModelField<M, ModelName>, ...ModelField<M, ModelName>[]],
>(
  referencesModelName: ReferencesModelName,
  config: RelationshipConfig<M, ModelName, ReferencesModelName, TFields>,
): ModelRelationshipDef<M, ModelName, ReferencesModelName, 'many'> => ({
  referencesModelName,
  fields: normalizeRelationshipFields(config),
  type: 'many',
});

export const one = <
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string,
  TFields extends [ModelField<M, ModelName>, ...ModelField<M, ModelName>[]],
>(
  referencesModelName: ReferencesModelName,
  config: RelationshipConfig<M, ModelName, ReferencesModelName, TFields>,
): ModelRelationshipDef<M, ModelName, ReferencesModelName, 'one'> => ({
  referencesModelName,
  fields: normalizeRelationshipFields(config),
  type: 'one',
});

function normalizeRelationshipFields<
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string,
  TFields extends ModelField<M, ModelName>[],
>({
  references,
  fields,
}: RelationshipConfig<M, ModelName, ReferencesModelName, TFields>): {
  reference: ModelField<M, ReferencesModelName>;
  base: ModelField<M, ModelName>;
}[] {
  const result: {
    reference: ModelField<M, ReferencesModelName>;
    base: ModelField<M, ModelName>;
  }[] = [];

  if (fields.length !== references.length) {
    throw new Error('"fields" and "references" are different lengths');
  }

  if (fields.length === 0) {
    throw new Error('"fields" and "references" cannot be empty');
  }

  for (let index = 0; index < fields.length; index++) {
    const base = fields[index];
    const reference = references[index];
    if (base === undefined || reference === undefined) {
      throw new Error('"fields" and "references" are different lengths');
    }
    result.push({
      base,
      reference,
    });
  }

  return result;
}

export type ModelRelationshipSelection<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
> = {
  [K in keyof R[ModelName]]?: R[ModelName][K] extends ModelRelationshipDef<
    M,
    ModelName,
    infer ReferencesModelName,
    any
  >
    ? ModelRelationshipSelection<M, R, ReferencesModelName>
    : never;
};

export type ModelRelationshipData<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName> | undefined,
> = {
  [K in keyof Selection &
    string &
    keyof R[ModelName]]: R[ModelName][K] extends ModelRelationshipDef<
    M,
    ModelName,
    infer ReferencesModelName,
    infer Type
  >
    ? Selection[K] extends ModelRelationshipSelection<M, R, ReferencesModelName>
      ? Type extends 'one'
        ?
            | (ModelData<M, ReferencesModelName> &
                ModelRelationshipData<M, R, ReferencesModelName, Selection[K]>)
            | undefined
        : ReadonlyArray<
            ModelData<M, ReferencesModelName> &
              ModelRelationshipData<M, R, ReferencesModelName, Selection[K]>
          >
      : Type extends 'one'
      ? ModelData<M, ReferencesModelName> | undefined
      : ReadonlyArray<ModelData<M, ReferencesModelName>>
    : never;
};

export type ModelResult<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName> | undefined,
> = Simplify<
  ModelData<M, ModelName> & ModelRelationshipData<M, R, ModelName, Selection>
>;
