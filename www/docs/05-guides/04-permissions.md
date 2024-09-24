---
sidebar_position: 4
---

# Permissions

Loco Sync does not attempt to implement any permissions as part of the sync engine protocol, but rather provides primitives to implement the required logic of your application.

## Authentication

A new instance of Loco Sync Client should be created for each distinct authenticated user or profile in your application to ensure isolation of sessions. Additionally, `StorageAdapter` implementations may require a unique identifier (e.g. "namespace" in `@loco-sync/idb`). This identifier is typically composed of a user / profile id, org / team / workspace id, or any combination.

Authentication with your backend is also not a concern of Loco Sync, though your implementation of `NetworkAdapter` will likely add authorization cookies, headers, etc. to requests.

## Authorization

Sync groups are a mechanism to facilitate limiting access to only a portion of an application's data. In a literal sense, sync groups are used to filter model data and sync actions. A more useful way to think of sync groups is as "read permissions".

> Using sync groups is entirely optional. If all users of your application should have read access to all data, you probably do not need sync groups.

Loco Sync will become aware of which sync groups the current user has access to when your backend responds on one of a few specific `NetworkAdapter` methods (e.g. `initSync()` handshake, eager `bootstrap()`). These sync groups are saved to client storage, and a lazy bootstrap is initiated for each. Your backend is responsible for actually filtering data using sync groups, however.

#### Constraint and Patterns

- A particular instance of a model (and its sync actions) should be associated with the same sync groups throughout it's lifetime.
- A particular instance of a model can be associated with multiple sync groups, and this is a powerful way to implement more advanced read permission use cases.
  - You likely only want a model associated with one sync group per user, however.

#### Change in Access

- When the sync groups that a user has access to changes, Loco Sync becomes aware via diffing the values from a sync handshake message and those in client storage.
- If a sync group is added, the same process is followed as when initially connecting - a lazy bootstrap is initiated for that sync group, and it is saved to client storage.
- (Coming soon) If a sync group is removed, data stored on the client is dropped and the Loco Sync protocol is restarted.
  - There is no attempt to associate model data with sync groups once stored on the client in order to perform fine-grained removal. This is due to the magnitude of metadata that would be required. Rather, the Loco Sync protocol is designed to be "restartable" in this and other cases (e.g. schema changes).

> Loco Sync may not be a good fit if your application requires very fine-grained and dynamic read permissions. There may be other ways to implement these read permissions, however, so it is worth taking some time to consider alternatives if permissions seem like a deal-breaker.
