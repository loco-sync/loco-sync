---
sidebar_position: 2
---

# Storage

In local-first applications, data is stored on the client's device to facilitate near-instant load times and offline support. In Loco Sync, the `StorageAdapter` interface is used to store synced data, pending transactions, and additional metadata.

## IndexedDB

IndexedDB is a great choice for storage in browser local-first applications. An implementation of the `StorageAdapter` using IndexedDB is provided by `@loco-sync/idb`.

```ts
import { createLocoSyncIdbAdapter } from '@loco-sync/idb';
import { config } from './my-loco-sync-config';

const storage = createLocoSyncIdbAdapter<MS>('namespace', config);
```

The first parameter of `createLocoSyncIdbAdapter` is a "namespace" to identify and isolate sessions on the same client device. See [Permissions > Authentication](../guides/permissions#authentication) for more details.

Data versioning must currently also be handled via the `createLocoSyncIdbAdapter` "namespace". In other words, by including a "version" in the namespace value, data saved locally in the old format and the new format will not be mixed when your applications's schema changes. There are plans to remove this requirement with model schemas to automatically detect schema changes.

## Implement Your Own

Any object implementing the `StorageAdapter` interface can be passed to a `LocoSyncClient` instance.
