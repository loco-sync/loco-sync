import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  type ModelDefs,
  type ModelsRelationshipDefs,
  one,
  many,
  modelObjectKey,
} from '@loco-sync/client';
import { createLocoSyncIdbAdapter } from '../index';

function createStorage() {
  return createLocoSyncIdbAdapter<MS>('name', {
    modelDefs,
    relationshipDefs,
    syncGroupDefs: {
      modelsForPartialBootstrap: () => ['Post', 'PostTag'],
      equals: (a, b) => a.type === b.type,
    },
  });
}

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
    description: string | null;
  };
  PostTag: {
    id: string;
    postId: string;
    tagId: string;
  };
};

type SG = {
  type: '1' | '2' | '3';
};

type R = typeof relationshipDefs;

type MS = {
  models: M;
  relationshipDefs: R;
  syncGroup: SG;
};

const modelDefs: ModelDefs<M> = {
  Post: {},
  Author: { initialBootstrap: true },
  Tag: { initialBootstrap: true },
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

afterEach(function resetIdb() {
  indexedDB = new IDBFactory();
});

describe('IdbStorageAdapter.getMetadataAndPendingTransactions()', () => {
  test('Returns null on first interaction with idb', async () => {
    const storage = createStorage();
    const result = await storage.getMetadataAndPendingTransactions();
    expect(result).toEqual(undefined);
  });

  test('Returns result if eager bootstrap has been saved', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    const result = await storage.getMetadataAndPendingTransactions();
    expect(result).toEqual({
      metadata: {
        firstSyncId: 1,
        lastSyncId: 1,
        syncGroups: [],
        lastUpdatedAt: expect.any(String),
      },
      pendingTransactions: [],
    });
  });

  test('Returns result with updated lastSyncId after applying sync actions', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(10, []);
    const result2 = await storage.getMetadataAndPendingTransactions();
    expect(result2).toEqual({
      metadata: {
        firstSyncId: 1,
        lastSyncId: 10,
        syncGroups: [],
        lastUpdatedAt: expect.any(String),
      },
      pendingTransactions: [],
    });
  });

  test('Returns sync groups from previous calls to saveLazyBootstrap', async () => {});
  test('Returns pending transactions');
  test(
    'Invariant violation: should not be possible to have pending transaction without metadata saved',
  );
});

describe('IdbStorageAdapter.applySyncActions()', () => {
  test('Fails if called before eager bootstrap', async () => {
    const storage = createStorage();
    try {
      await storage.applySyncActions(2, []);
    } catch (e) {
      expect(e).toEqual(
        new Error('Cannot apply sync actions if metadata does not exist'),
      );
    }
    expect.assertions(1);
  });

  test('Insert, data does not exist', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(2, [
      {
        syncId: 2,
        action: 'insert',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1',
        },
      },
    ]);
    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([
      {
        id: '1',
        name: 'Author 1',
      },
    ]);
  });

  test('Insert, data already exists', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(2, [
      {
        syncId: 2,
        action: 'insert',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1',
        },
      },
    ]);
    await storage.applySyncActions(3, [
      {
        syncId: 3,
        action: 'insert',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1 - re-inserted?',
        },
      },
    ]);

    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([
      {
        id: '1',
        name: 'Author 1 - re-inserted?',
      },
    ]);
  });

  test('Update, data already exists', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(2, [
      {
        syncId: 2,
        action: 'insert',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1',
        },
      },
    ]);
    await storage.applySyncActions(3, [
      {
        syncId: 3,
        action: 'update',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1 - updated',
        },
      },
    ]);

    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([
      {
        id: '1',
        name: 'Author 1 - updated',
      },
    ]);
  });

  test('Update, data does not exist', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);

    await storage.applySyncActions(3, [
      {
        syncId: 3,
        action: 'update',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1 - updated',
        },
      },
    ]);

    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([
      {
        id: '1',
        name: 'Author 1 - updated',
      },
    ]);
  });

  test('Delete, data already exists', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(2, [
      {
        syncId: 2,
        action: 'insert',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1',
        },
      },
    ]);
    await storage.applySyncActions(3, [
      {
        syncId: 3,
        action: 'delete',
        modelName: 'Author',
        modelId: '1',
      },
    ]);

    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([]);
  });

  test('Delete data does not exist', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);

    await storage.applySyncActions(3, [
      {
        syncId: 3,
        action: 'delete',
        modelName: 'Author',
        modelId: '1',
      },
    ]);

    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([]);
  });

  test('Skips if lastSyncId is less than saved lastSyncId', async () => {});
});

