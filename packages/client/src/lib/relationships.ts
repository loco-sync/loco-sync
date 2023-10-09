import type { ModelData, Models } from './core';
import type { Simplify } from './typeUtils';

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
  Type extends ModelRelationshipType
> = {
  referencesModelName: ReferencesModelName;
  // TODO: What would it look like to have composite (e.g. field, referencesField are lists)
  references: keyof ModelData<M, ReferencesModelName>;
  field: keyof ModelData<M, ModelName>;
  type: Type;
};

// TODO: Support for relationship where "field" is an array of ids
// many-to-many's can represented this way

export const many = <
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string
>(
  referencesModelName: ReferencesModelName,
  {
    references,
    field = 'id',
  }: {
    references: keyof ModelData<M, ReferencesModelName>;
    field?: keyof ModelData<M, ModelName>;
  }
): ModelRelationshipDef<M, ModelName, ReferencesModelName, 'many'> => ({
  referencesModelName,
  references,
  field,
  type: 'many',
});

export const one = <
  M extends Models,
  ModelName extends keyof M & string,
  ReferencesModelName extends keyof M & string
>(
  referencesModelName: ReferencesModelName,
  {
    references = 'id',
    field,
  }: {
    references?: keyof ModelData<M, ReferencesModelName>;
    field: keyof ModelData<M, ModelName>;
  }
): ModelRelationshipDef<M, ModelName, ReferencesModelName, 'one'> => ({
  referencesModelName,
  references,
  field,
  type: 'one',
});

export type ModelRelationshipSelection<
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string
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
  Selection extends ModelRelationshipSelection<M, R, ModelName> | undefined
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
  Selection extends ModelRelationshipSelection<M, R, ModelName> | undefined
> = Simplify<
  ModelData<M, ModelName> & ModelRelationshipData<M, R, ModelName, Selection>
>;
