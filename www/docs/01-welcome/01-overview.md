---
sidebar_position: 1
---

# Overview

Loco Sync is a sync engine for local-first applications. The goal is to enable user experiences with instant updates, real-time collaboration, and offline support while reducing the engineering effort on common concerns such as networking, storage, and caching.

Unlike other local-first libraries, Loco Sync is not focused on peer-to-peer collaboration, but rather assumes the usage of an authoritative backend as a source-of-truth. While not suitable for all local-first applications, this has a number of benefits and can help provide a smooth transition when moving existing applications onto Loco Sync. And since every application is different, it is a priority to provide customizable support for concerns such as incremental loading and permissions to support a wide-array of real-life use cases.

In following with the focus on engineering benefits, Loco Sync seeks to provide a seamless experience with Typescript. Loco Sync takes a model-focused approach, where each piece of synced data is associated with a Typescript type, as well as additional, optional configuration.

The main components of Loco Sync are:

1. The Loco Sync Client, which facilitates the syncing protocol
2. A storage adapter for storing data locally on the client device
3. A network adapter connecting the Loco Sync Client to your backend

The following steps are necessary to start using Loco Sync in your project:

1. Setup your config
   1. Define models
   2. (Optional) Define relationships, indexes, custom mutations, and sync groups
2. Choose a storage adapter:
   1. `@loco-sync/idb` implements the storage adapter interface for IndexedDB, a great choice for browser apps
   2. (Optional) Implement your own storage adapter to meet your needs
3. Implement the network adapter interface (and bring your own backend)
4. (Optional) Hook into your view framework:
   1. `@loco-sync/react` provides hook adapters for React to query and mutate data inside of components
