import { createModelDataStore, type ModelDataStore } from '@loco-sync/client';
import type { MS } from '../utils';

describe('ModelDataStore.processMessage()', () => {
  let store: ModelDataStore<MS['models']>;
  beforeEach(() => {
    store = createModelDataStore<MS['models']>();
    store.loadBootstrap({
      Post: [
        {
          id: '1',
          title: 'init title',
          body: 'init body',
          authorId: '1',
        },
      ],
    });
  });

  it('Can edit a field after it is changed in the second sync of payload', () => {
    // Edit title
    store.processMessage({
      type: 'startTransaction',
      transactionId: 1,
      changes: [
        {
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            title: 'new title',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'new title',
      body: 'init body',
      authorId: '1',
    });

    // Commit title edit
    store.processMessage({
      type: 'commitTransaction',
      transactionId: 1,
      lastSyncId: 1,
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'new title',
      body: 'init body',
      authorId: '1',
    });

    // Edit body
    store.processMessage({
      type: 'startTransaction',
      transactionId: 2,
      changes: [
        {
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            body: 'new body',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'new title',
      body: 'new body',
      authorId: '1',
    });

    // Commit body edit
    store.processMessage({
      type: 'commitTransaction',
      transactionId: 2,
      lastSyncId: 2,
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'new title',
      body: 'new body',
      authorId: '1',
    });

    // Sync with both edits
    store.processMessage({
      type: 'sync',
      lastSyncId: 2,
      sync: [
        {
          syncId: 1,
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            id: '1',
            title: 'new title',
            body: 'init body',
            authorId: '1',
          },
        },
        {
          syncId: 2,
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            id: '1',
            title: 'new title',
            body: 'new body',
            authorId: '1',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'new title',
      body: 'new body',
      authorId: '1',
    });

    // Another edit to title
    store.processMessage({
      type: 'startTransaction',
      transactionId: 3,
      changes: [
        {
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            title: 'newer title',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'newer title',
      body: 'new body',
      authorId: '1',
    });

    // Commit newer body edit
    store.processMessage({
      type: 'commitTransaction',
      transactionId: 3,
      lastSyncId: 3,
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'newer title',
      body: 'new body',
      authorId: '1',
    });

    // Sync with newer title edit
    store.processMessage({
      type: 'sync',
      lastSyncId: 3,
      sync: [
        {
          syncId: 3,
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            id: '1',
            title: 'newer title',
            body: 'new body',
            authorId: '1',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'newer title',
      body: 'new body',
      authorId: '1',
    });

    // Another edit to body
    store.processMessage({
      type: 'startTransaction',
      transactionId: 4,
      changes: [
        {
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            body: 'newer body',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'newer title',
      body: 'newer body',
      authorId: '1',
    });

    // Commit newer body edit
    store.processMessage({
      type: 'commitTransaction',
      transactionId: 4,
      lastSyncId: 4,
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'newer title',
      body: 'newer body',
      authorId: '1',
    });

    // Sync with newer body edit
    store.processMessage({
      type: 'sync',
      lastSyncId: 4,
      sync: [
        {
          syncId: 4,
          modelName: 'Post',
          modelId: '1',
          action: 'update',
          data: {
            id: '1',
            title: 'newer title',
            body: 'newer body',
            authorId: '1',
          },
        },
      ],
    });
    expect(store.getOne('Post', { id: '1' })).toEqual({
      id: '1',
      title: 'newer title',
      body: 'newer body',
      authorId: '1',
    });
  });
});
