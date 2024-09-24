---
sidebar_position: 3
---

# Network

A Loco Sync application must communicate to an authoritative backend to:

- fetch application state
- keep application state in sync
- send client changes to application state

Implementing a `NetworkAdapter` that communicates with your application's backend allows `LocoSyncClient` to accomplish the above.

## NetworkAdapter Interface

The following methods must be implemented on a network adapter. The implementation details will depend heavily on your backend. For an in-depth guide on how to add the require functionality to an existing backend or build one from scratch, see [Bring your own Backend](../guides/bring-your-own-backend).

### bootstrap

`NetworkAdapter.bootstrap()` should return data associated with specified models. A bootstrap request comes in two types - eager and lazy. The distinction is not usually important for implementing this method, though a lazy bootstrap is also associated with a sync group. If using sync groups in your application, then your backend should check for a user's access to the provided sync group before returning the associated model data.

### initSync

`NetworkAdapter.initSync()` should initiate a connection to your backend to receive syncs. This method will be called with a listener function that should be called with certain message types, though some may not be relevant for all types of implementations. This method should returns an unsubscribe function. If sync is implemented via a stateful connection to the backend (e.g. if using WebSockets) this unsubscribe function should close that connection. If sync is implemented via polling, then it should stop the related interval callback.

### deltaSync

`NetworkAdapter.deltaSync()` should return the sync actions between the provided syncIds - `fromSyncId` (exclusive) and `toSyncId` (inclusive). This method is part of how Loco Sync ensures all updates are applied in the same order on the client, and thus the same final state is achieved.

### sendTransaction

`NetworkAdapter.sendTransaction()` will be called when a mutation is called. The parameters are the same that the mutation was called with - either the default type, or a custom type provided in the config. This method should send these mutations as a single, transactional request to your backend. In case of success, the associated `lastSyncId` should be returned. In case of failure, the appropriate type of error should be returned. If using custom mutations, this method will usually use a switch statement on the mutation type and call each respective endpoint.
