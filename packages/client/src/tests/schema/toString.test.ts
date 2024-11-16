import { schema } from '../../index';

describe('Schema Types', () => {
  test('Number', () => {
    const s = schema.number();
    expect(s.toString()).toEqual('number');
  });

  test('String', () => {
    const s = schema.string();
    expect(s.toString()).toEqual('string');
  });

  test('Boolean', () => {
    const s = schema.boolean();
    expect(s.toString()).toEqual('boolean');
  });

  test('Object', () => {
    const s = schema.object({
      a: schema.number(),
      b: schema.string(),
    });
    expect(s.toString()).toEqual('object<a:number,b:string>');
  });

  test('Array', () => {
    const s = schema.array(schema.number());
    expect(s.toString()).toEqual('array<number>');
  });

  test('Nullable', () => {
    const s = schema.nullable(schema.number());
    expect(s.toString()).toEqual('nullable<number>');
  });

  test('Optional', () => {
    const s = schema.optional(schema.string());
    expect(s.toString()).toEqual('optional<string>');
  });

  test('Union', () => {
    const s = schema.union([schema.string(), schema.number()]);
    expect(s.toString()).toEqual('union<string,number>');
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
    expect(s.toString()).toEqual(
      'object<a:array<object<b:string,c:optional<boolean>,d:array<number>>>>',
    );
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
    expect(s.toString()).toEqual(
      'object<a:object<b:object<c:object<d:number>>>>',
    );
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
    expect(s.toString()).toEqual(
      'union<object<a:number,type:literal<"a">>,object<b:string,type:literal<1>>,object<c:boolean,type:literal<true>>>',
    );
  });

  test('Object key order', () => {
    const s1 = schema.object({
      a: schema.number(),
      b: schema.string(),
      c: schema.boolean(),
    });
    const s2 = schema.object({
      c: schema.boolean(),
      b: schema.string(),
      a: schema.number(),
    });
    expect(s1.toString()).toEqual(s2.toString());
  });
});
