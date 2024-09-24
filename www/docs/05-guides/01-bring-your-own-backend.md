---
sidebar_position: 1
---

# Bring Your Own Backend

One of the guiding principles of Loco Sync is to work with any backend that implements the expected network interface, rather than a particular tech stack, library, or hosted service. Below is a guide on how exactly to "bring your own backend" - requirements and tips on how to implement a compliant Loco Sync backend.

## Storing Sync Actions

#### Requirements

- Sync actions must have a total ordering of events (i.e. `syncId` throughout the APIs and documentation).
- Range-based filtering on `syncId` should be available for implementing delta sync.
- If using sync groups, some association with sync actions will be necessary for filtering on bootstraps and syncing. The ability to associate a sync action with multiple sync groups is most flexible if advanced permissions cases are required.

#### Tips

- If using a SQL database, store sync actions in a table with an auto-incrementing id, with a many-to-many relationship to a sync group table

## Mutations

#### Requirements

- Each mutation should alter model data as well create related sync actions.
  - The returned `lastSyncId` should be the greatest `syncId` value of the created sync actions.
- Edits to model data and creation of sync actions must happen in a single transaction. This transaction must have an isolation level of at least Snapshot Isolation.
  - This is necessary to ensure consistency between bootstrap (model data) and subsequent sync actions.

#### Tips

- Integrate the creation of sync actions into the data layer of your backend (e.g. repositories).
- There may be benefits to using Serializable Isolation due to it's fail-fast approach depending on the details of propagating syncs to clients

## Propagating Sync

#### Requirements

- Sync actions must be propagated to the client in order based on `syncId` without gaps.

#### Tips

- There are multiple options for propagating syncs at a network protocol level, including WebSockets, SSE, polling, and more.
- Polling is the easiest to start with for a POC.
- A stateful connection (e.g. WebSockets or SSE) will provide lower latency for real-time collaboration.
  - Due to bi-directional messaging capabilities, WebSockets have an advantage in terms of keeping the door open for sending ephemeral data in the future (though this is not currently a feature of Loco Sync).
- If using a stateful connection to backend, polling sync actions at a short interval from the database and filtering those messages to connected clients based on auth is suggested.
  - However, care must be taken to ensure your polling method does not skip any sync actions under transaction race conditions.

## Resources

[Scaling the Linear Sync Engine](https://www.youtube.com/watch?v=Wo2m3jaJixU) discusses many of the details of Linear's own backend.
