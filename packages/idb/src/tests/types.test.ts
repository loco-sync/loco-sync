import 'fake-indexeddb/auto';
import { expectTypeOf } from 'vitest';
import {
  type ModelDefs,
  type ModelsConfig,
  type ModelsRelationshipDefs,
  one,
  many,
  type StorageAdapter,
} from '@loco-sync/client';
import { createLocoSyncIdbAdapter } from '../index';

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
  Post: {},
  Author: {},
  Tag: {},
  PostTag: {},
};

const relationshipDefs = {
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
  },
} satisfies ModelsRelationshipDefs<M>;

describe('Create types', () => {
  test('Basic create', () => {
    const config = {
      modelDefs,
      relationshipDefs,
    } satisfies ModelsConfig<MS>;
    const idbClient = createLocoSyncIdbAdapter<MS>('name', config);
    expectTypeOf(idbClient).toMatchTypeOf<StorageAdapter<MS>>();
  });
});
