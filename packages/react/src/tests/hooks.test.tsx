import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import {
  type ModelsConfig,
  LocoSyncClient,
  type NetworkClient,
  type SocketEventCallback,
  type LocalDbClient,
} from '@loco-sync/client';
import { createLocoSyncReact } from '../index';
import {
  type MS,
  modelDefs,
  relationshipDefs,
  fakeNetworkClient,
  fakeLocalDbClient,
} from './utils';

test('sync payload with multiple actions for one model', async () => {
  const user = userEvent.setup();

  render(<App />);

  // Use findByRole instead of getByRole because of loco-sync hydration
  const button = await screen.findByRole('button', { name: /click me/i });
  await user.click(button);

  expect(screen.getByText(/Title/)).toHaveTextContent(
    'Title: "updated title", Body: "updated body"',
  );
});

const config = {
  modelDefs,
  relationshipDefs,
} satisfies ModelsConfig<MS>;

const listeners = new Map<string, SocketEventCallback<MS['models']>>();
let listenerId = 0;

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

const networkClient: NetworkClient<MS> = {
  ...fakeNetworkClient,
  loadBootstrap: async () => {
    return {
      ok: true,
      value: {
        bootstrap,
        lastSyncId: 1,
      },
    };
  },
  initHandshake: () => {
    for (const callback of listeners.values()) {
      callback({
        type: 'handshake',
        modelSchemaVersion: 1,
        lastSyncId: 0,
      });
    }
  },
  addListener: (cb) => {
    listenerId += 1;
    const thisId = listenerId.toString();
    listeners.set(thisId, cb);
    return () => {
      listeners.delete(thisId);
    };
  },
};

const localDbClient: LocalDbClient<MS> = {
  ...fakeLocalDbClient,
  async loadBootstrap() {
    return bootstrap;
  },
};

const syncClient = new LocoSyncClient({
  name: 'test',
  networkClient,
  localDbClient,
});

const { Provider, useIsHydrated, useQueryOne } = createLocoSyncReact(
  syncClient,
  config,
);

const sendSyncPayload = () => {
  for (const callback of listeners.values()) {
    callback({
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
  }
};

const App = () => {
  return (
    <Provider>
      <InnerApp />
    </Provider>
  );
};

const InnerApp = () => {
  const isHydrated = useIsHydrated();
  const data = useQueryOne('Post', '1');

  if (!isHydrated) {
    return <div>Loading...</div>;
  }

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
          sendSyncPayload();
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
