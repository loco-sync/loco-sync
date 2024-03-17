import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('sync payload with insert after delete', async () => {
  const user = userEvent.setup();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test1 />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });
  expect(screen.getByText(/Title/)).toHaveTextContent(
    'Title: "init title", Body: "init body"',
  );

  await user.click(button);

  expect(screen.getByText(/Title/)).toHaveTextContent(
    'Title: "restored title updated", Body: "restored body updated"',
  );
});

const bootstrap = {
  Post: [
    {
      id: '1',
      title: 'init title',
      body: 'init body',
      authorId: '99',
    },
  ],
};

const { config, client, sendMessage } = setup(bootstrap);
const { Provider, useQueryOne } = createLocoSyncReact(config);

const Test1 = () => {
  const { data } = useQueryOne('Post', { id: '1' });

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
          sendMessage({
            type: 'sync',
            lastSyncId: 5,
            sync: [
              {
                syncId: 2,
                action: 'update',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: 'init title updated',
                  body: 'init body updated',
                  authorId: '99',
                },
              },
              {
                syncId: 3,
                action: 'delete',
                modelName: 'Post',
                modelId: '1',
              },
              {
                syncId: 4,
                action: 'insert',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: 'restored title',
                  body: 'restored body',
                  authorId: '99',
                },
              },
              {
                syncId: 5,
                action: 'update',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: 'restored title updated',
                  body: 'restored body updated',
                  authorId: '99',
                },
              },
            ],
          });
        }}
      >
        click me
      </button>
      <span>
        Title: "{data.title}", Body: "{data.body}"
      </span>
    </div>
  );
};
