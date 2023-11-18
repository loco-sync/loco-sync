import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('sync payload with multiple actions for one model', async () => {
  const user = userEvent.setup();

  render(
    <Provider notHydratedFallback={null}>
      <Test1 />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });
  await user.click(button);

  expect(screen.getByText(/Title/)).toHaveTextContent(
    'Title: "updated title", Body: "updated body"',
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

const { config, syncClient, sendSocketEvent } = setup(bootstrap);
const { Provider, useQueryOne } = createLocoSyncReact(syncClient, config);

const Test1 = () => {
  const data = useQueryOne('Post', '1');

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
          // Normally user, but this is the easiest repro for sync actions coming from server for now
          sendSocketEvent({
            type: 'sync',
            lastSyncId: 3,
            sync: [
              {
                syncId: 2,
                action: 'update',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: 'updated title',
                  body: 'init body',
                  authorId: '99',
                },
              },
              {
                syncId: 3,
                action: 'update',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: 'updated title',
                  body: 'updated body',
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
