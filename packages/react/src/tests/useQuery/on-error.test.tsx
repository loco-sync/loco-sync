import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';
import { vitest } from 'vitest';
import { LocoSyncClient } from '@loco-sync/client';

test('Calls onSuccess', async () => {
  const user = userEvent.setup();

  const onError = vitest.fn();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test1 onError={onError} />
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
const { Provider, useQueryOne, useMutation } = createLocoSyncReact(config);

const Test1 = ({ onError }: { onError: () => void }) => {
  const { data } = useQueryOne('Group', { id: '1' });
  const mutation = useMutation();

  if (!data) {
    return (
      <div>
        <span>Not found</span>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => {
          mutation.mutate(
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
      >
        click me
      </button>

      <span>Group is named "{data.name}"</span>
    </div>
  );
};
