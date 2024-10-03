---
sidebar_position: 1
---

# React Integration

Setup Loco Sync in React, using a config, storage adapter, and network adapter:

```tsx
import { LocoSyncClient } from '@loco-sync/client';
import { createLocoSyncReact } from '@loco-sync/react';

const { Provider, useMutation, useQuery, useQueryOne } =
  createLocoSyncReact(config);

const client = new LocoSyncClient({
  config,
  storage,
  network,
});

export function App() {
  return (
    <Provider client={client}>{/* Put the rest of your app here */}</Provider>
  );
}
```

Then, use the other hooks returned by `createLocoSyncReact` in your components:

<!-- TODO: Use Mutations -->

```tsx
function Page({ authorId, todoId }: { authorId: string; todoId: string }) {
  const author = useQueryOne(
    'Author',
    { id: authorId },
    {
      todos: {},
    },
  );

  const mutation = useMutation();

  return (
    <div>
      {author?.name}
      {author?.todos.map((t) => <div key={t.id}>{t.text}</div>)}
    </div>
  );
}
```

Notice the third parameter of `useQueryOne`: `todos` is one of the `relationshipDefs` defined above for the `"Author"` model. The types returned from the hook match the structure passed in.

<!-- Describe all of the return values of createLocoSyncReact -->

<!-- Filtering (just "inArray" for now) -->
