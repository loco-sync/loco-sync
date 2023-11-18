import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

const consoleMock = vi.spyOn(console, 'warn').mockImplementation(console.log);

afterEach(() => {
  vi.resetAllMocks();
});

test('Does not print invariant warning for valid hook args changes', async () => {
  const { rerender } = render(
    <Provider notHydratedFallback={null}>
      <Test modelName="Group" modelId="1" />
    </Provider>,
  );

  // Use find instead of get because of loco-sync hydration
  await screen.findByText(/Found/);

  expect(consoleMock).not.toHaveBeenCalled();

  rerender(
    <Provider notHydratedFallback={null}>
      <Test modelName="Group" modelId="2" />
    </Provider>,
  );

  await screen.findByText(/Found/);

  expect(consoleMock).not.toHaveBeenCalled();
});

test('Does print invariant warning for invalid hook args changes', async () => {
  const { rerender } = render(
    <Provider notHydratedFallback={null}>
      <Test modelName="Group" modelId="1" />
    </Provider>,
  );

  // Use find instead of get because of loco-sync hydration
  await screen.findByText(/Found/);

  expect(consoleMock).not.toHaveBeenCalled();

  rerender(
    <Provider notHydratedFallback={null}>
      <Test modelName="Author" modelId="1" />
    </Provider>,
  );

  await screen.findByText(/Found/);

  expect(consoleMock).toHaveBeenCalledWith(
    'The following args should not change per hook call, and changes are ignored: store, modelName, selection, relationshipDefs',
  );
});

const bootstrap = {
  Group: [
    {
      id: '1',
      name: '???',
    },
    {
      id: '2',
      name: '!!!',
    },
  ],
  Author: [
    {
      id: '1',
      name: '???',
      groupId: null,
    },
    {
      id: '2',
      name: '!!!',
      groupId: null,
    },
  ],
};

const { config, syncClient } = setup(bootstrap);
const { Provider, useQueryOne } = createLocoSyncReact(syncClient, config);

const Test = ({
  modelName,
  modelId,
}: {
  modelName: 'Group' | 'Author';
  modelId: string;
}) => {
  const data = useQueryOne(modelName, modelId);

  if (!data) {
    return <span>Not found</span>;
  }

  return <span>Found</span>;
};
