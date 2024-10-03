<div align="center">
  <!-- TODO Logo -->
  <!-- <img src="logo.svg" width="200px" align="center" alt="Loco Sync logo" /> -->
  <h1 align="center">Loco Sync</h1>
  <h3 align="center">
    A sync engine for local-first applications.
  </h3>
</div>

## Introduction

Loco Sync is a sync engine for local-first applications, and comes with the expected benefits of instant updates, real-time collaboration, and offline support. Loco Sync's particular approach emphasizes the following:

- Bring your own Backend
- Opt-in configuration to customize behavior and fine-tune performance
- Excellent Typescript integration, especially for dynamic client queries

Using Loco Sync in your project is as simple as:

1. Configure your application by defining models, relationships, mutations, and more.
2. Choose a storage adapter (IndexedDB with `@loco-sync/idb` is a great choice for browser apps).
3. Implement the network interface for your backend.
4. Setup `@loco-sync/react` to query and mutate synced data in your components

**Full documentation can be found at [loco-sync.com](https://loco-sync.com).**

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

## Inspiration

Loco Sync was heavily inspired by the videos Linear has released on its own sync engine implementation:

- [Real-time sync for web apps](https://www.youtube.com/watch?v=WxK11RsLqp4&t=2175s)
- [Scaling the Linear Sync Engine](https://www.youtube.com/watch?v=Wo2m3jaJixU)

Loco Sync was also influenced by a number of other projects in the local first ecosystem, including:

- [Automerge](https://automerge.org/)
- [Replicache](https://replicache.dev/)
- [TinyBase](https://tinybase.org/)
