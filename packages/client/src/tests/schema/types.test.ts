import { expectTypeOf } from 'vitest';
import { schema } from '../../index';

describe('Schema Types', () => {
  test('Number', () => {
    const s = schema.number();
    expectTypeOf(1).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf('1').not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf({
      a: 1,
    }).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Object', () => {
    const s = schema.object({
      a: schema.number(),
      b: schema.string(),
    });
    expectTypeOf({
      a: 1,
      b: 'string',
    }).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf({
      a: 1,
    }).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Array', () => {
    const s = schema.array(schema.number());
    expectTypeOf([1, 2, 3]).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf([1, '2', 3]).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('String', () => {
    const s = schema.string();
    expectTypeOf('1').toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf({
      a: '1',
    }).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf([]).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Boolean', () => {
    const s = schema.boolean();
    expectTypeOf(true).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf({
      a: true,
    }).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Nullable', () => {
    const s = schema.nullable(schema.number());
    expectTypeOf(null).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf('1').not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(undefined).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Optional', () => {
    const s = schema.optional(schema.string());
    expectTypeOf(undefined).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf('1').toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(null).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Union', () => {
    const s = schema.union([schema.string(), schema.number()]);
    expectTypeOf('1').toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(1).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf(true).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Complex 1', () => {
    const s = schema.object({
      a: schema.array(
        schema.object({
          b: schema.string(),
          c: schema.boolean().optional(),
          d: schema.number().array(),
        }),
      ),
    });
    expectTypeOf({ a: [] }).toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf({ a: [{}] }).not.toMatchTypeOf<schema.infer<typeof s>>();
    expectTypeOf({ a: [{ b: 'string', d: [1] }] }).toMatchTypeOf<
      schema.infer<typeof s>
    >();
  });

  test('Complex 2', () => {
    const s = schema.object({
      a: schema.object({
        b: schema.object({
          c: schema.object({
            d: schema.number(),
          }),
        }),
      }),
    });
    expectTypeOf({ a: { b: { c: { d: 1 } } } }).toMatchTypeOf<
      schema.infer<typeof s>
    >();
    expectTypeOf({ a: {} }).not.toMatchTypeOf<schema.infer<typeof s>>();
  });

  test('Complex 3', () => {
    const s = schema.union([
      schema.object({
        type: schema.literal('a'),
        a: schema.number(),
      }),
      schema.object({
        type: schema.literal(1),
        b: schema.string(),
      }),
      schema.object({
        type: schema.literal(true),
        c: schema.boolean(),
      }),
    ]);
    expectTypeOf({ type: 'a' as const, a: 1 }).toMatchTypeOf<
      schema.infer<typeof s>
    >();
    expectTypeOf({ type: 1 as const, b: '1' }).toMatchTypeOf<
      schema.infer<typeof s>
    >();
    expectTypeOf({ type: true as const, c: true }).toMatchTypeOf<
      schema.infer<typeof s>
    >();

    // Type is string, not literal value
    expectTypeOf({ type: 'a', a: 1 }).not.toMatchTypeOf<
      schema.infer<typeof s>
    >();
    expectTypeOf({ type: 'type' }).not.toMatchTypeOf<schema.infer<typeof s>>();
  });
});
