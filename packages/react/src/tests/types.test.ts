import { expectTypeOf } from 'vitest';
import { createConfig } from '@loco-sync/client';
import { type LocoSyncReact, createLocoSyncReact } from '../index';
import { type MS, modelDefs, relationshipDefs } from './utils';

describe('Create types', () => {
  test('Basic create', () => {
    const config = createConfig<MS>({
      modelDefs,
      relationshipDefs,
    });

    const reactClient = createLocoSyncReact(config);
    expectTypeOf(reactClient).toMatchTypeOf<LocoSyncReact<MS>>();
  });
});
