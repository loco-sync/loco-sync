import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('local changes with update after insert, separate calls', async () => {
  const user = userEvent.setup();

  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test1 />
    </Provider>,
  );

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button1 = await screen.findByRole('button', { name: /click me/i });
  expect(button1).toHaveTextContent('click me 1');
  expect(screen.getByText(/Not found/)).toHaveTextContent('Not found');

  await user.click(button1);
  expect(screen.getByText(/Title/)).toHaveTextContent(
    'Title: "init title", Body: "init body"',
  );

  const button2 = await screen.findByRole('button', { name: /click me/i });
  expect(button2).toHaveTextContent('click me 2');

  await user.click(button2);

  expect(screen.getByText(/Title/)).toHaveTextContent(
    'Title: "updated title", Body: "init body"',
  );
});

const bootstrap = {};

const { config, client } = setup(bootstrap);
const { Provider, useQueryOne, useMutation } = createLocoSyncReact(config);

const Test1 = () => {
  const { data } = useQueryOne('Post', { id: '1' });
  const mutation = useMutation();
  const [clicked, setClicked] = useState(false);

  return (
    <div>
      <button
        onClick={() => {
          setClicked(true);
          if (!clicked) {
            mutation.mutate([
              {
                action: 'create',
                modelName: 'Post',
                modelId: '1',
                data: {
                  id: '1',
                  title: 'init title',
                  body: 'init body',
                  authorId: '99',
                },
              },
            ]);
          } else {
            mutation.mutate([
              {
                action: 'update',
                modelName: 'Post',
                modelId: '1',
                data: {
                  title: 'updated title',
                },
              },
            ]);
          }
        }}
      >
        {clicked ? 'click me 2' : 'click me 1'}
      </button>
      {data ? (
        <span>
          Title: "{data.title}", Body: "{data.body}"
        </span>
      ) : (
        <span>Not found</span>
      )}
    </div>
  );
};
