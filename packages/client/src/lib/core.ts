import { z } from 'zod';
// TODO: Maybe move the ModelsRelationshipDefs types to this file?
import type { ModelsRelationshipDefs } from './relationships';

export type ModelsSpec<M extends Models = {}, MArgs = unknown> = {
  models: M;
  relationshipDefs?: ModelsRelationshipDefs<M>;
  mutationArgs?: MArgs;
};

type AnyModelsSpec = ModelsSpec<{}, any>;

export type Models = {
  [ModelName in string]: Model;
};

export type ModelDefs<M extends Models> = {
  [ModelName in keyof M & string]: ModelDef;
};

export type ModelDef = {
  schemaVersion: number;
};

export type ModelsConfig<MS extends AnyModelsSpec> = {
  modelDefs: ModelDefs<MS['models']>;
  relationshipDefs?: ModelsRelationshipDefs<MS['models']>;
  parsers?: ModelsParsers<MS['models']>;
  mutationDefs?: MutationDefs<MS>;
};

export type ModelsParsers<M extends Models> = {
  [ModelName in keyof M & string]: z.ZodType<{ id: string }>;
};

type MutationDefs<MS extends ModelsSpec> = {
  getChanges: (args: MS['mutationArgs']) => LocalChanges<MS['models']>;
};

export type MutationArgs<MS extends ModelsSpec> =
  MS['mutationArgs'] extends NonNullable<MS['mutationArgs']>
    ? MS['mutationArgs']
    : LocalChanges<MS['models']>;

export type MutationOptions = {
  onSuccess?: () => void;
  onError?: () => void;
};

export type MutationFn<MS extends ModelsSpec> = (
  args: MutationArgs<MS>,
  options?: MutationOptions,
) => void;

export type ModelsWithKeys<ModelName extends string> = Record<ModelName, Model>;

export type ExtractModelsRelationshipDefs<MS extends ModelsSpec> =
  MS['relationshipDefs'] extends ModelsRelationshipDefs<MS['models']>
    ? MS['relationshipDefs']
    : {};

export type Model = { id: string } & Record<string, unknown>;
export type ModelData<
  M extends Models,
  ModelName extends keyof M,
> = M[ModelName];

// TODO: Non-trivial filtering?
export type ModelFilter<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  [K in keyof ModelData<M, ModelName>]?: ModelData<M, ModelName>[K];
};

export type LocalChanges<M extends Models> = ReadonlyArray<
  {
    [ModelName in keyof M & string]: LocalChange<M, ModelName>;
  }[keyof M & string]
>;

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
  ModelName extends keyof M & string,
> extends BaseSyncAction<ModelName> {
  action: 'insert';
  data: ModelData<M, ModelName>;
}
interface SyncAction_Update<
  M extends Models,
  ModelName extends keyof M & string,
> extends BaseSyncAction<ModelName> {
  action: 'update';
  data: ModelData<M, ModelName>;
}
interface SyncAction_Delete<
  M extends Models,
  ModelName extends keyof M & string,
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

export function getMutationLocalChanges<MS extends ModelsSpec>(
  config: ModelsConfig<MS>,
  args: MutationArgs<MS>,
): LocalChanges<MS['models']> {
  if (config.mutationDefs) {
    return config.mutationDefs.getChanges(args);
  } else {
    // Based on config.mutationDefs types, this must be LocalChanges
    return args as LocalChanges<MS['models']>;
  }
}

export function createConfig<MS extends ModelsSpec>(
  config: ModelsConfig<MS>,
): ModelsConfig<MS> {
  return config;
}
