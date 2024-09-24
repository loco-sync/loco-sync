# Loco Sync

Loco Sync is a sync engine to power local-first applications.

## Introduction

LocoSync is a sync engine to power local-first applications. The goal is to enable user experiences with realtime collaboration, offline mode, instant updates, etc. while minimizing (or even reducing) the engineering effort for common related concerns such as networking, storage, caching, etc. Furthermore, unlike some other local-first libraries, LocoSync is not focused on peer-to-peer collaboration, but rather assumes the usage of an authoritative server as a source-of-truth. While not suitable for all local-first applications, this has a number of benefits and can help provide a smooth transition when moving existing applications onto LocoSync.

In following with the focus on engineering benefits, LocoSync seeks to provide a seamless experience with Typescript. LocoSync takes a model focused approach, where each piece of synced data is associated with a Typescript type, as well as additional, optional configuration.

> LocoSync is heavily inspired by Linear's sync engine videos, see the [Inspiration](#inspiration) section for more details.

The main components of LocoSync are:

1. The LocoSyncClient, which facilitates calls to your own backend,
2. A storage adapter, which is responsible for storing synced data, pending transactions, and additional metadata locally.
3. A network adapter, which connects LocoSyncClient to your backend with a particular interface.

The following steps are necessary to start using LocoSync in your project:

