import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';
import { vitest } from 'vitest';

test('Calls onError and rollsback changes, useQueryOne', async () => {
  const user = userEvent.setup();

  const onError = vitest.fn();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test1
        onClick={() => {
          client.addMutation(
            [
              {
                modelName: 'Group',
                modelId: '1',
                action: 'update',
                data: {
                  name: 'updated name',
                },
              },
            ],
            { onError },
          );
        }}
      />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });

  expect(screen.getByText(/Group/)).toHaveTextContent(
    'Group is named "init name"',
  );

  await user.click(button);

  expect(screen.getByText(/Group/)).toHaveTextContent(
    'Group is named "init name"',
  );

  expect(onError).toHaveBeenCalledTimes(1);
});

test('Calls onError and rollsback changes, useQuery', async () => {
  const user = userEvent.setup();

  const onError = vitest.fn();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test2
        onClick={() => {
          client.addMutation(
            [
              {
                modelName: 'Group',
                modelId: '2',
                action: 'create',
                data: {
                  id: '2',
                  name: 'group 2',
                },
              },
              {
                modelName: 'Group',
                modelId: '3',
                action: 'create',
                data: {
                  id: '3',
                  name: 'group 3',
                },
              },
              {
                modelName: 'Group',
                modelId: '4',
                action: 'create',
                data: {
                  id: '4',
                  name: 'group 4',
                },
              },
            ],
            { onError },
          );
        }}
      />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });

  expect(screen.getByText(/Group/)).toHaveTextContent('Group count: 1');

  await user.click(button);

  expect(screen.getByText(/Group/)).toHaveTextContent('Group count: 1');

  expect(onError).toHaveBeenCalledTimes(1);
});

const bootstrap = {
  Group: [
    {
      id: '1',
      name: 'init name',
    },
  ],
};

const { config, client } = setup(bootstrap, {
  networkAdapter: {
    sendTransaction: async () => ({ ok: false, error: 'server' }),
  },
});
const { Provider, useQueryOne, useQuery, useMutation } =
  createLocoSyncReact(config);

const Test1 = ({ onClick }: { onClick: () => void }) => {
  const { data } = useQueryOne('Group', { id: '1' });

  if (!data) {
    return (
      <div>
        <span>Not found</span>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onClick}>click me</button>

      <span>Group is named "{data.name}"</span>
    </div>
  );
};

const Test2 = ({ onClick }: { onClick: () => void }) => {
  const { data } = useQuery('Group');

  return (
    <div>
      <button onClick={onClick}>click me</button>

      <span>Group count: {data.length}</span>
    </div>
  );
};
