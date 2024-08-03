import type { ModelsConfig } from '../../lib/core';
import { ModelDataLoader } from '../../lib/model-data-loader';
import { type BootstrapResult } from '../../lib/network';
import { controlledPromise, type MS, setup } from '../utils';

// describe('ModelDataLoader, no sync groups', () => {
//   const config: ModelsConfig<MS> = {
//     modelDefs: {
//       Group: { initialBootstrap: true },
//       Author: { initialBootstrap: true },
//       Post: {},
//       Tag: { initialBootstrap: true },
//       PostTag: {},
//       PostTagAnnotation: {},
//     },
//   };

//   test('Models with initialBootstrap: true in modelDefs included in eagerModels', () => {
//     const { network, storage } = setup();
//     const loader = new ModelDataLoader<MS>(config, network, storage);
//     expect(loader.eagerModels).toEqual(
//       expect.arrayContaining(['Group', 'Author', 'Tag']),
//     );
//   });

//   test('isModelLoaded returns true for models with initialBootstrap: true', () => {
//     const { network, storage } = setup();
//     const loader = new ModelDataLoader<MS>(config, network, storage);
//     const result = loader.isModelLoaded('Group');
//     expect(result.loaded).toEqual(true);
//   });

//   test('isModelLoaded returns false for models w/o initialBootstrap: true', () => {
//     const { network, storage } = setup();
//     const loader = new ModelDataLoader<MS>(config, network, storage);
//     const result = loader.isModelLoaded('Post');
//     expect(result.loaded).toEqual(false);
//   });
// });

describe('ModelDataLoader, sync groups', () => {
  const config: ModelsConfig<MS> = {
    modelDefs: {
      Group: { initialBootstrap: true },
      Author: { initialBootstrap: true },
      Post: {},
      Tag: { initialBootstrap: true },
      PostTag: {},
      PostTagAnnotation: {},
    },
    syncGroupDefs: {
      modelsForPartialBootstrap: (syncGroup) => {
        if (syncGroup.type === '1') {
          return ['Post'];
        } else {
          return ['PostTag', 'PostTagAnnotation'];
        }
      },
      equals: (a, b) => a.type === b.type,
    },
  };

  test('Eager models always loaded', () => {
    const { network, storage } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);
    expect(loader.eagerModels).toEqual(
      expect.arrayContaining(['Group', 'Author', 'Tag']),
    );
    expect(loader.isModelLoaded('Group').loaded).toEqual(true);
    expect(loader.isModelLoaded('Author').loaded).toEqual(true);
    expect(loader.isModelLoaded('Tag').loaded).toEqual(true);
  });

  test('Non-eager model (one syncGroup) not loaded before any associated syncGroup is loaded', () => {
    const { network, storage } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(false);
  });

  test('Non-eager model (one syncGroup) loaded after associated syncGroup is loaded', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);

    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', models: ['Post'], syncGroups: [{ type: '1' }] }],
      Promise.resolve({
        ok: true as const,
        value: {
          bootstrap: {},
          firstSyncId: 10,
          syncGroups: [{ type: '1' as const }],
        },
      }),
    );
    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '1' }], new Set()],
      Promise.resolve(),
    );

    await loader.addNewSyncGroups([{ type: '1' }], new Set());
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(true);
  });

  test('Non-eager model (one syncGroup) can be awaited via isLoadedModel result', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);

    const bootstrap = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [{ type: 'lazy', models: ['Post'], syncGroups: [{ type: '1' }] }],
      bootstrap.promise,
    );
    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '1' }], new Set()],
      Promise.resolve(),
    );

    const addPromise = loader.addNewSyncGroups([{ type: '1' }], new Set());
    const result1 = loader.isModelLoaded('Post');
    expect(result1.loaded).toEqual(false);
    if (!result1.loaded) {
      setTimeout(
        () =>
          bootstrap.resolve({
            ok: true,
            value: {
              bootstrap: {},
              firstSyncId: 10,
              syncGroups: [{ type: '1' }],
            },
          }),
        10,
      );
      await result1.promise;
    }
    const result2 = loader.isModelLoaded('Post');
    expect(result2.loaded).toEqual(true);

    await addPromise;
  });

  test('Non-eager model (multiple syncGroups) is loaded after multiple syncGroups are loaded all at once', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);

    addNetworkFnCall(
      'bootstrap',
      [
        {
          type: 'lazy',
          models: ['PostTag', 'PostTagAnnotation'],
          syncGroups: [{ type: '2' }],
        },
      ],
      Promise.resolve({
        ok: true as const,
        value: {
          bootstrap: {},
          firstSyncId: 10,
          syncGroups: [{ type: '2' as const }],
        },
      }),
    );
    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '2' }], new Set()],
      Promise.resolve(),
    );
    addNetworkFnCall(
      'bootstrap',
      [
        {
          type: 'lazy',
          models: ['PostTag', 'PostTagAnnotation'],
          syncGroups: [{ type: '3' }],
        },
      ],
      Promise.resolve({
        ok: true as const,
        value: {
          bootstrap: {},
          firstSyncId: 10,
          syncGroups: [{ type: '3' as const }],
        },
      }),
    );
    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '3' }], new Set()],
      Promise.resolve(),
    );

    await loader.addNewSyncGroups([{ type: '2' }, { type: '3' }], new Set());
    const result = loader.isModelLoaded('PostTag');
    expect(result.loaded).toEqual(true);
  });

  test('Non-eager model (multiple syncGroups) switches from loaded to not loaded if a new associated syncGroup is added', async () => {
    const { network, storage, addNetworkFnCall, addStorageFnCall } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);

    addNetworkFnCall(
      'bootstrap',
      [
        {
          type: 'lazy',
          models: ['PostTag', 'PostTagAnnotation'],
          syncGroups: [{ type: '2' }],
        },
      ],
      Promise.resolve({
        ok: true as const,
        value: {
          bootstrap: {},
          firstSyncId: 10,
          syncGroups: [{ type: '2' as const }],
        },
      }),
    );
    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '2' }], new Set()],
      Promise.resolve(),
    );

    const bootstrap3 = controlledPromise<BootstrapResult<MS>>();
    addNetworkFnCall(
      'bootstrap',
      [
        {
          type: 'lazy',
          models: ['PostTag', 'PostTagAnnotation'],
          syncGroups: [{ type: '3' }],
        },
      ],
      bootstrap3.promise,
    );
    addStorageFnCall(
      'saveLazyBootstrap',
      [{}, [{ type: '3' }], new Set()],
      Promise.resolve(),
    );

    await loader.addNewSyncGroups([{ type: '2' }], new Set());
    const result1 = loader.isModelLoaded('PostTag');
    expect(result1.loaded).toEqual(true);

    const addPromise = loader.addNewSyncGroups([{ type: '3' }], new Set());
    const result2 = loader.isModelLoaded('PostTag');
    expect(result2.loaded).toEqual(false);
    if (!result2.loaded) {
      setTimeout(
        () =>
          bootstrap3.resolve({
            ok: true,
            value: {
              bootstrap: {},
              firstSyncId: 10,
              syncGroups: [{ type: '3' }],
            },
          }),
        10,
      );
      await result2.promise;
    }

    const result3 = loader.isModelLoaded('PostTag');
    expect(result3.loaded).toEqual(true);

    await addPromise;
  });

  test('Non-eager model loaded after associated syncGroup added from storage', async () => {
    const { network, storage } = setup();
    const loader = new ModelDataLoader<MS>(config, network, storage);
    loader.addSyncGroupsFromStorage([{ type: '1' }]);
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(true);
  });
});
