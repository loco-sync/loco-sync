import {
  type ModelDefs,
  type ModelsRelationshipDefs,
  one,
  many,
  LocoSyncClient,
  type BootstrapPayload,
  createConfig,
  type NetworkAdapter,
  type NetworkMessage,
  type StorageAdapter,
  type NetworkMessageListener,
  type SyncAction,
} from '@loco-sync/client';

type M = {
  Todo: {
    id: string;
    text: string;
    authorId: string;
  };
  Author: {
    id: string;
    name: string;
  };
};

const modelDefs: ModelDefs<M> = {
  Todo: { schemaVersion: 0 },
  Author: { schemaVersion: 0 },
};

const relationshipDefs = {
  Author: {
    todos: many('Todo', {
      fields: ['id'],
      references: ['authorId'],
    }),
  },
  Todo: {
    author: one('Author', {
      fields: ['authorId'],
      references: ['id'],
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

type R = typeof relationshipDefs;

type MS = {
  models: M;
  relationshipDefs: R;
};

export const config = createConfig<MS>({
  modelDefs,
  relationshipDefs,
});

const networkAdapter: NetworkAdapter<MS> = {
  sendTransaction: async () => ({ ok: true, value: { lastSyncId: 0 } }),
  deltaSync: async () => ({ ok: true, value: { sync: [] } }),
  loadBootstrap: async () => ({
    ok: true,
    value: { lastSyncId: 0, bootstrap: {} },
  }),
  initSync: () => () => {},
};

const storageAdapter: StorageAdapter<MS> = {
  getMetadataAndPendingTransactions: async () => undefined,
  applySyncActions: async () => {},
  removePendingTransaction: async () => {},
  createPendingTransaction: async () => 0,
  saveBootstrap: async () => {},
  loadBootstrap: async () => ({}),
};

export const client = new LocoSyncClient({
  network: networkAdapter,
  storage: storageAdapter,
});

const syncAction: SyncAction<M, 'Todo'> = {
  syncId: 123,
  action: 'insert',
  modelName: 'Todo',
  modelId: '1',
  data: { id: '1', text: 'hello', authorId: '1' },
};
