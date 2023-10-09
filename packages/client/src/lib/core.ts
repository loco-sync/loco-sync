import { z } from 'zod';

export type Models = {
  [M in string]: Model;
};

export type ModelsWithKeys<ModelName extends string> = Record<ModelName, Model>;

export type ModelBaseSchema = z.ZodObject<{
  id: z.ZodString;
}>;

// Zod based version - might go with this for MVP but seems overly opinionated
export type Model = {
  // schema: z.AnyZodObject;
  schema: ModelBaseSchema;
  // Next step would probably be including metadata on relationships with other models here?
  // Also, assuming IndexedDB, we could include indexes here
  // Then, these could be re-used in the in-memory component for searching
  // (though TBD if those requests get routed through this component or not)
  // If MVP is just loading everything into memory, then it's probably not necessary anyways?
};

// TODO: Since this will be stored in IndexedDB, should only use string or number here
// I think sub-objects and arrays are fine too?
// Should these be encoded in the types?

export type ModelData<
  M extends Models,
  ModelName extends keyof M & string
> = z.infer<M[ModelName]['schema']>;

// TODO: Non-trivial filtering?
export type ModelFilter<
  M extends Models,
  ModelName extends keyof M & string
> = {
  [K in keyof ModelData<M, ModelName>]?: ModelData<M, ModelName>[K];
};

// // Minimalist version
// export type Model = Record<string, unknown>;
// export type ModelData<
//   M extends Models,
//   ModelName extends keyof M & string
// > = M[ModelName];

// // // // // // // // // // // //
// Start of types that would be useful to provide limited ways to mutate data vs changing anything
// Each mutation would have a particular name and (expected args schema)?
type NamedMutations = {
  [M in string]: NamedMutationFn;
};
type NamedMutationFn = (mutation: NamedMutation) => Promise<void>;
// Need extra layer to go from these mutations to SyncActions
type NamedMutation = {
  id: number;
  name: string;
  args: any;
};
// // // // // // // // // // // //

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

export type MutationFn<M extends Models> = (changes: LocalChanges<M>) => void;

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