1. [Setup config](#config)
   1. Define models
   2. (Optional) define model relationships
   3. (Optional) custom mutation types
2. Choose a storage adapter:
   1. `@loco-sync/idb` implements the storage adapter interface for IndexedDB, a great choice for browser apps
   2. You can implement your own storage adapter to meet your needs
3. [Implement the network adapter interface, and bring your own backend](#bring-your-own-backend)
4. (Optional) Hook into your view framework:
   1. `@loco-sync/react` provides hook adapters for React to query and mutate data inside of components

## Installation

Install the core `@loco-sync/client` library:

```sh
npm install @loco-sync/client       # npm
yarn add @loco-sync/client          # yarn
bun add @loco-sync/client           # bun
pnpm add @loco-sync/client          # pnpm
```

Additionally, install any of the other adapter libraries you'll be using:

```sh
npm install @loco-sync/idb          # IndexedDB storage adapter
npm install @loco-sync/react        # React hooks adapter
```

## Models Config

The first step in setting up LocoSync in your project is building the config based on the models of your application. There may be convenient ways to reuse these types from other parts of your application, but for example's sake we will list the types out by hand:

```ts
type M = {
  Todo: {
    id: string;
    text: string;
    authorId: string;
  };
  Author: {
    id: string;
    name: string;
  };
};
```

Next, we will list out some relationships between models. `relationshipDefs` are optional, but will be convenient when querying this data later.

```ts
const relationshipDefs = {
  Author: {
    todos: many('Todo', {
      fields: ['id'],
      references: ['authorId'],
    }),
  },
  Todo: {
    author: one('Author', {
      fields: ['authorId'],
      references: ['id'],
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

type R = typeof relationshipDefs;
```

Finally, we create the config. `modelDefs` must be passed here because reflection from types to values is not possible in Typescript. Currently `schemaVersion` is not used, but in the future values passed for each modelName key will be an object with additional configuration per model.

```ts
type MS = {
  models: M;
  relationshipDefs: R;
};

const modelDefs: ModelDefs<M> = {
  Todo: { schemaVersion: 0 },
  Author: { schemaVersion: 0 },
};

export const config = createConfig<MS>({
  modelDefs,
  relationshipDefs,
});
```

## Network Adapter, Bring your own Backend

The following methods must be implemented on the network adapter:

- loadBootstrap
  - Returns the current application state
- deltaSync
  - Returns the sync actions between given sync ids
- initSync
  - Initiates a connection to receive periodic syncs
- sendTransaction
  - Sends a transaction, or mutation, to the server

The implementation details will depend heavily on your backend. For more details on the expected behavior for each method, see [How LocoSync Works](#how-locosync-works).

## React Adapter

Setup LocoSync in React, using a config, storage adapter, and network adapter:

```tsx
import { LocoSyncClient } from '@loco-sync/client';
import { createLocoSyncReact } from '@loco-sync/react';

const { Provider, useMutation, useQuery, useQueryOne } =
  createLocoSyncReact(config);

const client = new LocoSyncClient({
  config,
  storage,
  network,
});

export function App() {
  return (
    <Provider client={client}>{/* Put the rest of your app here */}</Provider>
  );
}
```

Then, use the other hooks returned by `createLocoSyncReact` in your components:

```tsx
function Page({ authorId, todoId }: { authorId: string; todoId: string }) {
  const author = useQueryOne('Author', authorId, {
    todos: {},
  });

  const mutation = useMutation();

  return (
    <div>
      {author?.name}
      {author?.todos.map((t) => <div key={t.id}>{t.text}</div>)}
    </div>
  );
}
```

Notice the third parameter of `useQueryOne`: `todos` is one of the `relationshipDefs` defined above for the `"Author"` model. The types returned from the hook match the structure passed in.

## How LocoSync Works

### Sync Actions

The building block of the sync engine is the sync action. A sync action is an ordered action on a particular instance of a model. In particular, an `action` is `"insert"`, `"update"`, or `"delete"`, and the model instance is recognized by the combination of `modelName` (keys passed to model types / modelDefs), and `modelId`. The order of sync actions is defined by its `syncId`, which you can think of as an auto-incrementing sequence.

For example, a sync action corresponding to an insert of a `Todo` might be:

```ts
const syncAction: SyncAction<M, 'Todo'> = {
  syncId: 123,
  action: 'insert',
  modelName: 'Todo',
  modelId: '1',
  data: { id: '1', text: 'hello', authorId: '2' },
};
```

There are a couple of constraints on sync actions:

- Sync actions are created on the server. This is what it means that the server is authoritative in LocoSync
- Every change to the data used via LocoSync in your should be reflected in a corresponding sync action
- Sync actions must applied in the same order across all clients in order for all of them to converge on the same state

### Client Syncing

LocoSync performs the following steps to sync the client to changes from the server, by applying sync actions in order:

1. Check if there if LocoSync data exists locally via the storage adapter
   1. If so, load the data into memory and read the `lastSyncId` from the metadata
   2. Else, call `loadBootstrap`, which returns both a snapshot of the data but also the associated `syncId`
2. Call `initSync` to begin receiving sync actions
   1. A compliant implementation will
      1. Note: some websocket libraries make this guarantee per connection, but check to make sure
   2. Do not apply these sync actions immediately - there could be a gap between the `lastSyncId` from step 1 and the first sync action received (especially when loading from storage)
3. Call `deltaSync` to fetch all of the sync actions between the `lastSyncId` from step 1 and the first
   1. Apply the sync actions returned, followed by those accrued from `initSync` in the mean time
4. Start applying sync actions to storage and to in-memory values, receive changes from server
   1. If `initSync` disconnects, return to step 2, but use the `lastSyncId` from the last sync action received rather than step 1

> Note: Applying a sync action means updating the storage and in-memory representations of the associated data. More details are in the following sections.

Now, the LocoSync client can apply incoming sync actions and stay up-to-date with the server. But how does the client handle changing data itself?

### Mutations

When mutating data in LocoSync, three things happen under the hood:

1. A transaction is save in storage
   1. This can facilitate retries when coming back online, among other things
2. Optimistic changes are applied to the data for instant updates
3. The transaction is sent to the server to mutation
   1. If successful, save the `lastSyncId` of the sync actions produced by the transaction (returned via `sendTransaction` network adapter method)
   2. Otherwise, rollback the transaction locally

Though mutations are applied optimistically on the client, they may be rejected by the server, in which case they should be rolled back. For this reason, optimistic changes are not applied to data that has been confirmed from the server (via one of the network adapter methods), but rather combined before being shown.

Besides failed mutations, pending transactions are actually also rolled back when applying a sync action with a `syncId` greater than the `lastSyncId` of that transaction (from 3 above). This means the sync actions from the server for that transaction have already been applied to the client, so the client can be safely drop the transaction.

### Conflicts

On the client, optimistic changes are applied "on top of" confirmed data, with a last-write-wins convention. When applied at the field level, with models that are not highly nested, collisions can be minimal in most applications. However, the server can implement any desired conflict resolution pattern.

In the future, LocoSync may support custom conflict merging on the client, but most cases can be handled via last-write-wins and additional models to track conflicts.

## Advanced

- (Coming soon) Breaking up application state via incremental loading
- (Coming soon) Schema version support
- (Coming soon) Authorization best practices

## Inspiration

LocoSync was heavily inspired by the videos Linear has released on its own sync engine implementation:

- [Real-time sync for web apps](https://www.youtube.com/watch?v=WxK11RsLqp4&t=2175s)
- [Scaling the Linear Sync Engine](https://www.youtube.com/watch?v=Wo2m3jaJixU)

LocoSync was also influenced by a number of other projects in the local first ecosystem, including:

- [TinyBase](https://tinybase.org/)
- [Automerge](https://automerge.org/)
- [Replicache](https://replicache.dev/)
