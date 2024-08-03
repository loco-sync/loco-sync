import { controlledPromise, relationshipDefs, setup, type MS } from '../utils';
import type {
  BootstrapResult,
  DeltaSyncResult,
  SyncListener,
} from '../../lib/network';
import { LocoSyncClient } from '../../lib/client';
import { QueryObserver } from '../../lib/query-observers';
import { modelObjectKey } from '../../lib/core';

describe('LocoSyncClient, network.initSync() handler', () => {
  test('Handshake - issues deltaSync', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });
  });

  test('Handshake - new syncGroups result in lazy bootstrap', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap(syncGroup) {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [{ type: '1' as const }],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', models: ['Group'], syncGroups: [{ type: '2' }] }],
      Promise.resolve({
        ok: true as const,
        value: {
          firstSyncId: 1,
          bootstrap: {},
          syncGroups: [{ type: '2' as const }],
        },
      }),
    );

    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '2' }], new Set()],
      Promise.resolve(),
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }, { type: '2' }],
    });
  });

  test('Sync - instantly applied to store if deltaSync has completed', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: { initialBootstrap: true },
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    await cache.addObserver(observer);

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '1',
              name: 'Group 1',
            },
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'insert',
          data: {
            id: '1',
            name: 'Group 1',
          },
        },
      ],
    });

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });
  });

  test('Sync - only visible from store after deltaSync request completes, multiple syncs can be accrued', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: { initialBootstrap: true, preloadFromStorage: true },
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

    await client.start();

    const deltaSync = controlledPromise<DeltaSyncResult<MS>>();
    addNetworkFnCall('deltaSync', [10, 100], deltaSync.promise);

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    addStorageFnCall(
      'applySyncActions',
      [
        103,
        [
          {
            syncId: 100,
            modelId: '1',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '1',
              name: 'Group 1',
            },
          },
          {
            syncId: 101,
            modelId: '2',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '2',
              name: 'Group 2',
            },
          },
          {
            syncId: 102,
            modelId: '3',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '3',
              name: 'Group 3',
            },
          },
          {
            syncId: 103,
            modelId: '4',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '4',
              name: 'Group 4',
            },
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '2',
          modelName: 'Group',
          action: 'insert',
          data: {
            id: '2',
            name: 'Group 2',
          },
        },
      ],
    });
    syncListener!({
      type: 'sync',
      lastSyncId: 103,
      sync: [
        {
          syncId: 102,
          modelId: '3',
          modelName: 'Group',
          action: 'insert',
          data: {
            id: '3',
            name: 'Group 3',
          },
        },
        {
          syncId: 103,
          modelId: '4',
          modelName: 'Group',
          action: 'insert',
          data: {
            id: '4',
            name: 'Group 4',
          },
        },
      ],
    });

    const cache = client.getCache();
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);
    expect(cache.getStore().getOne('Group', { id: '2' })).toEqual(undefined);
    expect(cache.getStore().getOne('Group', { id: '3' })).toEqual(undefined);
    expect(cache.getStore().getOne('Group', { id: '4' })).toEqual(undefined);

    deltaSync.resolve({
      ok: true as const,
      value: {
        sync: [
          {
            syncId: 100,
            modelId: '1',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '1',
              name: 'Group 1',
            },
          },
        ],
      },
    });

    // No way to await processing of deltaSync because it's in the sync handler
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });
    expect(cache.getStore().getOne('Group', { id: '2' })).toEqual({
      id: '2',
      name: 'Group 2',
    });
    expect(cache.getStore().getOne('Group', { id: '3' })).toEqual({
      id: '3',
      name: 'Group 3',
    });
    expect(cache.getStore().getOne('Group', { id: '4' })).toEqual({
      id: '4',
      name: 'Group 4',
    });
  });

  test('Sync - sync group bootstrap race condition (create, sync first)', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap: () => {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    const lazyBootstrap = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      lazyBootstrap.promise,
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '1',
              name: 'Group 1',
            },
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'insert',
          data: {
            id: '1',
            name: 'Group 1',
          },
        },
      ],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    const addObserverPromise = cache.addObserver(observer);
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);
    expect(cache.getStore().getOne('Group', { id: '2' })).toEqual(undefined);

    // Bootstrap does not include newly created Group 1
    lazyBootstrap.resolve({
      ok: true,
      value: {
        firstSyncId: 1,
        bootstrap: {
          Group: [{ id: '2', name: 'Group 2' }],
        },
        syncGroups: [{ type: '1' }],
      },
    });

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '2', name: 'Group 2' }],
        },
        [{ type: '1' }],
        new Set(),
      ],
      Promise.resolve(),
    );

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([
        // From applySyncActions call
        {
          id: '1',
          name: 'Group 1',
        },
        // From saveLazyBootstrap call

        {
          id: '2',
          name: 'Group 2',
        },
      ]),
    );

    await addObserverPromise;

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });
    expect(cache.getStore().getOne('Group', { id: '2' })).toEqual({
      id: '2',
      name: 'Group 2',
    });
  });

  test('Sync - sync group bootstrap race condition (create, sync second)', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap: () => {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      Promise.resolve({
        ok: true as const,
        value: {
          firstSyncId: 1,
          bootstrap: {
            Group: [{ id: '2', name: 'Group 2' }],
          },
          syncGroups: [{ type: '1' as const }],
        },
      }),
    );

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '2', name: 'Group 2' }],
        },
        [{ type: '1' }],
        new Set(),
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([
        // From saveLazyBootstrap call
        {
          id: '2',
          name: 'Group 2',
        },
      ]),
    );

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'insert',
            data: {
              id: '1',
              name: 'Group 1',
            },
          },
        ],
      ],
      Promise.resolve(),
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    await cache.addObserver(observer);
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);
    expect(cache.getStore().getOne('Group', { id: '2' })).toEqual({
      id: '2',
      name: 'Group 2',
    });

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'insert',
          data: {
            id: '1',
            name: 'Group 1',
          },
        },
      ],
    });

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });
    expect(cache.getStore().getOne('Group', { id: '2' })).toEqual({
      id: '2',
      name: 'Group 2',
    });
  });

  test('Sync - sync group bootstrap race condition (update, sync first)', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap: () => {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    const lazyBootstrap = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      lazyBootstrap.promise,
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'update',
            data: {
              id: '1',
              name: 'Group 1 - updated',
            },
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'update',
          data: {
            id: '1',
            name: 'Group 1 - updated',
          },
        },
      ],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    const addObserverPromise = cache.addObserver(observer);
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);

    // Bootstrap includes newly updated Group 1
    lazyBootstrap.resolve({
      ok: true,
      value: {
        firstSyncId: 1,
        bootstrap: {
          Group: [{ id: '1', name: 'Group 1' }],
        },
        syncGroups: [{ type: '1' }],
      },
    });

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '1', name: 'Group 1' }],
        },
        [{ type: '1' }],
        new Set(),
      ],
      Promise.resolve(),
    );

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([
        // From applySyncActions call, which saveLazyBootstrap should not override
        {
          id: '1',
          name: 'Group 1 - updated',
        },
      ]),
    );

    await addObserverPromise;

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1 - updated',
    });
  });

  test('Sync - sync group bootstrap race condition (update, sync second)', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap: () => {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      Promise.resolve({
        ok: true as const,
        value: {
          firstSyncId: 1,
          bootstrap: {
            Group: [{ id: '1', name: 'Group 1' }],
          },
          syncGroups: [{ type: '1' as const }],
        },
      }),
    );

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '1', name: 'Group 1' }],
        },
        [{ type: '1' }],
        new Set(),
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([
        // From saveLazyBootstrap call
        {
          id: '1',
          name: 'Group 1',
        },
      ]),
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    await cache.addObserver(observer);
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'update',
            data: {
              id: '1',
              name: 'Group 1 - updated',
            },
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'update',
          data: {
            id: '1',
            name: 'Group 1 - updated',
          },
        },
      ],
    });

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1 - updated',
    });
  });

  test('Sync - sync group bootstrap race condition (delete, sync first)', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap: () => {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    const lazyBootstrap = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      lazyBootstrap.promise,
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'delete',
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'delete',
        },
      ],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    const addObserverPromise = cache.addObserver(observer);
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);

    // Bootstrap includes newly deleted Group 1
    lazyBootstrap.resolve({
      ok: true,
      value: {
        firstSyncId: 1,
        bootstrap: {
          Group: [{ id: '1', name: 'Group 1' }],
        },
        syncGroups: [{ type: '1' }],
      },
    });

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '1', name: 'Group 1' }],
        },
        [{ type: '1' }],
        new Set([modelObjectKey<MS>({ modelId: '1', modelName: 'Group' })]),
      ],
      Promise.resolve(),
    );

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

    await addObserverPromise;

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);
  });

  test('Sync - sync group bootstrap race condition (delete, sync second)', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
        syncGroupDefs: {
          modelsForPartialBootstrap: () => {
            return ['Group'];
          },
          equals: (a, b) => a.type === b.type,
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      Promise.resolve({
        ok: true as const,
        value: {
          firstSyncId: 1,
          bootstrap: {
            Group: [{ id: '1', name: 'Group 1' }],
          },
          syncGroups: [{ type: '1' as const }],
        },
      }),
    );

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '1', name: 'Group 1' }],
        },
        [{ type: '1' }],
        new Set(),
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([
        // From saveLazyBootstrap call
        {
          id: '1',
          name: 'Group 1',
        },
      ]),
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    await cache.addObserver(observer);
    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });

    addStorageFnCall(
      'applySyncActions',
      [
        101,
        [
          {
            syncId: 101,
            modelId: '1',
            modelName: 'Group',
            action: 'delete',
          },
        ],
      ],
      Promise.resolve(),
    );

    syncListener!({
      type: 'sync',
      lastSyncId: 101,
      sync: [
        {
          syncId: 101,
          modelId: '1',
          modelName: 'Group',
          action: 'delete',
        },
      ],
    });

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);
  });

  test('Disconnect - requires fresh deltaSync before reconnection', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: {},
          Post: {},
          PostTag: {},
          Author: {},
          PostTagAnnotation: {},
          Tag: {},
        },
        relationshipDefs,
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve({
        metadata: {
          firstSyncId: 0,
          lastSyncId: 10,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [],
      }),
    );

    let syncListener: SyncListener<MS> | undefined;
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
      (listener) => {
        syncListener = listener;
      },
    );

    await client.start();

    addNetworkFnCall(
      'deltaSync',
      [10, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    syncListener!({
      type: 'disconnected',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    addNetworkFnCall(
      'deltaSync',
      [100, 100],
      Promise.resolve({
        ok: true as const,
        value: {
          sync: [],
        },
      }),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });
  });
});

// Error cases
// What if messages come in an unexpected order? aka sync before handshake, multiple handshakes in a row, etc.
