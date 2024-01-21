import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('Component renders data from entities fetched via multi-field relationship', async () => {
  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test id="PT1" />
    </Provider>,
  );

  // Use find instead of get because of loco-sync hydration
  const groupSpan = await screen.findByText(/PostTag/);

  expect(groupSpan).toHaveTextContent(
    'PostTag:PT1 has annotations: "A note", "Another note"',
  );
});

const bootstrap = {
  PostTag: [
    {
      id: 'PT1',
      postId: 'P1',
      tagId: 'T1',
    },
    {
      id: 'PT2',
      postId: 'P2',
      tagId: 'T2',
    },
  ],
  PostTagAnnotation: [
    {
      id: 'PTA1a',
      postId: 'P1',
      tagId: 'T1',
      annotation: 'A note',
    },
    {
      id: 'PTA1b',
      postId: 'P1',
      tagId: 'T1',
      annotation: 'Another note',
    },
    {
      id: 'PTA2a',
      postId: 'P2',
      tagId: 'T2',
      annotation: 'A different note',
    },
  ],
};

const { config, client } = setup(bootstrap);
const { Provider, useQueryOne } = createLocoSyncReact(config);

const Test = ({ id }: { id: string }) => {
  const data = useQueryOne('PostTag', id, {
    annotations: {},
  });

  if (!data) {
    return <span>Not found</span>;
  }

  return (
    <span>
      PostTag:{data.id} has annotations:{' '}
      {data.annotations.map((d) => `"${d.annotation}"`).join(', ')}
    </span>
  );
};
