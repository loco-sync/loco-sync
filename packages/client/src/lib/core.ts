import { z } from 'zod';
// TODO: Maybe move the ModelsRelationshipDefs types to this file??
import { ModelsRelationshipDefs } from './relationships';

export type Models = {
  [ModelName in string]: Model;
};

export interface ModelsConfig<M extends Models> {
  modelNames: (keyof M & string)[];
  relationshipDefs?: ModelsRelationshipDefs<M>;
  parsers?: ModelsParsers<M>;
  mutationDefs?: AnyMutationDefs<M>;
}

export type ModelsParsers<M extends Models> = {
  [ModelName in keyof M & string]: z.ZodType<{ id: string }>;
};

export type ModelsParsersWithKeys<ModelName extends string> = {
  [x in ModelName]: z.ZodType<{ id: string }>;
};

type MutationDefs<M extends Models, Args extends unknown> = {
  getChanges: (args: Args) => LocalChanges<M>;
};

type AnyMutationDefs<M extends Models> = MutationDefs<M, unknown>;

export type MutationArgs<
  M extends Models,
  MC extends ModelsConfig<M>
> = MC['mutationDefs'] extends MutationDefs<M, infer Args>
  ? Args
  : LocalChanges<M>;

export type MutationFn<M extends Models, MC extends ModelsConfig<M>> = (
  args: MutationArgs<M, MC>
) => void;

export type ModelsWithKeys<ModelName extends string> = Record<ModelName, Model>;

export type ExtractModelsRelationshipDefs<
  M extends Models,
  MC extends ModelsConfig<M>
> = MC['relationshipDefs'] extends ModelsRelationshipDefs<M>
  ? MC['relationshipDefs']
  : {};

// // Minimalist version
export type Model = { id: string } & Record<string, unknown>;
export type ModelData<
  M extends Models,
  ModelName extends keyof M & string
> = M[ModelName];

/**
 *
 * Everything below here is the same as in core.ts
 *
 */

// TODO: Non-trivial filtering?
export type ModelFilter<
  M extends Models,
  ModelName extends keyof M & string
> = {
  [K in keyof ModelData<M, ModelName>]?: ModelData<M, ModelName>[K];
};

export type LocalChanges<M extends Models> = {
  [ModelName in keyof M & string]?: LocalChange<M, ModelName>[];
};

export type LocalChange<M extends Models, ModelName extends keyof M & string> =
  | LocalCreate<M, ModelName>
  | LocalUpdate<M, ModelName>
  | LocalDelete<M, ModelName>;

interface LocalCreate<M extends Models, ModelName extends keyof M & string>
  extends BaseLocalChange<ModelName> {
  action: 'create';
  data: ModelData<M, ModelName>;
}
interface LocalUpdate<M extends Models, ModelName extends keyof M & string>
  extends BaseLocalChange<ModelName> {
  action: 'update';
  data: Partial<Omit<ModelData<M, ModelName>, 'id'>>;
}
interface LocalDelete<M extends Models, ModelName extends keyof M & string>
  extends BaseLocalChange<ModelName> {
  action: 'delete';
}
type BaseLocalChange<ModelName extends string> = {
  modelName: ModelName;
  modelId: string;
  // batchIndex: number; // (optimization that we don't need yet)
};

export type SyncAction<M extends Models, ModelName extends keyof M & string> =
  | SyncAction_Insert<M, ModelName>
  | SyncAction_Update<M, ModelName>
  | SyncAction_Delete<M, ModelName>;
interface SyncAction_Insert<
  M extends Models,
  ModelName extends keyof M & string
> extends BaseSyncAction<ModelName> {
  action: 'insert';
  data: ModelData<M, ModelName>;
}
interface SyncAction_Update<
  M extends Models,
  ModelName extends keyof M & string
> extends BaseSyncAction<ModelName> {
  action: 'update';
  data: ModelData<M, ModelName>;
}
interface SyncAction_Delete<
  M extends Models,
  ModelName extends keyof M & string
> extends BaseSyncAction<ModelName> {
  action: 'delete';
}
type BaseSyncAction<ModelName extends string> = {
  syncId: number;
  modelName: ModelName;
  modelId: string;
};

export interface Metadata {
  // Should this be called databaseVersion?
  modelSchemaVersion: number;
  firstSyncId: number;
  lastSyncId: number;
  lastUpdatedAt: string;
}

export type BootstrapPayload<M extends Models> = {
  [ModelName in keyof M & string]?: ModelData<M, ModelName>[];
};

export function getMutationLocalChanges<
  M extends Models,
  MC extends ModelsConfig<M>
>(config: MC, args: MutationArgs<M, MC>): LocalChanges<M> {
  if (config.mutationDefs) {
    return config.mutationDefs.getChanges(args);
  } else {
    // Based on config.mutationDefs types, this must be LocalChanges
    return args as LocalChanges<M>;
  }
}
