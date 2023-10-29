import 'fake-indexeddb/auto';
import { assertType, expectTypeOf } from 'vitest';
import {
  type ModelDefs,
  type ModelsConfig,
  type ModelsRelationshipDefs,
  one,
  many,
  LocalDbClient,
} from '@loco-sync/client';
import { createLocoSyncIdbClient } from '../index';

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

describe('Create types', () => {
  test('Basic create', () => {
    const config = {
      modelDefs,
      relationshipDefs,
    } satisfies ModelsConfig<MS>;
    const idbClient = createLocoSyncIdbClient<MS>('name', config);
    expectTypeOf(idbClient).toMatchTypeOf<LocalDbClient<MS>>();
  });
});
