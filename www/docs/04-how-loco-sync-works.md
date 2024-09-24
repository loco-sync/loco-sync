---
sidebar_position: 4
---

# How Loco Sync Works

## Sync Actions

The main building block of the sync engine is the sync action. A sync action is an action on a particular instance of a model. In particular, an action is `"insert"`, `"update"`, or `"delete"`, and the model instance is recognized by the combination of `modelName`, and `modelId`. The order of sync actions is defined by its `syncId`, which you can think of as an auto-incrementing sequence.

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

Sync actions are created by an authoritative backend. Every change to synced data in your application should be reflected in a corresponding sync action.

Sync actions must applied in the same order across all clients to ensure all of them to converge on the same state. The next section describes how this is guaranteed.

## Syncing Protocol

The following steps are performed to sync the client with changes from the backend, by ensuring sync actions are applied in the correct order:

1. Check if Loco Sync data exists locally via the storage adapter
   1. If so, load the data into memory and read the `lastSyncId` from the metadata
   2. Else, call `bootstrap`, which returns both a snapshot of the data but also the associated `syncId`
2. Call `initSync` to begin receiving sync actions
   1. Do not apply these sync actions immediately - there could be a gap between the `lastSyncId` from step 1 and the first sync action received (especially when loading from storage)
3. Call `deltaSync` to fetch all of the sync actions between the `lastSyncId` from step 1 and the first
   1. Apply the sync actions returned, followed by those accrued from `initSync` in the mean time
4. Start applying sync actions to storage and to in-memory values, receive changes from server
   1. If `initSync` disconnects, return to step 2, but use the `lastSyncId` from the last sync action received rather than step 1

> Applying a sync action means updating the storage and in-memory representations of the associated data.

## Mutations

When mutating data, three important things happen:

1. A transaction is save in storage
   1. This can facilitate retries when coming back online
2. Optimistic changes are applied to the data for instant updates
3. The transaction is sent to the server to mutation
   1. If successful, save the `lastSyncId` of the sync actions produced by the transaction (returned via `sendTransaction` network adapter method)
   2. Otherwise, rollback the transaction locally

Though mutations are applied optimistically on the client, they may be rejected by the server. In that case, they are be rolled back. For this reason, optimistic changes are not applied to data that has been confirmed from the server (via one of the network adapter methods), but rather combined before being shown.

Besides failed mutations, pending transactions are actually also rolled back when applying a sync action with a `syncId` greater than the `lastSyncId` of that transaction (from 3 above). This means the sync actions from the server for that transaction have already been applied to the client, so the client can be safely drop the transaction.

### Conflicts

On the client, optimistic changes are rebased with confirmed data. If multiple actions affect the same data, conflicts are handled with a last-write-wins convention by default. When applied at the field level with models that are not highly nested, collisions can be minimal in most applications. However, the server can implement any desired conflict resolution pattern. Most cases can be handled via last-write-wins and additional models to track conflicts, but Loco Sync also support custom conflict merging on the client via [custom mutations](./loco-sync-client/config#mutations).
