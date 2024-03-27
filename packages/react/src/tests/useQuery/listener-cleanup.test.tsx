import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('Cleans up listeners correctly', async () => {
  const user = userEvent.setup();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test1 />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });
  expect(screen.getByText(/Group/)).toHaveTextContent(
    'Group "uno" - 1 authors - 0 posts',
  );

  const initListenerCount = client.getCache().getStore().listenerCount();

  await user.click(button);

  const newListenerCount = client.getCache().getStore().listenerCount();
  expect(initListenerCount).toBe(newListenerCount);

  expect(screen.getByText(/Group/)).toHaveTextContent(
    'Group "uno??" - 1 authors - 0 posts',
  );
});

const bootstrap = {
  Group: [{ id: '1', name: 'uno' }],
  Author: [{ id: '1', name: 'one', groupId: '1' }],
};

const { config, client } = setup(bootstrap);
const { Provider, useQueryOne, useMutation } = createLocoSyncReact(config);

const Test1 = () => {
  const { data } = useQueryOne(
    'Group',
    {
      id: '1',
    },
    {
      authors: {
        posts: {},
      },
    },
  );
  const mutation = useMutation();

  if (!data) {
    return <div>Not found</div>;
  }

  return (
    <div>
      <button
        onClick={() => {
          mutation.mutate([
            {
              action: 'update',
              modelName: 'Group',
              modelId: '1',
              data: {
                name: 'uno??',
              },
            },
          ]);
          mutation.mutate([
            {
              action: 'delete',
              modelName: 'Author',
              modelId: '1',
            },
          ]);
          mutation.mutate([
            {
              action: 'create',
              modelName: 'Author',
              modelId: '2',
              data: {
                id: '2',
                name: 'two',
                groupId: '1',
              },
            },
          ]);
          mutation.mutate([
            {
              action: 'create',
              modelName: 'Author',
              modelId: '3',
              data: {
                id: '3',
                name: 'three',
                groupId: '1',
              },
            },
          ]);
          mutation.mutate([
            {
              action: 'create',
              modelName: 'Post',
              modelId: '3',
              data: {
                id: '3',
                authorId: '3',
                title: 'init title',
                body: 'init body',
              },
            },
          ]);
          mutation.mutate([
            {
              action: 'delete',
              modelName: 'Author',
              modelId: '3',
            },
          ]);
        }}
      >
        click me
      </button>
      <span>
        Group "{data.name}" - {data.authors.length} authors -{' '}
        {data.authors.flatMap((a) => a.posts).length} posts
      </span>
    </div>
  );
};
