import { ModelDataLoader } from '../../lib/model-data-loader';
import { type MS, setup } from '../utils';

const { config: baseConfig, network, storage } = setup({});

describe('ModelDataLoader, no sync groups', () => {
  const config: typeof baseConfig = {
    ...baseConfig,
    modelDefs: {
      Group: { initialBootstrap: true },
      Author: { initialBootstrap: true },
      Post: {},
      Tag: { initialBootstrap: true },
      PostTag: {},
      PostTagAnnotation: {},
    },
  };

  test('Models with initialBootstrap: true in modelDefs included in eagerModels', () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    expect(loader.eagerModels).toEqual(
      expect.arrayContaining(['Group', 'Author', 'Tag']),
    );
  });

  test('isModelLoaded returns true for models with initialBootstrap: true', () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    const result = loader.isModelLoaded('Group');
    expect(result.loaded).toEqual(true);
  });

  test('isModelLoaded returns false for models w/o initialBootstrap: true', () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(false);
  });
});

describe('ModelDataLoader, sync groups', () => {
  const config: typeof baseConfig = {
    ...baseConfig,
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
    const loader = new ModelDataLoader<MS>(config, network, storage);
    expect(loader.eagerModels).toEqual(
      expect.arrayContaining(['Group', 'Author', 'Tag']),
    );
    expect(loader.isModelLoaded('Group').loaded).toEqual(true);
    expect(loader.isModelLoaded('Author').loaded).toEqual(true);
    expect(loader.isModelLoaded('Tag').loaded).toEqual(true);
  });

  test('Non-eager models not loaded before associated syncGroup is loaded', () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(false);
  });

  test('Non-eager model loaded after associated syncGroup is loaded', async () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    await loader.addNewSyncGroups([{ type: '1' }], new Set());
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(true);
  });

  test('Non-eager model not loaded until after associated syncGroups are loaded', async () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    const addPromise = loader.addNewSyncGroups([{ type: '2' }], new Set());
    const result1 = loader.isModelLoaded('PostTag');
    expect(result1.loaded).toEqual(false);
    await addPromise;
    const result2 = loader.isModelLoaded('PostTag');
    expect(result2.loaded).toEqual(true);
  });

  test('Non-eager model is loaded after multiple syncGroups are loaded all at once', async () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    await loader.addNewSyncGroups([{ type: '2' }, { type: '3' }], new Set());
    const result = loader.isModelLoaded('PostTag');
    expect(result.loaded).toEqual(true);
  });

  test('Non-eager model switched from loaded to not loaded if a new associated syncGroup is added', async () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    await loader.addNewSyncGroups([{ type: '2' }], new Set());
    const result1 = loader.isModelLoaded('PostTag');
    expect(result1.loaded).toEqual(true);

    const addPromise = loader.addNewSyncGroups([{ type: '3' }], new Set());
    const result2 = loader.isModelLoaded('PostTag');
    expect(result2.loaded).toEqual(false);
    await addPromise;
    const result3 = loader.isModelLoaded('PostTag');
    expect(result3.loaded).toEqual(true);
  });

  test('Non-eager model can be awaited via isLoadedModel result', async () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    loader.addNewSyncGroups([{ type: '2' }], new Set());
    const result1 = loader.isModelLoaded('PostTag');
    expect(result1.loaded).toEqual(false);
    if (!result1.loaded) {
      await result1.promise;
    }
    const result2 = loader.isModelLoaded('PostTag');
    expect(result2.loaded).toEqual(true);
  });


  test('Non-eager model loaded after associated syncGroup added from storage', async () => {
    const loader = new ModelDataLoader<MS>(config, network, storage);
    loader.addSyncGroupsFromStorage([{ type: '1' }]);
    const result = loader.isModelLoaded('Post');
    expect(result.loaded).toEqual(true);
  });
});
