---
sidebar_position: 3
---

# Incremental Loading

A naive implementation of a sync engine might load all application state from the backend to the client (storage and in-memory), then sync all subsequent changes. In real production applications, this approach is often a non-starter due to the size of application data for a couple of different reasons:

- the initial load of data from backend to client could take too long, or the amount of data could be too much to save to the client storage
- similarly, client storage can have more data than would be performant to load into client memory

To solve this problem, Loco Sync allows customization of how application data is loaded, both from the backend and from client storage. This can be set in your application's [config per model](../loco-sync-client/config#models).

## Network Loading

There are three ways Loco Sync supports loading model data over the network, each with it's own tradeoffs.

> In theory, data of a certain model can be loaded over the network via multiple methods. Double check that this makes sense from a [Permissions](./permissions) perspective for your application.

### Eager Bootstrap

Eager bootstrap is a network loading method used to load data before launching your application, and is most similar to the "naive" implementation mentioned above. It is run once _ever_ per Loco Sync instance, and until the eager bootstrap is completed no data will be emitted to query listeners.

To include a model in the eager bootstrap, set `initialBootstrap` to true in it's config, and handle the model data from your backend's bootstrap endpoint:

```ts
import { ModelsConfig } from '@loco-sync/client';

const config: ModelsConfig<MS> = {
  modelDefs: {
    Todo: { initialBootstrap: true },
  },
};
```

Eager bootstrap should be used to load essential application data that is used by many parts of your application. Examples include high-level organizational constructs like "Groups" or "Teams", or other models that serve as anchor point in your application. It may also make sense to eagerly bootstrap models that are sufficiently limited in scope, e.g. "User Settings".

### Lazy Bootstrap via Sync Groups

The lazy bootstrap method is very similar to the eager one, with two notable exceptions: it does not block the initial load of the application, and each request is associated with a sync group.

To include a model in the lazy bootstrap for a sync group, return it from `lazyBootstrapModels` when called with the sync group, and handle the model data from your backend's bootstrap endpoint:

```ts
import { ModelsConfig } from '@loco-sync/client';

const config: ModelsConfig<MS> = {
  modelDefs: {
    Todo: {},
  },
  syncGroupDefs: {
    lazyBootstrapModels: () => ['Todo'],
  },
};
```

Lazy bootstrap should be used to load data that is not fetched by the eager bootstrap, or is dependent on a user's access to a sync group.

> Loco Sync does not currently support prioritized loading of sync groups. This may be added in the future to load immediately relevant data faster, e.g. based on what screen a user is viewing in the application.

### Index Loading (Coming Soon)

Loading model data over the network via indexes is not yet supported, but is one of the highest priority features on the Loco Sync roadmap. Index loading will work conceptually similarly to [index loading from client storage](#index-loading) in terms of triggering based on user queries.

## Storage Loading

While loading data from client storage into client memory is typically much faster than loading data from backend to client, loading all data into memory can quickly cause performance issues. There are two ways to customize behavior of loading data from storage into memory.

### Index Loading

The primary use of [indexes](../loco-sync-client/config#indexes) is to filter model data when loading from storage. When model data is required to form a query result (either from the base model or due to a relationship selection), the required keys are matched against that model's indexes. If a match is found, that index and the related filter values will be passed to `StorageAdapter.loadModelData()`, and only data matching that criteria will be returned.

> If no indexes exist for a model or the applied filters / relationships do not match an index, all data for that model will be loaded into memory.

### Preload

Sometimes all data for a certain model should always be loaded into memory, regardless of user queries. In this case, set `preloadFromStorage` in the model config:

```ts
import { ModelsConfig } from '@loco-sync/client';

const config: ModelsConfig<M> = {
  modelDefs: {
    Todo: { preloadFromStorage: true },
  },
};
```
