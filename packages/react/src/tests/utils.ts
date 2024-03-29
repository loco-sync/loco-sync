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
} from '@loco-sync/client';

type M = {
  Group: {
    id: string;
    name: string;
  };
  Author: {
    id: string;
    name: string;
    groupId: string | null;
  };
  Post: {
    id: string;
    title: string;
    body: string;
    authorId: string;
  };
  Tag: {
    id: string;
    name: string;
  };
  PostTag: {
    id: string;
    postId: string;
    tagId: string;
  };
  PostTagAnnotation: {
    id: string;
    postId: string;
    tagId: string;
    annotation: string;
  };
};

type R = typeof relationshipDefs;

export type MS = {
  models: M;
  relationshipDefs: R;
};

export const modelDefs: ModelDefs<M> = {
  Group: { schemaVersion: 0, preload: true },
  Post: { schemaVersion: 0, preload: true },
  Author: { schemaVersion: 0, preload: true },
  Tag: { schemaVersion: 0, preload: true },
  PostTag: { schemaVersion: 0, preload: true },
  PostTagAnnotation: { schemaVersion: 0, preload: true },
};

export const relationshipDefs = {
  Post: {
    author: one('Author', {
      fields: ['authorId'],
      references: ['id'],
    }),
  },
  Author: {
    posts: many('Post', {
      fields: ['id'],
      references: ['authorId'],
    }),
  },
  Group: {
    authors: many('Author', {
      fields: ['id'],
      references: ['groupId'],
    }),
  },
  Tag: {},
  PostTag: {
    post: one('Post', {
      fields: ['postId'],
      references: ['id'],
    }),
    tag: one('Tag', {
      fields: ['tagId'],
      references: ['id'],
    }),
    annotations: many('PostTagAnnotation', {
      fields: ['postId', 'tagId'],
      references: ['postId', 'tagId'],
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

export const fakeNetworkAdapter: NetworkAdapter<MS> = {
  sendTransaction: async () => ({ ok: true, value: { lastSyncId: 0 } }),
  deltaSync: async () => ({ ok: true, value: { sync: [] } }),
  loadBootstrap: async () => ({
    ok: true,
    value: { lastSyncId: 0, bootstrap: {} },
  }),
  initSync: () => () => {},
};

export const fakeStorageAdapter: StorageAdapter<MS> = {
  getMetadataAndPendingTransactions: async () => undefined,
  applySyncActions: async () => {},
  removePendingTransaction: async () => {},
  createPendingTransaction: async () => 0,
  saveBootstrap: async () => {},
  loadBootstrap: async () => ({}),
  loadModelData: async () => [],
};

type SetupOptions = {
  networkAdapter?: Partial<NetworkAdapter<MS>>;
};

export const setup = (
  bootstrap: BootstrapPayload<M>,
  options?: SetupOptions,
) => {
  const config = createConfig<MS>({
    modelDefs,
    relationshipDefs,
  });

  let listener: NetworkMessageListener<MS['models']> | undefined;

  const networkAdapter: NetworkAdapter<MS> = {
    ...fakeNetworkAdapter,
    loadBootstrap: async () => {
      return {
        ok: true,
        value: {
          bootstrap,
          lastSyncId: 1,
        },
      };
    },
    initSync: (_listener) => {
      listener = _listener;
      listener({
        type: 'handshake',
        modelSchemaVersion: 1,
        lastSyncId: 0,
      });
      return () => {};
    },
    ...options?.networkAdapter,
  };

  const storageAdapter: StorageAdapter<MS> = {
    ...fakeStorageAdapter,
    async loadBootstrap() {
      return bootstrap;
    },
    async loadModelData(modelName, args) {
      if (args) {
        throw new Error(
          "This fake test storage adapter doesn't handle extra loadModelData args.",
        );
      }
      return bootstrap[modelName] ?? [];
    },
  };

  const client = new LocoSyncClient({
    network: networkAdapter,
    storage: storageAdapter,
    config,
  });

  const sendMessage = (message: NetworkMessage<M>) => {
    listener?.(message);
  };

  return {
    client,
    config,
    sendMessage,
  };
};
