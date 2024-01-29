# LocoSync

LocoSync is a sync engine to power local-first applications.

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
  - Initiates a connection to receive periodic syncs.
- sendTransaction
  - Sends a transaction, or mutation, to the server

TODO: Explain sync actions

## React Adapter

TODO

## How LocoSync Works

TODO

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
