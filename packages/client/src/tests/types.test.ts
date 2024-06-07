import { expectTypeOf } from 'vitest';
import {
  type ModelDefs,
  type ModelsConfig,
  type ModelsRelationshipDefs,
  one,
  many,
  type LocalChanges,
} from '../index';

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

describe('Config', () => {
  test('Basic config', () => {
    expectTypeOf({
      modelDefs,
      relationshipDefs,
    }).toMatchTypeOf<ModelsConfig<MS>>();
  });

  test('Config with mutationDefs', () => {
    expectTypeOf({
      modelDefs,
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
