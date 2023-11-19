import {
  type ModelDefs,
  type ModelsRelationshipDefs,
  type LocalDbClient,
  type NetworkClient,
  one,
  many,
  LocoSyncClient,
  type SocketEventCallback,
  type ModelsConfig,
  type BootstrapPayload,
  type SocketEvent,
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
};

type R = typeof relationshipDefs;

export type MS = {
  models: M;
  relationshipDefs: R;
};

export const modelDefs: ModelDefs<M> = {
  Group: { schemaVersion: 0 },
  Post: { schemaVersion: 0 },
  Author: { schemaVersion: 0 },
  Tag: { schemaVersion: 0 },
  PostTag: { schemaVersion: 0 },
};

export const relationshipDefs = {
  Post: {
    author: one('Author', {
      field: 'authorId',
    }),
  },
  Author: {
    posts: many('Post', {
      references: 'authorId',
    }),
  },
  Group: {
    authors: many('Author', {
      references: 'groupId',
    }),
  },
  Tag: {},
  PostTag: {
    post: one('Post', {
      field: 'postId',
    }),
    tag: one('Tag', {
      field: 'tagId',
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

export const fakeNetworkClient: NetworkClient<MS> = {
  sendTransaction: async () => ({ ok: true, value: { lastSyncId: 0 } }),
  deltaSync: async () => ({ ok: true, value: { sync: [] } }),
  loadBootstrap: async () => ({
    ok: true,
    value: { lastSyncId: 0, bootstrap: {} },
  }),
  initHandshake: () => () => {},
  addListener: () => () => {},
};

export const fakeLocalDbClient: LocalDbClient<MS> = {
  getMetadataAndPendingTransactions: async () => undefined,
  applySyncActions: async () => {},
  removePendingTransaction: async () => {},
  createPendingTransaction: async () => 0,
  saveBootstrap: async () => {},
  loadBootstrap: async () => ({}),
};

export const setup = (bootstrap: BootstrapPayload<M>) => {
  const config = {
    modelDefs,
    relationshipDefs,
  } satisfies ModelsConfig<MS>;

  const listeners = new Map<string, SocketEventCallback<MS['models']>>();
  let listenerId = 0;

  const networkClient: NetworkClient<MS> = {
    ...fakeNetworkClient,
    loadBootstrap: async () => {
      return {
        ok: true,
        value: {
          bootstrap,
          lastSyncId: 1,
        },
      };
    },
    initHandshake: () => {
      for (const callback of listeners.values()) {
        callback({
          type: 'handshake',
          modelSchemaVersion: 1,
          lastSyncId: 0,
        });
      }
      return () => {};
    },
    addListener: (cb) => {
      listenerId += 1;
      const thisId = listenerId.toString();
      listeners.set(thisId, cb);
      return () => {
        listeners.delete(thisId);
      };
    },
  };

  const localDbClient: LocalDbClient<MS> = {
    ...fakeLocalDbClient,
    async loadBootstrap() {
      return bootstrap;
    },
  };

  const syncClient = new LocoSyncClient({
    name: 'test',
    networkClient,
    localDbClient,
  });

  const sendSocketEvent = (event: SocketEvent<M>) => {
    for (const callback of listeners.values()) {
      callback(event);
    }
  };

  return {
    syncClient,
    config,
    sendSocketEvent,
  };
};
