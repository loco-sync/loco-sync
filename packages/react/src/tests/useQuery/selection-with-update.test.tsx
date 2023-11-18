import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('Update moves selected entity between parts of selection', async () => {
  const user = userEvent.setup();

  render(
    <Provider notHydratedFallback={null}>
      <Test1 />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });

  expect(screen.getByText(/Author:1/)).toHaveTextContent(
    'Author:1 has 1 post(s)',
  );
  expect(screen.getByText(/Author:2/)).toHaveTextContent(
    'Author:2 has 0 post(s)',
  );

  await user.click(button);

  expect(screen.getByText(/Author:1/)).toHaveTextContent(
    'Author:1 has 0 post(s)',
  );
  expect(screen.getByText(/Author:2/)).toHaveTextContent(
    'Author:2 has 1 post(s)',
  );
});

const bootstrap = {
  Group: [
    {
      id: '1',
      name: '1',
    },
  ],
  Author: [
    {
      id: '1',
      name: '1',
      groupId: '1',
    },
    {
      id: '2',
      name: '2',
      groupId: '1',
    },
  ],
  Post: [
    {
      id: '1',
      title: 'title',
      body: 'body',
      authorId: '1',
    },
  ],
};

const { config, syncClient, sendSocketEvent } = setup(bootstrap);
const { Provider, useQueryOne } = createLocoSyncReact(syncClient, config);

const Test1 = () => {
  const data = useQueryOne('Group', '1', {
    authors: {
      posts: {},
    },
  });

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
            lastSyncId: 1,
            sync: [
              {
                syncId: 1,
                action: 'update',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: '',
                  body: '',
                  authorId: '2',
                },
              },
            ],
          });
        }}
      >
        click me
      </button>
      {data.authors.map((author) => (
        <span key={author.id}>
          Author:{author.id} has {author.posts.length} post(s)
        </span>
      ))}
    </div>
  );
};
