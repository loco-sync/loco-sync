export type Result<T, E = any> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type Simplify<AnyType> = _Simplify<AnyType, { deep: true }, Date>;

// type _Simplify<AnyType, Options extends SimplifyOptions = {}> = Flatten<AnyType> extends AnyType ? Flatten<AnyType, Options> : AnyType;

type _Simplify<
  AnyType,
  Options extends SimplifyOptions = {},
  HaltType = never,
> = AnyType extends HaltType
  ? AnyType
  : Flatten<AnyType> extends AnyType
  ? Flatten<AnyType, Options, HaltType>
  : AnyType;

interface SimplifyOptions {
  /**
    Do the simplification recursively.
  
    @default false
    */
  deep?: boolean;
}

type Flatten<
  AnyType,
  Options extends SimplifyOptions = {},
  HaltType = never,
> = Options['deep'] extends true
  ? {
      [KeyType in keyof AnyType]: _Simplify<
        AnyType[KeyType],
        Options,
        HaltType
      >;
    }
  : {
      [KeyType in keyof AnyType]: AnyType[KeyType];
    };
