import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createLocoSyncReact } from '../../index';
import { setup } from '../utils';

test('Preloaded data is always hydrated', async () => {
  render(
    <Provider notHydratedFallback={null} client={client}>
      <Test id="1" />
    </Provider>,
  );

  // Use find instead of get because of loco-sync hydration
  const groupSpan1 = await screen.findByText(/Group/);
  expect(groupSpan1).toHaveTextContent('Group:1 has name "???"');
});

const bootstrap = {
  Group: [
    {
      id: '1',
      name: '???',
    },
  ],
};

const { config, client } = setup(bootstrap);
const { Provider, useQueryOne } = createLocoSyncReact(config);

const Test = ({ id }: { id: string }) => {
  const { data, isHydrated } = useQueryOne('Group', { id });

  if (!isHydrated || !data) {
    throw new Error('Preloaded data should always be hydrated');
  }

  return (
    <span>
      Group:{data.id} has name "{data.name}"
    </span>
  );
};
