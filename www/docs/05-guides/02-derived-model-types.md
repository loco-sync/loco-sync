---
sidebar_position: 2
---

# Derived Model Types

The "default" way to define model types in Loco Sync is via hand-written Typescript types. In many real applications, however, this would be error prone or impractical. Below are a couple of examples of how to derive model types from common libraries you might already be using in your application.

## Zod

```ts
import { z } from 'zod';

const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  authorId: z.string(),
  isDone: z.boolean(),
  likeCount: z.integer(),
});

type M = {
  Todo: z.infer<typeof TodoSchema>;
};
```

## Drizzle ORM

```ts
import { integer, pgTable, uuid, text, boolean } from 'drizzle-orm/pg-core';

export const Todo = pgTable('todo', {
  id: uuid('id').notNull().primaryKey(),
  authorId: uuid('author_id').notNull(),
  text: text('text').notNull(),
  isDone: boolean('is_done').notNull(),
  likeCount: integer('like_count').notNull(),
});

type M = {
  Todo: typeof users.$inferSelect;
};
```

<!-- Prisma? -->

<!-- OpenAPI definitions? -->
