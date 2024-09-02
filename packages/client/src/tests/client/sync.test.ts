import { controlledPromise, relationshipDefs, setup, type MS } from '../utils';
import type {
  BootstrapResult,
  DeltaSyncResult,
  SendTransactionResult,
  SyncListener,
} from '../../lib/network';
import { LocoSyncClient } from '../../lib/client';
import { QueryObserver } from '../../lib/query-observers';
import { modelObjectKey, type ModelData } from '../../lib/core';
import { vitest } from 'vitest';
import { inArray, type ModelFilter } from '../../lib/filters';
import { type ModelIndex } from '../../lib/indexes';

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
          lazyBootstrapModels(syncGroup) {
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
          lazyBootstrapModels: () => {
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

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([
        // From applySyncActions call
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
          lazyBootstrapModels: () => {
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
          lazyBootstrapModels: () => {
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
          lazyBootstrapModels: () => {
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
          lazyBootstrapModels: () => {
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

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

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
        new Set([
          modelObjectKey<MS['models']>({ modelId: '1', modelName: 'Group' }),
        ]),
      ],
      Promise.resolve(),
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
          lazyBootstrapModels: () => {
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

  test('Sync - sync group bootstrap, data in store without extra call to storage if loaded already', async () => {
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
          lazyBootstrapModels: () => {
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

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>(
      'Group',
      { id: '1' },
      {},
    );
    await cache.addObserver(observer);

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);

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
          bootstrap: {
            Group: [
              {
                id: '1',
                name: 'Group 1',
              },
            ],
          },
          firstSyncId: 101,
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

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual({
      id: '1',
      name: 'Group 1',
    });
  });

  test('Sync - multiple concurrent lazy bootstraps', async () => {
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
          lazyBootstrapModels: () => {
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

    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscriber = vitest.fn();
    observer.subscribe(() => observerSubscriber(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);
    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

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

    const lazyBootstrap1 = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      lazyBootstrap1.promise,
    );

    const lazyBootstrap2 = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '2' }], models: ['Group'] }],
      lazyBootstrap2.promise,
    );

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [{ type: '1' }, { type: '2' }],
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

    lazyBootstrap1.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }, { type: '2' as const }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    addStorageFnCall(
      'saveLazyBootstrap',
      [
        {
          Group: [{ id: '2', name: 'Group 2' }],
        },
        [{ type: '2' }],
        new Set(),
      ],
      Promise.resolve(),
    );

    lazyBootstrap2.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '2',
              name: 'Group 2',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }, { type: '2' as const }],
      },
    });

    await addObserverPromise;

    expect(observerSubscriber.mock.calls).toEqual([
      [{ data: [], isHydrated: false }],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - sync group bootstrap, data not subscribed to by an observer does not get added to store', async () => {
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
          lazyBootstrapModels: () => {
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

    const cache = client.getCache();

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);

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
          bootstrap: {
            Group: [
              {
                id: '1',
                name: 'Group 1',
              },
            ],
          },
          firstSyncId: 101,
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

    expect(cache.getStore().getOne('Group', { id: '1' })).toEqual(undefined);
  });

  test('Sync - concurrent loads, lazy bootstrap and data load from storage (storage started first, bootstrap resolved first)', async () => {
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
          lazyBootstrapModels: () => {
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

    const storageLoad = controlledPromise<ModelData<MS['models'], 'Group'>[]>();
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      storageLoad.promise,
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);

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

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
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

    lazyBootstrap.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    storageLoad.resolve([
      {
        id: '2',
        name: 'Group 2',
      },
    ]);

    await addObserverPromise;

    expect(observerSubscribe.mock.calls).toEqual([
      [{ data: [], isHydrated: false }],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - concurrent loads, lazy bootstrap and data load from storage (storage started first, storage resolved first)', async () => {
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
          lazyBootstrapModels: () => {
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

    const storageLoad = controlledPromise<ModelData<MS['models'], 'Group'>[]>();
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      storageLoad.promise,
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);

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

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    storageLoad.resolve([
      {
        id: '2',
        name: 'Group 2',
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
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

    lazyBootstrap.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }],
      },
    });

    await addObserverPromise;

    expect(observerSubscribe.mock.calls).toEqual([
      [{ data: [], isHydrated: false }],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - concurrent loads, lazy bootstrap and data load from storage (bootstrap started first, bootstrap resolved first)', async () => {
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
          lazyBootstrapModels: () => {
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

    await client.start();

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

    const storageLoad = controlledPromise<ModelData<MS['models'], 'Group'>[]>();
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      storageLoad.promise,
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

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

    lazyBootstrap.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    storageLoad.resolve([
      {
        id: '2',
        name: 'Group 2',
      },
    ]);

    await addObserverPromise;

    expect(observerSubscribe.mock.calls).toEqual([
      [{ data: [], isHydrated: false }],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - concurrent loads, lazy bootstrap and data load from storage (bootstrap started first, storage resolved first)', async () => {
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
          lazyBootstrapModels: () => {
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

    await client.start();

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

    const storageLoad = controlledPromise<ModelData<MS['models'], 'Group'>[]>();
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      storageLoad.promise,
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    storageLoad.resolve([
      {
        id: '2',
        name: 'Group 2',
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
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

    lazyBootstrap.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }],
      },
    });

    await addObserverPromise;

    expect(observerSubscribe.mock.calls).toEqual([
      [{ data: [], isHydrated: false }],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - sync group bootstrap, dependent observer added after lazy bootstrap started', async () => {
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
          lazyBootstrapModels: () => {
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

    const lazyBootstrap1 = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', syncGroups: [{ type: '1' }], models: ['Group'] }],
      lazyBootstrap1.promise,
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
      Promise.resolve([]),
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscriber = vitest.fn();
    observer.subscribe(() => observerSubscriber(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);
    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
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

    lazyBootstrap1.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }, { type: '2' as const }],
      },
    });

    await addObserverPromise;

    expect(observerSubscriber.mock.calls).toEqual([
      [{ data: [], isHydrated: false }],
      [
        {
          data: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - concurrent lazy bootstrap and storage loads, optimistic change before loads still emitted to observer', async () => {
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
          lazyBootstrapModels: () => {
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

    addStorageFnCall(
      'createPendingTransaction',
      [
        [
          {
            modelId: '3',
            modelName: 'Group',
            action: 'create',
            data: { id: '3', name: 'Group 3' },
          },
        ],
      ],
      Promise.resolve(1),
    );

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

    const sendTransaction = controlledPromise<SendTransactionResult>();
    addNetworkFnCall(
      'sendTransaction',
      [
        [
          {
            modelId: '3',
            modelName: 'Group',
            action: 'create',
            data: { id: '3', name: 'Group 3' },
          },
        ],
      ],
      sendTransaction.promise,
    );

    await client.start();

    client.addMutation([
      {
        modelId: '3',
        modelName: 'Group',
        action: 'create',
        data: { id: '3', name: 'Group 3' },
      },
    ]);

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

    const storageLoad = controlledPromise<ModelData<MS['models'], 'Group'>[]>();
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      storageLoad.promise,
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);

    expect(observer.getSnapshotMany()).toEqual({
      data: [
        {
          id: '3',
          name: 'Group 3',
        },
      ],
      isHydrated: false,
    });

    storageLoad.resolve([
      {
        id: '2',
        name: 'Group 2',
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 10));

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

    lazyBootstrap.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }],
      },
    });

    await addObserverPromise;

    expect(observerSubscribe.mock.calls).toEqual([
      [
        {
          data: [
            {
              id: '3',
              name: 'Group 3',
            },
          ],
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
            {
              id: '3',
              name: 'Group 3',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - concurrent lazy bootstrap and storage loads, optimistic change during loads still emitted to observer', async () => {
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
          lazyBootstrapModels: () => {
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

    await client.start();

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

    const storageLoad = controlledPromise<ModelData<MS['models'], 'Group'>[]>();
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      storageLoad.promise,
    );

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Group', {}>('Group', {}, {});
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    const addObserverPromise = cache.addObserver(observer);

    expect(observer.getSnapshotMany()).toEqual({
      data: [],
      isHydrated: false,
    });

    addStorageFnCall(
      'createPendingTransaction',
      [
        [
          {
            modelId: '3',
            modelName: 'Group',
            action: 'create',
            data: { id: '3', name: 'Group 3' },
          },
        ],
      ],
      Promise.resolve(1),
    );

    const sendTransaction = controlledPromise<SendTransactionResult>();
    addNetworkFnCall(
      'sendTransaction',
      [
        [
          {
            modelId: '3',
            modelName: 'Group',
            action: 'create',
            data: { id: '3', name: 'Group 3' },
          },
        ],
      ],
      // Don't resolve to simulate a long-standing optimistic update
      sendTransaction.promise,
    );

    client.addMutation([
      {
        modelId: '3',
        modelName: 'Group',
        action: 'create',
        data: { id: '3', name: 'Group 3' },
      },
    ]);

    storageLoad.resolve([
      {
        id: '2',
        name: 'Group 2',
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(observer.getSnapshotMany()).toEqual({
      data: [
        {
          id: '3',
          name: 'Group 3',
        },
      ],
      isHydrated: false,
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

    lazyBootstrap.resolve({
      ok: true as const,
      value: {
        bootstrap: {
          Group: [
            {
              id: '1',
              name: 'Group 1',
            },
          ],
        },
        firstSyncId: 101,
        syncGroups: [{ type: '1' as const }],
      },
    });

    await addObserverPromise;

    expect(observerSubscribe.mock.calls).toEqual([
      [
        {
          data: [],
          isHydrated: false,
        },
      ],
      [
        {
          data: [
            {
              id: '3',
              name: 'Group 3',
            },
          ],
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              name: 'Group 1',
            },
            {
              id: '2',
              name: 'Group 2',
            },
            {
              id: '3',
              name: 'Group 3',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - call to loadModelData based on filter / index, basic case', async () => {
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
        indexes: {
          Post: [
            {
              name: 'Post_authorId',
              fields: ['authorId'],
            },
          ],
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

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: { name: 'Post_authorId', fields: ['authorId'] } as ModelIndex<
            MS['models'],
            'Post'
          >,
          filter: { authorId: '1' } as ModelFilter<MS['models'], 'Post'>,
        },
      ],
      Promise.resolve([
        {
          id: '1',
          title: 'title',
          body: 'body',
          authorId: '1',
        },
      ]),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Post', {}>(
      'Post',
      { authorId: '1' },
      {},
    );
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    await cache.addObserver(observer);

    expect(observerSubscribe.mock.calls).toEqual([
      [
        {
          data: [],
          isHydrated: false,
        },
      ],
      [
        {
          data: [
            {
              id: '1',
              title: 'title',
              body: 'body',
              authorId: '1',
            },
          ],
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - call to loadModelData based on filter / index, inArray case', async () => {
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
        indexes: {
          Post: [
            {
              name: 'Post_authorId',
              fields: ['authorId'],
            },
          ],
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

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: { name: 'Post_authorId', fields: ['authorId'] } as ModelIndex<
            MS['models'],
            'Post'
          >,
          filter: { authorId: '1' } as ModelFilter<MS['models'], 'Post'>,
        },
      ],
      Promise.resolve([
        {
          id: '1',
          title: 'title',
          body: 'body',
          authorId: '1',
        },
      ]),
    );

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: { name: 'Post_authorId', fields: ['authorId'] } as ModelIndex<
            MS['models'],
            'Post'
          >,
          filter: { authorId: '2' } as ModelFilter<MS['models'], 'Post'>,
        },
      ],
      Promise.resolve([
        {
          id: '2',
          title: 'title',
          body: 'body',
          authorId: '2',
        },
      ]),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Post', {}>(
      'Post',
      { authorId: inArray(['1', '2']) },
      {},
    );
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    await cache.addObserver(observer);

    expect(observerSubscribe.mock.calls).toEqual([
      [
        {
          data: [],
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              title: 'title',
              body: 'body',
              authorId: '1',
            },
          ]),
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              title: 'title',
              body: 'body',
              authorId: '1',
            },
            {
              id: '2',
              title: 'title',
              body: 'body',
              authorId: '2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - call to loadModelData based on filter / index, combo inArray/literal case', async () => {
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
        indexes: {
          Post: [
            {
              name: 'Post_index',
              fields: ['authorId', 'title'],
            },
          ],
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

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: {
            name: 'Post_index',
            fields: ['authorId', 'title'],
          } as ModelIndex<MS['models'], 'Post'>,
          filter: { authorId: '1', title: 'title' } as ModelFilter<
            MS['models'],
            'Post'
          >,
        },
      ],
      Promise.resolve([
        {
          id: '1',
          title: 'title',
          body: 'body',
          authorId: '1',
        },
      ]),
    );

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: {
            name: 'Post_index',
            fields: ['authorId', 'title'],
          } as ModelIndex<MS['models'], 'Post'>,
          filter: { authorId: '2', title: 'title' } as ModelFilter<
            MS['models'],
            'Post'
          >,
        },
      ],
      Promise.resolve([
        {
          id: '2',
          title: 'title',
          body: 'body',
          authorId: '2',
        },
      ]),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Post', {}>(
      'Post',
      { authorId: inArray(['1', '2']), title: 'title' },
      {},
    );
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    await cache.addObserver(observer);

    expect(observerSubscribe.mock.calls).toEqual([
      [
        {
          data: [],
          isHydrated: false,
        },
      ],
      [
        {
          data: [
            {
              id: '1',
              title: 'title',
              body: 'body',
              authorId: '1',
            },
          ],
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              title: 'title',
              body: 'body',
              authorId: '1',
            },
            {
              id: '2',
              title: 'title',
              body: 'body',
              authorId: '2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
  });

  test('Sync - call to loadModelData based on filter / index, multiple inArray case', async () => {
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
        indexes: {
          Post: [
            {
              name: 'Post_index',
              fields: ['authorId', 'title'],
            },
          ],
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

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: {
            name: 'Post_index',
            fields: ['authorId', 'title'],
          } as ModelIndex<MS['models'], 'Post'>,
          filter: { authorId: '1', title: 'title 1' } as ModelFilter<
            MS['models'],
            'Post'
          >,
        },
      ],
      Promise.resolve([
        {
          id: '1',
          title: 'title 1',
          body: 'body',
          authorId: '1',
        },
      ]),
    );

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: {
            name: 'Post_index',
            fields: ['authorId', 'title'],
          } as ModelIndex<MS['models'], 'Post'>,
          filter: { authorId: '1', title: 'title 2' } as ModelFilter<
            MS['models'],
            'Post'
          >,
        },
      ],
      Promise.resolve([
        {
          id: '2',
          title: 'title 2',
          body: 'body',
          authorId: '1',
        },
      ]),
    );

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: {
            name: 'Post_index',
            fields: ['authorId', 'title'],
          } as ModelIndex<MS['models'], 'Post'>,
          filter: { authorId: '2', title: 'title 1' } as ModelFilter<
            MS['models'],
            'Post'
          >,
        },
      ],
      Promise.resolve([
        {
          id: '3',
          title: 'title 1',
          body: 'body',
          authorId: '2',
        },
      ]),
    );

    addStorageFnCall(
      'loadModelData',
      [
        'Post',
        {
          index: {
            name: 'Post_index',
            fields: ['authorId', 'title'],
          } as ModelIndex<MS['models'], 'Post'>,
          filter: { authorId: '2', title: 'title 2' } as ModelFilter<
            MS['models'],
            'Post'
          >,
        },
      ],
      Promise.resolve([
        {
          id: '4',
          title: 'title 2',
          body: 'body',
          authorId: '2',
        },
      ]),
    );

    addStorageFnCall('applySyncActions', [100, []], Promise.resolve());

    syncListener!({
      type: 'handshake',
      lastSyncId: 100,
      syncGroups: [],
    });

    const cache = client.getCache();
    const observer = new QueryObserver<MS, 'Post', {}>(
      'Post',
      { authorId: inArray(['1', '2']), title: inArray(['title 1', 'title 2']) },
      {},
    );
    const observerSubscribe = vitest.fn();
    observer.subscribe(() => observerSubscribe(observer.getSnapshotMany()));
    await cache.addObserver(observer);

    expect(observerSubscribe.mock.calls).toEqual([
      [
        {
          data: [],
          isHydrated: false,
        },
      ],
      [
        {
          data: [
            {
              id: '1',
              title: 'title 1',
              body: 'body',
              authorId: '1',
            },
          ],
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              title: 'title 1',
              body: 'body',
              authorId: '1',
            },
            {
              id: '2',
              title: 'title 2',
              body: 'body',
              authorId: '1',
            },
          ]),
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              title: 'title 1',
              body: 'body',
              authorId: '1',
            },
            {
              id: '2',
              title: 'title 2',
              body: 'body',
              authorId: '1',
            },
            {
              id: '3',
              title: 'title 1',
              body: 'body',
              authorId: '2',
            },
          ]),
          isHydrated: false,
        },
      ],
      [
        {
          data: expect.arrayContaining([
            {
              id: '1',
              title: 'title 1',
              body: 'body',
              authorId: '1',
            },
            {
              id: '2',
              title: 'title 2',
              body: 'body',
              authorId: '1',
            },
            {
              id: '3',
              title: 'title 1',
              body: 'body',
              authorId: '2',
            },
            {
              id: '4',
              title: 'title 2',
              body: 'body',
              authorId: '2',
            },
          ]),
          isHydrated: true,
        },
      ],
    ]);
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

  // TODO: Optimistic change returned via QueryObserver even if data is not loaded
});

// Error cases
// What if messages come in an unexpected order? aka sync before handshake, multiple handshakes in a row, etc.

// TODO: Concurrent lazy bootstraps / sync actions / storage loads that affect different parts (via select) of the same observable
// As for implementation here - I think we need to look up and "cancel" previous walks of any observers that are still building a result,
// e.g. via recursive calls to applyRelationshipsAsync / loadModelDataAsync
// but already have built upon a result that has now changed

// // // // // // // // // // // // //
//
// Need to specify expected behavior:
//
// // // // // // // // // // // // //

// How to handle contradictory, concurrent data from storage and bootstrap?
// - in theory the data would be contradictory because something changed and therefore there would be an associated sync action
//   so maybe it doesn't matter?

// What to do if there are local changes for data that has not been loaded yet, either from storage or bootstrap?
// - doesn't seem likely, but could easily see this arising if we replay pending transactions int store on app restart
//   e.g. if user ended session while offline