describe('IdbStorageAdapter.loadModelData()', () => {
  test('After eager bootstrap', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap(
      {
        Author: [
          { id: '1', name: 'Author 1' },
          { id: '2', name: 'Author 2' },
        ],
      },
      1,
    );
    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual(
      expect.arrayContaining([
        { id: '1', name: 'Author 1' },
        { id: '2', name: 'Author 2' },
      ]),
    );
  });

  test('After sync actions', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(2, [
      {
        syncId: 2,
        action: 'insert',
        modelName: 'Author',
        modelId: '1',
        data: {
          id: '1',
          name: 'Author 1',
        },
      },
    ]);
    const result = await storage.loadModelData('Author', undefined);
    expect(result).toEqual([
      {
        id: '1',
        name: 'Author 1',
      },
    ]);
  });

  test('After lazy bootstrap', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.saveLazyBootstrap(
      {
        Post: [
          { id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' },
          { id: '2', title: 'Post 2', body: 'Body 2', authorId: '1' },
        ],
      },
      [{ type: '1' }],
      new Set(),
    );
    const result = await storage.loadModelData('Post', undefined);
    expect(result).toEqual(
      expect.arrayContaining([
        { id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' },
        { id: '2', title: 'Post 2', body: 'Body 2', authorId: '1' },
      ]),
    );
  });

  test('Filters results / uses index if provided', async () => {
    const storage = createLocoSyncIdbAdapter<MS>('name', {
      modelDefs,
      relationshipDefs,
      syncGroupDefs: {
        modelsForPartialBootstrap: () => ['Post', 'PostTag'],
        equals: (a, b) => a.type === b.type,
      },
      indexes: {
        Author: [{ name: 'name', fields: ['name'] }],
      },
    });
    await storage.saveEagerBootstrap(
      {
        Author: [
          { id: '1', name: 'Author 1' },
          { id: '2', name: 'Author 2' },
        ],
      },
      1,
    );
    const result = await storage.loadModelData('Author', {
      index: {
        name: 'name',
        fields: ['name'],
      },
      filter: {
        name: 'Author 1',
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([{ id: '1', name: 'Author 1' }]),
    );
  });

  test('Multi-field index', async () => {
    const storage = createLocoSyncIdbAdapter<MS>('name', {
      modelDefs,
      relationshipDefs,
      syncGroupDefs: {
        modelsForPartialBootstrap: () => ['Post', 'PostTag'],
        equals: (a, b) => a.type === b.type,
      },
      indexes: {
        Post: [{ name: 'author-title', fields: ['title', 'authorId'] }],
      },
    });
    await storage.saveEagerBootstrap({}, 1);
    await storage.saveLazyBootstrap(
      {
        Post: [
          { id: '1', title: 'New Post', body: 'Body 1', authorId: '1' },
          { id: '2', title: 'Post 2', body: 'Body 2', authorId: '1' },
          { id: '3', title: 'New Post', body: 'Body 3', authorId: '2' },
        ],
      },
      [{ type: '1' }],
      new Set(),
    );

    const result = await storage.loadModelData('Post', {
      index: {
        name: 'author-title',
        fields: ['title', 'authorId'],
      },
      filter: {
        title: 'New Post',
        authorId: '1',
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        { id: '1', title: 'New Post', body: 'Body 1', authorId: '1' },
      ]),
    );
  });

  test('Ignores values on filter that are not in index', async () => {
    const storage = createLocoSyncIdbAdapter<MS>('name', {
      modelDefs,
      relationshipDefs,
      syncGroupDefs: {
        modelsForPartialBootstrap: () => ['Post', 'PostTag'],
        equals: (a, b) => a.type === b.type,
      },
      indexes: {
        Post: [{ name: 'title', fields: ['title'] }],
      },
    });
    await storage.saveEagerBootstrap({}, 1);
    await storage.saveLazyBootstrap(
      {
        Post: [
          { id: '1', title: 'New Post', body: 'Body 1', authorId: '1' },
          { id: '2', title: 'Post 2', body: 'Body 2', authorId: '1' },
          { id: '3', title: 'New Post', body: 'Body 3', authorId: '2' },
        ],
      },
      [{ type: '1' }],
      new Set(),
    );

    const result = await storage.loadModelData('Post', {
      index: {
        name: 'title',
        fields: ['title'],
      },
      filter: {
        title: 'New Post',
        authorId: '1',
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        { id: '1', title: 'New Post', body: 'Body 1', authorId: '1' },
        { id: '3', title: 'New Post', body: 'Body 3', authorId: '2' },
      ]),
    );
  });

  test('Throws if index does not exist', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    try {
      await storage.loadModelData('Post', {
        index: {
          name: 'author-title',
          fields: ['title', 'authorId'],
        },
        filter: {
          title: 'New Post',
          authorId: '1',
        },
      });
    } catch (e) {
      expect(e).toEqual(
        new Error(
          'The operation failed because the requested database object could not be found. For example, an object store did not exist but was being opened.',
        ),
      );
    }
    expect.assertions(1);
  });

  test('Treats missing values in filters as null', async () => {
    const storage = createLocoSyncIdbAdapter<MS>('name', {
      modelDefs,
      relationshipDefs,
      syncGroupDefs: {
        modelsForPartialBootstrap: () => ['Post', 'PostTag'],
        equals: (a, b) => a.type === b.type,
      },
      indexes: {
        Tag: [{ name: 'description', fields: ['description'] }],
      },
    });
    await storage.saveEagerBootstrap(
      {
        Tag: [
          { id: '1', name: 'Tag 1', description: null },
          { id: '2', name: 'Tag 2', description: '???' },
        ],
      },
      1,
    );

    try {
      await storage.loadModelData('Tag', {
        index: {
          name: 'description',
          fields: ['description'],
        },
        filter: {},
      });
    } catch (e) {
      expect(e).toEqual(
        new Error('Data provided to an operation does not meet requirements.'),
      );
    }
    expect.assertions(1);
  });
});

