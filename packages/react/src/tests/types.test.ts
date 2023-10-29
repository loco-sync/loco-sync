import { assertType, expectTypeOf } from 'vitest';
import {
  type ModelDefs,
  type ModelsConfig,
  type ModelsRelationshipDefs,
  one,
  many,
  LocalDbClient,
  LocoSyncClient,
  NetworkClient,
} from '@loco-sync/client';
import { LocoSyncReact, createLocoSyncReact } from '../index';

type M = {
  Post: {
    id: string;
    title: string;
    body: string;
    authorId: string;
  };
  Author: {
    id: string;
    name: string;
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

type MS = {
  models: M;
  relationshipDefs: R;
};

const modelDefs: ModelDefs<M> = {
  Post: { schemaVersion: 0 },
  Author: { schemaVersion: 0 },
  Tag: { schemaVersion: 0 },
  PostTag: { schemaVersion: 0 },
};

const relationshipDefs = {
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

const fakeNetworkClient: NetworkClient<MS> = {
  sendTransaction: async () => ({ ok: true, value: { lastSyncId: 0 } }),
  deltaSync: async () => ({ ok: true, value: { sync: [] } }),
  loadBootstrap: async () => ({
    ok: true,
    value: { lastSyncId: 0, bootstrap: {} },
  }),
  initHandshake: async () => {},
  addListener: () => () => {},
};

const fakeLocalDbClient: LocalDbClient<MS> = {
  getMetadataAndPendingTransactions: async () => undefined,
  applySyncActions: async () => {},
  removePendingTransaction: async () => {},
  createPendingTransaction: async () => 0,
  saveBootstrap: async () => {},
  loadBootstrap: async () => ({}),
};

describe('Create types', () => {
  test('Basic create', () => {
    const config = {
      modelDefs,
      relationshipDefs,
    } satisfies ModelsConfig<MS>;
    const syncClient = new LocoSyncClient({
      name: 'test',
      networkClient: fakeNetworkClient,
      localDbClient: fakeLocalDbClient,
    });
    const reactClient = createLocoSyncReact(syncClient, config);
    expectTypeOf(reactClient).toMatchTypeOf<LocoSyncReact<MS>>();
  });
});
