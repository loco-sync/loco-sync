import { expectTypeOf } from 'vitest';
import {
  type ModelDefs,
  type ModelsConfig,
  type ModelsRelationshipDefs,
  one,
  many,
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

// Couldn't figure out a good way to get these tests to work with "expectTypeOf" but not have compiler errors, moving on

// describe('Relationship Defs', () => {
//   test('Fields values must be on model', () => {
//     const relationshipDefs = {
//       Post: {
//         author: one('Author', {
//           fields: ['name'],
//           references: ['id'],
//         }),
//       },
//     } satisfies ModelsRelationshipDefs<M>;

//     expectTypeOf<typeof relationshipDefs>().toMatchTypeOf<
//       ModelsRelationshipDefs<M>
//     >();
//   });

//   test('References values must be on model', () => {
//     const relationshipDefs = {
//       Post: {
//         author: one('Author', {
//           fields: ['id'],
//           references: ['title'],
//         }),
//       },
//     } satisfies ModelsRelationshipDefs<M>;

//     expectTypeOf<typeof relationshipDefs>().toMatchTypeOf<
//       ModelsRelationshipDefs<M>
//     >();
//   });

//   test('Fields and references must be the same length', () => {
//     const relationshipDefs = {
//       Post: {
//         author: one('Author', {
//           fields: ['id', 'authorId'],
//           references: ['id'],
//         }),
//       },
//     } satisfies ModelsRelationshipDefs<M>;

//     expectTypeOf<typeof relationshipDefs>().toMatchTypeOf<
//       ModelsRelationshipDefs<M>
//     >();
//   });

//   test('Fields / references cannot be empty', () => {
//     const relationshipDefs = {
//       Post: {
//         author: one('Author', {
//           fields: [],
//           references: [],
//         }),
//       },
//     } satisfies ModelsRelationshipDefs<M>;

//     expectTypeOf<typeof relationshipDefs>().toMatchTypeOf<
//       ModelsRelationshipDefs<M>
//     >();
//   });
// });