describe('IdbStorageAdapter.saveEagerBootstrap()', () => {
  test('Saves data and metadata', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap(
      {
        Tag: [{ id: '1', name: 'Tag 1', description: null }],
        Author: [{ id: '1', name: 'Author 1' }],
      },
      1,
    );
    const result = await storage.getMetadataAndPendingTransactions();
    expect(result?.metadata).toEqual({
      firstSyncId: 1,
      lastSyncId: 1,
      syncGroups: [],
      lastUpdatedAt: expect.any(String),
    });
    const tags = await storage.loadModelData('Tag', undefined);
    expect(tags).toEqual([{ id: '1', name: 'Tag 1', description: null }]);
    const authors = await storage.loadModelData('Author', undefined);
    expect(authors).toEqual([{ id: '1', name: 'Author 1' }]);
  });

  test('Fails if saveEagerBootstrap has already been called', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    try {
      await storage.saveEagerBootstrap({}, 1);
    } catch (e) {
      expect(e).toEqual(
        new Error(
          'A mutation operation in the transaction failed because a constraint was not satisfied. For example, an object such as an object store or index already exists and a request attempted to create a new one.',
        ),
      );
    }
    expect.assertions(1);
  });
});

describe('IdbStorageAdapter.saveLazyBootstrap()', () => {
  test('Saves data and metadata', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.saveLazyBootstrap(
      {
        Post: [{ id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' }],
      },
      [{ type: '1' }],
      new Set(),
    );

    const result = await storage.getMetadataAndPendingTransactions();
    expect(result?.metadata).toEqual({
      firstSyncId: 1,
      lastSyncId: 1,
      syncGroups: [{ type: '1' }],
      lastUpdatedAt: expect.any(String),
    });
    const posts = await storage.loadModelData('Post', undefined);
    expect(posts).toEqual([
      { id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' },
    ]);
  });

  test('Fails if saveEagerBootstrap has not already been called', async () => {
    const storage = createStorage();
    try {
      await storage.saveLazyBootstrap(
        {
          Post: [{ id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' }],
        },
        [{ type: '1' }],
        new Set(),
      );
    } catch (e) {
      expect(e).toEqual(
        new Error('Cannot save lazy bootstrap if metadata does not exist'),
      );
    }
    expect.assertions(1);
  });

  test('Does not override data already saved by a sync action', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.applySyncActions(2, [
      {
        syncId: 2,
        action: 'insert',
        modelName: 'Post',
        modelId: '1',
        data: {
          id: '1',
          title: 'Post 1 ???',
          body: 'Body 1',
          authorId: '1',
        },
      },
    ]);

    await storage.saveLazyBootstrap(
      {
        Post: [{ id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' }],
      },
      [{ type: '1' }],
      new Set(),
    );

    const posts = await storage.loadModelData('Post', undefined);
    expect(posts).toEqual([
      { id: '1', title: 'Post 1 ???', body: 'Body 1', authorId: '1' },
    ]);
  });

  test('Does not insert data in tombstone set', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);

    const tombstoneModelObjectKeys = new Set([
      modelObjectKey<MS>({ modelName: 'Post', modelId: '1' }),
    ]);

    await storage.saveLazyBootstrap(
      {
        Post: [{ id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' }],
      },
      [{ type: '1' }],
      tombstoneModelObjectKeys,
    );

    const posts = await storage.loadModelData('Post', undefined);
    expect(posts).toEqual([]);
  });

  test('Cannot save lazy bootstrap if config does not have syncGroupDefs', async () => {
    const storage = createLocoSyncIdbAdapter<MS>('name', {
      modelDefs,
      relationshipDefs,
    });
    await storage.saveEagerBootstrap({}, 1);

    try {
      await storage.saveLazyBootstrap(
        {
          Post: [{ id: '2', title: 'Post 2', body: 'Body 2', authorId: '2' }],
        },
        [{ type: '1' }],
        new Set(),
      );
    } catch (e) {
      expect(e).toEqual(
        new Error(
          'Cannot save lazy bootstrap if config does not have syncGroupDefs',
        ),
      );
    }
    expect.assertions(1);
  });

  test('Cannot call saveLazyBootstrap with the same syncGroup twice', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    await storage.saveLazyBootstrap(
      {
        Post: [{ id: '1', title: 'Post 1', body: 'Body 1', authorId: '1' }],
      },
      [{ type: '1' }],
      new Set(),
    );

    try {
      await storage.saveLazyBootstrap(
        {
          Post: [{ id: '2', title: 'Post 2', body: 'Body 2', authorId: '2' }],
        },
        [{ type: '1' }],
        new Set(),
      );
    } catch (e) {
      expect(e).toEqual(
        new Error(
          'Cannot save lazy bootstrap for syncGroup already saved to metadata',
        ),
      );
    }
    expect.assertions(1);
  });
});

describe('IdbStorageAdapter.createPendingTransaction()', () => {
  test('Creates a pending transaction and returns the id', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    const id = await storage.createPendingTransaction([
      {
        modelId: '1',
        modelName: 'Author',
        action: 'create',
        data: { id: '1', name: 'Author 1' },
      },
    ]);

    const result = await storage.getMetadataAndPendingTransactions();
    expect(result?.pendingTransactions).toEqual([
      {
        id,
        changes: [
          {
            modelId: '1',
            modelName: 'Author',
            action: 'create',
            data: { id: '1', name: 'Author 1' },
          },
        ],
      },
    ]);
  });
});

describe('IdbStorageAdapter.removePendingTransaction()', () => {
  test('Removes a pending transaction by id', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);
    const id1 = await storage.createPendingTransaction([
      {
        modelId: '1',
        modelName: 'Author',
        action: 'create',
        data: { id: '1', name: 'Author 1' },
      },
    ]);
    const id2 = await storage.createPendingTransaction([
      {
        modelId: '1',
        modelName: 'Author',
        action: 'update',
        data: { name: 'Author 1 - updated' },
      },
    ]);

    await storage.removePendingTransaction(id1);

    const result = await storage.getMetadataAndPendingTransactions();
    expect(result?.pendingTransactions).toEqual([
      {
        id: id2,
        changes: [
          {
            modelId: '1',
            modelName: 'Author',
            action: 'update',
            data: { name: 'Author 1 - updated' },
          },
        ],
      },
    ]);
  });

  test('No-op if transaction does not exist', async () => {
    const storage = createStorage();
    await storage.saveEagerBootstrap({}, 1);

    const result1 = await storage.getMetadataAndPendingTransactions();
    expect(result1?.pendingTransactions).toEqual([]);

    await storage.removePendingTransaction(1);

    const result2 = await storage.getMetadataAndPendingTransactions();
    expect(result2?.pendingTransactions).toEqual([]);
  });
});

// TODO: Multiple concurrent adapters could be used to simulate multiple tabs
