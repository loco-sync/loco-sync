import type { ModelsConfig } from '../../lib/core';
import { type LocoSyncClientListener } from '../../lib/client';
import { ModelDataCache } from '../../lib/model-data-cache';
import { type MS, relationshipDefs } from '../utils';

const baseConfig: ModelsConfig<MS> = {
  modelDefs: {
    Group: { initialBootstrap: true },
    Tag: { initialBootstrap: true },
    Post: { initialBootstrap: true },
    PostTag: { initialBootstrap: true },
    Author: { initialBootstrap: true },
    PostTagAnnotation: { initialBootstrap: true },
  },
  relationshipDefs,
};

const listeners = new Set<LocoSyncClientListener<MS>>();
function addListener(listener: LocoSyncClientListener<MS>) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function sendStartMessage() {
  for (const listener of listeners) {
    listener({ type: 'started' });
  }
}

describe('ModelDataCache.processMessage(), sync', () => {
  // TODO:
  // - sync actions for pre-loaded models
  // - sync actions for models loaded based on observers, various race conditions
  test('', async () => {
    const cache = new ModelDataCache<MS>(
      addListener,
      async () => [],
      baseConfig,
    );
    cache.processMessage({
      type: 'sync',
      lastSyncId: 0,
      sync: [],
    });
    const groups = cache.getStore().getMany('Group');
    expect(groups).toEqual([]);
  });
});

// describe('ModelDataCache.processMessage(), startTransaction', () => {});

// describe('ModelDataCache.processMessage(), commitTransaction', () => {});

// describe('ModelDataCache.processMessage(), rollbackTransaction', () => {});

// describe('ModelDataCache.processMessage(), syncCatchUp', () => {});
