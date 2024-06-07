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
  Group: { preload: true },
  Post: { preload: true },
  Author: { preload: true },
  Tag: { preload: true },
  PostTag: { preload: true },
  PostTagAnnotation: { preload: true },
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
  let lastSyncId = 0;

  const networkAdapter: NetworkAdapter<MS> = {
    sendTransaction: async (args) => {
      lastSyncId += args.length;
      return { ok: true, value: { lastSyncId } };
    },
    deltaSync: async () => ({ ok: true, value: { sync: [] } }),
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
