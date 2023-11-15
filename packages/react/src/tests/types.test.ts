import { expectTypeOf } from 'vitest';
import { type ModelsConfig, LocoSyncClient } from '@loco-sync/client';
import { type LocoSyncReact, createLocoSyncReact } from '../index';
import {
  type MS,
  modelDefs,
  relationshipDefs,
  fakeNetworkClient,
  fakeLocalDbClient,
} from './utils';

describe('Create types', () => {
  test('Basic create', () => {
    const config = {
      modelDefs,
      relationshipDefs,
    } satisfies ModelsConfig<MS>;
    const syncClient = new LocoSyncClient({
      name: 'test',
      networkClient: fakeNetworkClient,
      localDbClient: fakeLocalDbClient,
    });
    const reactClient = createLocoSyncReact(syncClient, config);
    expectTypeOf(reactClient).toMatchTypeOf<LocoSyncReact<MS>>();
  });
});
