import { vitest } from 'vitest';
import { relationshipDefs, setup } from '../utils';
import { LocoSyncClient } from '../../lib/client';

describe('LocoSyncClient.start()', () => {
  test('Storage has metadata, basic case', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: { initialBootstrap: true, preloadFromStorage: true },
          Post: { initialBootstrap: true },
          PostTag: { initialBootstrap: true },
          Author: { initialBootstrap: true },
          PostTagAnnotation: { initialBootstrap: true },
          Tag: { initialBootstrap: true },
        },
        relationshipDefs: relationshipDefs,
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
          lastSyncId: 100,
          syncGroups: [],
          lastUpdatedAt: '',
        },
        pendingTransactions: [
          {
            id: 1,
            args: [
              {
                modelId: '1',
                modelName: 'Group' as const,
                action: 'create' as const,
                data: {
                  id: '1',
                  name: 'G1',
                },
              },
            ],
          },
        ],
      }),
    );
    addNetworkFnCall(
      'sendTransaction',
      [
        [
          {
            modelId: '1',
            modelName: 'Group',
            action: 'create',
            data: {
              id: '1',
              name: 'G1',
            },
          },
        ],
      ],
      Promise.resolve({
        ok: true as const,
        value: { lastSyncId: 101 },
      }),
    );
    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
    );
    addStorageFnCall('removePendingTransaction', [1], Promise.resolve());

    // Load each model (all set to preload from storage)
    addStorageFnCall(
      'loadModelData',
      ['Group', undefined],
      Promise.resolve([]),
    );

    const listener = vitest.fn();
    client.addListener(listener);

    await client.start();

    expect(listener).toBeCalledTimes(1);
    expect(listener).toBeCalledWith({ type: 'started' });
  });

  test('Storage has no metadata, basic case', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: { initialBootstrap: true },
          Post: { initialBootstrap: true },
          PostTag: { initialBootstrap: true },
          Author: { initialBootstrap: true },
          PostTagAnnotation: { initialBootstrap: true },
          Tag: { initialBootstrap: true },
        },
        relationshipDefs: relationshipDefs,
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve(undefined),
    );
    addNetworkFnCall(
      'bootstrap',
      [
        {
          type: 'eager',
          models: expect.arrayContaining([
            'Group',
            'Author',
            'Tag',
            'Post',
            'PostTag',
            'PostTagAnnotation',
          ]),
        },
      ],
      Promise.resolve({
        ok: true as const,
        value: {
          bootstrap: {},
          firstSyncId: 0,
          syncGroups: [],
        },
      }),
    );
    addStorageFnCall('saveEagerBootstrap', [{}, 0], Promise.resolve());

    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
    );

    const listener = vitest.fn();
    client.addListener(listener);

    await client.start();

    expect(listener).toBeCalledTimes(1);
    expect(listener).toBeCalledWith({ type: 'started' });
  });

  test('Storage has no metadata, only some models in eager bootstrap', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const client = new LocoSyncClient({
      config: {
        modelDefs: {
          Group: { initialBootstrap: true },
          Post: {},
          PostTag: {},
          Author: { initialBootstrap: true },
          PostTagAnnotation: {},
          Tag: { initialBootstrap: true },
        },
        relationshipDefs: relationshipDefs,
        syncGroupDefs: {
          equals: (a, b) => a.type === b.type,
          modelsForPartialBootstrap: (syncGroup) => {
            if (syncGroup.type === '1') {
              return ['Post'];
            } else {
              return ['PostTag', 'PostTagAnnotation'];
            }
          },
        },
      },
      network,
      storage,
    });

    addStorageFnCall(
      'getMetadataAndPendingTransactions',
      [],
      Promise.resolve(undefined),
    );
    addNetworkFnCall(
      'bootstrap',
      [
        {
          type: 'eager',
          models: expect.arrayContaining(['Group', 'Author', 'Tag']),
        },
      ],
      Promise.resolve({
        ok: true as const,
        value: {
          bootstrap: {},
          firstSyncId: 0,
          syncGroups: [],
        },
      }),
    );
    addStorageFnCall('saveEagerBootstrap', [{}, 0], Promise.resolve());

    addNetworkFnCall(
      'initSync',
      [expect.any(Function)],
      Promise.resolve(() => {}),
    );

    await client.start();
  });
});
