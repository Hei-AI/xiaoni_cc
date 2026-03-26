
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model GroupChatSetting
 * 
 */
export type GroupChatSetting = $Result.DefaultSelection<Prisma.$GroupChatSettingPayload>
/**
 * Model PrivateChatSetting
 * 
 */
export type PrivateChatSetting = $Result.DefaultSelection<Prisma.$PrivateChatSettingPayload>
/**
 * Model AgentInboundMessage
 * 
 */
export type AgentInboundMessage = $Result.DefaultSelection<Prisma.$AgentInboundMessagePayload>

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more GroupChatSettings
 * const groupChatSettings = await prisma.groupChatSetting.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  const U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more GroupChatSettings
   * const groupChatSettings = await prisma.groupChatSetting.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.groupChatSetting`: Exposes CRUD operations for the **GroupChatSetting** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GroupChatSettings
    * const groupChatSettings = await prisma.groupChatSetting.findMany()
    * ```
    */
  get groupChatSetting(): Prisma.GroupChatSettingDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.privateChatSetting`: Exposes CRUD operations for the **PrivateChatSetting** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PrivateChatSettings
    * const privateChatSettings = await prisma.privateChatSetting.findMany()
    * ```
    */
  get privateChatSetting(): Prisma.PrivateChatSettingDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.agentInboundMessage`: Exposes CRUD operations for the **AgentInboundMessage** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AgentInboundMessages
    * const agentInboundMessages = await prisma.agentInboundMessage.findMany()
    * ```
    */
  get agentInboundMessage(): Prisma.AgentInboundMessageDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.19.2
   * Query Engine version: c2990dca591cba766e3b7ef5d9e8a84796e47ab7
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import Bytes = runtime.Bytes
  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    GroupChatSetting: 'GroupChatSetting',
    PrivateChatSetting: 'PrivateChatSetting',
    AgentInboundMessage: 'AgentInboundMessage'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "groupChatSetting" | "privateChatSetting" | "agentInboundMessage"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      GroupChatSetting: {
        payload: Prisma.$GroupChatSettingPayload<ExtArgs>
        fields: Prisma.GroupChatSettingFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GroupChatSettingFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GroupChatSettingFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>
          }
          findFirst: {
            args: Prisma.GroupChatSettingFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GroupChatSettingFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>
          }
          findMany: {
            args: Prisma.GroupChatSettingFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>[]
          }
          create: {
            args: Prisma.GroupChatSettingCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>
          }
          createMany: {
            args: Prisma.GroupChatSettingCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GroupChatSettingCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>[]
          }
          delete: {
            args: Prisma.GroupChatSettingDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>
          }
          update: {
            args: Prisma.GroupChatSettingUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>
          }
          deleteMany: {
            args: Prisma.GroupChatSettingDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GroupChatSettingUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.GroupChatSettingUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>[]
          }
          upsert: {
            args: Prisma.GroupChatSettingUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupChatSettingPayload>
          }
          aggregate: {
            args: Prisma.GroupChatSettingAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGroupChatSetting>
          }
          groupBy: {
            args: Prisma.GroupChatSettingGroupByArgs<ExtArgs>
            result: $Utils.Optional<GroupChatSettingGroupByOutputType>[]
          }
          count: {
            args: Prisma.GroupChatSettingCountArgs<ExtArgs>
            result: $Utils.Optional<GroupChatSettingCountAggregateOutputType> | number
          }
        }
      }
      PrivateChatSetting: {
        payload: Prisma.$PrivateChatSettingPayload<ExtArgs>
        fields: Prisma.PrivateChatSettingFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PrivateChatSettingFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PrivateChatSettingFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>
          }
          findFirst: {
            args: Prisma.PrivateChatSettingFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PrivateChatSettingFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>
          }
          findMany: {
            args: Prisma.PrivateChatSettingFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>[]
          }
          create: {
            args: Prisma.PrivateChatSettingCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>
          }
          createMany: {
            args: Prisma.PrivateChatSettingCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PrivateChatSettingCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>[]
          }
          delete: {
            args: Prisma.PrivateChatSettingDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>
          }
          update: {
            args: Prisma.PrivateChatSettingUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>
          }
          deleteMany: {
            args: Prisma.PrivateChatSettingDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PrivateChatSettingUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PrivateChatSettingUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>[]
          }
          upsert: {
            args: Prisma.PrivateChatSettingUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PrivateChatSettingPayload>
          }
          aggregate: {
            args: Prisma.PrivateChatSettingAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePrivateChatSetting>
          }
          groupBy: {
            args: Prisma.PrivateChatSettingGroupByArgs<ExtArgs>
            result: $Utils.Optional<PrivateChatSettingGroupByOutputType>[]
          }
          count: {
            args: Prisma.PrivateChatSettingCountArgs<ExtArgs>
            result: $Utils.Optional<PrivateChatSettingCountAggregateOutputType> | number
          }
        }
      }
      AgentInboundMessage: {
        payload: Prisma.$AgentInboundMessagePayload<ExtArgs>
        fields: Prisma.AgentInboundMessageFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AgentInboundMessageFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AgentInboundMessageFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>
          }
          findFirst: {
            args: Prisma.AgentInboundMessageFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AgentInboundMessageFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>
          }
          findMany: {
            args: Prisma.AgentInboundMessageFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>[]
          }
          create: {
            args: Prisma.AgentInboundMessageCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>
          }
          createMany: {
            args: Prisma.AgentInboundMessageCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AgentInboundMessageCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>[]
          }
          delete: {
            args: Prisma.AgentInboundMessageDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>
          }
          update: {
            args: Prisma.AgentInboundMessageUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>
          }
          deleteMany: {
            args: Prisma.AgentInboundMessageDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AgentInboundMessageUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.AgentInboundMessageUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>[]
          }
          upsert: {
            args: Prisma.AgentInboundMessageUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentInboundMessagePayload>
          }
          aggregate: {
            args: Prisma.AgentInboundMessageAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgentInboundMessage>
          }
          groupBy: {
            args: Prisma.AgentInboundMessageGroupByArgs<ExtArgs>
            result: $Utils.Optional<AgentInboundMessageGroupByOutputType>[]
          }
          count: {
            args: Prisma.AgentInboundMessageCountArgs<ExtArgs>
            result: $Utils.Optional<AgentInboundMessageCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Shorthand for `emit: 'stdout'`
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events only
     * log: [
     *   { emit: 'event', level: 'query' },
     *   { emit: 'event', level: 'info' },
     *   { emit: 'event', level: 'warn' }
     *   { emit: 'event', level: 'error' }
     * ]
     * 
     * / Emit as events and log to stdout
     * og: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * 
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Instance of a Driver Adapter, e.g., like one provided by `@prisma/adapter-planetscale`
     */
    adapter?: runtime.SqlDriverAdapterFactory | null
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    groupChatSetting?: GroupChatSettingOmit
    privateChatSetting?: PrivateChatSettingOmit
    agentInboundMessage?: AgentInboundMessageOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

  export type GetLogType<T> = CheckIsLogLevel<
    T extends LogDefinition ? T['level'] : T
  >;

  export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
    ? GetLogType<T[number]>
    : never;

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */



  /**
   * Models
   */

  /**
   * Model GroupChatSetting
   */

  export type AggregateGroupChatSetting = {
    _count: GroupChatSettingCountAggregateOutputType | null
    _avg: GroupChatSettingAvgAggregateOutputType | null
    _sum: GroupChatSettingSumAggregateOutputType | null
    _min: GroupChatSettingMinAggregateOutputType | null
    _max: GroupChatSettingMaxAggregateOutputType | null
  }

  export type GroupChatSettingAvgAggregateOutputType = {
    group_id: number | null
    is_enabled: number | null
    auto_reply_enabled: number | null
    admin_user_id: number | null
  }

  export type GroupChatSettingSumAggregateOutputType = {
    group_id: bigint | null
    is_enabled: number | null
    auto_reply_enabled: number | null
    admin_user_id: bigint | null
  }

  export type GroupChatSettingMinAggregateOutputType = {
    group_id: bigint | null
    group_name: string | null
    is_enabled: number | null
    auto_reply_enabled: number | null
    welcome_message: string | null
    admin_user_id: bigint | null
    agent_prompt_id: string | null
    last_activity: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type GroupChatSettingMaxAggregateOutputType = {
    group_id: bigint | null
    group_name: string | null
    is_enabled: number | null
    auto_reply_enabled: number | null
    welcome_message: string | null
    admin_user_id: bigint | null
    agent_prompt_id: string | null
    last_activity: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type GroupChatSettingCountAggregateOutputType = {
    group_id: number
    group_name: number
    is_enabled: number
    auto_reply_enabled: number
    welcome_message: number
    admin_user_id: number
    agent_prompt_id: number
    last_activity: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type GroupChatSettingAvgAggregateInputType = {
    group_id?: true
    is_enabled?: true
    auto_reply_enabled?: true
    admin_user_id?: true
  }

  export type GroupChatSettingSumAggregateInputType = {
    group_id?: true
    is_enabled?: true
    auto_reply_enabled?: true
    admin_user_id?: true
  }

  export type GroupChatSettingMinAggregateInputType = {
    group_id?: true
    group_name?: true
    is_enabled?: true
    auto_reply_enabled?: true
    welcome_message?: true
    admin_user_id?: true
    agent_prompt_id?: true
    last_activity?: true
    created_at?: true
    updated_at?: true
  }

  export type GroupChatSettingMaxAggregateInputType = {
    group_id?: true
    group_name?: true
    is_enabled?: true
    auto_reply_enabled?: true
    welcome_message?: true
    admin_user_id?: true
    agent_prompt_id?: true
    last_activity?: true
    created_at?: true
    updated_at?: true
  }

  export type GroupChatSettingCountAggregateInputType = {
    group_id?: true
    group_name?: true
    is_enabled?: true
    auto_reply_enabled?: true
    welcome_message?: true
    admin_user_id?: true
    agent_prompt_id?: true
    last_activity?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type GroupChatSettingAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GroupChatSetting to aggregate.
     */
    where?: GroupChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupChatSettings to fetch.
     */
    orderBy?: GroupChatSettingOrderByWithRelationInput | GroupChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GroupChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupChatSettings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GroupChatSettings
    **/
    _count?: true | GroupChatSettingCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: GroupChatSettingAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: GroupChatSettingSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GroupChatSettingMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GroupChatSettingMaxAggregateInputType
  }

  export type GetGroupChatSettingAggregateType<T extends GroupChatSettingAggregateArgs> = {
        [P in keyof T & keyof AggregateGroupChatSetting]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGroupChatSetting[P]>
      : GetScalarType<T[P], AggregateGroupChatSetting[P]>
  }




  export type GroupChatSettingGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GroupChatSettingWhereInput
    orderBy?: GroupChatSettingOrderByWithAggregationInput | GroupChatSettingOrderByWithAggregationInput[]
    by: GroupChatSettingScalarFieldEnum[] | GroupChatSettingScalarFieldEnum
    having?: GroupChatSettingScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GroupChatSettingCountAggregateInputType | true
    _avg?: GroupChatSettingAvgAggregateInputType
    _sum?: GroupChatSettingSumAggregateInputType
    _min?: GroupChatSettingMinAggregateInputType
    _max?: GroupChatSettingMaxAggregateInputType
  }

  export type GroupChatSettingGroupByOutputType = {
    group_id: bigint
    group_name: string | null
    is_enabled: number
    auto_reply_enabled: number
    welcome_message: string | null
    admin_user_id: bigint | null
    agent_prompt_id: string | null
    last_activity: Date | null
    created_at: Date
    updated_at: Date
    _count: GroupChatSettingCountAggregateOutputType | null
    _avg: GroupChatSettingAvgAggregateOutputType | null
    _sum: GroupChatSettingSumAggregateOutputType | null
    _min: GroupChatSettingMinAggregateOutputType | null
    _max: GroupChatSettingMaxAggregateOutputType | null
  }

  type GetGroupChatSettingGroupByPayload<T extends GroupChatSettingGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GroupChatSettingGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GroupChatSettingGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GroupChatSettingGroupByOutputType[P]>
            : GetScalarType<T[P], GroupChatSettingGroupByOutputType[P]>
        }
      >
    >


  export type GroupChatSettingSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    group_id?: boolean
    group_name?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    admin_user_id?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["groupChatSetting"]>

  export type GroupChatSettingSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    group_id?: boolean
    group_name?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    admin_user_id?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["groupChatSetting"]>

  export type GroupChatSettingSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    group_id?: boolean
    group_name?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    admin_user_id?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["groupChatSetting"]>

  export type GroupChatSettingSelectScalar = {
    group_id?: boolean
    group_name?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    admin_user_id?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type GroupChatSettingOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"group_id" | "group_name" | "is_enabled" | "auto_reply_enabled" | "welcome_message" | "admin_user_id" | "agent_prompt_id" | "last_activity" | "created_at" | "updated_at", ExtArgs["result"]["groupChatSetting"]>

  export type $GroupChatSettingPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GroupChatSetting"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      group_id: bigint
      group_name: string | null
      is_enabled: number
      auto_reply_enabled: number
      welcome_message: string | null
      admin_user_id: bigint | null
      agent_prompt_id: string | null
      last_activity: Date | null
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["groupChatSetting"]>
    composites: {}
  }

  type GroupChatSettingGetPayload<S extends boolean | null | undefined | GroupChatSettingDefaultArgs> = $Result.GetResult<Prisma.$GroupChatSettingPayload, S>

  type GroupChatSettingCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<GroupChatSettingFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: GroupChatSettingCountAggregateInputType | true
    }

  export interface GroupChatSettingDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GroupChatSetting'], meta: { name: 'GroupChatSetting' } }
    /**
     * Find zero or one GroupChatSetting that matches the filter.
     * @param {GroupChatSettingFindUniqueArgs} args - Arguments to find a GroupChatSetting
     * @example
     * // Get one GroupChatSetting
     * const groupChatSetting = await prisma.groupChatSetting.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GroupChatSettingFindUniqueArgs>(args: SelectSubset<T, GroupChatSettingFindUniqueArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one GroupChatSetting that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {GroupChatSettingFindUniqueOrThrowArgs} args - Arguments to find a GroupChatSetting
     * @example
     * // Get one GroupChatSetting
     * const groupChatSetting = await prisma.groupChatSetting.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GroupChatSettingFindUniqueOrThrowArgs>(args: SelectSubset<T, GroupChatSettingFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first GroupChatSetting that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingFindFirstArgs} args - Arguments to find a GroupChatSetting
     * @example
     * // Get one GroupChatSetting
     * const groupChatSetting = await prisma.groupChatSetting.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GroupChatSettingFindFirstArgs>(args?: SelectSubset<T, GroupChatSettingFindFirstArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first GroupChatSetting that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingFindFirstOrThrowArgs} args - Arguments to find a GroupChatSetting
     * @example
     * // Get one GroupChatSetting
     * const groupChatSetting = await prisma.groupChatSetting.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GroupChatSettingFindFirstOrThrowArgs>(args?: SelectSubset<T, GroupChatSettingFindFirstOrThrowArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more GroupChatSettings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GroupChatSettings
     * const groupChatSettings = await prisma.groupChatSetting.findMany()
     * 
     * // Get first 10 GroupChatSettings
     * const groupChatSettings = await prisma.groupChatSetting.findMany({ take: 10 })
     * 
     * // Only select the `group_id`
     * const groupChatSettingWithGroup_idOnly = await prisma.groupChatSetting.findMany({ select: { group_id: true } })
     * 
     */
    findMany<T extends GroupChatSettingFindManyArgs>(args?: SelectSubset<T, GroupChatSettingFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a GroupChatSetting.
     * @param {GroupChatSettingCreateArgs} args - Arguments to create a GroupChatSetting.
     * @example
     * // Create one GroupChatSetting
     * const GroupChatSetting = await prisma.groupChatSetting.create({
     *   data: {
     *     // ... data to create a GroupChatSetting
     *   }
     * })
     * 
     */
    create<T extends GroupChatSettingCreateArgs>(args: SelectSubset<T, GroupChatSettingCreateArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many GroupChatSettings.
     * @param {GroupChatSettingCreateManyArgs} args - Arguments to create many GroupChatSettings.
     * @example
     * // Create many GroupChatSettings
     * const groupChatSetting = await prisma.groupChatSetting.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GroupChatSettingCreateManyArgs>(args?: SelectSubset<T, GroupChatSettingCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GroupChatSettings and returns the data saved in the database.
     * @param {GroupChatSettingCreateManyAndReturnArgs} args - Arguments to create many GroupChatSettings.
     * @example
     * // Create many GroupChatSettings
     * const groupChatSetting = await prisma.groupChatSetting.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GroupChatSettings and only return the `group_id`
     * const groupChatSettingWithGroup_idOnly = await prisma.groupChatSetting.createManyAndReturn({
     *   select: { group_id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GroupChatSettingCreateManyAndReturnArgs>(args?: SelectSubset<T, GroupChatSettingCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a GroupChatSetting.
     * @param {GroupChatSettingDeleteArgs} args - Arguments to delete one GroupChatSetting.
     * @example
     * // Delete one GroupChatSetting
     * const GroupChatSetting = await prisma.groupChatSetting.delete({
     *   where: {
     *     // ... filter to delete one GroupChatSetting
     *   }
     * })
     * 
     */
    delete<T extends GroupChatSettingDeleteArgs>(args: SelectSubset<T, GroupChatSettingDeleteArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one GroupChatSetting.
     * @param {GroupChatSettingUpdateArgs} args - Arguments to update one GroupChatSetting.
     * @example
     * // Update one GroupChatSetting
     * const groupChatSetting = await prisma.groupChatSetting.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GroupChatSettingUpdateArgs>(args: SelectSubset<T, GroupChatSettingUpdateArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more GroupChatSettings.
     * @param {GroupChatSettingDeleteManyArgs} args - Arguments to filter GroupChatSettings to delete.
     * @example
     * // Delete a few GroupChatSettings
     * const { count } = await prisma.groupChatSetting.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GroupChatSettingDeleteManyArgs>(args?: SelectSubset<T, GroupChatSettingDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GroupChatSettings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GroupChatSettings
     * const groupChatSetting = await prisma.groupChatSetting.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GroupChatSettingUpdateManyArgs>(args: SelectSubset<T, GroupChatSettingUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GroupChatSettings and returns the data updated in the database.
     * @param {GroupChatSettingUpdateManyAndReturnArgs} args - Arguments to update many GroupChatSettings.
     * @example
     * // Update many GroupChatSettings
     * const groupChatSetting = await prisma.groupChatSetting.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more GroupChatSettings and only return the `group_id`
     * const groupChatSettingWithGroup_idOnly = await prisma.groupChatSetting.updateManyAndReturn({
     *   select: { group_id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends GroupChatSettingUpdateManyAndReturnArgs>(args: SelectSubset<T, GroupChatSettingUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one GroupChatSetting.
     * @param {GroupChatSettingUpsertArgs} args - Arguments to update or create a GroupChatSetting.
     * @example
     * // Update or create a GroupChatSetting
     * const groupChatSetting = await prisma.groupChatSetting.upsert({
     *   create: {
     *     // ... data to create a GroupChatSetting
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GroupChatSetting we want to update
     *   }
     * })
     */
    upsert<T extends GroupChatSettingUpsertArgs>(args: SelectSubset<T, GroupChatSettingUpsertArgs<ExtArgs>>): Prisma__GroupChatSettingClient<$Result.GetResult<Prisma.$GroupChatSettingPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of GroupChatSettings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingCountArgs} args - Arguments to filter GroupChatSettings to count.
     * @example
     * // Count the number of GroupChatSettings
     * const count = await prisma.groupChatSetting.count({
     *   where: {
     *     // ... the filter for the GroupChatSettings we want to count
     *   }
     * })
    **/
    count<T extends GroupChatSettingCountArgs>(
      args?: Subset<T, GroupChatSettingCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GroupChatSettingCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GroupChatSetting.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends GroupChatSettingAggregateArgs>(args: Subset<T, GroupChatSettingAggregateArgs>): Prisma.PrismaPromise<GetGroupChatSettingAggregateType<T>>

    /**
     * Group by GroupChatSetting.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupChatSettingGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends GroupChatSettingGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GroupChatSettingGroupByArgs['orderBy'] }
        : { orderBy?: GroupChatSettingGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, GroupChatSettingGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGroupChatSettingGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GroupChatSetting model
   */
  readonly fields: GroupChatSettingFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GroupChatSetting.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GroupChatSettingClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the GroupChatSetting model
   */
  interface GroupChatSettingFieldRefs {
    readonly group_id: FieldRef<"GroupChatSetting", 'BigInt'>
    readonly group_name: FieldRef<"GroupChatSetting", 'String'>
    readonly is_enabled: FieldRef<"GroupChatSetting", 'Int'>
    readonly auto_reply_enabled: FieldRef<"GroupChatSetting", 'Int'>
    readonly welcome_message: FieldRef<"GroupChatSetting", 'String'>
    readonly admin_user_id: FieldRef<"GroupChatSetting", 'BigInt'>
    readonly agent_prompt_id: FieldRef<"GroupChatSetting", 'String'>
    readonly last_activity: FieldRef<"GroupChatSetting", 'DateTime'>
    readonly created_at: FieldRef<"GroupChatSetting", 'DateTime'>
    readonly updated_at: FieldRef<"GroupChatSetting", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GroupChatSetting findUnique
   */
  export type GroupChatSettingFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which GroupChatSetting to fetch.
     */
    where: GroupChatSettingWhereUniqueInput
  }

  /**
   * GroupChatSetting findUniqueOrThrow
   */
  export type GroupChatSettingFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which GroupChatSetting to fetch.
     */
    where: GroupChatSettingWhereUniqueInput
  }

  /**
   * GroupChatSetting findFirst
   */
  export type GroupChatSettingFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which GroupChatSetting to fetch.
     */
    where?: GroupChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupChatSettings to fetch.
     */
    orderBy?: GroupChatSettingOrderByWithRelationInput | GroupChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GroupChatSettings.
     */
    cursor?: GroupChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupChatSettings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GroupChatSettings.
     */
    distinct?: GroupChatSettingScalarFieldEnum | GroupChatSettingScalarFieldEnum[]
  }

  /**
   * GroupChatSetting findFirstOrThrow
   */
  export type GroupChatSettingFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which GroupChatSetting to fetch.
     */
    where?: GroupChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupChatSettings to fetch.
     */
    orderBy?: GroupChatSettingOrderByWithRelationInput | GroupChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GroupChatSettings.
     */
    cursor?: GroupChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupChatSettings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GroupChatSettings.
     */
    distinct?: GroupChatSettingScalarFieldEnum | GroupChatSettingScalarFieldEnum[]
  }

  /**
   * GroupChatSetting findMany
   */
  export type GroupChatSettingFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which GroupChatSettings to fetch.
     */
    where?: GroupChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupChatSettings to fetch.
     */
    orderBy?: GroupChatSettingOrderByWithRelationInput | GroupChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GroupChatSettings.
     */
    cursor?: GroupChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupChatSettings.
     */
    skip?: number
    distinct?: GroupChatSettingScalarFieldEnum | GroupChatSettingScalarFieldEnum[]
  }

  /**
   * GroupChatSetting create
   */
  export type GroupChatSettingCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * The data needed to create a GroupChatSetting.
     */
    data: XOR<GroupChatSettingCreateInput, GroupChatSettingUncheckedCreateInput>
  }

  /**
   * GroupChatSetting createMany
   */
  export type GroupChatSettingCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GroupChatSettings.
     */
    data: GroupChatSettingCreateManyInput | GroupChatSettingCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GroupChatSetting createManyAndReturn
   */
  export type GroupChatSettingCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * The data used to create many GroupChatSettings.
     */
    data: GroupChatSettingCreateManyInput | GroupChatSettingCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GroupChatSetting update
   */
  export type GroupChatSettingUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * The data needed to update a GroupChatSetting.
     */
    data: XOR<GroupChatSettingUpdateInput, GroupChatSettingUncheckedUpdateInput>
    /**
     * Choose, which GroupChatSetting to update.
     */
    where: GroupChatSettingWhereUniqueInput
  }

  /**
   * GroupChatSetting updateMany
   */
  export type GroupChatSettingUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GroupChatSettings.
     */
    data: XOR<GroupChatSettingUpdateManyMutationInput, GroupChatSettingUncheckedUpdateManyInput>
    /**
     * Filter which GroupChatSettings to update
     */
    where?: GroupChatSettingWhereInput
    /**
     * Limit how many GroupChatSettings to update.
     */
    limit?: number
  }

  /**
   * GroupChatSetting updateManyAndReturn
   */
  export type GroupChatSettingUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * The data used to update GroupChatSettings.
     */
    data: XOR<GroupChatSettingUpdateManyMutationInput, GroupChatSettingUncheckedUpdateManyInput>
    /**
     * Filter which GroupChatSettings to update
     */
    where?: GroupChatSettingWhereInput
    /**
     * Limit how many GroupChatSettings to update.
     */
    limit?: number
  }

  /**
   * GroupChatSetting upsert
   */
  export type GroupChatSettingUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * The filter to search for the GroupChatSetting to update in case it exists.
     */
    where: GroupChatSettingWhereUniqueInput
    /**
     * In case the GroupChatSetting found by the `where` argument doesn't exist, create a new GroupChatSetting with this data.
     */
    create: XOR<GroupChatSettingCreateInput, GroupChatSettingUncheckedCreateInput>
    /**
     * In case the GroupChatSetting was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GroupChatSettingUpdateInput, GroupChatSettingUncheckedUpdateInput>
  }

  /**
   * GroupChatSetting delete
   */
  export type GroupChatSettingDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
    /**
     * Filter which GroupChatSetting to delete.
     */
    where: GroupChatSettingWhereUniqueInput
  }

  /**
   * GroupChatSetting deleteMany
   */
  export type GroupChatSettingDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GroupChatSettings to delete
     */
    where?: GroupChatSettingWhereInput
    /**
     * Limit how many GroupChatSettings to delete.
     */
    limit?: number
  }

  /**
   * GroupChatSetting without action
   */
  export type GroupChatSettingDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupChatSetting
     */
    select?: GroupChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupChatSetting
     */
    omit?: GroupChatSettingOmit<ExtArgs> | null
  }


  /**
   * Model PrivateChatSetting
   */

  export type AggregatePrivateChatSetting = {
    _count: PrivateChatSettingCountAggregateOutputType | null
    _avg: PrivateChatSettingAvgAggregateOutputType | null
    _sum: PrivateChatSettingSumAggregateOutputType | null
    _min: PrivateChatSettingMinAggregateOutputType | null
    _max: PrivateChatSettingMaxAggregateOutputType | null
  }

  export type PrivateChatSettingAvgAggregateOutputType = {
    user_id: number | null
    is_enabled: number | null
    auto_reply_enabled: number | null
  }

  export type PrivateChatSettingSumAggregateOutputType = {
    user_id: bigint | null
    is_enabled: number | null
    auto_reply_enabled: number | null
  }

  export type PrivateChatSettingMinAggregateOutputType = {
    user_id: bigint | null
    username: string | null
    is_enabled: number | null
    auto_reply_enabled: number | null
    welcome_message: string | null
    user_notes: string | null
    agent_prompt_id: string | null
    last_activity: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type PrivateChatSettingMaxAggregateOutputType = {
    user_id: bigint | null
    username: string | null
    is_enabled: number | null
    auto_reply_enabled: number | null
    welcome_message: string | null
    user_notes: string | null
    agent_prompt_id: string | null
    last_activity: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type PrivateChatSettingCountAggregateOutputType = {
    user_id: number
    username: number
    is_enabled: number
    auto_reply_enabled: number
    welcome_message: number
    user_notes: number
    agent_prompt_id: number
    last_activity: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type PrivateChatSettingAvgAggregateInputType = {
    user_id?: true
    is_enabled?: true
    auto_reply_enabled?: true
  }

  export type PrivateChatSettingSumAggregateInputType = {
    user_id?: true
    is_enabled?: true
    auto_reply_enabled?: true
  }

  export type PrivateChatSettingMinAggregateInputType = {
    user_id?: true
    username?: true
    is_enabled?: true
    auto_reply_enabled?: true
    welcome_message?: true
    user_notes?: true
    agent_prompt_id?: true
    last_activity?: true
    created_at?: true
    updated_at?: true
  }

  export type PrivateChatSettingMaxAggregateInputType = {
    user_id?: true
    username?: true
    is_enabled?: true
    auto_reply_enabled?: true
    welcome_message?: true
    user_notes?: true
    agent_prompt_id?: true
    last_activity?: true
    created_at?: true
    updated_at?: true
  }

  export type PrivateChatSettingCountAggregateInputType = {
    user_id?: true
    username?: true
    is_enabled?: true
    auto_reply_enabled?: true
    welcome_message?: true
    user_notes?: true
    agent_prompt_id?: true
    last_activity?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type PrivateChatSettingAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PrivateChatSetting to aggregate.
     */
    where?: PrivateChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrivateChatSettings to fetch.
     */
    orderBy?: PrivateChatSettingOrderByWithRelationInput | PrivateChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PrivateChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrivateChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrivateChatSettings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PrivateChatSettings
    **/
    _count?: true | PrivateChatSettingCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PrivateChatSettingAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PrivateChatSettingSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PrivateChatSettingMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PrivateChatSettingMaxAggregateInputType
  }

  export type GetPrivateChatSettingAggregateType<T extends PrivateChatSettingAggregateArgs> = {
        [P in keyof T & keyof AggregatePrivateChatSetting]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePrivateChatSetting[P]>
      : GetScalarType<T[P], AggregatePrivateChatSetting[P]>
  }




  export type PrivateChatSettingGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PrivateChatSettingWhereInput
    orderBy?: PrivateChatSettingOrderByWithAggregationInput | PrivateChatSettingOrderByWithAggregationInput[]
    by: PrivateChatSettingScalarFieldEnum[] | PrivateChatSettingScalarFieldEnum
    having?: PrivateChatSettingScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PrivateChatSettingCountAggregateInputType | true
    _avg?: PrivateChatSettingAvgAggregateInputType
    _sum?: PrivateChatSettingSumAggregateInputType
    _min?: PrivateChatSettingMinAggregateInputType
    _max?: PrivateChatSettingMaxAggregateInputType
  }

  export type PrivateChatSettingGroupByOutputType = {
    user_id: bigint
    username: string | null
    is_enabled: number
    auto_reply_enabled: number
    welcome_message: string | null
    user_notes: string | null
    agent_prompt_id: string | null
    last_activity: Date | null
    created_at: Date
    updated_at: Date
    _count: PrivateChatSettingCountAggregateOutputType | null
    _avg: PrivateChatSettingAvgAggregateOutputType | null
    _sum: PrivateChatSettingSumAggregateOutputType | null
    _min: PrivateChatSettingMinAggregateOutputType | null
    _max: PrivateChatSettingMaxAggregateOutputType | null
  }

  type GetPrivateChatSettingGroupByPayload<T extends PrivateChatSettingGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PrivateChatSettingGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PrivateChatSettingGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PrivateChatSettingGroupByOutputType[P]>
            : GetScalarType<T[P], PrivateChatSettingGroupByOutputType[P]>
        }
      >
    >


  export type PrivateChatSettingSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    user_id?: boolean
    username?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    user_notes?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["privateChatSetting"]>

  export type PrivateChatSettingSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    user_id?: boolean
    username?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    user_notes?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["privateChatSetting"]>

  export type PrivateChatSettingSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    user_id?: boolean
    username?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    user_notes?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["privateChatSetting"]>

  export type PrivateChatSettingSelectScalar = {
    user_id?: boolean
    username?: boolean
    is_enabled?: boolean
    auto_reply_enabled?: boolean
    welcome_message?: boolean
    user_notes?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type PrivateChatSettingOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"user_id" | "username" | "is_enabled" | "auto_reply_enabled" | "welcome_message" | "user_notes" | "agent_prompt_id" | "last_activity" | "created_at" | "updated_at", ExtArgs["result"]["privateChatSetting"]>

  export type $PrivateChatSettingPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PrivateChatSetting"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      user_id: bigint
      username: string | null
      is_enabled: number
      auto_reply_enabled: number
      welcome_message: string | null
      user_notes: string | null
      agent_prompt_id: string | null
      last_activity: Date | null
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["privateChatSetting"]>
    composites: {}
  }

  type PrivateChatSettingGetPayload<S extends boolean | null | undefined | PrivateChatSettingDefaultArgs> = $Result.GetResult<Prisma.$PrivateChatSettingPayload, S>

  type PrivateChatSettingCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PrivateChatSettingFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PrivateChatSettingCountAggregateInputType | true
    }

  export interface PrivateChatSettingDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PrivateChatSetting'], meta: { name: 'PrivateChatSetting' } }
    /**
     * Find zero or one PrivateChatSetting that matches the filter.
     * @param {PrivateChatSettingFindUniqueArgs} args - Arguments to find a PrivateChatSetting
     * @example
     * // Get one PrivateChatSetting
     * const privateChatSetting = await prisma.privateChatSetting.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PrivateChatSettingFindUniqueArgs>(args: SelectSubset<T, PrivateChatSettingFindUniqueArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one PrivateChatSetting that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PrivateChatSettingFindUniqueOrThrowArgs} args - Arguments to find a PrivateChatSetting
     * @example
     * // Get one PrivateChatSetting
     * const privateChatSetting = await prisma.privateChatSetting.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PrivateChatSettingFindUniqueOrThrowArgs>(args: SelectSubset<T, PrivateChatSettingFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PrivateChatSetting that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingFindFirstArgs} args - Arguments to find a PrivateChatSetting
     * @example
     * // Get one PrivateChatSetting
     * const privateChatSetting = await prisma.privateChatSetting.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PrivateChatSettingFindFirstArgs>(args?: SelectSubset<T, PrivateChatSettingFindFirstArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PrivateChatSetting that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingFindFirstOrThrowArgs} args - Arguments to find a PrivateChatSetting
     * @example
     * // Get one PrivateChatSetting
     * const privateChatSetting = await prisma.privateChatSetting.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PrivateChatSettingFindFirstOrThrowArgs>(args?: SelectSubset<T, PrivateChatSettingFindFirstOrThrowArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more PrivateChatSettings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PrivateChatSettings
     * const privateChatSettings = await prisma.privateChatSetting.findMany()
     * 
     * // Get first 10 PrivateChatSettings
     * const privateChatSettings = await prisma.privateChatSetting.findMany({ take: 10 })
     * 
     * // Only select the `user_id`
     * const privateChatSettingWithUser_idOnly = await prisma.privateChatSetting.findMany({ select: { user_id: true } })
     * 
     */
    findMany<T extends PrivateChatSettingFindManyArgs>(args?: SelectSubset<T, PrivateChatSettingFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a PrivateChatSetting.
     * @param {PrivateChatSettingCreateArgs} args - Arguments to create a PrivateChatSetting.
     * @example
     * // Create one PrivateChatSetting
     * const PrivateChatSetting = await prisma.privateChatSetting.create({
     *   data: {
     *     // ... data to create a PrivateChatSetting
     *   }
     * })
     * 
     */
    create<T extends PrivateChatSettingCreateArgs>(args: SelectSubset<T, PrivateChatSettingCreateArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many PrivateChatSettings.
     * @param {PrivateChatSettingCreateManyArgs} args - Arguments to create many PrivateChatSettings.
     * @example
     * // Create many PrivateChatSettings
     * const privateChatSetting = await prisma.privateChatSetting.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PrivateChatSettingCreateManyArgs>(args?: SelectSubset<T, PrivateChatSettingCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PrivateChatSettings and returns the data saved in the database.
     * @param {PrivateChatSettingCreateManyAndReturnArgs} args - Arguments to create many PrivateChatSettings.
     * @example
     * // Create many PrivateChatSettings
     * const privateChatSetting = await prisma.privateChatSetting.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PrivateChatSettings and only return the `user_id`
     * const privateChatSettingWithUser_idOnly = await prisma.privateChatSetting.createManyAndReturn({
     *   select: { user_id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PrivateChatSettingCreateManyAndReturnArgs>(args?: SelectSubset<T, PrivateChatSettingCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a PrivateChatSetting.
     * @param {PrivateChatSettingDeleteArgs} args - Arguments to delete one PrivateChatSetting.
     * @example
     * // Delete one PrivateChatSetting
     * const PrivateChatSetting = await prisma.privateChatSetting.delete({
     *   where: {
     *     // ... filter to delete one PrivateChatSetting
     *   }
     * })
     * 
     */
    delete<T extends PrivateChatSettingDeleteArgs>(args: SelectSubset<T, PrivateChatSettingDeleteArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one PrivateChatSetting.
     * @param {PrivateChatSettingUpdateArgs} args - Arguments to update one PrivateChatSetting.
     * @example
     * // Update one PrivateChatSetting
     * const privateChatSetting = await prisma.privateChatSetting.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PrivateChatSettingUpdateArgs>(args: SelectSubset<T, PrivateChatSettingUpdateArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more PrivateChatSettings.
     * @param {PrivateChatSettingDeleteManyArgs} args - Arguments to filter PrivateChatSettings to delete.
     * @example
     * // Delete a few PrivateChatSettings
     * const { count } = await prisma.privateChatSetting.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PrivateChatSettingDeleteManyArgs>(args?: SelectSubset<T, PrivateChatSettingDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PrivateChatSettings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PrivateChatSettings
     * const privateChatSetting = await prisma.privateChatSetting.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PrivateChatSettingUpdateManyArgs>(args: SelectSubset<T, PrivateChatSettingUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PrivateChatSettings and returns the data updated in the database.
     * @param {PrivateChatSettingUpdateManyAndReturnArgs} args - Arguments to update many PrivateChatSettings.
     * @example
     * // Update many PrivateChatSettings
     * const privateChatSetting = await prisma.privateChatSetting.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more PrivateChatSettings and only return the `user_id`
     * const privateChatSettingWithUser_idOnly = await prisma.privateChatSetting.updateManyAndReturn({
     *   select: { user_id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PrivateChatSettingUpdateManyAndReturnArgs>(args: SelectSubset<T, PrivateChatSettingUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one PrivateChatSetting.
     * @param {PrivateChatSettingUpsertArgs} args - Arguments to update or create a PrivateChatSetting.
     * @example
     * // Update or create a PrivateChatSetting
     * const privateChatSetting = await prisma.privateChatSetting.upsert({
     *   create: {
     *     // ... data to create a PrivateChatSetting
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PrivateChatSetting we want to update
     *   }
     * })
     */
    upsert<T extends PrivateChatSettingUpsertArgs>(args: SelectSubset<T, PrivateChatSettingUpsertArgs<ExtArgs>>): Prisma__PrivateChatSettingClient<$Result.GetResult<Prisma.$PrivateChatSettingPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of PrivateChatSettings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingCountArgs} args - Arguments to filter PrivateChatSettings to count.
     * @example
     * // Count the number of PrivateChatSettings
     * const count = await prisma.privateChatSetting.count({
     *   where: {
     *     // ... the filter for the PrivateChatSettings we want to count
     *   }
     * })
    **/
    count<T extends PrivateChatSettingCountArgs>(
      args?: Subset<T, PrivateChatSettingCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PrivateChatSettingCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PrivateChatSetting.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PrivateChatSettingAggregateArgs>(args: Subset<T, PrivateChatSettingAggregateArgs>): Prisma.PrismaPromise<GetPrivateChatSettingAggregateType<T>>

    /**
     * Group by PrivateChatSetting.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PrivateChatSettingGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PrivateChatSettingGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PrivateChatSettingGroupByArgs['orderBy'] }
        : { orderBy?: PrivateChatSettingGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PrivateChatSettingGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPrivateChatSettingGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PrivateChatSetting model
   */
  readonly fields: PrivateChatSettingFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PrivateChatSetting.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PrivateChatSettingClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PrivateChatSetting model
   */
  interface PrivateChatSettingFieldRefs {
    readonly user_id: FieldRef<"PrivateChatSetting", 'BigInt'>
    readonly username: FieldRef<"PrivateChatSetting", 'String'>
    readonly is_enabled: FieldRef<"PrivateChatSetting", 'Int'>
    readonly auto_reply_enabled: FieldRef<"PrivateChatSetting", 'Int'>
    readonly welcome_message: FieldRef<"PrivateChatSetting", 'String'>
    readonly user_notes: FieldRef<"PrivateChatSetting", 'String'>
    readonly agent_prompt_id: FieldRef<"PrivateChatSetting", 'String'>
    readonly last_activity: FieldRef<"PrivateChatSetting", 'DateTime'>
    readonly created_at: FieldRef<"PrivateChatSetting", 'DateTime'>
    readonly updated_at: FieldRef<"PrivateChatSetting", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PrivateChatSetting findUnique
   */
  export type PrivateChatSettingFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which PrivateChatSetting to fetch.
     */
    where: PrivateChatSettingWhereUniqueInput
  }

  /**
   * PrivateChatSetting findUniqueOrThrow
   */
  export type PrivateChatSettingFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which PrivateChatSetting to fetch.
     */
    where: PrivateChatSettingWhereUniqueInput
  }

  /**
   * PrivateChatSetting findFirst
   */
  export type PrivateChatSettingFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which PrivateChatSetting to fetch.
     */
    where?: PrivateChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrivateChatSettings to fetch.
     */
    orderBy?: PrivateChatSettingOrderByWithRelationInput | PrivateChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PrivateChatSettings.
     */
    cursor?: PrivateChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrivateChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrivateChatSettings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PrivateChatSettings.
     */
    distinct?: PrivateChatSettingScalarFieldEnum | PrivateChatSettingScalarFieldEnum[]
  }

  /**
   * PrivateChatSetting findFirstOrThrow
   */
  export type PrivateChatSettingFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which PrivateChatSetting to fetch.
     */
    where?: PrivateChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrivateChatSettings to fetch.
     */
    orderBy?: PrivateChatSettingOrderByWithRelationInput | PrivateChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PrivateChatSettings.
     */
    cursor?: PrivateChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrivateChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrivateChatSettings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PrivateChatSettings.
     */
    distinct?: PrivateChatSettingScalarFieldEnum | PrivateChatSettingScalarFieldEnum[]
  }

  /**
   * PrivateChatSetting findMany
   */
  export type PrivateChatSettingFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * Filter, which PrivateChatSettings to fetch.
     */
    where?: PrivateChatSettingWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PrivateChatSettings to fetch.
     */
    orderBy?: PrivateChatSettingOrderByWithRelationInput | PrivateChatSettingOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PrivateChatSettings.
     */
    cursor?: PrivateChatSettingWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PrivateChatSettings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PrivateChatSettings.
     */
    skip?: number
    distinct?: PrivateChatSettingScalarFieldEnum | PrivateChatSettingScalarFieldEnum[]
  }

  /**
   * PrivateChatSetting create
   */
  export type PrivateChatSettingCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * The data needed to create a PrivateChatSetting.
     */
    data: XOR<PrivateChatSettingCreateInput, PrivateChatSettingUncheckedCreateInput>
  }

  /**
   * PrivateChatSetting createMany
   */
  export type PrivateChatSettingCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PrivateChatSettings.
     */
    data: PrivateChatSettingCreateManyInput | PrivateChatSettingCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PrivateChatSetting createManyAndReturn
   */
  export type PrivateChatSettingCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * The data used to create many PrivateChatSettings.
     */
    data: PrivateChatSettingCreateManyInput | PrivateChatSettingCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PrivateChatSetting update
   */
  export type PrivateChatSettingUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * The data needed to update a PrivateChatSetting.
     */
    data: XOR<PrivateChatSettingUpdateInput, PrivateChatSettingUncheckedUpdateInput>
    /**
     * Choose, which PrivateChatSetting to update.
     */
    where: PrivateChatSettingWhereUniqueInput
  }

  /**
   * PrivateChatSetting updateMany
   */
  export type PrivateChatSettingUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PrivateChatSettings.
     */
    data: XOR<PrivateChatSettingUpdateManyMutationInput, PrivateChatSettingUncheckedUpdateManyInput>
    /**
     * Filter which PrivateChatSettings to update
     */
    where?: PrivateChatSettingWhereInput
    /**
     * Limit how many PrivateChatSettings to update.
     */
    limit?: number
  }

  /**
   * PrivateChatSetting updateManyAndReturn
   */
  export type PrivateChatSettingUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * The data used to update PrivateChatSettings.
     */
    data: XOR<PrivateChatSettingUpdateManyMutationInput, PrivateChatSettingUncheckedUpdateManyInput>
    /**
     * Filter which PrivateChatSettings to update
     */
    where?: PrivateChatSettingWhereInput
    /**
     * Limit how many PrivateChatSettings to update.
     */
    limit?: number
  }

  /**
   * PrivateChatSetting upsert
   */
  export type PrivateChatSettingUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * The filter to search for the PrivateChatSetting to update in case it exists.
     */
    where: PrivateChatSettingWhereUniqueInput
    /**
     * In case the PrivateChatSetting found by the `where` argument doesn't exist, create a new PrivateChatSetting with this data.
     */
    create: XOR<PrivateChatSettingCreateInput, PrivateChatSettingUncheckedCreateInput>
    /**
     * In case the PrivateChatSetting was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PrivateChatSettingUpdateInput, PrivateChatSettingUncheckedUpdateInput>
  }

  /**
   * PrivateChatSetting delete
   */
  export type PrivateChatSettingDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
    /**
     * Filter which PrivateChatSetting to delete.
     */
    where: PrivateChatSettingWhereUniqueInput
  }

  /**
   * PrivateChatSetting deleteMany
   */
  export type PrivateChatSettingDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PrivateChatSettings to delete
     */
    where?: PrivateChatSettingWhereInput
    /**
     * Limit how many PrivateChatSettings to delete.
     */
    limit?: number
  }

  /**
   * PrivateChatSetting without action
   */
  export type PrivateChatSettingDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PrivateChatSetting
     */
    select?: PrivateChatSettingSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PrivateChatSetting
     */
    omit?: PrivateChatSettingOmit<ExtArgs> | null
  }


  /**
   * Model AgentInboundMessage
   */

  export type AggregateAgentInboundMessage = {
    _count: AgentInboundMessageCountAggregateOutputType | null
    _avg: AgentInboundMessageAvgAggregateOutputType | null
    _sum: AgentInboundMessageSumAggregateOutputType | null
    _min: AgentInboundMessageMinAggregateOutputType | null
    _max: AgentInboundMessageMaxAggregateOutputType | null
  }

  export type AgentInboundMessageAvgAggregateOutputType = {
    id: number | null
    is_read: number | null
    was_mentioned: number | null
  }

  export type AgentInboundMessageSumAggregateOutputType = {
    id: bigint | null
    is_read: number | null
    was_mentioned: number | null
  }

  export type AgentInboundMessageMinAggregateOutputType = {
    id: bigint | null
    trace_id: string | null
    source: string | null
    message_sid: string | null
    dedupe_key: string | null
    chat_type: string | null
    session_key: string | null
    peer_id: string | null
    peer_name: string | null
    sender_id: string | null
    sender_name: string | null
    account_id: string | null
    is_read: number | null
    read_at: Date | null
    received_at: Date | null
    message_timestamp: Date | null
    body_for_agent: string | null
    raw_body: string | null
    command_body: string | null
    was_mentioned: number | null
    reply_to_id: string | null
    reply_to_body: string | null
    reply_to_sender: string | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type AgentInboundMessageMaxAggregateOutputType = {
    id: bigint | null
    trace_id: string | null
    source: string | null
    message_sid: string | null
    dedupe_key: string | null
    chat_type: string | null
    session_key: string | null
    peer_id: string | null
    peer_name: string | null
    sender_id: string | null
    sender_name: string | null
    account_id: string | null
    is_read: number | null
    read_at: Date | null
    received_at: Date | null
    message_timestamp: Date | null
    body_for_agent: string | null
    raw_body: string | null
    command_body: string | null
    was_mentioned: number | null
    reply_to_id: string | null
    reply_to_body: string | null
    reply_to_sender: string | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type AgentInboundMessageCountAggregateOutputType = {
    id: number
    trace_id: number
    source: number
    message_sid: number
    dedupe_key: number
    chat_type: number
    session_key: number
    peer_id: number
    peer_name: number
    sender_id: number
    sender_name: number
    account_id: number
    is_read: number
    read_at: number
    received_at: number
    message_timestamp: number
    body_for_agent: number
    raw_body: number
    command_body: number
    was_mentioned: number
    reply_to_id: number
    reply_to_body: number
    reply_to_sender: number
    raw_payload: number
    inbound_context: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type AgentInboundMessageAvgAggregateInputType = {
    id?: true
    is_read?: true
    was_mentioned?: true
  }

  export type AgentInboundMessageSumAggregateInputType = {
    id?: true
    is_read?: true
    was_mentioned?: true
  }

  export type AgentInboundMessageMinAggregateInputType = {
    id?: true
    trace_id?: true
    source?: true
    message_sid?: true
    dedupe_key?: true
    chat_type?: true
    session_key?: true
    peer_id?: true
    peer_name?: true
    sender_id?: true
    sender_name?: true
    account_id?: true
    is_read?: true
    read_at?: true
    received_at?: true
    message_timestamp?: true
    body_for_agent?: true
    raw_body?: true
    command_body?: true
    was_mentioned?: true
    reply_to_id?: true
    reply_to_body?: true
    reply_to_sender?: true
    created_at?: true
    updated_at?: true
  }

  export type AgentInboundMessageMaxAggregateInputType = {
    id?: true
    trace_id?: true
    source?: true
    message_sid?: true
    dedupe_key?: true
    chat_type?: true
    session_key?: true
    peer_id?: true
    peer_name?: true
    sender_id?: true
    sender_name?: true
    account_id?: true
    is_read?: true
    read_at?: true
    received_at?: true
    message_timestamp?: true
    body_for_agent?: true
    raw_body?: true
    command_body?: true
    was_mentioned?: true
    reply_to_id?: true
    reply_to_body?: true
    reply_to_sender?: true
    created_at?: true
    updated_at?: true
  }

  export type AgentInboundMessageCountAggregateInputType = {
    id?: true
    trace_id?: true
    source?: true
    message_sid?: true
    dedupe_key?: true
    chat_type?: true
    session_key?: true
    peer_id?: true
    peer_name?: true
    sender_id?: true
    sender_name?: true
    account_id?: true
    is_read?: true
    read_at?: true
    received_at?: true
    message_timestamp?: true
    body_for_agent?: true
    raw_body?: true
    command_body?: true
    was_mentioned?: true
    reply_to_id?: true
    reply_to_body?: true
    reply_to_sender?: true
    raw_payload?: true
    inbound_context?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type AgentInboundMessageAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentInboundMessage to aggregate.
     */
    where?: AgentInboundMessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentInboundMessages to fetch.
     */
    orderBy?: AgentInboundMessageOrderByWithRelationInput | AgentInboundMessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AgentInboundMessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentInboundMessages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentInboundMessages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AgentInboundMessages
    **/
    _count?: true | AgentInboundMessageCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AgentInboundMessageAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AgentInboundMessageSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AgentInboundMessageMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AgentInboundMessageMaxAggregateInputType
  }

  export type GetAgentInboundMessageAggregateType<T extends AgentInboundMessageAggregateArgs> = {
        [P in keyof T & keyof AggregateAgentInboundMessage]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgentInboundMessage[P]>
      : GetScalarType<T[P], AggregateAgentInboundMessage[P]>
  }




  export type AgentInboundMessageGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentInboundMessageWhereInput
    orderBy?: AgentInboundMessageOrderByWithAggregationInput | AgentInboundMessageOrderByWithAggregationInput[]
    by: AgentInboundMessageScalarFieldEnum[] | AgentInboundMessageScalarFieldEnum
    having?: AgentInboundMessageScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AgentInboundMessageCountAggregateInputType | true
    _avg?: AgentInboundMessageAvgAggregateInputType
    _sum?: AgentInboundMessageSumAggregateInputType
    _min?: AgentInboundMessageMinAggregateInputType
    _max?: AgentInboundMessageMaxAggregateInputType
  }

  export type AgentInboundMessageGroupByOutputType = {
    id: bigint
    trace_id: string
    source: string
    message_sid: string
    dedupe_key: string
    chat_type: string
    session_key: string
    peer_id: string
    peer_name: string | null
    sender_id: string
    sender_name: string | null
    account_id: string
    is_read: number
    read_at: Date | null
    received_at: Date
    message_timestamp: Date | null
    body_for_agent: string
    raw_body: string | null
    command_body: string | null
    was_mentioned: number
    reply_to_id: string | null
    reply_to_body: string | null
    reply_to_sender: string | null
    raw_payload: JsonValue
    inbound_context: JsonValue
    created_at: Date
    updated_at: Date
    _count: AgentInboundMessageCountAggregateOutputType | null
    _avg: AgentInboundMessageAvgAggregateOutputType | null
    _sum: AgentInboundMessageSumAggregateOutputType | null
    _min: AgentInboundMessageMinAggregateOutputType | null
    _max: AgentInboundMessageMaxAggregateOutputType | null
  }

  type GetAgentInboundMessageGroupByPayload<T extends AgentInboundMessageGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AgentInboundMessageGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AgentInboundMessageGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AgentInboundMessageGroupByOutputType[P]>
            : GetScalarType<T[P], AgentInboundMessageGroupByOutputType[P]>
        }
      >
    >


  export type AgentInboundMessageSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    trace_id?: boolean
    source?: boolean
    message_sid?: boolean
    dedupe_key?: boolean
    chat_type?: boolean
    session_key?: boolean
    peer_id?: boolean
    peer_name?: boolean
    sender_id?: boolean
    sender_name?: boolean
    account_id?: boolean
    is_read?: boolean
    read_at?: boolean
    received_at?: boolean
    message_timestamp?: boolean
    body_for_agent?: boolean
    raw_body?: boolean
    command_body?: boolean
    was_mentioned?: boolean
    reply_to_id?: boolean
    reply_to_body?: boolean
    reply_to_sender?: boolean
    raw_payload?: boolean
    inbound_context?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["agentInboundMessage"]>

  export type AgentInboundMessageSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    trace_id?: boolean
    source?: boolean
    message_sid?: boolean
    dedupe_key?: boolean
    chat_type?: boolean
    session_key?: boolean
    peer_id?: boolean
    peer_name?: boolean
    sender_id?: boolean
    sender_name?: boolean
    account_id?: boolean
    is_read?: boolean
    read_at?: boolean
    received_at?: boolean
    message_timestamp?: boolean
    body_for_agent?: boolean
    raw_body?: boolean
    command_body?: boolean
    was_mentioned?: boolean
    reply_to_id?: boolean
    reply_to_body?: boolean
    reply_to_sender?: boolean
    raw_payload?: boolean
    inbound_context?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["agentInboundMessage"]>

  export type AgentInboundMessageSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    trace_id?: boolean
    source?: boolean
    message_sid?: boolean
    dedupe_key?: boolean
    chat_type?: boolean
    session_key?: boolean
    peer_id?: boolean
    peer_name?: boolean
    sender_id?: boolean
    sender_name?: boolean
    account_id?: boolean
    is_read?: boolean
    read_at?: boolean
    received_at?: boolean
    message_timestamp?: boolean
    body_for_agent?: boolean
    raw_body?: boolean
    command_body?: boolean
    was_mentioned?: boolean
    reply_to_id?: boolean
    reply_to_body?: boolean
    reply_to_sender?: boolean
    raw_payload?: boolean
    inbound_context?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["agentInboundMessage"]>

  export type AgentInboundMessageSelectScalar = {
    id?: boolean
    trace_id?: boolean
    source?: boolean
    message_sid?: boolean
    dedupe_key?: boolean
    chat_type?: boolean
    session_key?: boolean
    peer_id?: boolean
    peer_name?: boolean
    sender_id?: boolean
    sender_name?: boolean
    account_id?: boolean
    is_read?: boolean
    read_at?: boolean
    received_at?: boolean
    message_timestamp?: boolean
    body_for_agent?: boolean
    raw_body?: boolean
    command_body?: boolean
    was_mentioned?: boolean
    reply_to_id?: boolean
    reply_to_body?: boolean
    reply_to_sender?: boolean
    raw_payload?: boolean
    inbound_context?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type AgentInboundMessageOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "trace_id" | "source" | "message_sid" | "dedupe_key" | "chat_type" | "session_key" | "peer_id" | "peer_name" | "sender_id" | "sender_name" | "account_id" | "is_read" | "read_at" | "received_at" | "message_timestamp" | "body_for_agent" | "raw_body" | "command_body" | "was_mentioned" | "reply_to_id" | "reply_to_body" | "reply_to_sender" | "raw_payload" | "inbound_context" | "created_at" | "updated_at", ExtArgs["result"]["agentInboundMessage"]>

  export type $AgentInboundMessagePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AgentInboundMessage"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      trace_id: string
      source: string
      message_sid: string
      dedupe_key: string
      chat_type: string
      session_key: string
      peer_id: string
      peer_name: string | null
      sender_id: string
      sender_name: string | null
      account_id: string
      is_read: number
      read_at: Date | null
      received_at: Date
      message_timestamp: Date | null
      body_for_agent: string
      raw_body: string | null
      command_body: string | null
      was_mentioned: number
      reply_to_id: string | null
      reply_to_body: string | null
      reply_to_sender: string | null
      raw_payload: Prisma.JsonValue
      inbound_context: Prisma.JsonValue
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["agentInboundMessage"]>
    composites: {}
  }

  type AgentInboundMessageGetPayload<S extends boolean | null | undefined | AgentInboundMessageDefaultArgs> = $Result.GetResult<Prisma.$AgentInboundMessagePayload, S>

  type AgentInboundMessageCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<AgentInboundMessageFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: AgentInboundMessageCountAggregateInputType | true
    }

  export interface AgentInboundMessageDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AgentInboundMessage'], meta: { name: 'AgentInboundMessage' } }
    /**
     * Find zero or one AgentInboundMessage that matches the filter.
     * @param {AgentInboundMessageFindUniqueArgs} args - Arguments to find a AgentInboundMessage
     * @example
     * // Get one AgentInboundMessage
     * const agentInboundMessage = await prisma.agentInboundMessage.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AgentInboundMessageFindUniqueArgs>(args: SelectSubset<T, AgentInboundMessageFindUniqueArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one AgentInboundMessage that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {AgentInboundMessageFindUniqueOrThrowArgs} args - Arguments to find a AgentInboundMessage
     * @example
     * // Get one AgentInboundMessage
     * const agentInboundMessage = await prisma.agentInboundMessage.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AgentInboundMessageFindUniqueOrThrowArgs>(args: SelectSubset<T, AgentInboundMessageFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first AgentInboundMessage that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageFindFirstArgs} args - Arguments to find a AgentInboundMessage
     * @example
     * // Get one AgentInboundMessage
     * const agentInboundMessage = await prisma.agentInboundMessage.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AgentInboundMessageFindFirstArgs>(args?: SelectSubset<T, AgentInboundMessageFindFirstArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first AgentInboundMessage that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageFindFirstOrThrowArgs} args - Arguments to find a AgentInboundMessage
     * @example
     * // Get one AgentInboundMessage
     * const agentInboundMessage = await prisma.agentInboundMessage.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AgentInboundMessageFindFirstOrThrowArgs>(args?: SelectSubset<T, AgentInboundMessageFindFirstOrThrowArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more AgentInboundMessages that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AgentInboundMessages
     * const agentInboundMessages = await prisma.agentInboundMessage.findMany()
     * 
     * // Get first 10 AgentInboundMessages
     * const agentInboundMessages = await prisma.agentInboundMessage.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agentInboundMessageWithIdOnly = await prisma.agentInboundMessage.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AgentInboundMessageFindManyArgs>(args?: SelectSubset<T, AgentInboundMessageFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a AgentInboundMessage.
     * @param {AgentInboundMessageCreateArgs} args - Arguments to create a AgentInboundMessage.
     * @example
     * // Create one AgentInboundMessage
     * const AgentInboundMessage = await prisma.agentInboundMessage.create({
     *   data: {
     *     // ... data to create a AgentInboundMessage
     *   }
     * })
     * 
     */
    create<T extends AgentInboundMessageCreateArgs>(args: SelectSubset<T, AgentInboundMessageCreateArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many AgentInboundMessages.
     * @param {AgentInboundMessageCreateManyArgs} args - Arguments to create many AgentInboundMessages.
     * @example
     * // Create many AgentInboundMessages
     * const agentInboundMessage = await prisma.agentInboundMessage.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AgentInboundMessageCreateManyArgs>(args?: SelectSubset<T, AgentInboundMessageCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AgentInboundMessages and returns the data saved in the database.
     * @param {AgentInboundMessageCreateManyAndReturnArgs} args - Arguments to create many AgentInboundMessages.
     * @example
     * // Create many AgentInboundMessages
     * const agentInboundMessage = await prisma.agentInboundMessage.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AgentInboundMessages and only return the `id`
     * const agentInboundMessageWithIdOnly = await prisma.agentInboundMessage.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AgentInboundMessageCreateManyAndReturnArgs>(args?: SelectSubset<T, AgentInboundMessageCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a AgentInboundMessage.
     * @param {AgentInboundMessageDeleteArgs} args - Arguments to delete one AgentInboundMessage.
     * @example
     * // Delete one AgentInboundMessage
     * const AgentInboundMessage = await prisma.agentInboundMessage.delete({
     *   where: {
     *     // ... filter to delete one AgentInboundMessage
     *   }
     * })
     * 
     */
    delete<T extends AgentInboundMessageDeleteArgs>(args: SelectSubset<T, AgentInboundMessageDeleteArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one AgentInboundMessage.
     * @param {AgentInboundMessageUpdateArgs} args - Arguments to update one AgentInboundMessage.
     * @example
     * // Update one AgentInboundMessage
     * const agentInboundMessage = await prisma.agentInboundMessage.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AgentInboundMessageUpdateArgs>(args: SelectSubset<T, AgentInboundMessageUpdateArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more AgentInboundMessages.
     * @param {AgentInboundMessageDeleteManyArgs} args - Arguments to filter AgentInboundMessages to delete.
     * @example
     * // Delete a few AgentInboundMessages
     * const { count } = await prisma.agentInboundMessage.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AgentInboundMessageDeleteManyArgs>(args?: SelectSubset<T, AgentInboundMessageDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentInboundMessages.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AgentInboundMessages
     * const agentInboundMessage = await prisma.agentInboundMessage.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AgentInboundMessageUpdateManyArgs>(args: SelectSubset<T, AgentInboundMessageUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentInboundMessages and returns the data updated in the database.
     * @param {AgentInboundMessageUpdateManyAndReturnArgs} args - Arguments to update many AgentInboundMessages.
     * @example
     * // Update many AgentInboundMessages
     * const agentInboundMessage = await prisma.agentInboundMessage.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more AgentInboundMessages and only return the `id`
     * const agentInboundMessageWithIdOnly = await prisma.agentInboundMessage.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends AgentInboundMessageUpdateManyAndReturnArgs>(args: SelectSubset<T, AgentInboundMessageUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one AgentInboundMessage.
     * @param {AgentInboundMessageUpsertArgs} args - Arguments to update or create a AgentInboundMessage.
     * @example
     * // Update or create a AgentInboundMessage
     * const agentInboundMessage = await prisma.agentInboundMessage.upsert({
     *   create: {
     *     // ... data to create a AgentInboundMessage
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AgentInboundMessage we want to update
     *   }
     * })
     */
    upsert<T extends AgentInboundMessageUpsertArgs>(args: SelectSubset<T, AgentInboundMessageUpsertArgs<ExtArgs>>): Prisma__AgentInboundMessageClient<$Result.GetResult<Prisma.$AgentInboundMessagePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of AgentInboundMessages.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageCountArgs} args - Arguments to filter AgentInboundMessages to count.
     * @example
     * // Count the number of AgentInboundMessages
     * const count = await prisma.agentInboundMessage.count({
     *   where: {
     *     // ... the filter for the AgentInboundMessages we want to count
     *   }
     * })
    **/
    count<T extends AgentInboundMessageCountArgs>(
      args?: Subset<T, AgentInboundMessageCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AgentInboundMessageCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AgentInboundMessage.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AgentInboundMessageAggregateArgs>(args: Subset<T, AgentInboundMessageAggregateArgs>): Prisma.PrismaPromise<GetAgentInboundMessageAggregateType<T>>

    /**
     * Group by AgentInboundMessage.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentInboundMessageGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AgentInboundMessageGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AgentInboundMessageGroupByArgs['orderBy'] }
        : { orderBy?: AgentInboundMessageGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AgentInboundMessageGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgentInboundMessageGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AgentInboundMessage model
   */
  readonly fields: AgentInboundMessageFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AgentInboundMessage.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AgentInboundMessageClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AgentInboundMessage model
   */
  interface AgentInboundMessageFieldRefs {
    readonly id: FieldRef<"AgentInboundMessage", 'BigInt'>
    readonly trace_id: FieldRef<"AgentInboundMessage", 'String'>
    readonly source: FieldRef<"AgentInboundMessage", 'String'>
    readonly message_sid: FieldRef<"AgentInboundMessage", 'String'>
    readonly dedupe_key: FieldRef<"AgentInboundMessage", 'String'>
    readonly chat_type: FieldRef<"AgentInboundMessage", 'String'>
    readonly session_key: FieldRef<"AgentInboundMessage", 'String'>
    readonly peer_id: FieldRef<"AgentInboundMessage", 'String'>
    readonly peer_name: FieldRef<"AgentInboundMessage", 'String'>
    readonly sender_id: FieldRef<"AgentInboundMessage", 'String'>
    readonly sender_name: FieldRef<"AgentInboundMessage", 'String'>
    readonly account_id: FieldRef<"AgentInboundMessage", 'String'>
    readonly is_read: FieldRef<"AgentInboundMessage", 'Int'>
    readonly read_at: FieldRef<"AgentInboundMessage", 'DateTime'>
    readonly received_at: FieldRef<"AgentInboundMessage", 'DateTime'>
    readonly message_timestamp: FieldRef<"AgentInboundMessage", 'DateTime'>
    readonly body_for_agent: FieldRef<"AgentInboundMessage", 'String'>
    readonly raw_body: FieldRef<"AgentInboundMessage", 'String'>
    readonly command_body: FieldRef<"AgentInboundMessage", 'String'>
    readonly was_mentioned: FieldRef<"AgentInboundMessage", 'Int'>
    readonly reply_to_id: FieldRef<"AgentInboundMessage", 'String'>
    readonly reply_to_body: FieldRef<"AgentInboundMessage", 'String'>
    readonly reply_to_sender: FieldRef<"AgentInboundMessage", 'String'>
    readonly raw_payload: FieldRef<"AgentInboundMessage", 'Json'>
    readonly inbound_context: FieldRef<"AgentInboundMessage", 'Json'>
    readonly created_at: FieldRef<"AgentInboundMessage", 'DateTime'>
    readonly updated_at: FieldRef<"AgentInboundMessage", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AgentInboundMessage findUnique
   */
  export type AgentInboundMessageFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * Filter, which AgentInboundMessage to fetch.
     */
    where: AgentInboundMessageWhereUniqueInput
  }

  /**
   * AgentInboundMessage findUniqueOrThrow
   */
  export type AgentInboundMessageFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * Filter, which AgentInboundMessage to fetch.
     */
    where: AgentInboundMessageWhereUniqueInput
  }

  /**
   * AgentInboundMessage findFirst
   */
  export type AgentInboundMessageFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * Filter, which AgentInboundMessage to fetch.
     */
    where?: AgentInboundMessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentInboundMessages to fetch.
     */
    orderBy?: AgentInboundMessageOrderByWithRelationInput | AgentInboundMessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentInboundMessages.
     */
    cursor?: AgentInboundMessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentInboundMessages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentInboundMessages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentInboundMessages.
     */
    distinct?: AgentInboundMessageScalarFieldEnum | AgentInboundMessageScalarFieldEnum[]
  }

  /**
   * AgentInboundMessage findFirstOrThrow
   */
  export type AgentInboundMessageFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * Filter, which AgentInboundMessage to fetch.
     */
    where?: AgentInboundMessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentInboundMessages to fetch.
     */
    orderBy?: AgentInboundMessageOrderByWithRelationInput | AgentInboundMessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentInboundMessages.
     */
    cursor?: AgentInboundMessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentInboundMessages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentInboundMessages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentInboundMessages.
     */
    distinct?: AgentInboundMessageScalarFieldEnum | AgentInboundMessageScalarFieldEnum[]
  }

  /**
   * AgentInboundMessage findMany
   */
  export type AgentInboundMessageFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * Filter, which AgentInboundMessages to fetch.
     */
    where?: AgentInboundMessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentInboundMessages to fetch.
     */
    orderBy?: AgentInboundMessageOrderByWithRelationInput | AgentInboundMessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AgentInboundMessages.
     */
    cursor?: AgentInboundMessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentInboundMessages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentInboundMessages.
     */
    skip?: number
    distinct?: AgentInboundMessageScalarFieldEnum | AgentInboundMessageScalarFieldEnum[]
  }

  /**
   * AgentInboundMessage create
   */
  export type AgentInboundMessageCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * The data needed to create a AgentInboundMessage.
     */
    data: XOR<AgentInboundMessageCreateInput, AgentInboundMessageUncheckedCreateInput>
  }

  /**
   * AgentInboundMessage createMany
   */
  export type AgentInboundMessageCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AgentInboundMessages.
     */
    data: AgentInboundMessageCreateManyInput | AgentInboundMessageCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentInboundMessage createManyAndReturn
   */
  export type AgentInboundMessageCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * The data used to create many AgentInboundMessages.
     */
    data: AgentInboundMessageCreateManyInput | AgentInboundMessageCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentInboundMessage update
   */
  export type AgentInboundMessageUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * The data needed to update a AgentInboundMessage.
     */
    data: XOR<AgentInboundMessageUpdateInput, AgentInboundMessageUncheckedUpdateInput>
    /**
     * Choose, which AgentInboundMessage to update.
     */
    where: AgentInboundMessageWhereUniqueInput
  }

  /**
   * AgentInboundMessage updateMany
   */
  export type AgentInboundMessageUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AgentInboundMessages.
     */
    data: XOR<AgentInboundMessageUpdateManyMutationInput, AgentInboundMessageUncheckedUpdateManyInput>
    /**
     * Filter which AgentInboundMessages to update
     */
    where?: AgentInboundMessageWhereInput
    /**
     * Limit how many AgentInboundMessages to update.
     */
    limit?: number
  }

  /**
   * AgentInboundMessage updateManyAndReturn
   */
  export type AgentInboundMessageUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * The data used to update AgentInboundMessages.
     */
    data: XOR<AgentInboundMessageUpdateManyMutationInput, AgentInboundMessageUncheckedUpdateManyInput>
    /**
     * Filter which AgentInboundMessages to update
     */
    where?: AgentInboundMessageWhereInput
    /**
     * Limit how many AgentInboundMessages to update.
     */
    limit?: number
  }

  /**
   * AgentInboundMessage upsert
   */
  export type AgentInboundMessageUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * The filter to search for the AgentInboundMessage to update in case it exists.
     */
    where: AgentInboundMessageWhereUniqueInput
    /**
     * In case the AgentInboundMessage found by the `where` argument doesn't exist, create a new AgentInboundMessage with this data.
     */
    create: XOR<AgentInboundMessageCreateInput, AgentInboundMessageUncheckedCreateInput>
    /**
     * In case the AgentInboundMessage was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AgentInboundMessageUpdateInput, AgentInboundMessageUncheckedUpdateInput>
  }

  /**
   * AgentInboundMessage delete
   */
  export type AgentInboundMessageDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
    /**
     * Filter which AgentInboundMessage to delete.
     */
    where: AgentInboundMessageWhereUniqueInput
  }

  /**
   * AgentInboundMessage deleteMany
   */
  export type AgentInboundMessageDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentInboundMessages to delete
     */
    where?: AgentInboundMessageWhereInput
    /**
     * Limit how many AgentInboundMessages to delete.
     */
    limit?: number
  }

  /**
   * AgentInboundMessage without action
   */
  export type AgentInboundMessageDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentInboundMessage
     */
    select?: AgentInboundMessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentInboundMessage
     */
    omit?: AgentInboundMessageOmit<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const GroupChatSettingScalarFieldEnum: {
    group_id: 'group_id',
    group_name: 'group_name',
    is_enabled: 'is_enabled',
    auto_reply_enabled: 'auto_reply_enabled',
    welcome_message: 'welcome_message',
    admin_user_id: 'admin_user_id',
    agent_prompt_id: 'agent_prompt_id',
    last_activity: 'last_activity',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type GroupChatSettingScalarFieldEnum = (typeof GroupChatSettingScalarFieldEnum)[keyof typeof GroupChatSettingScalarFieldEnum]


  export const PrivateChatSettingScalarFieldEnum: {
    user_id: 'user_id',
    username: 'username',
    is_enabled: 'is_enabled',
    auto_reply_enabled: 'auto_reply_enabled',
    welcome_message: 'welcome_message',
    user_notes: 'user_notes',
    agent_prompt_id: 'agent_prompt_id',
    last_activity: 'last_activity',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type PrivateChatSettingScalarFieldEnum = (typeof PrivateChatSettingScalarFieldEnum)[keyof typeof PrivateChatSettingScalarFieldEnum]


  export const AgentInboundMessageScalarFieldEnum: {
    id: 'id',
    trace_id: 'trace_id',
    source: 'source',
    message_sid: 'message_sid',
    dedupe_key: 'dedupe_key',
    chat_type: 'chat_type',
    session_key: 'session_key',
    peer_id: 'peer_id',
    peer_name: 'peer_name',
    sender_id: 'sender_id',
    sender_name: 'sender_name',
    account_id: 'account_id',
    is_read: 'is_read',
    read_at: 'read_at',
    received_at: 'received_at',
    message_timestamp: 'message_timestamp',
    body_for_agent: 'body_for_agent',
    raw_body: 'raw_body',
    command_body: 'command_body',
    was_mentioned: 'was_mentioned',
    reply_to_id: 'reply_to_id',
    reply_to_body: 'reply_to_body',
    reply_to_sender: 'reply_to_sender',
    raw_payload: 'raw_payload',
    inbound_context: 'inbound_context',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type AgentInboundMessageScalarFieldEnum = (typeof AgentInboundMessageScalarFieldEnum)[keyof typeof AgentInboundMessageScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'BigInt'
   */
  export type BigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt'>
    


  /**
   * Reference to a field of type 'BigInt[]'
   */
  export type ListBigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt[]'>
    


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'QueryMode'
   */
  export type EnumQueryModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueryMode'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type GroupChatSettingWhereInput = {
    AND?: GroupChatSettingWhereInput | GroupChatSettingWhereInput[]
    OR?: GroupChatSettingWhereInput[]
    NOT?: GroupChatSettingWhereInput | GroupChatSettingWhereInput[]
    group_id?: BigIntFilter<"GroupChatSetting"> | bigint | number
    group_name?: StringNullableFilter<"GroupChatSetting"> | string | null
    is_enabled?: IntFilter<"GroupChatSetting"> | number
    auto_reply_enabled?: IntFilter<"GroupChatSetting"> | number
    welcome_message?: StringNullableFilter<"GroupChatSetting"> | string | null
    admin_user_id?: BigIntNullableFilter<"GroupChatSetting"> | bigint | number | null
    agent_prompt_id?: StringNullableFilter<"GroupChatSetting"> | string | null
    last_activity?: DateTimeNullableFilter<"GroupChatSetting"> | Date | string | null
    created_at?: DateTimeFilter<"GroupChatSetting"> | Date | string
    updated_at?: DateTimeFilter<"GroupChatSetting"> | Date | string
  }

  export type GroupChatSettingOrderByWithRelationInput = {
    group_id?: SortOrder
    group_name?: SortOrderInput | SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrderInput | SortOrder
    admin_user_id?: SortOrderInput | SortOrder
    agent_prompt_id?: SortOrderInput | SortOrder
    last_activity?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupChatSettingWhereUniqueInput = Prisma.AtLeast<{
    group_id?: bigint | number
    AND?: GroupChatSettingWhereInput | GroupChatSettingWhereInput[]
    OR?: GroupChatSettingWhereInput[]
    NOT?: GroupChatSettingWhereInput | GroupChatSettingWhereInput[]
    group_name?: StringNullableFilter<"GroupChatSetting"> | string | null
    is_enabled?: IntFilter<"GroupChatSetting"> | number
    auto_reply_enabled?: IntFilter<"GroupChatSetting"> | number
    welcome_message?: StringNullableFilter<"GroupChatSetting"> | string | null
    admin_user_id?: BigIntNullableFilter<"GroupChatSetting"> | bigint | number | null
    agent_prompt_id?: StringNullableFilter<"GroupChatSetting"> | string | null
    last_activity?: DateTimeNullableFilter<"GroupChatSetting"> | Date | string | null
    created_at?: DateTimeFilter<"GroupChatSetting"> | Date | string
    updated_at?: DateTimeFilter<"GroupChatSetting"> | Date | string
  }, "group_id">

  export type GroupChatSettingOrderByWithAggregationInput = {
    group_id?: SortOrder
    group_name?: SortOrderInput | SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrderInput | SortOrder
    admin_user_id?: SortOrderInput | SortOrder
    agent_prompt_id?: SortOrderInput | SortOrder
    last_activity?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: GroupChatSettingCountOrderByAggregateInput
    _avg?: GroupChatSettingAvgOrderByAggregateInput
    _max?: GroupChatSettingMaxOrderByAggregateInput
    _min?: GroupChatSettingMinOrderByAggregateInput
    _sum?: GroupChatSettingSumOrderByAggregateInput
  }

  export type GroupChatSettingScalarWhereWithAggregatesInput = {
    AND?: GroupChatSettingScalarWhereWithAggregatesInput | GroupChatSettingScalarWhereWithAggregatesInput[]
    OR?: GroupChatSettingScalarWhereWithAggregatesInput[]
    NOT?: GroupChatSettingScalarWhereWithAggregatesInput | GroupChatSettingScalarWhereWithAggregatesInput[]
    group_id?: BigIntWithAggregatesFilter<"GroupChatSetting"> | bigint | number
    group_name?: StringNullableWithAggregatesFilter<"GroupChatSetting"> | string | null
    is_enabled?: IntWithAggregatesFilter<"GroupChatSetting"> | number
    auto_reply_enabled?: IntWithAggregatesFilter<"GroupChatSetting"> | number
    welcome_message?: StringNullableWithAggregatesFilter<"GroupChatSetting"> | string | null
    admin_user_id?: BigIntNullableWithAggregatesFilter<"GroupChatSetting"> | bigint | number | null
    agent_prompt_id?: StringNullableWithAggregatesFilter<"GroupChatSetting"> | string | null
    last_activity?: DateTimeNullableWithAggregatesFilter<"GroupChatSetting"> | Date | string | null
    created_at?: DateTimeWithAggregatesFilter<"GroupChatSetting"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"GroupChatSetting"> | Date | string
  }

  export type PrivateChatSettingWhereInput = {
    AND?: PrivateChatSettingWhereInput | PrivateChatSettingWhereInput[]
    OR?: PrivateChatSettingWhereInput[]
    NOT?: PrivateChatSettingWhereInput | PrivateChatSettingWhereInput[]
    user_id?: BigIntFilter<"PrivateChatSetting"> | bigint | number
    username?: StringNullableFilter<"PrivateChatSetting"> | string | null
    is_enabled?: IntFilter<"PrivateChatSetting"> | number
    auto_reply_enabled?: IntFilter<"PrivateChatSetting"> | number
    welcome_message?: StringNullableFilter<"PrivateChatSetting"> | string | null
    user_notes?: StringNullableFilter<"PrivateChatSetting"> | string | null
    agent_prompt_id?: StringNullableFilter<"PrivateChatSetting"> | string | null
    last_activity?: DateTimeNullableFilter<"PrivateChatSetting"> | Date | string | null
    created_at?: DateTimeFilter<"PrivateChatSetting"> | Date | string
    updated_at?: DateTimeFilter<"PrivateChatSetting"> | Date | string
  }

  export type PrivateChatSettingOrderByWithRelationInput = {
    user_id?: SortOrder
    username?: SortOrderInput | SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrderInput | SortOrder
    user_notes?: SortOrderInput | SortOrder
    agent_prompt_id?: SortOrderInput | SortOrder
    last_activity?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PrivateChatSettingWhereUniqueInput = Prisma.AtLeast<{
    user_id?: bigint | number
    AND?: PrivateChatSettingWhereInput | PrivateChatSettingWhereInput[]
    OR?: PrivateChatSettingWhereInput[]
    NOT?: PrivateChatSettingWhereInput | PrivateChatSettingWhereInput[]
    username?: StringNullableFilter<"PrivateChatSetting"> | string | null
    is_enabled?: IntFilter<"PrivateChatSetting"> | number
    auto_reply_enabled?: IntFilter<"PrivateChatSetting"> | number
    welcome_message?: StringNullableFilter<"PrivateChatSetting"> | string | null
    user_notes?: StringNullableFilter<"PrivateChatSetting"> | string | null
    agent_prompt_id?: StringNullableFilter<"PrivateChatSetting"> | string | null
    last_activity?: DateTimeNullableFilter<"PrivateChatSetting"> | Date | string | null
    created_at?: DateTimeFilter<"PrivateChatSetting"> | Date | string
    updated_at?: DateTimeFilter<"PrivateChatSetting"> | Date | string
  }, "user_id">

  export type PrivateChatSettingOrderByWithAggregationInput = {
    user_id?: SortOrder
    username?: SortOrderInput | SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrderInput | SortOrder
    user_notes?: SortOrderInput | SortOrder
    agent_prompt_id?: SortOrderInput | SortOrder
    last_activity?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: PrivateChatSettingCountOrderByAggregateInput
    _avg?: PrivateChatSettingAvgOrderByAggregateInput
    _max?: PrivateChatSettingMaxOrderByAggregateInput
    _min?: PrivateChatSettingMinOrderByAggregateInput
    _sum?: PrivateChatSettingSumOrderByAggregateInput
  }

  export type PrivateChatSettingScalarWhereWithAggregatesInput = {
    AND?: PrivateChatSettingScalarWhereWithAggregatesInput | PrivateChatSettingScalarWhereWithAggregatesInput[]
    OR?: PrivateChatSettingScalarWhereWithAggregatesInput[]
    NOT?: PrivateChatSettingScalarWhereWithAggregatesInput | PrivateChatSettingScalarWhereWithAggregatesInput[]
    user_id?: BigIntWithAggregatesFilter<"PrivateChatSetting"> | bigint | number
    username?: StringNullableWithAggregatesFilter<"PrivateChatSetting"> | string | null
    is_enabled?: IntWithAggregatesFilter<"PrivateChatSetting"> | number
    auto_reply_enabled?: IntWithAggregatesFilter<"PrivateChatSetting"> | number
    welcome_message?: StringNullableWithAggregatesFilter<"PrivateChatSetting"> | string | null
    user_notes?: StringNullableWithAggregatesFilter<"PrivateChatSetting"> | string | null
    agent_prompt_id?: StringNullableWithAggregatesFilter<"PrivateChatSetting"> | string | null
    last_activity?: DateTimeNullableWithAggregatesFilter<"PrivateChatSetting"> | Date | string | null
    created_at?: DateTimeWithAggregatesFilter<"PrivateChatSetting"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"PrivateChatSetting"> | Date | string
  }

  export type AgentInboundMessageWhereInput = {
    AND?: AgentInboundMessageWhereInput | AgentInboundMessageWhereInput[]
    OR?: AgentInboundMessageWhereInput[]
    NOT?: AgentInboundMessageWhereInput | AgentInboundMessageWhereInput[]
    id?: BigIntFilter<"AgentInboundMessage"> | bigint | number
    trace_id?: StringFilter<"AgentInboundMessage"> | string
    source?: StringFilter<"AgentInboundMessage"> | string
    message_sid?: StringFilter<"AgentInboundMessage"> | string
    dedupe_key?: StringFilter<"AgentInboundMessage"> | string
    chat_type?: StringFilter<"AgentInboundMessage"> | string
    session_key?: StringFilter<"AgentInboundMessage"> | string
    peer_id?: StringFilter<"AgentInboundMessage"> | string
    peer_name?: StringNullableFilter<"AgentInboundMessage"> | string | null
    sender_id?: StringFilter<"AgentInboundMessage"> | string
    sender_name?: StringNullableFilter<"AgentInboundMessage"> | string | null
    account_id?: StringFilter<"AgentInboundMessage"> | string
    is_read?: IntFilter<"AgentInboundMessage"> | number
    read_at?: DateTimeNullableFilter<"AgentInboundMessage"> | Date | string | null
    received_at?: DateTimeFilter<"AgentInboundMessage"> | Date | string
    message_timestamp?: DateTimeNullableFilter<"AgentInboundMessage"> | Date | string | null
    body_for_agent?: StringFilter<"AgentInboundMessage"> | string
    raw_body?: StringNullableFilter<"AgentInboundMessage"> | string | null
    command_body?: StringNullableFilter<"AgentInboundMessage"> | string | null
    was_mentioned?: IntFilter<"AgentInboundMessage"> | number
    reply_to_id?: StringNullableFilter<"AgentInboundMessage"> | string | null
    reply_to_body?: StringNullableFilter<"AgentInboundMessage"> | string | null
    reply_to_sender?: StringNullableFilter<"AgentInboundMessage"> | string | null
    raw_payload?: JsonFilter<"AgentInboundMessage">
    inbound_context?: JsonFilter<"AgentInboundMessage">
    created_at?: DateTimeFilter<"AgentInboundMessage"> | Date | string
    updated_at?: DateTimeFilter<"AgentInboundMessage"> | Date | string
  }

  export type AgentInboundMessageOrderByWithRelationInput = {
    id?: SortOrder
    trace_id?: SortOrder
    source?: SortOrder
    message_sid?: SortOrder
    dedupe_key?: SortOrder
    chat_type?: SortOrder
    session_key?: SortOrder
    peer_id?: SortOrder
    peer_name?: SortOrderInput | SortOrder
    sender_id?: SortOrder
    sender_name?: SortOrderInput | SortOrder
    account_id?: SortOrder
    is_read?: SortOrder
    read_at?: SortOrderInput | SortOrder
    received_at?: SortOrder
    message_timestamp?: SortOrderInput | SortOrder
    body_for_agent?: SortOrder
    raw_body?: SortOrderInput | SortOrder
    command_body?: SortOrderInput | SortOrder
    was_mentioned?: SortOrder
    reply_to_id?: SortOrderInput | SortOrder
    reply_to_body?: SortOrderInput | SortOrder
    reply_to_sender?: SortOrderInput | SortOrder
    raw_payload?: SortOrder
    inbound_context?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type AgentInboundMessageWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    dedupe_key?: string
    AND?: AgentInboundMessageWhereInput | AgentInboundMessageWhereInput[]
    OR?: AgentInboundMessageWhereInput[]
    NOT?: AgentInboundMessageWhereInput | AgentInboundMessageWhereInput[]
    trace_id?: StringFilter<"AgentInboundMessage"> | string
    source?: StringFilter<"AgentInboundMessage"> | string
    message_sid?: StringFilter<"AgentInboundMessage"> | string
    chat_type?: StringFilter<"AgentInboundMessage"> | string
    session_key?: StringFilter<"AgentInboundMessage"> | string
    peer_id?: StringFilter<"AgentInboundMessage"> | string
    peer_name?: StringNullableFilter<"AgentInboundMessage"> | string | null
    sender_id?: StringFilter<"AgentInboundMessage"> | string
    sender_name?: StringNullableFilter<"AgentInboundMessage"> | string | null
    account_id?: StringFilter<"AgentInboundMessage"> | string
    is_read?: IntFilter<"AgentInboundMessage"> | number
    read_at?: DateTimeNullableFilter<"AgentInboundMessage"> | Date | string | null
    received_at?: DateTimeFilter<"AgentInboundMessage"> | Date | string
    message_timestamp?: DateTimeNullableFilter<"AgentInboundMessage"> | Date | string | null
    body_for_agent?: StringFilter<"AgentInboundMessage"> | string
    raw_body?: StringNullableFilter<"AgentInboundMessage"> | string | null
    command_body?: StringNullableFilter<"AgentInboundMessage"> | string | null
    was_mentioned?: IntFilter<"AgentInboundMessage"> | number
    reply_to_id?: StringNullableFilter<"AgentInboundMessage"> | string | null
    reply_to_body?: StringNullableFilter<"AgentInboundMessage"> | string | null
    reply_to_sender?: StringNullableFilter<"AgentInboundMessage"> | string | null
    raw_payload?: JsonFilter<"AgentInboundMessage">
    inbound_context?: JsonFilter<"AgentInboundMessage">
    created_at?: DateTimeFilter<"AgentInboundMessage"> | Date | string
    updated_at?: DateTimeFilter<"AgentInboundMessage"> | Date | string
  }, "id" | "dedupe_key">

  export type AgentInboundMessageOrderByWithAggregationInput = {
    id?: SortOrder
    trace_id?: SortOrder
    source?: SortOrder
    message_sid?: SortOrder
    dedupe_key?: SortOrder
    chat_type?: SortOrder
    session_key?: SortOrder
    peer_id?: SortOrder
    peer_name?: SortOrderInput | SortOrder
    sender_id?: SortOrder
    sender_name?: SortOrderInput | SortOrder
    account_id?: SortOrder
    is_read?: SortOrder
    read_at?: SortOrderInput | SortOrder
    received_at?: SortOrder
    message_timestamp?: SortOrderInput | SortOrder
    body_for_agent?: SortOrder
    raw_body?: SortOrderInput | SortOrder
    command_body?: SortOrderInput | SortOrder
    was_mentioned?: SortOrder
    reply_to_id?: SortOrderInput | SortOrder
    reply_to_body?: SortOrderInput | SortOrder
    reply_to_sender?: SortOrderInput | SortOrder
    raw_payload?: SortOrder
    inbound_context?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: AgentInboundMessageCountOrderByAggregateInput
    _avg?: AgentInboundMessageAvgOrderByAggregateInput
    _max?: AgentInboundMessageMaxOrderByAggregateInput
    _min?: AgentInboundMessageMinOrderByAggregateInput
    _sum?: AgentInboundMessageSumOrderByAggregateInput
  }

  export type AgentInboundMessageScalarWhereWithAggregatesInput = {
    AND?: AgentInboundMessageScalarWhereWithAggregatesInput | AgentInboundMessageScalarWhereWithAggregatesInput[]
    OR?: AgentInboundMessageScalarWhereWithAggregatesInput[]
    NOT?: AgentInboundMessageScalarWhereWithAggregatesInput | AgentInboundMessageScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"AgentInboundMessage"> | bigint | number
    trace_id?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    source?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    message_sid?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    dedupe_key?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    chat_type?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    session_key?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    peer_id?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    peer_name?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    sender_id?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    sender_name?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    account_id?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    is_read?: IntWithAggregatesFilter<"AgentInboundMessage"> | number
    read_at?: DateTimeNullableWithAggregatesFilter<"AgentInboundMessage"> | Date | string | null
    received_at?: DateTimeWithAggregatesFilter<"AgentInboundMessage"> | Date | string
    message_timestamp?: DateTimeNullableWithAggregatesFilter<"AgentInboundMessage"> | Date | string | null
    body_for_agent?: StringWithAggregatesFilter<"AgentInboundMessage"> | string
    raw_body?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    command_body?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    was_mentioned?: IntWithAggregatesFilter<"AgentInboundMessage"> | number
    reply_to_id?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    reply_to_body?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    reply_to_sender?: StringNullableWithAggregatesFilter<"AgentInboundMessage"> | string | null
    raw_payload?: JsonWithAggregatesFilter<"AgentInboundMessage">
    inbound_context?: JsonWithAggregatesFilter<"AgentInboundMessage">
    created_at?: DateTimeWithAggregatesFilter<"AgentInboundMessage"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"AgentInboundMessage"> | Date | string
  }

  export type GroupChatSettingCreateInput = {
    group_id: bigint | number
    group_name?: string | null
    is_enabled?: number
    auto_reply_enabled?: number
    welcome_message?: string | null
    admin_user_id?: bigint | number | null
    agent_prompt_id?: string | null
    last_activity?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type GroupChatSettingUncheckedCreateInput = {
    group_id: bigint | number
    group_name?: string | null
    is_enabled?: number
    auto_reply_enabled?: number
    welcome_message?: string | null
    admin_user_id?: bigint | number | null
    agent_prompt_id?: string | null
    last_activity?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type GroupChatSettingUpdateInput = {
    group_id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_name?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    admin_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupChatSettingUncheckedUpdateInput = {
    group_id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_name?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    admin_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupChatSettingCreateManyInput = {
    group_id: bigint | number
    group_name?: string | null
    is_enabled?: number
    auto_reply_enabled?: number
    welcome_message?: string | null
    admin_user_id?: bigint | number | null
    agent_prompt_id?: string | null
    last_activity?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type GroupChatSettingUpdateManyMutationInput = {
    group_id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_name?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    admin_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupChatSettingUncheckedUpdateManyInput = {
    group_id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_name?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    admin_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrivateChatSettingCreateInput = {
    user_id: bigint | number
    username?: string | null
    is_enabled?: number
    auto_reply_enabled?: number
    welcome_message?: string | null
    user_notes?: string | null
    agent_prompt_id?: string | null
    last_activity?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type PrivateChatSettingUncheckedCreateInput = {
    user_id: bigint | number
    username?: string | null
    is_enabled?: number
    auto_reply_enabled?: number
    welcome_message?: string | null
    user_notes?: string | null
    agent_prompt_id?: string | null
    last_activity?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type PrivateChatSettingUpdateInput = {
    user_id?: BigIntFieldUpdateOperationsInput | bigint | number
    username?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    user_notes?: NullableStringFieldUpdateOperationsInput | string | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrivateChatSettingUncheckedUpdateInput = {
    user_id?: BigIntFieldUpdateOperationsInput | bigint | number
    username?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    user_notes?: NullableStringFieldUpdateOperationsInput | string | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrivateChatSettingCreateManyInput = {
    user_id: bigint | number
    username?: string | null
    is_enabled?: number
    auto_reply_enabled?: number
    welcome_message?: string | null
    user_notes?: string | null
    agent_prompt_id?: string | null
    last_activity?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type PrivateChatSettingUpdateManyMutationInput = {
    user_id?: BigIntFieldUpdateOperationsInput | bigint | number
    username?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    user_notes?: NullableStringFieldUpdateOperationsInput | string | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PrivateChatSettingUncheckedUpdateManyInput = {
    user_id?: BigIntFieldUpdateOperationsInput | bigint | number
    username?: NullableStringFieldUpdateOperationsInput | string | null
    is_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    welcome_message?: NullableStringFieldUpdateOperationsInput | string | null
    user_notes?: NullableStringFieldUpdateOperationsInput | string | null
    agent_prompt_id?: NullableStringFieldUpdateOperationsInput | string | null
    last_activity?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentInboundMessageCreateInput = {
    id?: bigint | number
    trace_id: string
    source: string
    message_sid: string
    dedupe_key: string
    chat_type: string
    session_key: string
    peer_id: string
    peer_name?: string | null
    sender_id: string
    sender_name?: string | null
    account_id: string
    is_read?: number
    read_at?: Date | string | null
    received_at: Date | string
    message_timestamp?: Date | string | null
    body_for_agent: string
    raw_body?: string | null
    command_body?: string | null
    was_mentioned?: number
    reply_to_id?: string | null
    reply_to_body?: string | null
    reply_to_sender?: string | null
    raw_payload: JsonNullValueInput | InputJsonValue
    inbound_context: JsonNullValueInput | InputJsonValue
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type AgentInboundMessageUncheckedCreateInput = {
    id?: bigint | number
    trace_id: string
    source: string
    message_sid: string
    dedupe_key: string
    chat_type: string
    session_key: string
    peer_id: string
    peer_name?: string | null
    sender_id: string
    sender_name?: string | null
    account_id: string
    is_read?: number
    read_at?: Date | string | null
    received_at: Date | string
    message_timestamp?: Date | string | null
    body_for_agent: string
    raw_body?: string | null
    command_body?: string | null
    was_mentioned?: number
    reply_to_id?: string | null
    reply_to_body?: string | null
    reply_to_sender?: string | null
    raw_payload: JsonNullValueInput | InputJsonValue
    inbound_context: JsonNullValueInput | InputJsonValue
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type AgentInboundMessageUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    trace_id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    message_sid?: StringFieldUpdateOperationsInput | string
    dedupe_key?: StringFieldUpdateOperationsInput | string
    chat_type?: StringFieldUpdateOperationsInput | string
    session_key?: StringFieldUpdateOperationsInput | string
    peer_id?: StringFieldUpdateOperationsInput | string
    peer_name?: NullableStringFieldUpdateOperationsInput | string | null
    sender_id?: StringFieldUpdateOperationsInput | string
    sender_name?: NullableStringFieldUpdateOperationsInput | string | null
    account_id?: StringFieldUpdateOperationsInput | string
    is_read?: IntFieldUpdateOperationsInput | number
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    received_at?: DateTimeFieldUpdateOperationsInput | Date | string
    message_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    body_for_agent?: StringFieldUpdateOperationsInput | string
    raw_body?: NullableStringFieldUpdateOperationsInput | string | null
    command_body?: NullableStringFieldUpdateOperationsInput | string | null
    was_mentioned?: IntFieldUpdateOperationsInput | number
    reply_to_id?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_body?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_sender?: NullableStringFieldUpdateOperationsInput | string | null
    raw_payload?: JsonNullValueInput | InputJsonValue
    inbound_context?: JsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentInboundMessageUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    trace_id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    message_sid?: StringFieldUpdateOperationsInput | string
    dedupe_key?: StringFieldUpdateOperationsInput | string
    chat_type?: StringFieldUpdateOperationsInput | string
    session_key?: StringFieldUpdateOperationsInput | string
    peer_id?: StringFieldUpdateOperationsInput | string
    peer_name?: NullableStringFieldUpdateOperationsInput | string | null
    sender_id?: StringFieldUpdateOperationsInput | string
    sender_name?: NullableStringFieldUpdateOperationsInput | string | null
    account_id?: StringFieldUpdateOperationsInput | string
    is_read?: IntFieldUpdateOperationsInput | number
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    received_at?: DateTimeFieldUpdateOperationsInput | Date | string
    message_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    body_for_agent?: StringFieldUpdateOperationsInput | string
    raw_body?: NullableStringFieldUpdateOperationsInput | string | null
    command_body?: NullableStringFieldUpdateOperationsInput | string | null
    was_mentioned?: IntFieldUpdateOperationsInput | number
    reply_to_id?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_body?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_sender?: NullableStringFieldUpdateOperationsInput | string | null
    raw_payload?: JsonNullValueInput | InputJsonValue
    inbound_context?: JsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentInboundMessageCreateManyInput = {
    id?: bigint | number
    trace_id: string
    source: string
    message_sid: string
    dedupe_key: string
    chat_type: string
    session_key: string
    peer_id: string
    peer_name?: string | null
    sender_id: string
    sender_name?: string | null
    account_id: string
    is_read?: number
    read_at?: Date | string | null
    received_at: Date | string
    message_timestamp?: Date | string | null
    body_for_agent: string
    raw_body?: string | null
    command_body?: string | null
    was_mentioned?: number
    reply_to_id?: string | null
    reply_to_body?: string | null
    reply_to_sender?: string | null
    raw_payload: JsonNullValueInput | InputJsonValue
    inbound_context: JsonNullValueInput | InputJsonValue
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type AgentInboundMessageUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    trace_id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    message_sid?: StringFieldUpdateOperationsInput | string
    dedupe_key?: StringFieldUpdateOperationsInput | string
    chat_type?: StringFieldUpdateOperationsInput | string
    session_key?: StringFieldUpdateOperationsInput | string
    peer_id?: StringFieldUpdateOperationsInput | string
    peer_name?: NullableStringFieldUpdateOperationsInput | string | null
    sender_id?: StringFieldUpdateOperationsInput | string
    sender_name?: NullableStringFieldUpdateOperationsInput | string | null
    account_id?: StringFieldUpdateOperationsInput | string
    is_read?: IntFieldUpdateOperationsInput | number
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    received_at?: DateTimeFieldUpdateOperationsInput | Date | string
    message_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    body_for_agent?: StringFieldUpdateOperationsInput | string
    raw_body?: NullableStringFieldUpdateOperationsInput | string | null
    command_body?: NullableStringFieldUpdateOperationsInput | string | null
    was_mentioned?: IntFieldUpdateOperationsInput | number
    reply_to_id?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_body?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_sender?: NullableStringFieldUpdateOperationsInput | string | null
    raw_payload?: JsonNullValueInput | InputJsonValue
    inbound_context?: JsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentInboundMessageUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    trace_id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    message_sid?: StringFieldUpdateOperationsInput | string
    dedupe_key?: StringFieldUpdateOperationsInput | string
    chat_type?: StringFieldUpdateOperationsInput | string
    session_key?: StringFieldUpdateOperationsInput | string
    peer_id?: StringFieldUpdateOperationsInput | string
    peer_name?: NullableStringFieldUpdateOperationsInput | string | null
    sender_id?: StringFieldUpdateOperationsInput | string
    sender_name?: NullableStringFieldUpdateOperationsInput | string | null
    account_id?: StringFieldUpdateOperationsInput | string
    is_read?: IntFieldUpdateOperationsInput | number
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    received_at?: DateTimeFieldUpdateOperationsInput | Date | string
    message_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    body_for_agent?: StringFieldUpdateOperationsInput | string
    raw_body?: NullableStringFieldUpdateOperationsInput | string | null
    command_body?: NullableStringFieldUpdateOperationsInput | string | null
    was_mentioned?: IntFieldUpdateOperationsInput | number
    reply_to_id?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_body?: NullableStringFieldUpdateOperationsInput | string | null
    reply_to_sender?: NullableStringFieldUpdateOperationsInput | string | null
    raw_payload?: JsonNullValueInput | InputJsonValue
    inbound_context?: JsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BigIntFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntFilter<$PrismaModel> | bigint | number
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type BigIntNullableFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableFilter<$PrismaModel> | bigint | number | null
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type GroupChatSettingCountOrderByAggregateInput = {
    group_id?: SortOrder
    group_name?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrder
    admin_user_id?: SortOrder
    agent_prompt_id?: SortOrder
    last_activity?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupChatSettingAvgOrderByAggregateInput = {
    group_id?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    admin_user_id?: SortOrder
  }

  export type GroupChatSettingMaxOrderByAggregateInput = {
    group_id?: SortOrder
    group_name?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrder
    admin_user_id?: SortOrder
    agent_prompt_id?: SortOrder
    last_activity?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupChatSettingMinOrderByAggregateInput = {
    group_id?: SortOrder
    group_name?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrder
    admin_user_id?: SortOrder
    agent_prompt_id?: SortOrder
    last_activity?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupChatSettingSumOrderByAggregateInput = {
    group_id?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    admin_user_id?: SortOrder
  }

  export type BigIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntWithAggregatesFilter<$PrismaModel> | bigint | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedBigIntFilter<$PrismaModel>
    _min?: NestedBigIntFilter<$PrismaModel>
    _max?: NestedBigIntFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type BigIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableWithAggregatesFilter<$PrismaModel> | bigint | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedBigIntNullableFilter<$PrismaModel>
    _min?: NestedBigIntNullableFilter<$PrismaModel>
    _max?: NestedBigIntNullableFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type PrivateChatSettingCountOrderByAggregateInput = {
    user_id?: SortOrder
    username?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrder
    user_notes?: SortOrder
    agent_prompt_id?: SortOrder
    last_activity?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PrivateChatSettingAvgOrderByAggregateInput = {
    user_id?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
  }

  export type PrivateChatSettingMaxOrderByAggregateInput = {
    user_id?: SortOrder
    username?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrder
    user_notes?: SortOrder
    agent_prompt_id?: SortOrder
    last_activity?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PrivateChatSettingMinOrderByAggregateInput = {
    user_id?: SortOrder
    username?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    welcome_message?: SortOrder
    user_notes?: SortOrder
    agent_prompt_id?: SortOrder
    last_activity?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PrivateChatSettingSumOrderByAggregateInput = {
    user_id?: SortOrder
    is_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }
  export type JsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type AgentInboundMessageCountOrderByAggregateInput = {
    id?: SortOrder
    trace_id?: SortOrder
    source?: SortOrder
    message_sid?: SortOrder
    dedupe_key?: SortOrder
    chat_type?: SortOrder
    session_key?: SortOrder
    peer_id?: SortOrder
    peer_name?: SortOrder
    sender_id?: SortOrder
    sender_name?: SortOrder
    account_id?: SortOrder
    is_read?: SortOrder
    read_at?: SortOrder
    received_at?: SortOrder
    message_timestamp?: SortOrder
    body_for_agent?: SortOrder
    raw_body?: SortOrder
    command_body?: SortOrder
    was_mentioned?: SortOrder
    reply_to_id?: SortOrder
    reply_to_body?: SortOrder
    reply_to_sender?: SortOrder
    raw_payload?: SortOrder
    inbound_context?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type AgentInboundMessageAvgOrderByAggregateInput = {
    id?: SortOrder
    is_read?: SortOrder
    was_mentioned?: SortOrder
  }

  export type AgentInboundMessageMaxOrderByAggregateInput = {
    id?: SortOrder
    trace_id?: SortOrder
    source?: SortOrder
    message_sid?: SortOrder
    dedupe_key?: SortOrder
    chat_type?: SortOrder
    session_key?: SortOrder
    peer_id?: SortOrder
    peer_name?: SortOrder
    sender_id?: SortOrder
    sender_name?: SortOrder
    account_id?: SortOrder
    is_read?: SortOrder
    read_at?: SortOrder
    received_at?: SortOrder
    message_timestamp?: SortOrder
    body_for_agent?: SortOrder
    raw_body?: SortOrder
    command_body?: SortOrder
    was_mentioned?: SortOrder
    reply_to_id?: SortOrder
    reply_to_body?: SortOrder
    reply_to_sender?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type AgentInboundMessageMinOrderByAggregateInput = {
    id?: SortOrder
    trace_id?: SortOrder
    source?: SortOrder
    message_sid?: SortOrder
    dedupe_key?: SortOrder
    chat_type?: SortOrder
    session_key?: SortOrder
    peer_id?: SortOrder
    peer_name?: SortOrder
    sender_id?: SortOrder
    sender_name?: SortOrder
    account_id?: SortOrder
    is_read?: SortOrder
    read_at?: SortOrder
    received_at?: SortOrder
    message_timestamp?: SortOrder
    body_for_agent?: SortOrder
    raw_body?: SortOrder
    command_body?: SortOrder
    was_mentioned?: SortOrder
    reply_to_id?: SortOrder
    reply_to_body?: SortOrder
    reply_to_sender?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type AgentInboundMessageSumOrderByAggregateInput = {
    id?: SortOrder
    is_read?: SortOrder
    was_mentioned?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type BigIntFieldUpdateOperationsInput = {
    set?: bigint | number
    increment?: bigint | number
    decrement?: bigint | number
    multiply?: bigint | number
    divide?: bigint | number
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableBigIntFieldUpdateOperationsInput = {
    set?: bigint | number | null
    increment?: bigint | number
    decrement?: bigint | number
    multiply?: bigint | number
    divide?: bigint | number
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NestedBigIntFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntFilter<$PrismaModel> | bigint | number
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedBigIntNullableFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableFilter<$PrismaModel> | bigint | number | null
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedBigIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntWithAggregatesFilter<$PrismaModel> | bigint | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedBigIntFilter<$PrismaModel>
    _min?: NestedBigIntFilter<$PrismaModel>
    _max?: NestedBigIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedBigIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableWithAggregatesFilter<$PrismaModel> | bigint | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedBigIntNullableFilter<$PrismaModel>
    _min?: NestedBigIntNullableFilter<$PrismaModel>
    _max?: NestedBigIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }
  export type NestedJsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}