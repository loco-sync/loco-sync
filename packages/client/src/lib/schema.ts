import type { Result } from './typeUtils';

export abstract class SchemaType<T> {
  _type!: T;

  abstract parse(data: any): Result<T, ParseError[]>;
  abstract toString(): string;

  optional(): SchemaOptional<this> {
    return SchemaOptional.create(this);
  }

  nullable(): SchemaNullable<this> {
    return SchemaNullable.create(this);
  }

  array(): SchemaArray<this> {
    return SchemaArray.create(this);
  }

  protected addPathToErrors(path: string, errors: ParseError[]): ParseError[] {
    return errors.map((e) => ({
      path: e.path ? `${path}.${e.path}` : path,
      message: e.message,
    }));
  }
}

export type AnyType = SchemaType<any>;
export type RawShape = { [key: string]: AnyType };
export type infer<T extends AnyType> = T['_type'];

export type ParseError = {
  path?: string;
  message: string;
};

// object types
type identity<T> = T;
type flatten<T> = identity<{ [k in keyof T]: T[k] }>;
type baseObjectOutputType<Shape extends RawShape> = {
  [k in keyof Shape]: Shape[k]['_type'];
};

type optionalKeys<T extends object> = {
  [k in keyof T]: undefined extends T[k] ? k : never;
}[keyof T];
type requiredKeys<T extends object> = {
  [k in keyof T]: undefined extends T[k] ? never : k;
}[keyof T];
type addQuestionMarks<T extends object, _O = any> = {
  [K in requiredKeys<T>]: T[K];
} & {
  [K in optionalKeys<T>]?: T[K];
} & { [k in keyof T]?: unknown };

type objectOutputType<Shape extends RawShape> = flatten<
  addQuestionMarks<baseObjectOutputType<Shape>>
>;

export class SchemaObject<Shape extends RawShape> extends SchemaType<
  objectOutputType<Shape>
> {
  #shape: Shape;
  #enumerateShapeResult: { key: string; valueType: AnyType }[] | undefined;

  private enumerateShape(): { key: string; valueType: AnyType }[] {
    if (this.#enumerateShapeResult) {
      return this.#enumerateShapeResult;
    }

    const result: { key: string; valueType: AnyType }[] = [];
    const shape = this.#shape;
    const shapeKeys = Object.keys(shape).sort();
    for (const key of shapeKeys) {
      const valueType = shape[key];
      if (!valueType || !(valueType instanceof SchemaType)) {
        continue;
      }
      result.push({ key, valueType });
    }

    this.#enumerateShapeResult = result;
    return result;
  }

  parse(data: any): Result<this['_type'], ParseError[]> {
    const type = getParsedType(data);
    if (type !== 'object') {
      return {
        ok: false,
        error: [
          {
            message: 'Expected object',
          },
        ],
      };
    }

    const result = {} as this['_type'];
    const errors: ParseError[] = [];
    for (const { key, valueType } of this.enumerateShape()) {
      const value = valueType.parse(data[key]);
      if (!value.ok) {
        errors.push(
          ...value.error.map((e) => ({
            path: e.path ? `${key}.${e.path}` : key,
            message: e.message,
          })),
        );
      } else {
        result[key as keyof this['_type']] = value.value;
      }
    }

    if (errors.length > 0) {
      return { ok: false, error: errors };
    }
    return { ok: true, value: result };
  }

  toString(): string {
    const shapeHashes = this.enumerateShape().map(({ key, valueType }) => {
      return `${key}:${valueType.toString()}`;
    });
    return `object<${shapeHashes.join(',')}>`;
  }

  constructor(shape: Shape) {
    super();
    this.#shape = shape;
  }

  static create = <Shape extends RawShape>(
    shape: Shape,
  ): SchemaObject<Shape> => {
    return new SchemaObject(shape);
  };
}

export class SchemaNumber extends SchemaType<number> {
  parse(data: any): Result<number, ParseError[]> {
    const type = getParsedType(data);
    if (type !== 'number') {
      return {
        ok: false,
        error: [
          {
            message: 'Expected number',
          },
        ],
      };
    }
    return { ok: true, value: data };
  }

  toString(): string {
    return 'number';
  }

  constructor() {
    super();
  }

  static create = (): SchemaNumber => {
    return new SchemaNumber();
  };
}

export class SchemaString extends SchemaType<string> {
  parse(data: any): Result<string, ParseError[]> {
    const type = getParsedType(data);
    if (type !== 'string') {
      return {
        ok: false,
        error: [
          {
            message: 'Expected string',
          },
        ],
      };
    }
    return { ok: true, value: data };
  }

  toString(): string {
    return 'string';
  }

  constructor() {
    super();
  }

  static create = (): SchemaString => {
    return new SchemaString();
  };
}

export class SchemaBoolean extends SchemaType<boolean> {
  parse(data: any): Result<boolean, ParseError[]> {
    const type = getParsedType(data);
    if (type !== 'boolean') {
      return {
        ok: false,
        error: [
          {
            message: 'Expected boolean',
          },
        ],
      };
    }
    return { ok: true, value: data };
  }

  toString(): string {
    return 'boolean';
  }

  constructor() {
    super();
  }

  static create = (): SchemaBoolean => {
    return new SchemaBoolean();
  };
}

export class SchemaArray<T extends AnyType> extends SchemaType<T['_type'][]> {
  #innerSchemaType: T;

