import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';
import { vitest } from 'vitest';

test('Calls onSuccess', async () => {
  const user = userEvent.setup();

  const onSuccess = vitest.fn();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test1 onSuccess={onSuccess} />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });

  expect(screen.getByText(/Group/)).toHaveTextContent(
    'Group is named "init name"',
  );

  await user.click(button);

  expect(screen.getByText(/Group/)).toHaveTextContent(
    'Group is named "updated name"',
  );

  expect(onSuccess).toHaveBeenCalledTimes(1);
});

const bootstrap = {
  Group: [
    {
      id: '1',
      name: 'init name',
    },
  ],
};

const { config, client } = setup(bootstrap);
const { Provider, useQueryOne, useMutation } = createLocoSyncReact(config);

const Test1 = ({ onSuccess }: { onSuccess: () => void }) => {
  const data = useQueryOne('Group', '1');
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
            { onSuccess },
          );
        }}
      >
        click me
      </button>

      <span>Group is named "{data.name}"</span>
    </div>
  );
};
