import {
  NetworkAdapter,
  SyncListener,
  SyncAction,
  ModelData,
  ModelsSpec,
  LocalChange,
  BootstrapPayload,
  MutationArgs,
} from '@loco-sync/client';

export interface FakeNetworkAdapterOptions<MS extends ModelsSpec> {
  seedData?: SeedData<MS>;
  generateMutations?: {
    interval: number;
    count: number;
    fn: GenerateMutation<MS>;
  };
  randomDelay?: {
    min?: number;
    max?: number;
  };
}

type SeedData<MS extends ModelsSpec> = {
  count: number;
  fn: (store: ModelStore<MS>) => BootstrapPayload<MS['models']>;
}[];

type GenerateMutation<MS extends ModelsSpec> = (
  store: ModelStore<MS>,
) => MutationArgs<MS>;

type ModelStore<MS extends ModelsSpec> = Map<
  keyof MS['models'] & string,
  Map<string, ModelData<MS['models'], keyof MS['models'] & string>>
>;

export function createFakeNetworkAdapter<MS extends ModelsSpec>(
  opts?: FakeNetworkAdapterOptions<MS>,
): NetworkAdapter<MS> {
  console.log('createFakeNetworkAdapter');
  const listeners: Set<SyncListener<MS>> = new Set();
  const syncs: SyncAction<MS['models'], keyof MS['models'] & string>[] = [];
  const modelStores: ModelStore<MS> = new Map();

  function getModelStore(modelName: keyof MS['models'] & string) {
    let modelStore = modelStores.get(modelName);
    if (!modelStore) {
      modelStore = new Map();
      modelStores.set(modelName, modelStore);
    }
    return modelStore;
  }

  for (const { count, fn } of opts?.seedData ?? []) {
    for (let i = 0; i < count; i++) {
      const data = fn(modelStores);
      for (const [key, value] of Object.entries(data)) {
        const modelName = key as keyof MS['models'] & string;
        const models = value as ModelData<
          MS['models'],
          keyof MS['models'] & string
        >[];
        const modelStore = getModelStore(modelName);
        for (const model of models) {
          modelStore.set(model.id, model);
        }
      }
    }
  }
  console.log({ modelStores });

  const minSleep = opts?.randomDelay?.min ?? 0;
  const maxSleep = opts?.randomDelay?.max ?? 100;
  const randomSleep = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, minSleep + Math.random() * (maxSleep - minSleep));
    });

  let lastSyncId = 0;
  setInterval(() => {
    const newSyncs = syncs.slice(lastSyncId);
    lastSyncId += newSyncs.length;
    for (const listener of listeners) {
      listener({
        type: 'sync',
        sync: newSyncs,
        lastSyncId,
      });
    }
  });

  const adapter: NetworkAdapter<MS> = {
    sendTransaction: async (args) => {
      await randomSleep();
      // Would need to get access to the model store to convert arbitrary mutation args to local changes
      // So for now just assume the mutation args are already local changes (which is the default)
      const changes = args as LocalChange<
        MS['models'],
        keyof MS['models'] & string
      >[];

      let newLastSyncId = syncs.length;
      for (const change of changes) {
        newLastSyncId++;
        if (change.action === 'create') {
          const modelStore = getModelStore(change.modelName);
          modelStore.set(change.modelId, change.data);
          syncs.push({
            syncId: newLastSyncId,
            action: 'insert',
            modelId: change.modelId,
            modelName: change.modelName,
            data: change.data,
          });
        } else if (change.action === 'update') {
          const modelStore = getModelStore(change.modelName);
          const existing = modelStore.get(change.modelId);
          if (!existing) {
            continue;
          }
          const newData = {
            ...existing,
            ...change.data,
          };
          modelStore.set(change.modelId, newData);
          syncs.push({
            syncId: newLastSyncId,
            action: 'update',
            modelId: change.modelId,
            modelName: change.modelName,
            data: newData,
          });
        } else {
          const modelStore = getModelStore(change.modelName);
          modelStore.delete(change.modelId);
          syncs.push({
            syncId: newLastSyncId,
            action: 'delete',
            modelId: change.modelId,
            modelName: change.modelName,
          });
        }
      }

      await randomSleep();
      return {
        ok: true,
        value: {
          lastSyncId: newLastSyncId,
        },
      };
    },
    bootstrap: async () => {
      console.log('bootstrap', modelStores);
      await randomSleep();
      const bootstrap: BootstrapPayload<MS['models']> = {};
      for (const [modelName, modelStore] of modelStores) {
        bootstrap[modelName] = Array.from(modelStore.values());
      }

      const result = {
        ok: true as const,
        value: {
          firstSyncId: lastSyncId,
          syncGroups: [],
          bootstrap,
        },
      };
      await randomSleep();
      return result;
    },
    deltaSync: async (fromSyncId, toSyncId) => {
      await randomSleep();
      const sync = syncs.slice(fromSyncId, toSyncId);
      await randomSleep();
      return {
        ok: true,
        value: {
          sync,
        },
      };
    },
    initSync: async (listener) => {
      await randomSleep();
      listeners.add(listener);
      listener({
        type: 'handshake',
        syncGroups: [],
        lastSyncId,
      });
      return () => listeners.delete(listener);
    },
  };

  const generateMutations = opts?.generateMutations;
  if (generateMutations) {
    setInterval(() => {
      const mutations = generateMutations.fn(modelStores);
      adapter.sendTransaction(mutations);
    }, generateMutations.interval);
  }

  return adapter;
}
