import { expectTypeOf } from 'vitest';
import {
  type ModelDefs,
  type ModelsConfig,
  type ModelsRelationshipDefs,
  one,
  many,
  type Models,
  type ModelsParsers,
  type LocalChanges,
} from '../index';
import { z } from 'zod';

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

const parsers = {
  Post: z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    authorId: z.string(),
  }),
  Author: z.object({
    id: z.string(),
    name: z.string(),
  }),
  Tag: z.object({
    id: z.string(),
    name: z.string(),
  }),
  PostTag: z.object({
    id: z.string(),
    postId: z.string(),
    tagId: z.string(),
  }),
};

describe('Config', () => {
  test('Basic config', () => {
    expectTypeOf({
      modelDefs,
      relationshipDefs,
    }).toMatchTypeOf<ModelsConfig<MS>>();
  });

  test('Config with parsers', () => {
    expectTypeOf({
      modelDefs,
      parsers,
      relationshipDefs,
    }).toMatchTypeOf<ModelsConfig<MS>>();
  });

  test('Config with mutationDefs', () => {
    expectTypeOf({
      modelDefs,
      parsers,
      relationshipDefs,
      mutationDefs: {
        getChanges: () => [],
      },
    }).toMatchTypeOf<ModelsConfig<MS>>();
  });
});

describe('Model parsers', () => {
  type ZodFromParser<
    M extends Models,
    MP extends ModelsParsers<M>,
    ModelName extends keyof M & string,
    Action extends 'create' | 'delete',
  > = Action extends 'create' ? MP[ModelName] : z.ZodUndefined;

  test('One parser', () => {
    expectTypeOf<(typeof parsers)['Post']>().toEqualTypeOf<
      ZodFromParser<M, typeof parsers, 'Post', 'create'>
    >();
  });

  test('Union of parsers', () => {
    expectTypeOf<(typeof parsers)[keyof typeof parsers]>().toEqualTypeOf<
      ZodFromParser<M, typeof parsers, keyof typeof parsers, 'create'>
    >();
  });
});

describe('Local Changes', () => {
  test('Empty', () => {
    const localChanges = [] as const;
    expectTypeOf<typeof localChanges>().toMatchTypeOf<LocalChanges<M>>();
  });

  test('Basic', () => {
    const localChanges = [
      {
        modelName: 'Post',
        modelId: '1',
        action: 'create',
        data: {
          id: '1',
          title: 'Hello',
          body: 'World',
          authorId: '1',
        },
      },
    ] as const;
    expectTypeOf<typeof localChanges>().toMatchTypeOf<LocalChanges<M>>();
  });

  test('Model data mismatch', () => {
    const localChanges = [
      {
        modelName: 'Post',
        modelId: '1',
        action: 'create',
        data: {
          id: '1',
          name: '',
        },
      },
    ] as const;
    expectTypeOf<typeof localChanges>().not.toMatchTypeOf<LocalChanges<M>>();
  });
});
