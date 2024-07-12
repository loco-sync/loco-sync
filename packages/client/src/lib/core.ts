import type { ModelsRelationshipDefs } from './relationships';
import type { ModelsIndexes } from './indexes';

export type ModelsSpec<
  M extends Models = {},
  MArgs = unknown,
  SyncGroup = unknown,
> = {
  models: M;
  relationshipDefs: ModelsRelationshipDefs<M>;
  mutationArgs?: MArgs;
  syncGroup?: SyncGroup;
};

type AnyModelsSpec = ModelsSpec<{}, any>;

export type Models = {
  [ModelName in string]: Model;
};

export type ModelDefs<M extends Models> = {
  [ModelName in keyof M & string]: ModelDef;
};

export type ModelDef = {
  preloadFromStorage?: boolean;
  initialBootstrap?: boolean;
};

export type ModelsConfig<MS extends AnyModelsSpec> = {
  modelDefs: ModelDefs<MS['models']>;
  relationshipDefs?: ModelsRelationshipDefs<MS['models']>;
  indexes?: ModelsIndexes<MS['models']>;
  mutationDefs?: MutationDefs<MS>;
  syncGroupDefs?: SyncGroupDefs<MS>;
};

type MutationDefs<MS extends ModelsSpec> = {
  getChanges: (
    args: MS['mutationArgs'],
    store: ReadonlyModelDataStore<MS['models']>,
  ) => LocalChanges<MS['models']>;
};

type SyncGroupDefs<MS extends ModelsSpec> = {
  modelsForPartialBootstrap: (
    syncGroup: MS['syncGroup'],
  ) => (keyof MS['models'] & string)[];
  equals: (a: MS['syncGroup'], b: MS['syncGroup']) => boolean;
};

export type ReadonlyModelDataStore<M extends Models> = {
  getMany: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter?: ModelFilter<M, ModelName>,
  ) => ModelData<M, ModelName>[];

  getOne: <ModelName extends keyof M & string>(
    modelName: ModelName,
    filter?: ModelFilter<M, ModelName>,
  ) => ModelData<M, ModelName> | undefined;
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

export type Model = { id: string } & Record<string, unknown>;

export type ModelData<
  M extends Models,
  ModelName extends keyof M,
> = M[ModelName];

export type ModelField<
  M extends Models,
  ModelName extends keyof M & string,
> = keyof ModelData<M, ModelName> & string;

// TODO: Non-trivial filtering?
export type ModelFilter<
  M extends Models,
  ModelName extends keyof M & string,
> = {
  [K in ModelField<M, ModelName>]?: ModelData<M, ModelName>[K];
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

export interface Metadata<SyncGroup> {
  firstSyncId: number;
  lastSyncId: number;
  lastUpdatedAt: string;
  syncGroups: SyncGroup[];
}

export type BootstrapPayload<M extends Models> = {
  [ModelName in keyof M & string]?: ModelData<M, ModelName>[];
};

export function getMutationLocalChanges<MS extends ModelsSpec>(
  config: ModelsConfig<MS>,
  args: MutationArgs<MS>,
  store: ReadonlyModelDataStore<MS['models']>,
): LocalChanges<MS['models']> {
  if (config.mutationDefs) {
    return config.mutationDefs.getChanges(args, store);
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