  parse(data: any): Result<this['_type'][], ParseError[]> {
    const type = getParsedType(data);
    if (type !== 'array') {
      return {
        ok: false,
        error: [
          {
            message: 'Expected array',
          },
        ],
      };
    }

    const result: T['_type'][] = [];
    const errors: ParseError[] = [];

    let index = 0;
    for (const item of data) {
      const value = this.#innerSchemaType.parse(item);
      if (!value.ok) {
        errors.push(...this.addPathToErrors(index.toString(), value.error));
      } else {
        result.push(value.value);
      }

      index++;
    }

    if (errors.length > 0) {
      return { ok: false, error: errors };
    }
    return { ok: true, value: result };
  }

  toString(): string {
    return `array<${this.#innerSchemaType.toString()}>`;
  }

  constructor(innerSchemaType: T) {
    super();
    this.#innerSchemaType = innerSchemaType;
  }

  static create = <T extends AnyType>(valueType: T): SchemaArray<T> => {
    return new SchemaArray(valueType);
  };
}

export class SchemaNullable<T extends AnyType> extends SchemaType<
  T['_type'] | null
> {
  #innerSchemaType: T;

  parse(data: any): Result<T['_type'] | null, ParseError[]> {
    const type = getParsedType(data);
    if (type === 'null') {
      return { ok: true, value: null };
    }

    return this.#innerSchemaType.parse(data);
  }

  toString(): string {
    return `nullable<${this.#innerSchemaType.toString()}>`;
  }

  constructor(innerSchemaType: T) {
    super();
    this.#innerSchemaType = innerSchemaType;
  }

  static create = <T extends AnyType>(
    innerSchemaType: T,
  ): SchemaNullable<T> => {
    return new SchemaNullable(innerSchemaType);
  };
}

export class SchemaOptional<T extends AnyType> extends SchemaType<
  T['_type'] | undefined
> {
  #innerSchemaType: T;

  parse(data: any): Result<T['_type'] | undefined, ParseError[]> {
    const type = getParsedType(data);
    if (type === 'undefined') {
      return { ok: true, value: undefined };
    }

    return this.#innerSchemaType.parse(data);
  }

  toString(): string {
    return `optional<${this.#innerSchemaType.toString()}>`;
  }

  constructor(innerSchemaType: T) {
    super();
    this.#innerSchemaType = innerSchemaType;
  }

  static create = <T extends AnyType>(
    innerSchemaType: T,
  ): SchemaOptional<T> => {
    return new SchemaOptional(innerSchemaType);
  };
}

type SchemaUnionType = Readonly<[AnyType, ...AnyType[]]>;

export class SchemaUnion<T extends SchemaUnionType> extends SchemaType<
  T[number]['_type']
> {
  #innerSchemaTypes: T;

  parse(data: any): Result<T[number]['_type'], ParseError[]> {
    const errors: ParseError[] = [];
    for (const innerSchemaType of this.#innerSchemaTypes) {
      const value = innerSchemaType.parse(data);
      if (value.ok) {
        return value;
      }

      errors.push(...value.error);
    }

    return { ok: false, error: errors };
  }

  toString(): string {
    return `union<${this.#innerSchemaTypes
      .map((t) => t.toString())
      .join(',')}>`;
  }

  constructor(innerSchemaTypes: T) {
    super();
    this.#innerSchemaTypes = innerSchemaTypes;
  }

  static create = <T extends SchemaUnionType>(
    innerSchemaTypes: T,
  ): SchemaUnion<T> => {
    return new SchemaUnion(innerSchemaTypes);
  };
}

export class SchemaLiteral<
  T extends string | number | boolean,
> extends SchemaType<T> {
  #value: T;

  parse(data: any): Result<T, ParseError[]> {
    if (data === this.#value) {
      return { ok: true, value: data };
    }

    return {
      ok: false,
      error: [
        {
          message: `Expected literal ${this.#value}`,
        },
      ],
    };
  }

  toString(): string {
    if (typeof this.#value === 'string') {
      return `literal<"${this.#value}">`;
    }
    return `literal<${this.#value}>`;
  }

  constructor(value: T) {
    super();
    this.#value = value;
  }

  static create = <T extends string | number | boolean>(
    value: T,
  ): SchemaLiteral<T> => {
    return new SchemaLiteral(value);
  };
}

type ParsedType =
  | 'undefined'
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'null'
  | 'object'
  | 'unknown';

const getParsedType = (data: any): ParsedType => {
  const t = typeof data;

  switch (t) {
    case 'undefined':
      return 'undefined';

    case 'string':
      return 'string';

    case 'number':
      return 'number';

    case 'boolean':
      return 'boolean';

    case 'object':
      if (Array.isArray(data)) {
        return 'array';
      }
      if (data === null) {
        return 'null';
      }
      return 'object';

    default:
      return 'unknown';
  }
};

const object = SchemaObject.create;
const number = SchemaNumber.create;
const boolean = SchemaBoolean.create;
const string = SchemaString.create;
const array = SchemaArray.create;
const nullable = SchemaNullable.create;
const optional = SchemaOptional.create;
const union = SchemaUnion.create;
const literal = SchemaLiteral.create;

export {
  object,
  number,
  boolean,
  string,
  array,
  nullable,
  optional,
  union,
  literal,
};
