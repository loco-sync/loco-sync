---
sidebar_position: 1
---

# Config

A Loco Sync config allows you to customize behavior and fine-tune performance of your application, and consists of the following parts:

#### Required

- `Models` - data types of your application

#### Optional

- `Relationships` - associations between models to build structured query results
- `Mutations` - customize mutations while preserving data-centric benefits
- `Indexes` - specify how model data should be loaded from storage, and optionally via the network
- `Sync Groups` - mechanism to implement custom incremental loading and permissions

> Don't worry about setting all of this up at once, you can incrementally expand your application's config as needed.

## Models

Models are central to Loco Sync and it's config, but what is a model? Models are the domain specific data types of your application. If you are building a Todo App, for example, your models might consist of "Todo", "Author", etc. Models in Loco Sync often correspond to tables in SQL databases or documents in NoSQL databases.

Models are defined as Typescript types. However, a common pattern is to derive model types from existing code in your application, e.g. database schema definitions. See [Derived Models Types](../guides/derived-model-types) for more details. For example's sake here, we will list the types out by hand:

```ts
import { ModelDefs } from '@loco-sync/client';

type M = {
  Todo: {
    id: string;
    text: string;
    authorId: string;
    isDone: boolean;
    likeCount: number;
  };
  Author: {
    id: string;
    name: string;
  };
};
```

> (Coming Soon) In the future, model definitions in Loco Sync will optionally support schemas-as-values to enable automatic version change detection, runtime data validation, and more.

Next, for each model we provide a specific config with some optional values to change how Loco Sync uses them:

```ts
const modelDefs: ModelDefs<M> = {
  Todo: {},
  Author: { preloadFromStorage: true, initialBootstrap: true },
};
```

`initialBootstrap` alters the network loading behavior of a model's data, and `preloadFromStorage` affects the storage loading behavior. See [Incremental Loading](../guides/incremental-loading) for more details.

## Relationships

Defining relationships in your config allows you to query related models and build a structured result. Relationships can be chained together, much like join statements in a SQL query. Best of all, the data returned by a query with relationships will be typed to match the relationship selection. Continuing our example from above, here are some relationship definitions for our Todo App:

```ts
import { one, many, ModelsRelationshipDefs } from '@loco-sync/client';

const relationshipDefs = {
  Todo: {
    author: one('Author', {
      fields: ['authorId'],
      references: ['id'],
    }),
  },
  Author: {
    todos: many('Todo', {
      fields: ['id'],
      references: ['authorId'],
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

type R = typeof relationshipDefs;
```

Below is an example usage of relationships when querying data. See [React Integration](../framework-integrations/react) for more details:

```ts
const { data } = useQueryOne(
  // Model name
  'Todo',
  // Filter
  { id: '1' },
  // Selection based on relationships
  {
    author: {
      todos: {},
    },
  },
);
```

## Mutations

By default, mutations in Loco Sync are a data-centric. In particular, a mutation consists of a set of operations on a model, where an operation is one of a "create", "update", or "delete". Optionally, a custom mutation type can be provided. You can get a long way with data-centric mutations, but there are a few reasons why you may want custom mutations:

- A specific mutations structure is required by your backend
  - e.g. integrating with an existing backend's endpoints
  - e.g. validation is required that is non-trivial to perform with data-centric mutations
- Your application requires operations that are difficult or impossible to handle with concurrent users and data-centric mutations
  - e.g. increment with concurrent users
- You simply want more semantic meaning associated with data changes in your application's code

In order to support optimistic updates, however, Loco Sync must still be able to translate your custom mutation type into the aforementioned data-centric operations. This translation is provided as an implementation of `getChanges`, and is required for configs using custom mutations. Here is an example of the config for custom mutations for our Todo App:

```ts
import { ReadonlyModelDataStore, LocalChanges } from '@loco-sync/client';

type MArgs =
  | {
      type: 'CreateTodo';
      todoId: string;
      authorId: string;
      text: string;
    }
  | {
      type: 'EditTodo';
      todoId: string;
      isDone: boolean;
    }
  | {
      type: 'IncrementTodoLikes';
      todoId: string;
    };

function getChanges(
  args: MArgs,
  store: ReadonlyModelDataStore<M>,
): LocalChanges<M> {
  switch (args.type) {
    case 'CreateTodo': {
      return [
        {
          action: 'create',
          modelName: 'Todo',
          modelId: args.todoId,
          data: {
            id: args.todoId,
            authorId: args.authorId,
            text: args.text,
            isDone: false,
            likeCount: 0,
          },
        },
      ];
    }
    case 'EditTodo': {
      return [
        {
          action: 'update',
          modelName: 'Todo',
          modelId: args.todoId,
          data: {
            isDone: args.isDone,
          },
        },
      ];
    }
    case 'IncrementTodoLikes': {
      const todo = store.getOne('Todo', { id: args.todoId });
      if (!todo) {
        return [];
      }
      return [
        {
          action: 'update',
          modelName: 'Todo',
          modelId: args.todoId,
          data: {
            likeCount: todo.likeCount + 1,
          },
        },
      ];
    }
  }
}
```

> Optimistic, local updates do not need to exactly match the data that your authoritative backend will produce. (e.g. extra "audit" or "history" objects may be created only on the backend, even if still synced to the client)

## Indexes

Indexes are used to load a subset of the data associated with a model, and consist of a name and an array of fields on the associated model. See [Incremental Loading](../guides/incremental-loading) for more details. For the Todo App, we add an index to the "Todo" model:

```ts
const indexes: ModelIndexes<MS> = {
  Todo: [
    {
      name: 'Todo_authorId',
      fields: ['authorId'],
    },
  ],
};
```

## Sync Groups

Sync groups are used to implement permissions and lazy loading of data. Similar to models, sync groups are defined by a Typescript type, though also require an `equals` function. To control which types of model data will be loaded for the sync groups granted to a user, a `lazyBootstrapModels` function is also required. Below is a sync group example in the Todo App:

```ts
type SG =
  | {
      type: 'Admin';
    }
  | {
      type: 'GroupMember';
      groupId: string;
    };

function syncGroupsEqual(a: SG, b: SG): boolean {
  if (a.type === 'Admin') {
    return b.type === 'Admin';
  } else {
    return b.type === 'GroupMember' && a.groupId === b.groupId;
  }
}

function syncGroupLazyBootstrapModels(syncGroup: SG): Array<keyof M> {
  if (syncGroup.type === 'Admin') {
    return [];
  } else {
    return ['Todo'];
  }
}
```

See [Permissions > Authorization](../guides/permissions#authorization) and [Incremental Loading](../guides/incremental-loading) for more details on sync groups.

## Putting It All Together

Putting this all together, a full configuration (with the snippets above) might look like the following:

```ts
import { ModelsConfig } from '@loco-sync/client';

type MS = {
  models: M;
  relationshipDefs: R;
  mutationArgs: MArgs;
  syncGroup: SG;
};

export const config: ModelsConfig<MS> = {
  modelDefs,
  relationshipDefs,
  mutationDefs: {
    getChanges,
  },
  indexes,
  syncGroupDefs: {
    equals: syncGroupsEqual,
    lazyBootstrapModels: syncGroupLazyBootstrapModels,
  },
};
```
