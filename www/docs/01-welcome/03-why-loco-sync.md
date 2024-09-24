---
sidebar_position: 3
sidebar_label: Why Loco Sync?
---

# Why Loco Sync?

Using a sync engine and building a local-first application can feel very different from more traditional ways of building web applications. Is the change really worth it? Let's review some of the benefits of local-first applications in general, and Loco Sync in particular.

## Local-first Benefits

Local-first applications powered by sync engines come with a wide-array of benefits, but arguably the most compelling are the improvements to user experience. The following is a short list of the improvements that are downstream of storing data on the client device and eagerly syncing data changes to the client:

- Near-instant load times
- Instant, optimistic updates
- Real-time collaboration between users
- Offline mode / increased robustness with spotty network connections

The benefits of a sync engine are not limited to user experience. The following are developer experience improvements often seen in projects using them:

- No more networking or caching code in your application's frontend
- Backend query endpoints are unnecessary for synced data

If the above improvements sound compelling, building an application with a sync engine may make sense for you. There are many projects in the local-first ecosystem, however. Next, we'll explore the types of application that Loco Sync seeks to help build, and the unique benefits of its approach.

## Centralized Authority

A Loco Sync application requires a centralized, authoritative backend. While the data-ownership goals of the local-first movement are quite compelling, there are and will remain countless applications that require an authoritative backend. Loco Sync leans into this architecture. In doing so, simpler solutions to some of the hardest parts of local-fist applications (permissions, schema versioning) can be built more seamlessly.

> If you wish to build a peer-to-peer application, a project like [Automerge](https://automerge.org/) will be a better fit.

## Backend Flexibility

While Loco Sync assumes that an application will have an authoritative backend, the assumptions about that backend are kept to a minimum. Rather, a network interface is specified and used in the syncing protocol. This is in contrast to many other local-fist projects, which require either a particular database or even the use of a hosted service. Rather than being limited to the APIs of these services and expressiveness of these databases, use the tech stack you want and write the important logic of your backend in code - no more implementing permissions in another DSL!

An additional benefit of this approach is incremental and partial adoption of Loco Sync in existing applications. Safely try a sync engine with the features that would benefit the most, and expand your usage over time if desired.

## Additional Features

### Model Based

All application data in Loco Sync is associated with a "model" of a type / schema. Besides being useful for type-checking, this powers more advanced features.

### Client Relationships

Most application data is inherently relational, especially when building UIs. Loco Sync embraces this by allowing the creation of relationships between models. Queries of data may select relationships to include in the result (along with nested relationship from the related model, and so on). Best of all, the results will be have complete types based on all of the models involved. See [Config > Relationships](../loco-sync-client/config#relationships) for more details on how to set up relationships in your application.

### Custom Mutations

Loco Sync supports both data-centric mutations based on your application's models and custom mutations defined by your application. Custom mutations can be used to preserve the semantic meaning of user actions across your entire application stack, but can be also be used to implement arbitrary conflict resolution logic and to ease the transition to Loco Sync with an existing backend. See [Config > Mutations](../loco-sync-client/config#relationships) for more details on how to set up custom mutations in your application.
