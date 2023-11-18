import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('Component updates after rendering with a new modelId passed to useQueryOne', async () => {
  const { rerender } = render(
    <Provider notHydratedFallback={null}>
      <Test authorId="1" />
    </Provider>,
  );

  // Use find instead of get because of loco-sync hydration
  const authorSpan = await screen.findByText(/Author/);

  expect(authorSpan).toHaveTextContent('Author:1 has 1 post(s)');

  rerender(
    <Provider notHydratedFallback={null}>
      <Test authorId="2" />
    </Provider>,
  );

  expect(authorSpan).toHaveTextContent('Author:2 has 2 post(s)');
});

const bootstrap = {
  Author: [
    {
      id: '1',
      name: '1',
      groupId: null,
    },
    {
      id: '2',
      name: '2',
      groupId: null,
    },
  ],
  Post: [
    {
      id: '1',
      title: 'title',
      body: 'body',
      authorId: '1',
    },
    {
      id: '2a',
      title: 'title',
      body: 'body',
      authorId: '2',
    },
    {
      id: '2b',
      title: 'title',
      body: 'body',
      authorId: '2',
    },
  ],
};

const { config, syncClient } = setup(bootstrap);
const { Provider, useQuery } = createLocoSyncReact(syncClient, config);

const Test = ({ authorId }: { authorId: string }) => {
  const data = useQuery('Post', {
    authorId,
  });

  if (!data) {
    return <span>Not found</span>;
  }

  return (
    <span>
      Author:{authorId} has {data.length} post(s)
    </span>
  );
};
