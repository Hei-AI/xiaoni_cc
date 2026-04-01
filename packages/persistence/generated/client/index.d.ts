
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
 * Model HttpTrafficLog
 * 
 */
export type HttpTrafficLog = $Result.DefaultSelection<Prisma.$HttpTrafficLogPayload>
/**
 * Model ConversationItem
 * 
 */
export type ConversationItem = $Result.DefaultSelection<Prisma.$ConversationItemPayload>
/**
 * Model TrafficReplayHistory
 * 
 */
export type TrafficReplayHistory = $Result.DefaultSelection<Prisma.$TrafficReplayHistoryPayload>
/**
 * Model RelationshipLedgerEvent
 * 
 */
export type RelationshipLedgerEvent = $Result.DefaultSelection<Prisma.$RelationshipLedgerEventPayload>
/**
 * Model RelationshipMemoryJob
 * 
 */
export type RelationshipMemoryJob = $Result.DefaultSelection<Prisma.$RelationshipMemoryJobPayload>
/**
 * Model RelationshipMemoryCard
 * 
 */
export type RelationshipMemoryCard = $Result.DefaultSelection<Prisma.$RelationshipMemoryCardPayload>
/**
 * Model RelationshipMemoryOverride
 * 
 */
export type RelationshipMemoryOverride = $Result.DefaultSelection<Prisma.$RelationshipMemoryOverridePayload>

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

  /**
   * `prisma.httpTrafficLog`: Exposes CRUD operations for the **HttpTrafficLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more HttpTrafficLogs
    * const httpTrafficLogs = await prisma.httpTrafficLog.findMany()
    * ```
    */
  get httpTrafficLog(): Prisma.HttpTrafficLogDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.conversationItem`: Exposes CRUD operations for the **ConversationItem** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ConversationItems
    * const conversationItems = await prisma.conversationItem.findMany()
    * ```
    */
  get conversationItem(): Prisma.ConversationItemDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.trafficReplayHistory`: Exposes CRUD operations for the **TrafficReplayHistory** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TrafficReplayHistories
    * const trafficReplayHistories = await prisma.trafficReplayHistory.findMany()
    * ```
    */
  get trafficReplayHistory(): Prisma.TrafficReplayHistoryDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.relationshipLedgerEvent`: Exposes CRUD operations for the **RelationshipLedgerEvent** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more RelationshipLedgerEvents
    * const relationshipLedgerEvents = await prisma.relationshipLedgerEvent.findMany()
    * ```
    */
  get relationshipLedgerEvent(): Prisma.RelationshipLedgerEventDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.relationshipMemoryJob`: Exposes CRUD operations for the **RelationshipMemoryJob** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more RelationshipMemoryJobs
    * const relationshipMemoryJobs = await prisma.relationshipMemoryJob.findMany()
    * ```
    */
  get relationshipMemoryJob(): Prisma.RelationshipMemoryJobDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.relationshipMemoryCard`: Exposes CRUD operations for the **RelationshipMemoryCard** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more RelationshipMemoryCards
    * const relationshipMemoryCards = await prisma.relationshipMemoryCard.findMany()
    * ```
    */
  get relationshipMemoryCard(): Prisma.RelationshipMemoryCardDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.relationshipMemoryOverride`: Exposes CRUD operations for the **RelationshipMemoryOverride** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more RelationshipMemoryOverrides
    * const relationshipMemoryOverrides = await prisma.relationshipMemoryOverride.findMany()
    * ```
    */
  get relationshipMemoryOverride(): Prisma.RelationshipMemoryOverrideDelegate<ExtArgs, ClientOptions>;
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
    AgentInboundMessage: 'AgentInboundMessage',
    HttpTrafficLog: 'HttpTrafficLog',
    ConversationItem: 'ConversationItem',
    TrafficReplayHistory: 'TrafficReplayHistory',
    RelationshipLedgerEvent: 'RelationshipLedgerEvent',
    RelationshipMemoryJob: 'RelationshipMemoryJob',
    RelationshipMemoryCard: 'RelationshipMemoryCard',
    RelationshipMemoryOverride: 'RelationshipMemoryOverride'
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
      modelProps: "groupChatSetting" | "privateChatSetting" | "agentInboundMessage" | "httpTrafficLog" | "conversationItem" | "trafficReplayHistory" | "relationshipLedgerEvent" | "relationshipMemoryJob" | "relationshipMemoryCard" | "relationshipMemoryOverride"
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
      HttpTrafficLog: {
        payload: Prisma.$HttpTrafficLogPayload<ExtArgs>
        fields: Prisma.HttpTrafficLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.HttpTrafficLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.HttpTrafficLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>
          }
          findFirst: {
            args: Prisma.HttpTrafficLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.HttpTrafficLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>
          }
          findMany: {
            args: Prisma.HttpTrafficLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>[]
          }
          create: {
            args: Prisma.HttpTrafficLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>
          }
          createMany: {
            args: Prisma.HttpTrafficLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.HttpTrafficLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>[]
          }
          delete: {
            args: Prisma.HttpTrafficLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>
          }
          update: {
            args: Prisma.HttpTrafficLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>
          }
          deleteMany: {
            args: Prisma.HttpTrafficLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.HttpTrafficLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.HttpTrafficLogUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>[]
          }
          upsert: {
            args: Prisma.HttpTrafficLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$HttpTrafficLogPayload>
          }
          aggregate: {
            args: Prisma.HttpTrafficLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateHttpTrafficLog>
          }
          groupBy: {
            args: Prisma.HttpTrafficLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<HttpTrafficLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.HttpTrafficLogCountArgs<ExtArgs>
            result: $Utils.Optional<HttpTrafficLogCountAggregateOutputType> | number
          }
        }
      }
      ConversationItem: {
        payload: Prisma.$ConversationItemPayload<ExtArgs>
        fields: Prisma.ConversationItemFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ConversationItemFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ConversationItemFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>
          }
          findFirst: {
            args: Prisma.ConversationItemFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ConversationItemFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>
          }
          findMany: {
            args: Prisma.ConversationItemFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>[]
          }
          create: {
            args: Prisma.ConversationItemCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>
          }
          createMany: {
            args: Prisma.ConversationItemCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ConversationItemCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>[]
          }
          delete: {
            args: Prisma.ConversationItemDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>
          }
          update: {
            args: Prisma.ConversationItemUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>
          }
          deleteMany: {
            args: Prisma.ConversationItemDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ConversationItemUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.ConversationItemUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>[]
          }
          upsert: {
            args: Prisma.ConversationItemUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConversationItemPayload>
          }
          aggregate: {
            args: Prisma.ConversationItemAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateConversationItem>
          }
          groupBy: {
            args: Prisma.ConversationItemGroupByArgs<ExtArgs>
            result: $Utils.Optional<ConversationItemGroupByOutputType>[]
          }
          count: {
            args: Prisma.ConversationItemCountArgs<ExtArgs>
            result: $Utils.Optional<ConversationItemCountAggregateOutputType> | number
          }
        }
      }
      TrafficReplayHistory: {
        payload: Prisma.$TrafficReplayHistoryPayload<ExtArgs>
        fields: Prisma.TrafficReplayHistoryFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TrafficReplayHistoryFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TrafficReplayHistoryFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>
          }
          findFirst: {
            args: Prisma.TrafficReplayHistoryFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TrafficReplayHistoryFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>
          }
          findMany: {
            args: Prisma.TrafficReplayHistoryFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>[]
          }
          create: {
            args: Prisma.TrafficReplayHistoryCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>
          }
          createMany: {
            args: Prisma.TrafficReplayHistoryCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TrafficReplayHistoryCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>[]
          }
          delete: {
            args: Prisma.TrafficReplayHistoryDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>
          }
          update: {
            args: Prisma.TrafficReplayHistoryUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>
          }
          deleteMany: {
            args: Prisma.TrafficReplayHistoryDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TrafficReplayHistoryUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.TrafficReplayHistoryUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>[]
          }
          upsert: {
            args: Prisma.TrafficReplayHistoryUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TrafficReplayHistoryPayload>
          }
          aggregate: {
            args: Prisma.TrafficReplayHistoryAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTrafficReplayHistory>
          }
          groupBy: {
            args: Prisma.TrafficReplayHistoryGroupByArgs<ExtArgs>
            result: $Utils.Optional<TrafficReplayHistoryGroupByOutputType>[]
          }
          count: {
            args: Prisma.TrafficReplayHistoryCountArgs<ExtArgs>
            result: $Utils.Optional<TrafficReplayHistoryCountAggregateOutputType> | number
          }
        }
      }
      RelationshipLedgerEvent: {
        payload: Prisma.$RelationshipLedgerEventPayload<ExtArgs>
        fields: Prisma.RelationshipLedgerEventFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RelationshipLedgerEventFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RelationshipLedgerEventFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>
          }
          findFirst: {
            args: Prisma.RelationshipLedgerEventFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RelationshipLedgerEventFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>
          }
          findMany: {
            args: Prisma.RelationshipLedgerEventFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>[]
          }
          create: {
            args: Prisma.RelationshipLedgerEventCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>
          }
          createMany: {
            args: Prisma.RelationshipLedgerEventCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RelationshipLedgerEventCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>[]
          }
          delete: {
            args: Prisma.RelationshipLedgerEventDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>
          }
          update: {
            args: Prisma.RelationshipLedgerEventUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>
          }
          deleteMany: {
            args: Prisma.RelationshipLedgerEventDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RelationshipLedgerEventUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.RelationshipLedgerEventUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>[]
          }
          upsert: {
            args: Prisma.RelationshipLedgerEventUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipLedgerEventPayload>
          }
          aggregate: {
            args: Prisma.RelationshipLedgerEventAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRelationshipLedgerEvent>
          }
          groupBy: {
            args: Prisma.RelationshipLedgerEventGroupByArgs<ExtArgs>
            result: $Utils.Optional<RelationshipLedgerEventGroupByOutputType>[]
          }
          count: {
            args: Prisma.RelationshipLedgerEventCountArgs<ExtArgs>
            result: $Utils.Optional<RelationshipLedgerEventCountAggregateOutputType> | number
          }
        }
      }
      RelationshipMemoryJob: {
        payload: Prisma.$RelationshipMemoryJobPayload<ExtArgs>
        fields: Prisma.RelationshipMemoryJobFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RelationshipMemoryJobFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RelationshipMemoryJobFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>
          }
          findFirst: {
            args: Prisma.RelationshipMemoryJobFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RelationshipMemoryJobFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>
          }
          findMany: {
            args: Prisma.RelationshipMemoryJobFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>[]
          }
          create: {
            args: Prisma.RelationshipMemoryJobCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>
          }
          createMany: {
            args: Prisma.RelationshipMemoryJobCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RelationshipMemoryJobCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>[]
          }
          delete: {
            args: Prisma.RelationshipMemoryJobDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>
          }
          update: {
            args: Prisma.RelationshipMemoryJobUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>
          }
          deleteMany: {
            args: Prisma.RelationshipMemoryJobDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RelationshipMemoryJobUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.RelationshipMemoryJobUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>[]
          }
          upsert: {
            args: Prisma.RelationshipMemoryJobUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryJobPayload>
          }
          aggregate: {
            args: Prisma.RelationshipMemoryJobAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRelationshipMemoryJob>
          }
          groupBy: {
            args: Prisma.RelationshipMemoryJobGroupByArgs<ExtArgs>
            result: $Utils.Optional<RelationshipMemoryJobGroupByOutputType>[]
          }
          count: {
            args: Prisma.RelationshipMemoryJobCountArgs<ExtArgs>
            result: $Utils.Optional<RelationshipMemoryJobCountAggregateOutputType> | number
          }
        }
      }
      RelationshipMemoryCard: {
        payload: Prisma.$RelationshipMemoryCardPayload<ExtArgs>
        fields: Prisma.RelationshipMemoryCardFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RelationshipMemoryCardFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RelationshipMemoryCardFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>
          }
          findFirst: {
            args: Prisma.RelationshipMemoryCardFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RelationshipMemoryCardFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>
          }
          findMany: {
            args: Prisma.RelationshipMemoryCardFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>[]
          }
          create: {
            args: Prisma.RelationshipMemoryCardCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>
          }
          createMany: {
            args: Prisma.RelationshipMemoryCardCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RelationshipMemoryCardCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>[]
          }
          delete: {
            args: Prisma.RelationshipMemoryCardDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>
          }
          update: {
            args: Prisma.RelationshipMemoryCardUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>
          }
          deleteMany: {
            args: Prisma.RelationshipMemoryCardDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RelationshipMemoryCardUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.RelationshipMemoryCardUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>[]
          }
          upsert: {
            args: Prisma.RelationshipMemoryCardUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryCardPayload>
          }
          aggregate: {
            args: Prisma.RelationshipMemoryCardAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRelationshipMemoryCard>
          }
          groupBy: {
            args: Prisma.RelationshipMemoryCardGroupByArgs<ExtArgs>
            result: $Utils.Optional<RelationshipMemoryCardGroupByOutputType>[]
          }
          count: {
            args: Prisma.RelationshipMemoryCardCountArgs<ExtArgs>
            result: $Utils.Optional<RelationshipMemoryCardCountAggregateOutputType> | number
          }
        }
      }
      RelationshipMemoryOverride: {
        payload: Prisma.$RelationshipMemoryOverridePayload<ExtArgs>
        fields: Prisma.RelationshipMemoryOverrideFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RelationshipMemoryOverrideFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RelationshipMemoryOverrideFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>
          }
          findFirst: {
            args: Prisma.RelationshipMemoryOverrideFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RelationshipMemoryOverrideFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>
          }
          findMany: {
            args: Prisma.RelationshipMemoryOverrideFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>[]
          }
          create: {
            args: Prisma.RelationshipMemoryOverrideCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>
          }
          createMany: {
            args: Prisma.RelationshipMemoryOverrideCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RelationshipMemoryOverrideCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>[]
          }
          delete: {
            args: Prisma.RelationshipMemoryOverrideDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>
          }
          update: {
            args: Prisma.RelationshipMemoryOverrideUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>
          }
          deleteMany: {
            args: Prisma.RelationshipMemoryOverrideDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RelationshipMemoryOverrideUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.RelationshipMemoryOverrideUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>[]
          }
          upsert: {
            args: Prisma.RelationshipMemoryOverrideUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RelationshipMemoryOverridePayload>
          }
          aggregate: {
            args: Prisma.RelationshipMemoryOverrideAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRelationshipMemoryOverride>
          }
          groupBy: {
            args: Prisma.RelationshipMemoryOverrideGroupByArgs<ExtArgs>
            result: $Utils.Optional<RelationshipMemoryOverrideGroupByOutputType>[]
          }
          count: {
            args: Prisma.RelationshipMemoryOverrideCountArgs<ExtArgs>
            result: $Utils.Optional<RelationshipMemoryOverrideCountAggregateOutputType> | number
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
    httpTrafficLog?: HttpTrafficLogOmit
    conversationItem?: ConversationItemOmit
    trafficReplayHistory?: TrafficReplayHistoryOmit
    relationshipLedgerEvent?: RelationshipLedgerEventOmit
    relationshipMemoryJob?: RelationshipMemoryJobOmit
    relationshipMemoryCard?: RelationshipMemoryCardOmit
    relationshipMemoryOverride?: RelationshipMemoryOverrideOmit
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
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
    admin_user_id: number | null
  }

  export type GroupChatSettingSumAggregateOutputType = {
    group_id: bigint | null
    is_enabled: number | null
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
    admin_user_id: bigint | null
  }

  export type GroupChatSettingMinAggregateOutputType = {
    group_id: bigint | null
    group_name: string | null
    is_enabled: number | null
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
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
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
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
    continuous_learning_enabled: number
    auto_reply_enabled: number
    transcript_compact_offset: number
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
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
    admin_user_id?: true
  }

  export type GroupChatSettingSumAggregateInputType = {
    group_id?: true
    is_enabled?: true
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
    admin_user_id?: true
  }

  export type GroupChatSettingMinAggregateInputType = {
    group_id?: true
    group_name?: true
    is_enabled?: true
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
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
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
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
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
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
    continuous_learning_enabled: number
    auto_reply_enabled: number
    transcript_compact_offset: number
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
    welcome_message?: boolean
    admin_user_id?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type GroupChatSettingOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"group_id" | "group_name" | "is_enabled" | "continuous_learning_enabled" | "auto_reply_enabled" | "transcript_compact_offset" | "welcome_message" | "admin_user_id" | "agent_prompt_id" | "last_activity" | "created_at" | "updated_at", ExtArgs["result"]["groupChatSetting"]>

  export type $GroupChatSettingPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GroupChatSetting"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      group_id: bigint
      group_name: string | null
      is_enabled: number
      continuous_learning_enabled: number
      auto_reply_enabled: number
      transcript_compact_offset: number
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
    readonly continuous_learning_enabled: FieldRef<"GroupChatSetting", 'Int'>
    readonly auto_reply_enabled: FieldRef<"GroupChatSetting", 'Int'>
    readonly transcript_compact_offset: FieldRef<"GroupChatSetting", 'Int'>
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
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
  }

  export type PrivateChatSettingSumAggregateOutputType = {
    user_id: bigint | null
    is_enabled: number | null
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
  }

  export type PrivateChatSettingMinAggregateOutputType = {
    user_id: bigint | null
    username: string | null
    is_enabled: number | null
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
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
    continuous_learning_enabled: number | null
    auto_reply_enabled: number | null
    transcript_compact_offset: number | null
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
    continuous_learning_enabled: number
    auto_reply_enabled: number
    transcript_compact_offset: number
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
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
  }

  export type PrivateChatSettingSumAggregateInputType = {
    user_id?: true
    is_enabled?: true
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
  }

  export type PrivateChatSettingMinAggregateInputType = {
    user_id?: true
    username?: true
    is_enabled?: true
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
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
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
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
    continuous_learning_enabled?: true
    auto_reply_enabled?: true
    transcript_compact_offset?: true
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
    continuous_learning_enabled: number
    auto_reply_enabled: number
    transcript_compact_offset: number
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
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
    continuous_learning_enabled?: boolean
    auto_reply_enabled?: boolean
    transcript_compact_offset?: boolean
    welcome_message?: boolean
    user_notes?: boolean
    agent_prompt_id?: boolean
    last_activity?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type PrivateChatSettingOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"user_id" | "username" | "is_enabled" | "continuous_learning_enabled" | "auto_reply_enabled" | "transcript_compact_offset" | "welcome_message" | "user_notes" | "agent_prompt_id" | "last_activity" | "created_at" | "updated_at", ExtArgs["result"]["privateChatSetting"]>

  export type $PrivateChatSettingPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PrivateChatSetting"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      user_id: bigint
      username: string | null
      is_enabled: number
      continuous_learning_enabled: number
      auto_reply_enabled: number
      transcript_compact_offset: number
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
    readonly continuous_learning_enabled: FieldRef<"PrivateChatSetting", 'Int'>
    readonly auto_reply_enabled: FieldRef<"PrivateChatSetting", 'Int'>
    readonly transcript_compact_offset: FieldRef<"PrivateChatSetting", 'Int'>
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
   * Model HttpTrafficLog
   */

  export type AggregateHttpTrafficLog = {
    _count: HttpTrafficLogCountAggregateOutputType | null
    _avg: HttpTrafficLogAvgAggregateOutputType | null
    _sum: HttpTrafficLogSumAggregateOutputType | null
    _min: HttpTrafficLogMinAggregateOutputType | null
    _max: HttpTrafficLogMaxAggregateOutputType | null
  }

  export type HttpTrafficLogAvgAggregateOutputType = {
    id: number | null
    conversation_id: number | null
    agent_turn: number | null
    request_size: number | null
    response_status: number | null
    response_size: number | null
    duration_ms: number | null
  }

  export type HttpTrafficLogSumAggregateOutputType = {
    id: bigint | null
    conversation_id: bigint | null
    agent_turn: number | null
    request_size: number | null
    response_status: number | null
    response_size: number | null
    duration_ms: bigint | null
  }

  export type HttpTrafficLogMinAggregateOutputType = {
    id: bigint | null
    request_id: string | null
    trace_id: string | null
    conversation_id: bigint | null
    user_id: string | null
    session_id: string | null
    agent_turn: number | null
    llm_call_id: string | null
    tool_call_id: string | null
    container_name: string | null
    service_name: string | null
    method: string | null
    url: string | null
    host: string | null
    path: string | null
    request_body: string | null
    request_content_type: string | null
    request_size: number | null
    response_status: number | null
    response_body: string | null
    response_content_type: string | null
    response_size: number | null
    duration_ms: bigint | null
    request_timestamp: Date | null
    response_timestamp: Date | null
    is_ai_request: boolean | null
    api_type: string | null
    api_version: string | null
    client_ip: string | null
    user_agent: string | null
    error_message: string | null
    created_at: Date | null
  }

  export type HttpTrafficLogMaxAggregateOutputType = {
    id: bigint | null
    request_id: string | null
    trace_id: string | null
    conversation_id: bigint | null
    user_id: string | null
    session_id: string | null
    agent_turn: number | null
    llm_call_id: string | null
    tool_call_id: string | null
    container_name: string | null
    service_name: string | null
    method: string | null
    url: string | null
    host: string | null
    path: string | null
    request_body: string | null
    request_content_type: string | null
    request_size: number | null
    response_status: number | null
    response_body: string | null
    response_content_type: string | null
    response_size: number | null
    duration_ms: bigint | null
    request_timestamp: Date | null
    response_timestamp: Date | null
    is_ai_request: boolean | null
    api_type: string | null
    api_version: string | null
    client_ip: string | null
    user_agent: string | null
    error_message: string | null
    created_at: Date | null
  }

  export type HttpTrafficLogCountAggregateOutputType = {
    id: number
    request_id: number
    trace_id: number
    conversation_id: number
    user_id: number
    session_id: number
    agent_turn: number
    llm_call_id: number
    tool_call_id: number
    container_name: number
    service_name: number
    method: number
    url: number
    host: number
    path: number
    query_params: number
    request_headers: number
    request_body: number
    request_content_type: number
    request_size: number
    response_status: number
    response_headers: number
    response_body: number
    response_content_type: number
    response_size: number
    duration_ms: number
    request_timestamp: number
    response_timestamp: number
    is_ai_request: number
    api_type: number
    api_version: number
    client_ip: number
    user_agent: number
    error_message: number
    created_at: number
    _all: number
  }


  export type HttpTrafficLogAvgAggregateInputType = {
    id?: true
    conversation_id?: true
    agent_turn?: true
    request_size?: true
    response_status?: true
    response_size?: true
    duration_ms?: true
  }

  export type HttpTrafficLogSumAggregateInputType = {
    id?: true
    conversation_id?: true
    agent_turn?: true
    request_size?: true
    response_status?: true
    response_size?: true
    duration_ms?: true
  }

  export type HttpTrafficLogMinAggregateInputType = {
    id?: true
    request_id?: true
    trace_id?: true
    conversation_id?: true
    user_id?: true
    session_id?: true
    agent_turn?: true
    llm_call_id?: true
    tool_call_id?: true
    container_name?: true
    service_name?: true
    method?: true
    url?: true
    host?: true
    path?: true
    request_body?: true
    request_content_type?: true
    request_size?: true
    response_status?: true
    response_body?: true
    response_content_type?: true
    response_size?: true
    duration_ms?: true
    request_timestamp?: true
    response_timestamp?: true
    is_ai_request?: true
    api_type?: true
    api_version?: true
    client_ip?: true
    user_agent?: true
    error_message?: true
    created_at?: true
  }

  export type HttpTrafficLogMaxAggregateInputType = {
    id?: true
    request_id?: true
    trace_id?: true
    conversation_id?: true
    user_id?: true
    session_id?: true
    agent_turn?: true
    llm_call_id?: true
    tool_call_id?: true
    container_name?: true
    service_name?: true
    method?: true
    url?: true
    host?: true
    path?: true
    request_body?: true
    request_content_type?: true
    request_size?: true
    response_status?: true
    response_body?: true
    response_content_type?: true
    response_size?: true
    duration_ms?: true
    request_timestamp?: true
    response_timestamp?: true
    is_ai_request?: true
    api_type?: true
    api_version?: true
    client_ip?: true
    user_agent?: true
    error_message?: true
    created_at?: true
  }

  export type HttpTrafficLogCountAggregateInputType = {
    id?: true
    request_id?: true
    trace_id?: true
    conversation_id?: true
    user_id?: true
    session_id?: true
    agent_turn?: true
    llm_call_id?: true
    tool_call_id?: true
    container_name?: true
    service_name?: true
    method?: true
    url?: true
    host?: true
    path?: true
    query_params?: true
    request_headers?: true
    request_body?: true
    request_content_type?: true
    request_size?: true
    response_status?: true
    response_headers?: true
    response_body?: true
    response_content_type?: true
    response_size?: true
    duration_ms?: true
    request_timestamp?: true
    response_timestamp?: true
    is_ai_request?: true
    api_type?: true
    api_version?: true
    client_ip?: true
    user_agent?: true
    error_message?: true
    created_at?: true
    _all?: true
  }

  export type HttpTrafficLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which HttpTrafficLog to aggregate.
     */
    where?: HttpTrafficLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HttpTrafficLogs to fetch.
     */
    orderBy?: HttpTrafficLogOrderByWithRelationInput | HttpTrafficLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: HttpTrafficLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HttpTrafficLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HttpTrafficLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned HttpTrafficLogs
    **/
    _count?: true | HttpTrafficLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: HttpTrafficLogAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: HttpTrafficLogSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: HttpTrafficLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: HttpTrafficLogMaxAggregateInputType
  }

  export type GetHttpTrafficLogAggregateType<T extends HttpTrafficLogAggregateArgs> = {
        [P in keyof T & keyof AggregateHttpTrafficLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateHttpTrafficLog[P]>
      : GetScalarType<T[P], AggregateHttpTrafficLog[P]>
  }




  export type HttpTrafficLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: HttpTrafficLogWhereInput
    orderBy?: HttpTrafficLogOrderByWithAggregationInput | HttpTrafficLogOrderByWithAggregationInput[]
    by: HttpTrafficLogScalarFieldEnum[] | HttpTrafficLogScalarFieldEnum
    having?: HttpTrafficLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: HttpTrafficLogCountAggregateInputType | true
    _avg?: HttpTrafficLogAvgAggregateInputType
    _sum?: HttpTrafficLogSumAggregateInputType
    _min?: HttpTrafficLogMinAggregateInputType
    _max?: HttpTrafficLogMaxAggregateInputType
  }

  export type HttpTrafficLogGroupByOutputType = {
    id: bigint
    request_id: string | null
    trace_id: string | null
    conversation_id: bigint | null
    user_id: string | null
    session_id: string | null
    agent_turn: number | null
    llm_call_id: string | null
    tool_call_id: string | null
    container_name: string | null
    service_name: string | null
    method: string
    url: string
    host: string
    path: string
    query_params: JsonValue | null
    request_headers: JsonValue
    request_body: string | null
    request_content_type: string | null
    request_size: number | null
    response_status: number | null
    response_headers: JsonValue | null
    response_body: string | null
    response_content_type: string | null
    response_size: number | null
    duration_ms: bigint | null
    request_timestamp: Date
    response_timestamp: Date | null
    is_ai_request: boolean
    api_type: string | null
    api_version: string | null
    client_ip: string | null
    user_agent: string | null
    error_message: string | null
    created_at: Date
    _count: HttpTrafficLogCountAggregateOutputType | null
    _avg: HttpTrafficLogAvgAggregateOutputType | null
    _sum: HttpTrafficLogSumAggregateOutputType | null
    _min: HttpTrafficLogMinAggregateOutputType | null
    _max: HttpTrafficLogMaxAggregateOutputType | null
  }

  type GetHttpTrafficLogGroupByPayload<T extends HttpTrafficLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<HttpTrafficLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof HttpTrafficLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], HttpTrafficLogGroupByOutputType[P]>
            : GetScalarType<T[P], HttpTrafficLogGroupByOutputType[P]>
        }
      >
    >


  export type HttpTrafficLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    request_id?: boolean
    trace_id?: boolean
    conversation_id?: boolean
    user_id?: boolean
    session_id?: boolean
    agent_turn?: boolean
    llm_call_id?: boolean
    tool_call_id?: boolean
    container_name?: boolean
    service_name?: boolean
    method?: boolean
    url?: boolean
    host?: boolean
    path?: boolean
    query_params?: boolean
    request_headers?: boolean
    request_body?: boolean
    request_content_type?: boolean
    request_size?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    response_content_type?: boolean
    response_size?: boolean
    duration_ms?: boolean
    request_timestamp?: boolean
    response_timestamp?: boolean
    is_ai_request?: boolean
    api_type?: boolean
    api_version?: boolean
    client_ip?: boolean
    user_agent?: boolean
    error_message?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["httpTrafficLog"]>

  export type HttpTrafficLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    request_id?: boolean
    trace_id?: boolean
    conversation_id?: boolean
    user_id?: boolean
    session_id?: boolean
    agent_turn?: boolean
    llm_call_id?: boolean
    tool_call_id?: boolean
    container_name?: boolean
    service_name?: boolean
    method?: boolean
    url?: boolean
    host?: boolean
    path?: boolean
    query_params?: boolean
    request_headers?: boolean
    request_body?: boolean
    request_content_type?: boolean
    request_size?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    response_content_type?: boolean
    response_size?: boolean
    duration_ms?: boolean
    request_timestamp?: boolean
    response_timestamp?: boolean
    is_ai_request?: boolean
    api_type?: boolean
    api_version?: boolean
    client_ip?: boolean
    user_agent?: boolean
    error_message?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["httpTrafficLog"]>

  export type HttpTrafficLogSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    request_id?: boolean
    trace_id?: boolean
    conversation_id?: boolean
    user_id?: boolean
    session_id?: boolean
    agent_turn?: boolean
    llm_call_id?: boolean
    tool_call_id?: boolean
    container_name?: boolean
    service_name?: boolean
    method?: boolean
    url?: boolean
    host?: boolean
    path?: boolean
    query_params?: boolean
    request_headers?: boolean
    request_body?: boolean
    request_content_type?: boolean
    request_size?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    response_content_type?: boolean
    response_size?: boolean
    duration_ms?: boolean
    request_timestamp?: boolean
    response_timestamp?: boolean
    is_ai_request?: boolean
    api_type?: boolean
    api_version?: boolean
    client_ip?: boolean
    user_agent?: boolean
    error_message?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["httpTrafficLog"]>

  export type HttpTrafficLogSelectScalar = {
    id?: boolean
    request_id?: boolean
    trace_id?: boolean
    conversation_id?: boolean
    user_id?: boolean
    session_id?: boolean
    agent_turn?: boolean
    llm_call_id?: boolean
    tool_call_id?: boolean
    container_name?: boolean
    service_name?: boolean
    method?: boolean
    url?: boolean
    host?: boolean
    path?: boolean
    query_params?: boolean
    request_headers?: boolean
    request_body?: boolean
    request_content_type?: boolean
    request_size?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    response_content_type?: boolean
    response_size?: boolean
    duration_ms?: boolean
    request_timestamp?: boolean
    response_timestamp?: boolean
    is_ai_request?: boolean
    api_type?: boolean
    api_version?: boolean
    client_ip?: boolean
    user_agent?: boolean
    error_message?: boolean
    created_at?: boolean
  }

  export type HttpTrafficLogOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "request_id" | "trace_id" | "conversation_id" | "user_id" | "session_id" | "agent_turn" | "llm_call_id" | "tool_call_id" | "container_name" | "service_name" | "method" | "url" | "host" | "path" | "query_params" | "request_headers" | "request_body" | "request_content_type" | "request_size" | "response_status" | "response_headers" | "response_body" | "response_content_type" | "response_size" | "duration_ms" | "request_timestamp" | "response_timestamp" | "is_ai_request" | "api_type" | "api_version" | "client_ip" | "user_agent" | "error_message" | "created_at", ExtArgs["result"]["httpTrafficLog"]>

  export type $HttpTrafficLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "HttpTrafficLog"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      request_id: string | null
      trace_id: string | null
      conversation_id: bigint | null
      user_id: string | null
      session_id: string | null
      agent_turn: number | null
      llm_call_id: string | null
      tool_call_id: string | null
      container_name: string | null
      service_name: string | null
      method: string
      url: string
      host: string
      path: string
      query_params: Prisma.JsonValue | null
      request_headers: Prisma.JsonValue
      request_body: string | null
      request_content_type: string | null
      request_size: number | null
      response_status: number | null
      response_headers: Prisma.JsonValue | null
      response_body: string | null
      response_content_type: string | null
      response_size: number | null
      duration_ms: bigint | null
      request_timestamp: Date
      response_timestamp: Date | null
      is_ai_request: boolean
      api_type: string | null
      api_version: string | null
      client_ip: string | null
      user_agent: string | null
      error_message: string | null
      created_at: Date
    }, ExtArgs["result"]["httpTrafficLog"]>
    composites: {}
  }

  type HttpTrafficLogGetPayload<S extends boolean | null | undefined | HttpTrafficLogDefaultArgs> = $Result.GetResult<Prisma.$HttpTrafficLogPayload, S>

  type HttpTrafficLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<HttpTrafficLogFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: HttpTrafficLogCountAggregateInputType | true
    }

  export interface HttpTrafficLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['HttpTrafficLog'], meta: { name: 'HttpTrafficLog' } }
    /**
     * Find zero or one HttpTrafficLog that matches the filter.
     * @param {HttpTrafficLogFindUniqueArgs} args - Arguments to find a HttpTrafficLog
     * @example
     * // Get one HttpTrafficLog
     * const httpTrafficLog = await prisma.httpTrafficLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends HttpTrafficLogFindUniqueArgs>(args: SelectSubset<T, HttpTrafficLogFindUniqueArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one HttpTrafficLog that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {HttpTrafficLogFindUniqueOrThrowArgs} args - Arguments to find a HttpTrafficLog
     * @example
     * // Get one HttpTrafficLog
     * const httpTrafficLog = await prisma.httpTrafficLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends HttpTrafficLogFindUniqueOrThrowArgs>(args: SelectSubset<T, HttpTrafficLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first HttpTrafficLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogFindFirstArgs} args - Arguments to find a HttpTrafficLog
     * @example
     * // Get one HttpTrafficLog
     * const httpTrafficLog = await prisma.httpTrafficLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends HttpTrafficLogFindFirstArgs>(args?: SelectSubset<T, HttpTrafficLogFindFirstArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first HttpTrafficLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogFindFirstOrThrowArgs} args - Arguments to find a HttpTrafficLog
     * @example
     * // Get one HttpTrafficLog
     * const httpTrafficLog = await prisma.httpTrafficLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends HttpTrafficLogFindFirstOrThrowArgs>(args?: SelectSubset<T, HttpTrafficLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more HttpTrafficLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all HttpTrafficLogs
     * const httpTrafficLogs = await prisma.httpTrafficLog.findMany()
     * 
     * // Get first 10 HttpTrafficLogs
     * const httpTrafficLogs = await prisma.httpTrafficLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const httpTrafficLogWithIdOnly = await prisma.httpTrafficLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends HttpTrafficLogFindManyArgs>(args?: SelectSubset<T, HttpTrafficLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a HttpTrafficLog.
     * @param {HttpTrafficLogCreateArgs} args - Arguments to create a HttpTrafficLog.
     * @example
     * // Create one HttpTrafficLog
     * const HttpTrafficLog = await prisma.httpTrafficLog.create({
     *   data: {
     *     // ... data to create a HttpTrafficLog
     *   }
     * })
     * 
     */
    create<T extends HttpTrafficLogCreateArgs>(args: SelectSubset<T, HttpTrafficLogCreateArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many HttpTrafficLogs.
     * @param {HttpTrafficLogCreateManyArgs} args - Arguments to create many HttpTrafficLogs.
     * @example
     * // Create many HttpTrafficLogs
     * const httpTrafficLog = await prisma.httpTrafficLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends HttpTrafficLogCreateManyArgs>(args?: SelectSubset<T, HttpTrafficLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many HttpTrafficLogs and returns the data saved in the database.
     * @param {HttpTrafficLogCreateManyAndReturnArgs} args - Arguments to create many HttpTrafficLogs.
     * @example
     * // Create many HttpTrafficLogs
     * const httpTrafficLog = await prisma.httpTrafficLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many HttpTrafficLogs and only return the `id`
     * const httpTrafficLogWithIdOnly = await prisma.httpTrafficLog.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends HttpTrafficLogCreateManyAndReturnArgs>(args?: SelectSubset<T, HttpTrafficLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a HttpTrafficLog.
     * @param {HttpTrafficLogDeleteArgs} args - Arguments to delete one HttpTrafficLog.
     * @example
     * // Delete one HttpTrafficLog
     * const HttpTrafficLog = await prisma.httpTrafficLog.delete({
     *   where: {
     *     // ... filter to delete one HttpTrafficLog
     *   }
     * })
     * 
     */
    delete<T extends HttpTrafficLogDeleteArgs>(args: SelectSubset<T, HttpTrafficLogDeleteArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one HttpTrafficLog.
     * @param {HttpTrafficLogUpdateArgs} args - Arguments to update one HttpTrafficLog.
     * @example
     * // Update one HttpTrafficLog
     * const httpTrafficLog = await prisma.httpTrafficLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends HttpTrafficLogUpdateArgs>(args: SelectSubset<T, HttpTrafficLogUpdateArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more HttpTrafficLogs.
     * @param {HttpTrafficLogDeleteManyArgs} args - Arguments to filter HttpTrafficLogs to delete.
     * @example
     * // Delete a few HttpTrafficLogs
     * const { count } = await prisma.httpTrafficLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends HttpTrafficLogDeleteManyArgs>(args?: SelectSubset<T, HttpTrafficLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more HttpTrafficLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many HttpTrafficLogs
     * const httpTrafficLog = await prisma.httpTrafficLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends HttpTrafficLogUpdateManyArgs>(args: SelectSubset<T, HttpTrafficLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more HttpTrafficLogs and returns the data updated in the database.
     * @param {HttpTrafficLogUpdateManyAndReturnArgs} args - Arguments to update many HttpTrafficLogs.
     * @example
     * // Update many HttpTrafficLogs
     * const httpTrafficLog = await prisma.httpTrafficLog.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more HttpTrafficLogs and only return the `id`
     * const httpTrafficLogWithIdOnly = await prisma.httpTrafficLog.updateManyAndReturn({
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
    updateManyAndReturn<T extends HttpTrafficLogUpdateManyAndReturnArgs>(args: SelectSubset<T, HttpTrafficLogUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one HttpTrafficLog.
     * @param {HttpTrafficLogUpsertArgs} args - Arguments to update or create a HttpTrafficLog.
     * @example
     * // Update or create a HttpTrafficLog
     * const httpTrafficLog = await prisma.httpTrafficLog.upsert({
     *   create: {
     *     // ... data to create a HttpTrafficLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the HttpTrafficLog we want to update
     *   }
     * })
     */
    upsert<T extends HttpTrafficLogUpsertArgs>(args: SelectSubset<T, HttpTrafficLogUpsertArgs<ExtArgs>>): Prisma__HttpTrafficLogClient<$Result.GetResult<Prisma.$HttpTrafficLogPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of HttpTrafficLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogCountArgs} args - Arguments to filter HttpTrafficLogs to count.
     * @example
     * // Count the number of HttpTrafficLogs
     * const count = await prisma.httpTrafficLog.count({
     *   where: {
     *     // ... the filter for the HttpTrafficLogs we want to count
     *   }
     * })
    **/
    count<T extends HttpTrafficLogCountArgs>(
      args?: Subset<T, HttpTrafficLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], HttpTrafficLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a HttpTrafficLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends HttpTrafficLogAggregateArgs>(args: Subset<T, HttpTrafficLogAggregateArgs>): Prisma.PrismaPromise<GetHttpTrafficLogAggregateType<T>>

    /**
     * Group by HttpTrafficLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {HttpTrafficLogGroupByArgs} args - Group by arguments.
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
      T extends HttpTrafficLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: HttpTrafficLogGroupByArgs['orderBy'] }
        : { orderBy?: HttpTrafficLogGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, HttpTrafficLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetHttpTrafficLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the HttpTrafficLog model
   */
  readonly fields: HttpTrafficLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for HttpTrafficLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__HttpTrafficLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the HttpTrafficLog model
   */
  interface HttpTrafficLogFieldRefs {
    readonly id: FieldRef<"HttpTrafficLog", 'BigInt'>
    readonly request_id: FieldRef<"HttpTrafficLog", 'String'>
    readonly trace_id: FieldRef<"HttpTrafficLog", 'String'>
    readonly conversation_id: FieldRef<"HttpTrafficLog", 'BigInt'>
    readonly user_id: FieldRef<"HttpTrafficLog", 'String'>
    readonly session_id: FieldRef<"HttpTrafficLog", 'String'>
    readonly agent_turn: FieldRef<"HttpTrafficLog", 'Int'>
    readonly llm_call_id: FieldRef<"HttpTrafficLog", 'String'>
    readonly tool_call_id: FieldRef<"HttpTrafficLog", 'String'>
    readonly container_name: FieldRef<"HttpTrafficLog", 'String'>
    readonly service_name: FieldRef<"HttpTrafficLog", 'String'>
    readonly method: FieldRef<"HttpTrafficLog", 'String'>
    readonly url: FieldRef<"HttpTrafficLog", 'String'>
    readonly host: FieldRef<"HttpTrafficLog", 'String'>
    readonly path: FieldRef<"HttpTrafficLog", 'String'>
    readonly query_params: FieldRef<"HttpTrafficLog", 'Json'>
    readonly request_headers: FieldRef<"HttpTrafficLog", 'Json'>
    readonly request_body: FieldRef<"HttpTrafficLog", 'String'>
    readonly request_content_type: FieldRef<"HttpTrafficLog", 'String'>
    readonly request_size: FieldRef<"HttpTrafficLog", 'Int'>
    readonly response_status: FieldRef<"HttpTrafficLog", 'Int'>
    readonly response_headers: FieldRef<"HttpTrafficLog", 'Json'>
    readonly response_body: FieldRef<"HttpTrafficLog", 'String'>
    readonly response_content_type: FieldRef<"HttpTrafficLog", 'String'>
    readonly response_size: FieldRef<"HttpTrafficLog", 'Int'>
    readonly duration_ms: FieldRef<"HttpTrafficLog", 'BigInt'>
    readonly request_timestamp: FieldRef<"HttpTrafficLog", 'DateTime'>
    readonly response_timestamp: FieldRef<"HttpTrafficLog", 'DateTime'>
    readonly is_ai_request: FieldRef<"HttpTrafficLog", 'Boolean'>
    readonly api_type: FieldRef<"HttpTrafficLog", 'String'>
    readonly api_version: FieldRef<"HttpTrafficLog", 'String'>
    readonly client_ip: FieldRef<"HttpTrafficLog", 'String'>
    readonly user_agent: FieldRef<"HttpTrafficLog", 'String'>
    readonly error_message: FieldRef<"HttpTrafficLog", 'String'>
    readonly created_at: FieldRef<"HttpTrafficLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * HttpTrafficLog findUnique
   */
  export type HttpTrafficLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * Filter, which HttpTrafficLog to fetch.
     */
    where: HttpTrafficLogWhereUniqueInput
  }

  /**
   * HttpTrafficLog findUniqueOrThrow
   */
  export type HttpTrafficLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * Filter, which HttpTrafficLog to fetch.
     */
    where: HttpTrafficLogWhereUniqueInput
  }

  /**
   * HttpTrafficLog findFirst
   */
  export type HttpTrafficLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * Filter, which HttpTrafficLog to fetch.
     */
    where?: HttpTrafficLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HttpTrafficLogs to fetch.
     */
    orderBy?: HttpTrafficLogOrderByWithRelationInput | HttpTrafficLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for HttpTrafficLogs.
     */
    cursor?: HttpTrafficLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HttpTrafficLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HttpTrafficLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of HttpTrafficLogs.
     */
    distinct?: HttpTrafficLogScalarFieldEnum | HttpTrafficLogScalarFieldEnum[]
  }

  /**
   * HttpTrafficLog findFirstOrThrow
   */
  export type HttpTrafficLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * Filter, which HttpTrafficLog to fetch.
     */
    where?: HttpTrafficLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HttpTrafficLogs to fetch.
     */
    orderBy?: HttpTrafficLogOrderByWithRelationInput | HttpTrafficLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for HttpTrafficLogs.
     */
    cursor?: HttpTrafficLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HttpTrafficLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HttpTrafficLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of HttpTrafficLogs.
     */
    distinct?: HttpTrafficLogScalarFieldEnum | HttpTrafficLogScalarFieldEnum[]
  }

  /**
   * HttpTrafficLog findMany
   */
  export type HttpTrafficLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * Filter, which HttpTrafficLogs to fetch.
     */
    where?: HttpTrafficLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of HttpTrafficLogs to fetch.
     */
    orderBy?: HttpTrafficLogOrderByWithRelationInput | HttpTrafficLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing HttpTrafficLogs.
     */
    cursor?: HttpTrafficLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` HttpTrafficLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` HttpTrafficLogs.
     */
    skip?: number
    distinct?: HttpTrafficLogScalarFieldEnum | HttpTrafficLogScalarFieldEnum[]
  }

  /**
   * HttpTrafficLog create
   */
  export type HttpTrafficLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * The data needed to create a HttpTrafficLog.
     */
    data: XOR<HttpTrafficLogCreateInput, HttpTrafficLogUncheckedCreateInput>
  }

  /**
   * HttpTrafficLog createMany
   */
  export type HttpTrafficLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many HttpTrafficLogs.
     */
    data: HttpTrafficLogCreateManyInput | HttpTrafficLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * HttpTrafficLog createManyAndReturn
   */
  export type HttpTrafficLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * The data used to create many HttpTrafficLogs.
     */
    data: HttpTrafficLogCreateManyInput | HttpTrafficLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * HttpTrafficLog update
   */
  export type HttpTrafficLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * The data needed to update a HttpTrafficLog.
     */
    data: XOR<HttpTrafficLogUpdateInput, HttpTrafficLogUncheckedUpdateInput>
    /**
     * Choose, which HttpTrafficLog to update.
     */
    where: HttpTrafficLogWhereUniqueInput
  }

  /**
   * HttpTrafficLog updateMany
   */
  export type HttpTrafficLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update HttpTrafficLogs.
     */
    data: XOR<HttpTrafficLogUpdateManyMutationInput, HttpTrafficLogUncheckedUpdateManyInput>
    /**
     * Filter which HttpTrafficLogs to update
     */
    where?: HttpTrafficLogWhereInput
    /**
     * Limit how many HttpTrafficLogs to update.
     */
    limit?: number
  }

  /**
   * HttpTrafficLog updateManyAndReturn
   */
  export type HttpTrafficLogUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * The data used to update HttpTrafficLogs.
     */
    data: XOR<HttpTrafficLogUpdateManyMutationInput, HttpTrafficLogUncheckedUpdateManyInput>
    /**
     * Filter which HttpTrafficLogs to update
     */
    where?: HttpTrafficLogWhereInput
    /**
     * Limit how many HttpTrafficLogs to update.
     */
    limit?: number
  }

  /**
   * HttpTrafficLog upsert
   */
  export type HttpTrafficLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * The filter to search for the HttpTrafficLog to update in case it exists.
     */
    where: HttpTrafficLogWhereUniqueInput
    /**
     * In case the HttpTrafficLog found by the `where` argument doesn't exist, create a new HttpTrafficLog with this data.
     */
    create: XOR<HttpTrafficLogCreateInput, HttpTrafficLogUncheckedCreateInput>
    /**
     * In case the HttpTrafficLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<HttpTrafficLogUpdateInput, HttpTrafficLogUncheckedUpdateInput>
  }

  /**
   * HttpTrafficLog delete
   */
  export type HttpTrafficLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
    /**
     * Filter which HttpTrafficLog to delete.
     */
    where: HttpTrafficLogWhereUniqueInput
  }

  /**
   * HttpTrafficLog deleteMany
   */
  export type HttpTrafficLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which HttpTrafficLogs to delete
     */
    where?: HttpTrafficLogWhereInput
    /**
     * Limit how many HttpTrafficLogs to delete.
     */
    limit?: number
  }

  /**
   * HttpTrafficLog without action
   */
  export type HttpTrafficLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the HttpTrafficLog
     */
    select?: HttpTrafficLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the HttpTrafficLog
     */
    omit?: HttpTrafficLogOmit<ExtArgs> | null
  }


  /**
   * Model ConversationItem
   */

  export type AggregateConversationItem = {
    _count: ConversationItemCountAggregateOutputType | null
    _avg: ConversationItemAvgAggregateOutputType | null
    _sum: ConversationItemSumAggregateOutputType | null
    _min: ConversationItemMinAggregateOutputType | null
    _max: ConversationItemMaxAggregateOutputType | null
  }

  export type ConversationItemAvgAggregateOutputType = {
    id: number | null
    conversation_id: number | null
    group_index: number | null
    item_index: number | null
    delivery_message_id: number | null
  }

  export type ConversationItemSumAggregateOutputType = {
    id: bigint | null
    conversation_id: bigint | null
    group_index: number | null
    item_index: number | null
    delivery_message_id: bigint | null
  }

  export type ConversationItemMinAggregateOutputType = {
    id: bigint | null
    conversation_id: bigint | null
    session_key: string | null
    role: string | null
    phase: string | null
    content: string | null
    group_index: number | null
    item_index: number | null
    source: string | null
    delivery_message_id: bigint | null
    run_id: string | null
    trace_id: string | null
    created_at: Date | null
  }

  export type ConversationItemMaxAggregateOutputType = {
    id: bigint | null
    conversation_id: bigint | null
    session_key: string | null
    role: string | null
    phase: string | null
    content: string | null
    group_index: number | null
    item_index: number | null
    source: string | null
    delivery_message_id: bigint | null
    run_id: string | null
    trace_id: string | null
    created_at: Date | null
  }

  export type ConversationItemCountAggregateOutputType = {
    id: number
    conversation_id: number
    session_key: number
    role: number
    phase: number
    content: number
    group_index: number
    item_index: number
    source: number
    delivery_message_id: number
    run_id: number
    trace_id: number
    created_at: number
    _all: number
  }


  export type ConversationItemAvgAggregateInputType = {
    id?: true
    conversation_id?: true
    group_index?: true
    item_index?: true
    delivery_message_id?: true
  }

  export type ConversationItemSumAggregateInputType = {
    id?: true
    conversation_id?: true
    group_index?: true
    item_index?: true
    delivery_message_id?: true
  }

  export type ConversationItemMinAggregateInputType = {
    id?: true
    conversation_id?: true
    session_key?: true
    role?: true
    phase?: true
    content?: true
    group_index?: true
    item_index?: true
    source?: true
    delivery_message_id?: true
    run_id?: true
    trace_id?: true
    created_at?: true
  }

  export type ConversationItemMaxAggregateInputType = {
    id?: true
    conversation_id?: true
    session_key?: true
    role?: true
    phase?: true
    content?: true
    group_index?: true
    item_index?: true
    source?: true
    delivery_message_id?: true
    run_id?: true
    trace_id?: true
    created_at?: true
  }

  export type ConversationItemCountAggregateInputType = {
    id?: true
    conversation_id?: true
    session_key?: true
    role?: true
    phase?: true
    content?: true
    group_index?: true
    item_index?: true
    source?: true
    delivery_message_id?: true
    run_id?: true
    trace_id?: true
    created_at?: true
    _all?: true
  }

  export type ConversationItemAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ConversationItem to aggregate.
     */
    where?: ConversationItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConversationItems to fetch.
     */
    orderBy?: ConversationItemOrderByWithRelationInput | ConversationItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ConversationItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConversationItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConversationItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ConversationItems
    **/
    _count?: true | ConversationItemCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ConversationItemAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ConversationItemSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ConversationItemMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ConversationItemMaxAggregateInputType
  }

  export type GetConversationItemAggregateType<T extends ConversationItemAggregateArgs> = {
        [P in keyof T & keyof AggregateConversationItem]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateConversationItem[P]>
      : GetScalarType<T[P], AggregateConversationItem[P]>
  }




  export type ConversationItemGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ConversationItemWhereInput
    orderBy?: ConversationItemOrderByWithAggregationInput | ConversationItemOrderByWithAggregationInput[]
    by: ConversationItemScalarFieldEnum[] | ConversationItemScalarFieldEnum
    having?: ConversationItemScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ConversationItemCountAggregateInputType | true
    _avg?: ConversationItemAvgAggregateInputType
    _sum?: ConversationItemSumAggregateInputType
    _min?: ConversationItemMinAggregateInputType
    _max?: ConversationItemMaxAggregateInputType
  }

  export type ConversationItemGroupByOutputType = {
    id: bigint
    conversation_id: bigint
    session_key: string | null
    role: string
    phase: string | null
    content: string
    group_index: number
    item_index: number
    source: string
    delivery_message_id: bigint | null
    run_id: string | null
    trace_id: string | null
    created_at: Date
    _count: ConversationItemCountAggregateOutputType | null
    _avg: ConversationItemAvgAggregateOutputType | null
    _sum: ConversationItemSumAggregateOutputType | null
    _min: ConversationItemMinAggregateOutputType | null
    _max: ConversationItemMaxAggregateOutputType | null
  }

  type GetConversationItemGroupByPayload<T extends ConversationItemGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ConversationItemGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ConversationItemGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ConversationItemGroupByOutputType[P]>
            : GetScalarType<T[P], ConversationItemGroupByOutputType[P]>
        }
      >
    >


  export type ConversationItemSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    conversation_id?: boolean
    session_key?: boolean
    role?: boolean
    phase?: boolean
    content?: boolean
    group_index?: boolean
    item_index?: boolean
    source?: boolean
    delivery_message_id?: boolean
    run_id?: boolean
    trace_id?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["conversationItem"]>

  export type ConversationItemSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    conversation_id?: boolean
    session_key?: boolean
    role?: boolean
    phase?: boolean
    content?: boolean
    group_index?: boolean
    item_index?: boolean
    source?: boolean
    delivery_message_id?: boolean
    run_id?: boolean
    trace_id?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["conversationItem"]>

  export type ConversationItemSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    conversation_id?: boolean
    session_key?: boolean
    role?: boolean
    phase?: boolean
    content?: boolean
    group_index?: boolean
    item_index?: boolean
    source?: boolean
    delivery_message_id?: boolean
    run_id?: boolean
    trace_id?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["conversationItem"]>

  export type ConversationItemSelectScalar = {
    id?: boolean
    conversation_id?: boolean
    session_key?: boolean
    role?: boolean
    phase?: boolean
    content?: boolean
    group_index?: boolean
    item_index?: boolean
    source?: boolean
    delivery_message_id?: boolean
    run_id?: boolean
    trace_id?: boolean
    created_at?: boolean
  }

  export type ConversationItemOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "conversation_id" | "session_key" | "role" | "phase" | "content" | "group_index" | "item_index" | "source" | "delivery_message_id" | "run_id" | "trace_id" | "created_at", ExtArgs["result"]["conversationItem"]>

  export type $ConversationItemPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ConversationItem"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      conversation_id: bigint
      session_key: string | null
      role: string
      phase: string | null
      content: string
      group_index: number
      item_index: number
      source: string
      delivery_message_id: bigint | null
      run_id: string | null
      trace_id: string | null
      created_at: Date
    }, ExtArgs["result"]["conversationItem"]>
    composites: {}
  }

  type ConversationItemGetPayload<S extends boolean | null | undefined | ConversationItemDefaultArgs> = $Result.GetResult<Prisma.$ConversationItemPayload, S>

  type ConversationItemCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<ConversationItemFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: ConversationItemCountAggregateInputType | true
    }

  export interface ConversationItemDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ConversationItem'], meta: { name: 'ConversationItem' } }
    /**
     * Find zero or one ConversationItem that matches the filter.
     * @param {ConversationItemFindUniqueArgs} args - Arguments to find a ConversationItem
     * @example
     * // Get one ConversationItem
     * const conversationItem = await prisma.conversationItem.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ConversationItemFindUniqueArgs>(args: SelectSubset<T, ConversationItemFindUniqueArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one ConversationItem that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {ConversationItemFindUniqueOrThrowArgs} args - Arguments to find a ConversationItem
     * @example
     * // Get one ConversationItem
     * const conversationItem = await prisma.conversationItem.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ConversationItemFindUniqueOrThrowArgs>(args: SelectSubset<T, ConversationItemFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first ConversationItem that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemFindFirstArgs} args - Arguments to find a ConversationItem
     * @example
     * // Get one ConversationItem
     * const conversationItem = await prisma.conversationItem.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ConversationItemFindFirstArgs>(args?: SelectSubset<T, ConversationItemFindFirstArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first ConversationItem that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemFindFirstOrThrowArgs} args - Arguments to find a ConversationItem
     * @example
     * // Get one ConversationItem
     * const conversationItem = await prisma.conversationItem.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ConversationItemFindFirstOrThrowArgs>(args?: SelectSubset<T, ConversationItemFindFirstOrThrowArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more ConversationItems that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ConversationItems
     * const conversationItems = await prisma.conversationItem.findMany()
     * 
     * // Get first 10 ConversationItems
     * const conversationItems = await prisma.conversationItem.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const conversationItemWithIdOnly = await prisma.conversationItem.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ConversationItemFindManyArgs>(args?: SelectSubset<T, ConversationItemFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a ConversationItem.
     * @param {ConversationItemCreateArgs} args - Arguments to create a ConversationItem.
     * @example
     * // Create one ConversationItem
     * const ConversationItem = await prisma.conversationItem.create({
     *   data: {
     *     // ... data to create a ConversationItem
     *   }
     * })
     * 
     */
    create<T extends ConversationItemCreateArgs>(args: SelectSubset<T, ConversationItemCreateArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many ConversationItems.
     * @param {ConversationItemCreateManyArgs} args - Arguments to create many ConversationItems.
     * @example
     * // Create many ConversationItems
     * const conversationItem = await prisma.conversationItem.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ConversationItemCreateManyArgs>(args?: SelectSubset<T, ConversationItemCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ConversationItems and returns the data saved in the database.
     * @param {ConversationItemCreateManyAndReturnArgs} args - Arguments to create many ConversationItems.
     * @example
     * // Create many ConversationItems
     * const conversationItem = await prisma.conversationItem.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ConversationItems and only return the `id`
     * const conversationItemWithIdOnly = await prisma.conversationItem.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ConversationItemCreateManyAndReturnArgs>(args?: SelectSubset<T, ConversationItemCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a ConversationItem.
     * @param {ConversationItemDeleteArgs} args - Arguments to delete one ConversationItem.
     * @example
     * // Delete one ConversationItem
     * const ConversationItem = await prisma.conversationItem.delete({
     *   where: {
     *     // ... filter to delete one ConversationItem
     *   }
     * })
     * 
     */
    delete<T extends ConversationItemDeleteArgs>(args: SelectSubset<T, ConversationItemDeleteArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one ConversationItem.
     * @param {ConversationItemUpdateArgs} args - Arguments to update one ConversationItem.
     * @example
     * // Update one ConversationItem
     * const conversationItem = await prisma.conversationItem.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ConversationItemUpdateArgs>(args: SelectSubset<T, ConversationItemUpdateArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more ConversationItems.
     * @param {ConversationItemDeleteManyArgs} args - Arguments to filter ConversationItems to delete.
     * @example
     * // Delete a few ConversationItems
     * const { count } = await prisma.conversationItem.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ConversationItemDeleteManyArgs>(args?: SelectSubset<T, ConversationItemDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ConversationItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ConversationItems
     * const conversationItem = await prisma.conversationItem.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ConversationItemUpdateManyArgs>(args: SelectSubset<T, ConversationItemUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ConversationItems and returns the data updated in the database.
     * @param {ConversationItemUpdateManyAndReturnArgs} args - Arguments to update many ConversationItems.
     * @example
     * // Update many ConversationItems
     * const conversationItem = await prisma.conversationItem.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more ConversationItems and only return the `id`
     * const conversationItemWithIdOnly = await prisma.conversationItem.updateManyAndReturn({
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
    updateManyAndReturn<T extends ConversationItemUpdateManyAndReturnArgs>(args: SelectSubset<T, ConversationItemUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one ConversationItem.
     * @param {ConversationItemUpsertArgs} args - Arguments to update or create a ConversationItem.
     * @example
     * // Update or create a ConversationItem
     * const conversationItem = await prisma.conversationItem.upsert({
     *   create: {
     *     // ... data to create a ConversationItem
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ConversationItem we want to update
     *   }
     * })
     */
    upsert<T extends ConversationItemUpsertArgs>(args: SelectSubset<T, ConversationItemUpsertArgs<ExtArgs>>): Prisma__ConversationItemClient<$Result.GetResult<Prisma.$ConversationItemPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of ConversationItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemCountArgs} args - Arguments to filter ConversationItems to count.
     * @example
     * // Count the number of ConversationItems
     * const count = await prisma.conversationItem.count({
     *   where: {
     *     // ... the filter for the ConversationItems we want to count
     *   }
     * })
    **/
    count<T extends ConversationItemCountArgs>(
      args?: Subset<T, ConversationItemCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ConversationItemCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ConversationItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends ConversationItemAggregateArgs>(args: Subset<T, ConversationItemAggregateArgs>): Prisma.PrismaPromise<GetConversationItemAggregateType<T>>

    /**
     * Group by ConversationItem.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConversationItemGroupByArgs} args - Group by arguments.
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
      T extends ConversationItemGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ConversationItemGroupByArgs['orderBy'] }
        : { orderBy?: ConversationItemGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, ConversationItemGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetConversationItemGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ConversationItem model
   */
  readonly fields: ConversationItemFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ConversationItem.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ConversationItemClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the ConversationItem model
   */
  interface ConversationItemFieldRefs {
    readonly id: FieldRef<"ConversationItem", 'BigInt'>
    readonly conversation_id: FieldRef<"ConversationItem", 'BigInt'>
    readonly session_key: FieldRef<"ConversationItem", 'String'>
    readonly role: FieldRef<"ConversationItem", 'String'>
    readonly phase: FieldRef<"ConversationItem", 'String'>
    readonly content: FieldRef<"ConversationItem", 'String'>
    readonly group_index: FieldRef<"ConversationItem", 'Int'>
    readonly item_index: FieldRef<"ConversationItem", 'Int'>
    readonly source: FieldRef<"ConversationItem", 'String'>
    readonly delivery_message_id: FieldRef<"ConversationItem", 'BigInt'>
    readonly run_id: FieldRef<"ConversationItem", 'String'>
    readonly trace_id: FieldRef<"ConversationItem", 'String'>
    readonly created_at: FieldRef<"ConversationItem", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * ConversationItem findUnique
   */
  export type ConversationItemFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * Filter, which ConversationItem to fetch.
     */
    where: ConversationItemWhereUniqueInput
  }

  /**
   * ConversationItem findUniqueOrThrow
   */
  export type ConversationItemFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * Filter, which ConversationItem to fetch.
     */
    where: ConversationItemWhereUniqueInput
  }

  /**
   * ConversationItem findFirst
   */
  export type ConversationItemFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * Filter, which ConversationItem to fetch.
     */
    where?: ConversationItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConversationItems to fetch.
     */
    orderBy?: ConversationItemOrderByWithRelationInput | ConversationItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ConversationItems.
     */
    cursor?: ConversationItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConversationItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConversationItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ConversationItems.
     */
    distinct?: ConversationItemScalarFieldEnum | ConversationItemScalarFieldEnum[]
  }

  /**
   * ConversationItem findFirstOrThrow
   */
  export type ConversationItemFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * Filter, which ConversationItem to fetch.
     */
    where?: ConversationItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConversationItems to fetch.
     */
    orderBy?: ConversationItemOrderByWithRelationInput | ConversationItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ConversationItems.
     */
    cursor?: ConversationItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConversationItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConversationItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ConversationItems.
     */
    distinct?: ConversationItemScalarFieldEnum | ConversationItemScalarFieldEnum[]
  }

  /**
   * ConversationItem findMany
   */
  export type ConversationItemFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * Filter, which ConversationItems to fetch.
     */
    where?: ConversationItemWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConversationItems to fetch.
     */
    orderBy?: ConversationItemOrderByWithRelationInput | ConversationItemOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ConversationItems.
     */
    cursor?: ConversationItemWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConversationItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConversationItems.
     */
    skip?: number
    distinct?: ConversationItemScalarFieldEnum | ConversationItemScalarFieldEnum[]
  }

  /**
   * ConversationItem create
   */
  export type ConversationItemCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * The data needed to create a ConversationItem.
     */
    data: XOR<ConversationItemCreateInput, ConversationItemUncheckedCreateInput>
  }

  /**
   * ConversationItem createMany
   */
  export type ConversationItemCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ConversationItems.
     */
    data: ConversationItemCreateManyInput | ConversationItemCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ConversationItem createManyAndReturn
   */
  export type ConversationItemCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * The data used to create many ConversationItems.
     */
    data: ConversationItemCreateManyInput | ConversationItemCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ConversationItem update
   */
  export type ConversationItemUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * The data needed to update a ConversationItem.
     */
    data: XOR<ConversationItemUpdateInput, ConversationItemUncheckedUpdateInput>
    /**
     * Choose, which ConversationItem to update.
     */
    where: ConversationItemWhereUniqueInput
  }

  /**
   * ConversationItem updateMany
   */
  export type ConversationItemUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ConversationItems.
     */
    data: XOR<ConversationItemUpdateManyMutationInput, ConversationItemUncheckedUpdateManyInput>
    /**
     * Filter which ConversationItems to update
     */
    where?: ConversationItemWhereInput
    /**
     * Limit how many ConversationItems to update.
     */
    limit?: number
  }

  /**
   * ConversationItem updateManyAndReturn
   */
  export type ConversationItemUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * The data used to update ConversationItems.
     */
    data: XOR<ConversationItemUpdateManyMutationInput, ConversationItemUncheckedUpdateManyInput>
    /**
     * Filter which ConversationItems to update
     */
    where?: ConversationItemWhereInput
    /**
     * Limit how many ConversationItems to update.
     */
    limit?: number
  }

  /**
   * ConversationItem upsert
   */
  export type ConversationItemUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * The filter to search for the ConversationItem to update in case it exists.
     */
    where: ConversationItemWhereUniqueInput
    /**
     * In case the ConversationItem found by the `where` argument doesn't exist, create a new ConversationItem with this data.
     */
    create: XOR<ConversationItemCreateInput, ConversationItemUncheckedCreateInput>
    /**
     * In case the ConversationItem was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ConversationItemUpdateInput, ConversationItemUncheckedUpdateInput>
  }

  /**
   * ConversationItem delete
   */
  export type ConversationItemDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
    /**
     * Filter which ConversationItem to delete.
     */
    where: ConversationItemWhereUniqueInput
  }

  /**
   * ConversationItem deleteMany
   */
  export type ConversationItemDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ConversationItems to delete
     */
    where?: ConversationItemWhereInput
    /**
     * Limit how many ConversationItems to delete.
     */
    limit?: number
  }

  /**
   * ConversationItem without action
   */
  export type ConversationItemDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConversationItem
     */
    select?: ConversationItemSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConversationItem
     */
    omit?: ConversationItemOmit<ExtArgs> | null
  }


  /**
   * Model TrafficReplayHistory
   */

  export type AggregateTrafficReplayHistory = {
    _count: TrafficReplayHistoryCountAggregateOutputType | null
    _avg: TrafficReplayHistoryAvgAggregateOutputType | null
    _sum: TrafficReplayHistorySumAggregateOutputType | null
    _min: TrafficReplayHistoryMinAggregateOutputType | null
    _max: TrafficReplayHistoryMaxAggregateOutputType | null
  }

  export type TrafficReplayHistoryAvgAggregateOutputType = {
    id: number | null
    original_log_id: number | null
    response_status: number | null
    duration_ms: number | null
    replay_response_status: number | null
    replay_duration_ms: number | null
    replay_response_size: number | null
    duration_diff_ms: number | null
    body_size_diff: number | null
    template_id: number | null
  }

  export type TrafficReplayHistorySumAggregateOutputType = {
    id: bigint | null
    original_log_id: bigint | null
    response_status: number | null
    duration_ms: number | null
    replay_response_status: number | null
    replay_duration_ms: number | null
    replay_response_size: number | null
    duration_diff_ms: number | null
    body_size_diff: number | null
    template_id: number | null
  }

  export type TrafficReplayHistoryMinAggregateOutputType = {
    id: bigint | null
    original_log_id: bigint | null
    replay_name: string | null
    target_url: string | null
    request_method: string | null
    request_body: string | null
    response_status: number | null
    response_body: string | null
    duration_ms: number | null
    status: string | null
    error_message: string | null
    replayed_at: Date | null
    replayed_by: string | null
    modified_method: string | null
    modified_url: string | null
    modified_body: string | null
    replay_request_body: string | null
    replay_response_status: number | null
    replay_duration_ms: number | null
    replay_response_body: string | null
    replay_response_size: number | null
    status_code_match: boolean | null
    response_body_match: boolean | null
    duration_diff_ms: number | null
    body_size_diff: number | null
    success: boolean | null
    template_id: number | null
  }

  export type TrafficReplayHistoryMaxAggregateOutputType = {
    id: bigint | null
    original_log_id: bigint | null
    replay_name: string | null
    target_url: string | null
    request_method: string | null
    request_body: string | null
    response_status: number | null
    response_body: string | null
    duration_ms: number | null
    status: string | null
    error_message: string | null
    replayed_at: Date | null
    replayed_by: string | null
    modified_method: string | null
    modified_url: string | null
    modified_body: string | null
    replay_request_body: string | null
    replay_response_status: number | null
    replay_duration_ms: number | null
    replay_response_body: string | null
    replay_response_size: number | null
    status_code_match: boolean | null
    response_body_match: boolean | null
    duration_diff_ms: number | null
    body_size_diff: number | null
    success: boolean | null
    template_id: number | null
  }

  export type TrafficReplayHistoryCountAggregateOutputType = {
    id: number
    original_log_id: number
    replay_name: number
    target_url: number
    request_method: number
    request_headers: number
    request_body: number
    response_status: number
    response_headers: number
    response_body: number
    duration_ms: number
    status: number
    error_message: number
    replayed_at: number
    replayed_by: number
    modified_method: number
    modified_url: number
    modified_headers: number
    modified_body: number
    modification_summary: number
    replay_request_headers: number
    replay_request_body: number
    replay_response_status: number
    replay_duration_ms: number
    replay_response_headers: number
    replay_response_body: number
    replay_response_size: number
    diff_summary: number
    status_code_match: number
    response_body_match: number
    duration_diff_ms: number
    body_size_diff: number
    success: number
    template_id: number
    _all: number
  }


  export type TrafficReplayHistoryAvgAggregateInputType = {
    id?: true
    original_log_id?: true
    response_status?: true
    duration_ms?: true
    replay_response_status?: true
    replay_duration_ms?: true
    replay_response_size?: true
    duration_diff_ms?: true
    body_size_diff?: true
    template_id?: true
  }

  export type TrafficReplayHistorySumAggregateInputType = {
    id?: true
    original_log_id?: true
    response_status?: true
    duration_ms?: true
    replay_response_status?: true
    replay_duration_ms?: true
    replay_response_size?: true
    duration_diff_ms?: true
    body_size_diff?: true
    template_id?: true
  }

  export type TrafficReplayHistoryMinAggregateInputType = {
    id?: true
    original_log_id?: true
    replay_name?: true
    target_url?: true
    request_method?: true
    request_body?: true
    response_status?: true
    response_body?: true
    duration_ms?: true
    status?: true
    error_message?: true
    replayed_at?: true
    replayed_by?: true
    modified_method?: true
    modified_url?: true
    modified_body?: true
    replay_request_body?: true
    replay_response_status?: true
    replay_duration_ms?: true
    replay_response_body?: true
    replay_response_size?: true
    status_code_match?: true
    response_body_match?: true
    duration_diff_ms?: true
    body_size_diff?: true
    success?: true
    template_id?: true
  }

  export type TrafficReplayHistoryMaxAggregateInputType = {
    id?: true
    original_log_id?: true
    replay_name?: true
    target_url?: true
    request_method?: true
    request_body?: true
    response_status?: true
    response_body?: true
    duration_ms?: true
    status?: true
    error_message?: true
    replayed_at?: true
    replayed_by?: true
    modified_method?: true
    modified_url?: true
    modified_body?: true
    replay_request_body?: true
    replay_response_status?: true
    replay_duration_ms?: true
    replay_response_body?: true
    replay_response_size?: true
    status_code_match?: true
    response_body_match?: true
    duration_diff_ms?: true
    body_size_diff?: true
    success?: true
    template_id?: true
  }

  export type TrafficReplayHistoryCountAggregateInputType = {
    id?: true
    original_log_id?: true
    replay_name?: true
    target_url?: true
    request_method?: true
    request_headers?: true
    request_body?: true
    response_status?: true
    response_headers?: true
    response_body?: true
    duration_ms?: true
    status?: true
    error_message?: true
    replayed_at?: true
    replayed_by?: true
    modified_method?: true
    modified_url?: true
    modified_headers?: true
    modified_body?: true
    modification_summary?: true
    replay_request_headers?: true
    replay_request_body?: true
    replay_response_status?: true
    replay_duration_ms?: true
    replay_response_headers?: true
    replay_response_body?: true
    replay_response_size?: true
    diff_summary?: true
    status_code_match?: true
    response_body_match?: true
    duration_diff_ms?: true
    body_size_diff?: true
    success?: true
    template_id?: true
    _all?: true
  }

  export type TrafficReplayHistoryAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TrafficReplayHistory to aggregate.
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrafficReplayHistories to fetch.
     */
    orderBy?: TrafficReplayHistoryOrderByWithRelationInput | TrafficReplayHistoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TrafficReplayHistoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrafficReplayHistories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrafficReplayHistories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TrafficReplayHistories
    **/
    _count?: true | TrafficReplayHistoryCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TrafficReplayHistoryAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TrafficReplayHistorySumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TrafficReplayHistoryMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TrafficReplayHistoryMaxAggregateInputType
  }

  export type GetTrafficReplayHistoryAggregateType<T extends TrafficReplayHistoryAggregateArgs> = {
        [P in keyof T & keyof AggregateTrafficReplayHistory]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTrafficReplayHistory[P]>
      : GetScalarType<T[P], AggregateTrafficReplayHistory[P]>
  }




  export type TrafficReplayHistoryGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TrafficReplayHistoryWhereInput
    orderBy?: TrafficReplayHistoryOrderByWithAggregationInput | TrafficReplayHistoryOrderByWithAggregationInput[]
    by: TrafficReplayHistoryScalarFieldEnum[] | TrafficReplayHistoryScalarFieldEnum
    having?: TrafficReplayHistoryScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TrafficReplayHistoryCountAggregateInputType | true
    _avg?: TrafficReplayHistoryAvgAggregateInputType
    _sum?: TrafficReplayHistorySumAggregateInputType
    _min?: TrafficReplayHistoryMinAggregateInputType
    _max?: TrafficReplayHistoryMaxAggregateInputType
  }

  export type TrafficReplayHistoryGroupByOutputType = {
    id: bigint
    original_log_id: bigint
    replay_name: string | null
    target_url: string | null
    request_method: string | null
    request_headers: JsonValue | null
    request_body: string | null
    response_status: number | null
    response_headers: JsonValue | null
    response_body: string | null
    duration_ms: number | null
    status: string
    error_message: string | null
    replayed_at: Date
    replayed_by: string | null
    modified_method: string | null
    modified_url: string | null
    modified_headers: JsonValue | null
    modified_body: string | null
    modification_summary: JsonValue | null
    replay_request_headers: JsonValue | null
    replay_request_body: string | null
    replay_response_status: number | null
    replay_duration_ms: number | null
    replay_response_headers: JsonValue | null
    replay_response_body: string | null
    replay_response_size: number | null
    diff_summary: JsonValue | null
    status_code_match: boolean
    response_body_match: boolean
    duration_diff_ms: number | null
    body_size_diff: number | null
    success: boolean
    template_id: number | null
    _count: TrafficReplayHistoryCountAggregateOutputType | null
    _avg: TrafficReplayHistoryAvgAggregateOutputType | null
    _sum: TrafficReplayHistorySumAggregateOutputType | null
    _min: TrafficReplayHistoryMinAggregateOutputType | null
    _max: TrafficReplayHistoryMaxAggregateOutputType | null
  }

  type GetTrafficReplayHistoryGroupByPayload<T extends TrafficReplayHistoryGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TrafficReplayHistoryGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TrafficReplayHistoryGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TrafficReplayHistoryGroupByOutputType[P]>
            : GetScalarType<T[P], TrafficReplayHistoryGroupByOutputType[P]>
        }
      >
    >


  export type TrafficReplayHistorySelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    original_log_id?: boolean
    replay_name?: boolean
    target_url?: boolean
    request_method?: boolean
    request_headers?: boolean
    request_body?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    duration_ms?: boolean
    status?: boolean
    error_message?: boolean
    replayed_at?: boolean
    replayed_by?: boolean
    modified_method?: boolean
    modified_url?: boolean
    modified_headers?: boolean
    modified_body?: boolean
    modification_summary?: boolean
    replay_request_headers?: boolean
    replay_request_body?: boolean
    replay_response_status?: boolean
    replay_duration_ms?: boolean
    replay_response_headers?: boolean
    replay_response_body?: boolean
    replay_response_size?: boolean
    diff_summary?: boolean
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: boolean
    body_size_diff?: boolean
    success?: boolean
    template_id?: boolean
  }, ExtArgs["result"]["trafficReplayHistory"]>

  export type TrafficReplayHistorySelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    original_log_id?: boolean
    replay_name?: boolean
    target_url?: boolean
    request_method?: boolean
    request_headers?: boolean
    request_body?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    duration_ms?: boolean
    status?: boolean
    error_message?: boolean
    replayed_at?: boolean
    replayed_by?: boolean
    modified_method?: boolean
    modified_url?: boolean
    modified_headers?: boolean
    modified_body?: boolean
    modification_summary?: boolean
    replay_request_headers?: boolean
    replay_request_body?: boolean
    replay_response_status?: boolean
    replay_duration_ms?: boolean
    replay_response_headers?: boolean
    replay_response_body?: boolean
    replay_response_size?: boolean
    diff_summary?: boolean
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: boolean
    body_size_diff?: boolean
    success?: boolean
    template_id?: boolean
  }, ExtArgs["result"]["trafficReplayHistory"]>

  export type TrafficReplayHistorySelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    original_log_id?: boolean
    replay_name?: boolean
    target_url?: boolean
    request_method?: boolean
    request_headers?: boolean
    request_body?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    duration_ms?: boolean
    status?: boolean
    error_message?: boolean
    replayed_at?: boolean
    replayed_by?: boolean
    modified_method?: boolean
    modified_url?: boolean
    modified_headers?: boolean
    modified_body?: boolean
    modification_summary?: boolean
    replay_request_headers?: boolean
    replay_request_body?: boolean
    replay_response_status?: boolean
    replay_duration_ms?: boolean
    replay_response_headers?: boolean
    replay_response_body?: boolean
    replay_response_size?: boolean
    diff_summary?: boolean
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: boolean
    body_size_diff?: boolean
    success?: boolean
    template_id?: boolean
  }, ExtArgs["result"]["trafficReplayHistory"]>

  export type TrafficReplayHistorySelectScalar = {
    id?: boolean
    original_log_id?: boolean
    replay_name?: boolean
    target_url?: boolean
    request_method?: boolean
    request_headers?: boolean
    request_body?: boolean
    response_status?: boolean
    response_headers?: boolean
    response_body?: boolean
    duration_ms?: boolean
    status?: boolean
    error_message?: boolean
    replayed_at?: boolean
    replayed_by?: boolean
    modified_method?: boolean
    modified_url?: boolean
    modified_headers?: boolean
    modified_body?: boolean
    modification_summary?: boolean
    replay_request_headers?: boolean
    replay_request_body?: boolean
    replay_response_status?: boolean
    replay_duration_ms?: boolean
    replay_response_headers?: boolean
    replay_response_body?: boolean
    replay_response_size?: boolean
    diff_summary?: boolean
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: boolean
    body_size_diff?: boolean
    success?: boolean
    template_id?: boolean
  }

  export type TrafficReplayHistoryOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "original_log_id" | "replay_name" | "target_url" | "request_method" | "request_headers" | "request_body" | "response_status" | "response_headers" | "response_body" | "duration_ms" | "status" | "error_message" | "replayed_at" | "replayed_by" | "modified_method" | "modified_url" | "modified_headers" | "modified_body" | "modification_summary" | "replay_request_headers" | "replay_request_body" | "replay_response_status" | "replay_duration_ms" | "replay_response_headers" | "replay_response_body" | "replay_response_size" | "diff_summary" | "status_code_match" | "response_body_match" | "duration_diff_ms" | "body_size_diff" | "success" | "template_id", ExtArgs["result"]["trafficReplayHistory"]>

  export type $TrafficReplayHistoryPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TrafficReplayHistory"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      original_log_id: bigint
      replay_name: string | null
      target_url: string | null
      request_method: string | null
      request_headers: Prisma.JsonValue | null
      request_body: string | null
      response_status: number | null
      response_headers: Prisma.JsonValue | null
      response_body: string | null
      duration_ms: number | null
      status: string
      error_message: string | null
      replayed_at: Date
      replayed_by: string | null
      modified_method: string | null
      modified_url: string | null
      modified_headers: Prisma.JsonValue | null
      modified_body: string | null
      modification_summary: Prisma.JsonValue | null
      replay_request_headers: Prisma.JsonValue | null
      replay_request_body: string | null
      replay_response_status: number | null
      replay_duration_ms: number | null
      replay_response_headers: Prisma.JsonValue | null
      replay_response_body: string | null
      replay_response_size: number | null
      diff_summary: Prisma.JsonValue | null
      status_code_match: boolean
      response_body_match: boolean
      duration_diff_ms: number | null
      body_size_diff: number | null
      success: boolean
      template_id: number | null
    }, ExtArgs["result"]["trafficReplayHistory"]>
    composites: {}
  }

  type TrafficReplayHistoryGetPayload<S extends boolean | null | undefined | TrafficReplayHistoryDefaultArgs> = $Result.GetResult<Prisma.$TrafficReplayHistoryPayload, S>

  type TrafficReplayHistoryCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<TrafficReplayHistoryFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: TrafficReplayHistoryCountAggregateInputType | true
    }

  export interface TrafficReplayHistoryDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TrafficReplayHistory'], meta: { name: 'TrafficReplayHistory' } }
    /**
     * Find zero or one TrafficReplayHistory that matches the filter.
     * @param {TrafficReplayHistoryFindUniqueArgs} args - Arguments to find a TrafficReplayHistory
     * @example
     * // Get one TrafficReplayHistory
     * const trafficReplayHistory = await prisma.trafficReplayHistory.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TrafficReplayHistoryFindUniqueArgs>(args: SelectSubset<T, TrafficReplayHistoryFindUniqueArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one TrafficReplayHistory that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {TrafficReplayHistoryFindUniqueOrThrowArgs} args - Arguments to find a TrafficReplayHistory
     * @example
     * // Get one TrafficReplayHistory
     * const trafficReplayHistory = await prisma.trafficReplayHistory.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TrafficReplayHistoryFindUniqueOrThrowArgs>(args: SelectSubset<T, TrafficReplayHistoryFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first TrafficReplayHistory that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryFindFirstArgs} args - Arguments to find a TrafficReplayHistory
     * @example
     * // Get one TrafficReplayHistory
     * const trafficReplayHistory = await prisma.trafficReplayHistory.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TrafficReplayHistoryFindFirstArgs>(args?: SelectSubset<T, TrafficReplayHistoryFindFirstArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first TrafficReplayHistory that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryFindFirstOrThrowArgs} args - Arguments to find a TrafficReplayHistory
     * @example
     * // Get one TrafficReplayHistory
     * const trafficReplayHistory = await prisma.trafficReplayHistory.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TrafficReplayHistoryFindFirstOrThrowArgs>(args?: SelectSubset<T, TrafficReplayHistoryFindFirstOrThrowArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more TrafficReplayHistories that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TrafficReplayHistories
     * const trafficReplayHistories = await prisma.trafficReplayHistory.findMany()
     * 
     * // Get first 10 TrafficReplayHistories
     * const trafficReplayHistories = await prisma.trafficReplayHistory.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const trafficReplayHistoryWithIdOnly = await prisma.trafficReplayHistory.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TrafficReplayHistoryFindManyArgs>(args?: SelectSubset<T, TrafficReplayHistoryFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a TrafficReplayHistory.
     * @param {TrafficReplayHistoryCreateArgs} args - Arguments to create a TrafficReplayHistory.
     * @example
     * // Create one TrafficReplayHistory
     * const TrafficReplayHistory = await prisma.trafficReplayHistory.create({
     *   data: {
     *     // ... data to create a TrafficReplayHistory
     *   }
     * })
     * 
     */
    create<T extends TrafficReplayHistoryCreateArgs>(args: SelectSubset<T, TrafficReplayHistoryCreateArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many TrafficReplayHistories.
     * @param {TrafficReplayHistoryCreateManyArgs} args - Arguments to create many TrafficReplayHistories.
     * @example
     * // Create many TrafficReplayHistories
     * const trafficReplayHistory = await prisma.trafficReplayHistory.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TrafficReplayHistoryCreateManyArgs>(args?: SelectSubset<T, TrafficReplayHistoryCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TrafficReplayHistories and returns the data saved in the database.
     * @param {TrafficReplayHistoryCreateManyAndReturnArgs} args - Arguments to create many TrafficReplayHistories.
     * @example
     * // Create many TrafficReplayHistories
     * const trafficReplayHistory = await prisma.trafficReplayHistory.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TrafficReplayHistories and only return the `id`
     * const trafficReplayHistoryWithIdOnly = await prisma.trafficReplayHistory.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TrafficReplayHistoryCreateManyAndReturnArgs>(args?: SelectSubset<T, TrafficReplayHistoryCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a TrafficReplayHistory.
     * @param {TrafficReplayHistoryDeleteArgs} args - Arguments to delete one TrafficReplayHistory.
     * @example
     * // Delete one TrafficReplayHistory
     * const TrafficReplayHistory = await prisma.trafficReplayHistory.delete({
     *   where: {
     *     // ... filter to delete one TrafficReplayHistory
     *   }
     * })
     * 
     */
    delete<T extends TrafficReplayHistoryDeleteArgs>(args: SelectSubset<T, TrafficReplayHistoryDeleteArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one TrafficReplayHistory.
     * @param {TrafficReplayHistoryUpdateArgs} args - Arguments to update one TrafficReplayHistory.
     * @example
     * // Update one TrafficReplayHistory
     * const trafficReplayHistory = await prisma.trafficReplayHistory.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TrafficReplayHistoryUpdateArgs>(args: SelectSubset<T, TrafficReplayHistoryUpdateArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more TrafficReplayHistories.
     * @param {TrafficReplayHistoryDeleteManyArgs} args - Arguments to filter TrafficReplayHistories to delete.
     * @example
     * // Delete a few TrafficReplayHistories
     * const { count } = await prisma.trafficReplayHistory.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TrafficReplayHistoryDeleteManyArgs>(args?: SelectSubset<T, TrafficReplayHistoryDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TrafficReplayHistories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TrafficReplayHistories
     * const trafficReplayHistory = await prisma.trafficReplayHistory.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TrafficReplayHistoryUpdateManyArgs>(args: SelectSubset<T, TrafficReplayHistoryUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TrafficReplayHistories and returns the data updated in the database.
     * @param {TrafficReplayHistoryUpdateManyAndReturnArgs} args - Arguments to update many TrafficReplayHistories.
     * @example
     * // Update many TrafficReplayHistories
     * const trafficReplayHistory = await prisma.trafficReplayHistory.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more TrafficReplayHistories and only return the `id`
     * const trafficReplayHistoryWithIdOnly = await prisma.trafficReplayHistory.updateManyAndReturn({
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
    updateManyAndReturn<T extends TrafficReplayHistoryUpdateManyAndReturnArgs>(args: SelectSubset<T, TrafficReplayHistoryUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one TrafficReplayHistory.
     * @param {TrafficReplayHistoryUpsertArgs} args - Arguments to update or create a TrafficReplayHistory.
     * @example
     * // Update or create a TrafficReplayHistory
     * const trafficReplayHistory = await prisma.trafficReplayHistory.upsert({
     *   create: {
     *     // ... data to create a TrafficReplayHistory
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TrafficReplayHistory we want to update
     *   }
     * })
     */
    upsert<T extends TrafficReplayHistoryUpsertArgs>(args: SelectSubset<T, TrafficReplayHistoryUpsertArgs<ExtArgs>>): Prisma__TrafficReplayHistoryClient<$Result.GetResult<Prisma.$TrafficReplayHistoryPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of TrafficReplayHistories.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryCountArgs} args - Arguments to filter TrafficReplayHistories to count.
     * @example
     * // Count the number of TrafficReplayHistories
     * const count = await prisma.trafficReplayHistory.count({
     *   where: {
     *     // ... the filter for the TrafficReplayHistories we want to count
     *   }
     * })
    **/
    count<T extends TrafficReplayHistoryCountArgs>(
      args?: Subset<T, TrafficReplayHistoryCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TrafficReplayHistoryCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TrafficReplayHistory.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends TrafficReplayHistoryAggregateArgs>(args: Subset<T, TrafficReplayHistoryAggregateArgs>): Prisma.PrismaPromise<GetTrafficReplayHistoryAggregateType<T>>

    /**
     * Group by TrafficReplayHistory.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TrafficReplayHistoryGroupByArgs} args - Group by arguments.
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
      T extends TrafficReplayHistoryGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TrafficReplayHistoryGroupByArgs['orderBy'] }
        : { orderBy?: TrafficReplayHistoryGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, TrafficReplayHistoryGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTrafficReplayHistoryGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TrafficReplayHistory model
   */
  readonly fields: TrafficReplayHistoryFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TrafficReplayHistory.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TrafficReplayHistoryClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the TrafficReplayHistory model
   */
  interface TrafficReplayHistoryFieldRefs {
    readonly id: FieldRef<"TrafficReplayHistory", 'BigInt'>
    readonly original_log_id: FieldRef<"TrafficReplayHistory", 'BigInt'>
    readonly replay_name: FieldRef<"TrafficReplayHistory", 'String'>
    readonly target_url: FieldRef<"TrafficReplayHistory", 'String'>
    readonly request_method: FieldRef<"TrafficReplayHistory", 'String'>
    readonly request_headers: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly request_body: FieldRef<"TrafficReplayHistory", 'String'>
    readonly response_status: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly response_headers: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly response_body: FieldRef<"TrafficReplayHistory", 'String'>
    readonly duration_ms: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly status: FieldRef<"TrafficReplayHistory", 'String'>
    readonly error_message: FieldRef<"TrafficReplayHistory", 'String'>
    readonly replayed_at: FieldRef<"TrafficReplayHistory", 'DateTime'>
    readonly replayed_by: FieldRef<"TrafficReplayHistory", 'String'>
    readonly modified_method: FieldRef<"TrafficReplayHistory", 'String'>
    readonly modified_url: FieldRef<"TrafficReplayHistory", 'String'>
    readonly modified_headers: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly modified_body: FieldRef<"TrafficReplayHistory", 'String'>
    readonly modification_summary: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly replay_request_headers: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly replay_request_body: FieldRef<"TrafficReplayHistory", 'String'>
    readonly replay_response_status: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly replay_duration_ms: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly replay_response_headers: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly replay_response_body: FieldRef<"TrafficReplayHistory", 'String'>
    readonly replay_response_size: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly diff_summary: FieldRef<"TrafficReplayHistory", 'Json'>
    readonly status_code_match: FieldRef<"TrafficReplayHistory", 'Boolean'>
    readonly response_body_match: FieldRef<"TrafficReplayHistory", 'Boolean'>
    readonly duration_diff_ms: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly body_size_diff: FieldRef<"TrafficReplayHistory", 'Int'>
    readonly success: FieldRef<"TrafficReplayHistory", 'Boolean'>
    readonly template_id: FieldRef<"TrafficReplayHistory", 'Int'>
  }
    

  // Custom InputTypes
  /**
   * TrafficReplayHistory findUnique
   */
  export type TrafficReplayHistoryFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * Filter, which TrafficReplayHistory to fetch.
     */
    where: TrafficReplayHistoryWhereUniqueInput
  }

  /**
   * TrafficReplayHistory findUniqueOrThrow
   */
  export type TrafficReplayHistoryFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * Filter, which TrafficReplayHistory to fetch.
     */
    where: TrafficReplayHistoryWhereUniqueInput
  }

  /**
   * TrafficReplayHistory findFirst
   */
  export type TrafficReplayHistoryFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * Filter, which TrafficReplayHistory to fetch.
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrafficReplayHistories to fetch.
     */
    orderBy?: TrafficReplayHistoryOrderByWithRelationInput | TrafficReplayHistoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TrafficReplayHistories.
     */
    cursor?: TrafficReplayHistoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrafficReplayHistories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrafficReplayHistories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TrafficReplayHistories.
     */
    distinct?: TrafficReplayHistoryScalarFieldEnum | TrafficReplayHistoryScalarFieldEnum[]
  }

  /**
   * TrafficReplayHistory findFirstOrThrow
   */
  export type TrafficReplayHistoryFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * Filter, which TrafficReplayHistory to fetch.
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrafficReplayHistories to fetch.
     */
    orderBy?: TrafficReplayHistoryOrderByWithRelationInput | TrafficReplayHistoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TrafficReplayHistories.
     */
    cursor?: TrafficReplayHistoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrafficReplayHistories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrafficReplayHistories.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TrafficReplayHistories.
     */
    distinct?: TrafficReplayHistoryScalarFieldEnum | TrafficReplayHistoryScalarFieldEnum[]
  }

  /**
   * TrafficReplayHistory findMany
   */
  export type TrafficReplayHistoryFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * Filter, which TrafficReplayHistories to fetch.
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TrafficReplayHistories to fetch.
     */
    orderBy?: TrafficReplayHistoryOrderByWithRelationInput | TrafficReplayHistoryOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TrafficReplayHistories.
     */
    cursor?: TrafficReplayHistoryWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TrafficReplayHistories from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TrafficReplayHistories.
     */
    skip?: number
    distinct?: TrafficReplayHistoryScalarFieldEnum | TrafficReplayHistoryScalarFieldEnum[]
  }

  /**
   * TrafficReplayHistory create
   */
  export type TrafficReplayHistoryCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * The data needed to create a TrafficReplayHistory.
     */
    data: XOR<TrafficReplayHistoryCreateInput, TrafficReplayHistoryUncheckedCreateInput>
  }

  /**
   * TrafficReplayHistory createMany
   */
  export type TrafficReplayHistoryCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TrafficReplayHistories.
     */
    data: TrafficReplayHistoryCreateManyInput | TrafficReplayHistoryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TrafficReplayHistory createManyAndReturn
   */
  export type TrafficReplayHistoryCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * The data used to create many TrafficReplayHistories.
     */
    data: TrafficReplayHistoryCreateManyInput | TrafficReplayHistoryCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TrafficReplayHistory update
   */
  export type TrafficReplayHistoryUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * The data needed to update a TrafficReplayHistory.
     */
    data: XOR<TrafficReplayHistoryUpdateInput, TrafficReplayHistoryUncheckedUpdateInput>
    /**
     * Choose, which TrafficReplayHistory to update.
     */
    where: TrafficReplayHistoryWhereUniqueInput
  }

  /**
   * TrafficReplayHistory updateMany
   */
  export type TrafficReplayHistoryUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TrafficReplayHistories.
     */
    data: XOR<TrafficReplayHistoryUpdateManyMutationInput, TrafficReplayHistoryUncheckedUpdateManyInput>
    /**
     * Filter which TrafficReplayHistories to update
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * Limit how many TrafficReplayHistories to update.
     */
    limit?: number
  }

  /**
   * TrafficReplayHistory updateManyAndReturn
   */
  export type TrafficReplayHistoryUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * The data used to update TrafficReplayHistories.
     */
    data: XOR<TrafficReplayHistoryUpdateManyMutationInput, TrafficReplayHistoryUncheckedUpdateManyInput>
    /**
     * Filter which TrafficReplayHistories to update
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * Limit how many TrafficReplayHistories to update.
     */
    limit?: number
  }

  /**
   * TrafficReplayHistory upsert
   */
  export type TrafficReplayHistoryUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * The filter to search for the TrafficReplayHistory to update in case it exists.
     */
    where: TrafficReplayHistoryWhereUniqueInput
    /**
     * In case the TrafficReplayHistory found by the `where` argument doesn't exist, create a new TrafficReplayHistory with this data.
     */
    create: XOR<TrafficReplayHistoryCreateInput, TrafficReplayHistoryUncheckedCreateInput>
    /**
     * In case the TrafficReplayHistory was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TrafficReplayHistoryUpdateInput, TrafficReplayHistoryUncheckedUpdateInput>
  }

  /**
   * TrafficReplayHistory delete
   */
  export type TrafficReplayHistoryDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
    /**
     * Filter which TrafficReplayHistory to delete.
     */
    where: TrafficReplayHistoryWhereUniqueInput
  }

  /**
   * TrafficReplayHistory deleteMany
   */
  export type TrafficReplayHistoryDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TrafficReplayHistories to delete
     */
    where?: TrafficReplayHistoryWhereInput
    /**
     * Limit how many TrafficReplayHistories to delete.
     */
    limit?: number
  }

  /**
   * TrafficReplayHistory without action
   */
  export type TrafficReplayHistoryDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TrafficReplayHistory
     */
    select?: TrafficReplayHistorySelect<ExtArgs> | null
    /**
     * Omit specific fields from the TrafficReplayHistory
     */
    omit?: TrafficReplayHistoryOmit<ExtArgs> | null
  }


  /**
   * Model RelationshipLedgerEvent
   */

  export type AggregateRelationshipLedgerEvent = {
    _count: RelationshipLedgerEventCountAggregateOutputType | null
    _avg: RelationshipLedgerEventAvgAggregateOutputType | null
    _sum: RelationshipLedgerEventSumAggregateOutputType | null
    _min: RelationshipLedgerEventMinAggregateOutputType | null
    _max: RelationshipLedgerEventMaxAggregateOutputType | null
  }

  export type RelationshipLedgerEventAvgAggregateOutputType = {
    id: number | null
    group_id: number | null
    target_user_id: number | null
    event_weight: number | null
  }

  export type RelationshipLedgerEventSumAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    target_user_id: bigint | null
    event_weight: number | null
  }

  export type RelationshipLedgerEventMinAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    target_user_id: bigint | null
    session_key: string | null
    event_type: string | null
    event_weight: number | null
    confidence: string | null
    source_excerpt: string | null
    created_at: Date | null
    last_reinforced_at: Date | null
  }

  export type RelationshipLedgerEventMaxAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    target_user_id: bigint | null
    session_key: string | null
    event_type: string | null
    event_weight: number | null
    confidence: string | null
    source_excerpt: string | null
    created_at: Date | null
    last_reinforced_at: Date | null
  }

  export type RelationshipLedgerEventCountAggregateOutputType = {
    id: number
    group_id: number
    target_user_id: number
    session_key: number
    event_type: number
    event_weight: number
    confidence: number
    source_message_ids: number
    source_excerpt: number
    metadata: number
    created_at: number
    last_reinforced_at: number
    _all: number
  }


  export type RelationshipLedgerEventAvgAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    event_weight?: true
  }

  export type RelationshipLedgerEventSumAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    event_weight?: true
  }

  export type RelationshipLedgerEventMinAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    session_key?: true
    event_type?: true
    event_weight?: true
    confidence?: true
    source_excerpt?: true
    created_at?: true
    last_reinforced_at?: true
  }

  export type RelationshipLedgerEventMaxAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    session_key?: true
    event_type?: true
    event_weight?: true
    confidence?: true
    source_excerpt?: true
    created_at?: true
    last_reinforced_at?: true
  }

  export type RelationshipLedgerEventCountAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    session_key?: true
    event_type?: true
    event_weight?: true
    confidence?: true
    source_message_ids?: true
    source_excerpt?: true
    metadata?: true
    created_at?: true
    last_reinforced_at?: true
    _all?: true
  }

  export type RelationshipLedgerEventAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipLedgerEvent to aggregate.
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipLedgerEvents to fetch.
     */
    orderBy?: RelationshipLedgerEventOrderByWithRelationInput | RelationshipLedgerEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RelationshipLedgerEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipLedgerEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipLedgerEvents.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned RelationshipLedgerEvents
    **/
    _count?: true | RelationshipLedgerEventCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: RelationshipLedgerEventAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: RelationshipLedgerEventSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RelationshipLedgerEventMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RelationshipLedgerEventMaxAggregateInputType
  }

  export type GetRelationshipLedgerEventAggregateType<T extends RelationshipLedgerEventAggregateArgs> = {
        [P in keyof T & keyof AggregateRelationshipLedgerEvent]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRelationshipLedgerEvent[P]>
      : GetScalarType<T[P], AggregateRelationshipLedgerEvent[P]>
  }




  export type RelationshipLedgerEventGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RelationshipLedgerEventWhereInput
    orderBy?: RelationshipLedgerEventOrderByWithAggregationInput | RelationshipLedgerEventOrderByWithAggregationInput[]
    by: RelationshipLedgerEventScalarFieldEnum[] | RelationshipLedgerEventScalarFieldEnum
    having?: RelationshipLedgerEventScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RelationshipLedgerEventCountAggregateInputType | true
    _avg?: RelationshipLedgerEventAvgAggregateInputType
    _sum?: RelationshipLedgerEventSumAggregateInputType
    _min?: RelationshipLedgerEventMinAggregateInputType
    _max?: RelationshipLedgerEventMaxAggregateInputType
  }

  export type RelationshipLedgerEventGroupByOutputType = {
    id: bigint
    group_id: bigint | null
    target_user_id: bigint | null
    session_key: string
    event_type: string
    event_weight: number
    confidence: string
    source_message_ids: JsonValue
    source_excerpt: string | null
    metadata: JsonValue | null
    created_at: Date
    last_reinforced_at: Date | null
    _count: RelationshipLedgerEventCountAggregateOutputType | null
    _avg: RelationshipLedgerEventAvgAggregateOutputType | null
    _sum: RelationshipLedgerEventSumAggregateOutputType | null
    _min: RelationshipLedgerEventMinAggregateOutputType | null
    _max: RelationshipLedgerEventMaxAggregateOutputType | null
  }

  type GetRelationshipLedgerEventGroupByPayload<T extends RelationshipLedgerEventGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RelationshipLedgerEventGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RelationshipLedgerEventGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RelationshipLedgerEventGroupByOutputType[P]>
            : GetScalarType<T[P], RelationshipLedgerEventGroupByOutputType[P]>
        }
      >
    >


  export type RelationshipLedgerEventSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    target_user_id?: boolean
    session_key?: boolean
    event_type?: boolean
    event_weight?: boolean
    confidence?: boolean
    source_message_ids?: boolean
    source_excerpt?: boolean
    metadata?: boolean
    created_at?: boolean
    last_reinforced_at?: boolean
  }, ExtArgs["result"]["relationshipLedgerEvent"]>

  export type RelationshipLedgerEventSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    target_user_id?: boolean
    session_key?: boolean
    event_type?: boolean
    event_weight?: boolean
    confidence?: boolean
    source_message_ids?: boolean
    source_excerpt?: boolean
    metadata?: boolean
    created_at?: boolean
    last_reinforced_at?: boolean
  }, ExtArgs["result"]["relationshipLedgerEvent"]>

  export type RelationshipLedgerEventSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    target_user_id?: boolean
    session_key?: boolean
    event_type?: boolean
    event_weight?: boolean
    confidence?: boolean
    source_message_ids?: boolean
    source_excerpt?: boolean
    metadata?: boolean
    created_at?: boolean
    last_reinforced_at?: boolean
  }, ExtArgs["result"]["relationshipLedgerEvent"]>

  export type RelationshipLedgerEventSelectScalar = {
    id?: boolean
    group_id?: boolean
    target_user_id?: boolean
    session_key?: boolean
    event_type?: boolean
    event_weight?: boolean
    confidence?: boolean
    source_message_ids?: boolean
    source_excerpt?: boolean
    metadata?: boolean
    created_at?: boolean
    last_reinforced_at?: boolean
  }

  export type RelationshipLedgerEventOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "group_id" | "target_user_id" | "session_key" | "event_type" | "event_weight" | "confidence" | "source_message_ids" | "source_excerpt" | "metadata" | "created_at" | "last_reinforced_at", ExtArgs["result"]["relationshipLedgerEvent"]>

  export type $RelationshipLedgerEventPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "RelationshipLedgerEvent"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      group_id: bigint | null
      target_user_id: bigint | null
      session_key: string
      event_type: string
      event_weight: number
      confidence: string
      source_message_ids: Prisma.JsonValue
      source_excerpt: string | null
      metadata: Prisma.JsonValue | null
      created_at: Date
      last_reinforced_at: Date | null
    }, ExtArgs["result"]["relationshipLedgerEvent"]>
    composites: {}
  }

  type RelationshipLedgerEventGetPayload<S extends boolean | null | undefined | RelationshipLedgerEventDefaultArgs> = $Result.GetResult<Prisma.$RelationshipLedgerEventPayload, S>

  type RelationshipLedgerEventCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<RelationshipLedgerEventFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: RelationshipLedgerEventCountAggregateInputType | true
    }

  export interface RelationshipLedgerEventDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['RelationshipLedgerEvent'], meta: { name: 'RelationshipLedgerEvent' } }
    /**
     * Find zero or one RelationshipLedgerEvent that matches the filter.
     * @param {RelationshipLedgerEventFindUniqueArgs} args - Arguments to find a RelationshipLedgerEvent
     * @example
     * // Get one RelationshipLedgerEvent
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RelationshipLedgerEventFindUniqueArgs>(args: SelectSubset<T, RelationshipLedgerEventFindUniqueArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one RelationshipLedgerEvent that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {RelationshipLedgerEventFindUniqueOrThrowArgs} args - Arguments to find a RelationshipLedgerEvent
     * @example
     * // Get one RelationshipLedgerEvent
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RelationshipLedgerEventFindUniqueOrThrowArgs>(args: SelectSubset<T, RelationshipLedgerEventFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipLedgerEvent that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventFindFirstArgs} args - Arguments to find a RelationshipLedgerEvent
     * @example
     * // Get one RelationshipLedgerEvent
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RelationshipLedgerEventFindFirstArgs>(args?: SelectSubset<T, RelationshipLedgerEventFindFirstArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipLedgerEvent that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventFindFirstOrThrowArgs} args - Arguments to find a RelationshipLedgerEvent
     * @example
     * // Get one RelationshipLedgerEvent
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RelationshipLedgerEventFindFirstOrThrowArgs>(args?: SelectSubset<T, RelationshipLedgerEventFindFirstOrThrowArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more RelationshipLedgerEvents that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all RelationshipLedgerEvents
     * const relationshipLedgerEvents = await prisma.relationshipLedgerEvent.findMany()
     * 
     * // Get first 10 RelationshipLedgerEvents
     * const relationshipLedgerEvents = await prisma.relationshipLedgerEvent.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const relationshipLedgerEventWithIdOnly = await prisma.relationshipLedgerEvent.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RelationshipLedgerEventFindManyArgs>(args?: SelectSubset<T, RelationshipLedgerEventFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a RelationshipLedgerEvent.
     * @param {RelationshipLedgerEventCreateArgs} args - Arguments to create a RelationshipLedgerEvent.
     * @example
     * // Create one RelationshipLedgerEvent
     * const RelationshipLedgerEvent = await prisma.relationshipLedgerEvent.create({
     *   data: {
     *     // ... data to create a RelationshipLedgerEvent
     *   }
     * })
     * 
     */
    create<T extends RelationshipLedgerEventCreateArgs>(args: SelectSubset<T, RelationshipLedgerEventCreateArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many RelationshipLedgerEvents.
     * @param {RelationshipLedgerEventCreateManyArgs} args - Arguments to create many RelationshipLedgerEvents.
     * @example
     * // Create many RelationshipLedgerEvents
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RelationshipLedgerEventCreateManyArgs>(args?: SelectSubset<T, RelationshipLedgerEventCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many RelationshipLedgerEvents and returns the data saved in the database.
     * @param {RelationshipLedgerEventCreateManyAndReturnArgs} args - Arguments to create many RelationshipLedgerEvents.
     * @example
     * // Create many RelationshipLedgerEvents
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many RelationshipLedgerEvents and only return the `id`
     * const relationshipLedgerEventWithIdOnly = await prisma.relationshipLedgerEvent.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RelationshipLedgerEventCreateManyAndReturnArgs>(args?: SelectSubset<T, RelationshipLedgerEventCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a RelationshipLedgerEvent.
     * @param {RelationshipLedgerEventDeleteArgs} args - Arguments to delete one RelationshipLedgerEvent.
     * @example
     * // Delete one RelationshipLedgerEvent
     * const RelationshipLedgerEvent = await prisma.relationshipLedgerEvent.delete({
     *   where: {
     *     // ... filter to delete one RelationshipLedgerEvent
     *   }
     * })
     * 
     */
    delete<T extends RelationshipLedgerEventDeleteArgs>(args: SelectSubset<T, RelationshipLedgerEventDeleteArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one RelationshipLedgerEvent.
     * @param {RelationshipLedgerEventUpdateArgs} args - Arguments to update one RelationshipLedgerEvent.
     * @example
     * // Update one RelationshipLedgerEvent
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RelationshipLedgerEventUpdateArgs>(args: SelectSubset<T, RelationshipLedgerEventUpdateArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more RelationshipLedgerEvents.
     * @param {RelationshipLedgerEventDeleteManyArgs} args - Arguments to filter RelationshipLedgerEvents to delete.
     * @example
     * // Delete a few RelationshipLedgerEvents
     * const { count } = await prisma.relationshipLedgerEvent.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RelationshipLedgerEventDeleteManyArgs>(args?: SelectSubset<T, RelationshipLedgerEventDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipLedgerEvents.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many RelationshipLedgerEvents
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RelationshipLedgerEventUpdateManyArgs>(args: SelectSubset<T, RelationshipLedgerEventUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipLedgerEvents and returns the data updated in the database.
     * @param {RelationshipLedgerEventUpdateManyAndReturnArgs} args - Arguments to update many RelationshipLedgerEvents.
     * @example
     * // Update many RelationshipLedgerEvents
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more RelationshipLedgerEvents and only return the `id`
     * const relationshipLedgerEventWithIdOnly = await prisma.relationshipLedgerEvent.updateManyAndReturn({
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
    updateManyAndReturn<T extends RelationshipLedgerEventUpdateManyAndReturnArgs>(args: SelectSubset<T, RelationshipLedgerEventUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one RelationshipLedgerEvent.
     * @param {RelationshipLedgerEventUpsertArgs} args - Arguments to update or create a RelationshipLedgerEvent.
     * @example
     * // Update or create a RelationshipLedgerEvent
     * const relationshipLedgerEvent = await prisma.relationshipLedgerEvent.upsert({
     *   create: {
     *     // ... data to create a RelationshipLedgerEvent
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the RelationshipLedgerEvent we want to update
     *   }
     * })
     */
    upsert<T extends RelationshipLedgerEventUpsertArgs>(args: SelectSubset<T, RelationshipLedgerEventUpsertArgs<ExtArgs>>): Prisma__RelationshipLedgerEventClient<$Result.GetResult<Prisma.$RelationshipLedgerEventPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of RelationshipLedgerEvents.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventCountArgs} args - Arguments to filter RelationshipLedgerEvents to count.
     * @example
     * // Count the number of RelationshipLedgerEvents
     * const count = await prisma.relationshipLedgerEvent.count({
     *   where: {
     *     // ... the filter for the RelationshipLedgerEvents we want to count
     *   }
     * })
    **/
    count<T extends RelationshipLedgerEventCountArgs>(
      args?: Subset<T, RelationshipLedgerEventCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RelationshipLedgerEventCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a RelationshipLedgerEvent.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends RelationshipLedgerEventAggregateArgs>(args: Subset<T, RelationshipLedgerEventAggregateArgs>): Prisma.PrismaPromise<GetRelationshipLedgerEventAggregateType<T>>

    /**
     * Group by RelationshipLedgerEvent.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipLedgerEventGroupByArgs} args - Group by arguments.
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
      T extends RelationshipLedgerEventGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RelationshipLedgerEventGroupByArgs['orderBy'] }
        : { orderBy?: RelationshipLedgerEventGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, RelationshipLedgerEventGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRelationshipLedgerEventGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the RelationshipLedgerEvent model
   */
  readonly fields: RelationshipLedgerEventFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for RelationshipLedgerEvent.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RelationshipLedgerEventClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the RelationshipLedgerEvent model
   */
  interface RelationshipLedgerEventFieldRefs {
    readonly id: FieldRef<"RelationshipLedgerEvent", 'BigInt'>
    readonly group_id: FieldRef<"RelationshipLedgerEvent", 'BigInt'>
    readonly target_user_id: FieldRef<"RelationshipLedgerEvent", 'BigInt'>
    readonly session_key: FieldRef<"RelationshipLedgerEvent", 'String'>
    readonly event_type: FieldRef<"RelationshipLedgerEvent", 'String'>
    readonly event_weight: FieldRef<"RelationshipLedgerEvent", 'Float'>
    readonly confidence: FieldRef<"RelationshipLedgerEvent", 'String'>
    readonly source_message_ids: FieldRef<"RelationshipLedgerEvent", 'Json'>
    readonly source_excerpt: FieldRef<"RelationshipLedgerEvent", 'String'>
    readonly metadata: FieldRef<"RelationshipLedgerEvent", 'Json'>
    readonly created_at: FieldRef<"RelationshipLedgerEvent", 'DateTime'>
    readonly last_reinforced_at: FieldRef<"RelationshipLedgerEvent", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * RelationshipLedgerEvent findUnique
   */
  export type RelationshipLedgerEventFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipLedgerEvent to fetch.
     */
    where: RelationshipLedgerEventWhereUniqueInput
  }

  /**
   * RelationshipLedgerEvent findUniqueOrThrow
   */
  export type RelationshipLedgerEventFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipLedgerEvent to fetch.
     */
    where: RelationshipLedgerEventWhereUniqueInput
  }

  /**
   * RelationshipLedgerEvent findFirst
   */
  export type RelationshipLedgerEventFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipLedgerEvent to fetch.
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipLedgerEvents to fetch.
     */
    orderBy?: RelationshipLedgerEventOrderByWithRelationInput | RelationshipLedgerEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipLedgerEvents.
     */
    cursor?: RelationshipLedgerEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipLedgerEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipLedgerEvents.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipLedgerEvents.
     */
    distinct?: RelationshipLedgerEventScalarFieldEnum | RelationshipLedgerEventScalarFieldEnum[]
  }

  /**
   * RelationshipLedgerEvent findFirstOrThrow
   */
  export type RelationshipLedgerEventFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipLedgerEvent to fetch.
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipLedgerEvents to fetch.
     */
    orderBy?: RelationshipLedgerEventOrderByWithRelationInput | RelationshipLedgerEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipLedgerEvents.
     */
    cursor?: RelationshipLedgerEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipLedgerEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipLedgerEvents.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipLedgerEvents.
     */
    distinct?: RelationshipLedgerEventScalarFieldEnum | RelationshipLedgerEventScalarFieldEnum[]
  }

  /**
   * RelationshipLedgerEvent findMany
   */
  export type RelationshipLedgerEventFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipLedgerEvents to fetch.
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipLedgerEvents to fetch.
     */
    orderBy?: RelationshipLedgerEventOrderByWithRelationInput | RelationshipLedgerEventOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing RelationshipLedgerEvents.
     */
    cursor?: RelationshipLedgerEventWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipLedgerEvents from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipLedgerEvents.
     */
    skip?: number
    distinct?: RelationshipLedgerEventScalarFieldEnum | RelationshipLedgerEventScalarFieldEnum[]
  }

  /**
   * RelationshipLedgerEvent create
   */
  export type RelationshipLedgerEventCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * The data needed to create a RelationshipLedgerEvent.
     */
    data: XOR<RelationshipLedgerEventCreateInput, RelationshipLedgerEventUncheckedCreateInput>
  }

  /**
   * RelationshipLedgerEvent createMany
   */
  export type RelationshipLedgerEventCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many RelationshipLedgerEvents.
     */
    data: RelationshipLedgerEventCreateManyInput | RelationshipLedgerEventCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipLedgerEvent createManyAndReturn
   */
  export type RelationshipLedgerEventCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * The data used to create many RelationshipLedgerEvents.
     */
    data: RelationshipLedgerEventCreateManyInput | RelationshipLedgerEventCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipLedgerEvent update
   */
  export type RelationshipLedgerEventUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * The data needed to update a RelationshipLedgerEvent.
     */
    data: XOR<RelationshipLedgerEventUpdateInput, RelationshipLedgerEventUncheckedUpdateInput>
    /**
     * Choose, which RelationshipLedgerEvent to update.
     */
    where: RelationshipLedgerEventWhereUniqueInput
  }

  /**
   * RelationshipLedgerEvent updateMany
   */
  export type RelationshipLedgerEventUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update RelationshipLedgerEvents.
     */
    data: XOR<RelationshipLedgerEventUpdateManyMutationInput, RelationshipLedgerEventUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipLedgerEvents to update
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * Limit how many RelationshipLedgerEvents to update.
     */
    limit?: number
  }

  /**
   * RelationshipLedgerEvent updateManyAndReturn
   */
  export type RelationshipLedgerEventUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * The data used to update RelationshipLedgerEvents.
     */
    data: XOR<RelationshipLedgerEventUpdateManyMutationInput, RelationshipLedgerEventUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipLedgerEvents to update
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * Limit how many RelationshipLedgerEvents to update.
     */
    limit?: number
  }

  /**
   * RelationshipLedgerEvent upsert
   */
  export type RelationshipLedgerEventUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * The filter to search for the RelationshipLedgerEvent to update in case it exists.
     */
    where: RelationshipLedgerEventWhereUniqueInput
    /**
     * In case the RelationshipLedgerEvent found by the `where` argument doesn't exist, create a new RelationshipLedgerEvent with this data.
     */
    create: XOR<RelationshipLedgerEventCreateInput, RelationshipLedgerEventUncheckedCreateInput>
    /**
     * In case the RelationshipLedgerEvent was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RelationshipLedgerEventUpdateInput, RelationshipLedgerEventUncheckedUpdateInput>
  }

  /**
   * RelationshipLedgerEvent delete
   */
  export type RelationshipLedgerEventDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
    /**
     * Filter which RelationshipLedgerEvent to delete.
     */
    where: RelationshipLedgerEventWhereUniqueInput
  }

  /**
   * RelationshipLedgerEvent deleteMany
   */
  export type RelationshipLedgerEventDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipLedgerEvents to delete
     */
    where?: RelationshipLedgerEventWhereInput
    /**
     * Limit how many RelationshipLedgerEvents to delete.
     */
    limit?: number
  }

  /**
   * RelationshipLedgerEvent without action
   */
  export type RelationshipLedgerEventDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipLedgerEvent
     */
    select?: RelationshipLedgerEventSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipLedgerEvent
     */
    omit?: RelationshipLedgerEventOmit<ExtArgs> | null
  }


  /**
   * Model RelationshipMemoryJob
   */

  export type AggregateRelationshipMemoryJob = {
    _count: RelationshipMemoryJobCountAggregateOutputType | null
    _avg: RelationshipMemoryJobAvgAggregateOutputType | null
    _sum: RelationshipMemoryJobSumAggregateOutputType | null
    _min: RelationshipMemoryJobMinAggregateOutputType | null
    _max: RelationshipMemoryJobMaxAggregateOutputType | null
  }

  export type RelationshipMemoryJobAvgAggregateOutputType = {
    id: number | null
    group_id: number | null
    turn_range_start: number | null
    turn_range_end: number | null
    ledger_event_count: number | null
    output_card_version: number | null
  }

  export type RelationshipMemoryJobSumAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    turn_range_start: bigint | null
    turn_range_end: bigint | null
    ledger_event_count: number | null
    output_card_version: number | null
  }

  export type RelationshipMemoryJobMinAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    session_key: string | null
    status: string | null
    trigger_reason: string | null
    turn_range_start: bigint | null
    turn_range_end: bigint | null
    ledger_event_count: number | null
    output_card_version: number | null
    error_message: string | null
    started_at: Date | null
    finished_at: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type RelationshipMemoryJobMaxAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    session_key: string | null
    status: string | null
    trigger_reason: string | null
    turn_range_start: bigint | null
    turn_range_end: bigint | null
    ledger_event_count: number | null
    output_card_version: number | null
    error_message: string | null
    started_at: Date | null
    finished_at: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type RelationshipMemoryJobCountAggregateOutputType = {
    id: number
    group_id: number
    session_key: number
    status: number
    trigger_reason: number
    turn_range_start: number
    turn_range_end: number
    ledger_event_count: number
    input_message_ids: number
    output_card_version: number
    error_message: number
    metadata: number
    started_at: number
    finished_at: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type RelationshipMemoryJobAvgAggregateInputType = {
    id?: true
    group_id?: true
    turn_range_start?: true
    turn_range_end?: true
    ledger_event_count?: true
    output_card_version?: true
  }

  export type RelationshipMemoryJobSumAggregateInputType = {
    id?: true
    group_id?: true
    turn_range_start?: true
    turn_range_end?: true
    ledger_event_count?: true
    output_card_version?: true
  }

  export type RelationshipMemoryJobMinAggregateInputType = {
    id?: true
    group_id?: true
    session_key?: true
    status?: true
    trigger_reason?: true
    turn_range_start?: true
    turn_range_end?: true
    ledger_event_count?: true
    output_card_version?: true
    error_message?: true
    started_at?: true
    finished_at?: true
    created_at?: true
    updated_at?: true
  }

  export type RelationshipMemoryJobMaxAggregateInputType = {
    id?: true
    group_id?: true
    session_key?: true
    status?: true
    trigger_reason?: true
    turn_range_start?: true
    turn_range_end?: true
    ledger_event_count?: true
    output_card_version?: true
    error_message?: true
    started_at?: true
    finished_at?: true
    created_at?: true
    updated_at?: true
  }

  export type RelationshipMemoryJobCountAggregateInputType = {
    id?: true
    group_id?: true
    session_key?: true
    status?: true
    trigger_reason?: true
    turn_range_start?: true
    turn_range_end?: true
    ledger_event_count?: true
    input_message_ids?: true
    output_card_version?: true
    error_message?: true
    metadata?: true
    started_at?: true
    finished_at?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type RelationshipMemoryJobAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipMemoryJob to aggregate.
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryJobs to fetch.
     */
    orderBy?: RelationshipMemoryJobOrderByWithRelationInput | RelationshipMemoryJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RelationshipMemoryJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryJobs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned RelationshipMemoryJobs
    **/
    _count?: true | RelationshipMemoryJobCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: RelationshipMemoryJobAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: RelationshipMemoryJobSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RelationshipMemoryJobMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RelationshipMemoryJobMaxAggregateInputType
  }

  export type GetRelationshipMemoryJobAggregateType<T extends RelationshipMemoryJobAggregateArgs> = {
        [P in keyof T & keyof AggregateRelationshipMemoryJob]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRelationshipMemoryJob[P]>
      : GetScalarType<T[P], AggregateRelationshipMemoryJob[P]>
  }




  export type RelationshipMemoryJobGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RelationshipMemoryJobWhereInput
    orderBy?: RelationshipMemoryJobOrderByWithAggregationInput | RelationshipMemoryJobOrderByWithAggregationInput[]
    by: RelationshipMemoryJobScalarFieldEnum[] | RelationshipMemoryJobScalarFieldEnum
    having?: RelationshipMemoryJobScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RelationshipMemoryJobCountAggregateInputType | true
    _avg?: RelationshipMemoryJobAvgAggregateInputType
    _sum?: RelationshipMemoryJobSumAggregateInputType
    _min?: RelationshipMemoryJobMinAggregateInputType
    _max?: RelationshipMemoryJobMaxAggregateInputType
  }

  export type RelationshipMemoryJobGroupByOutputType = {
    id: bigint
    group_id: bigint | null
    session_key: string
    status: string
    trigger_reason: string
    turn_range_start: bigint | null
    turn_range_end: bigint | null
    ledger_event_count: number
    input_message_ids: JsonValue
    output_card_version: number | null
    error_message: string | null
    metadata: JsonValue | null
    started_at: Date | null
    finished_at: Date | null
    created_at: Date
    updated_at: Date
    _count: RelationshipMemoryJobCountAggregateOutputType | null
    _avg: RelationshipMemoryJobAvgAggregateOutputType | null
    _sum: RelationshipMemoryJobSumAggregateOutputType | null
    _min: RelationshipMemoryJobMinAggregateOutputType | null
    _max: RelationshipMemoryJobMaxAggregateOutputType | null
  }

  type GetRelationshipMemoryJobGroupByPayload<T extends RelationshipMemoryJobGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RelationshipMemoryJobGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RelationshipMemoryJobGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RelationshipMemoryJobGroupByOutputType[P]>
            : GetScalarType<T[P], RelationshipMemoryJobGroupByOutputType[P]>
        }
      >
    >


  export type RelationshipMemoryJobSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    session_key?: boolean
    status?: boolean
    trigger_reason?: boolean
    turn_range_start?: boolean
    turn_range_end?: boolean
    ledger_event_count?: boolean
    input_message_ids?: boolean
    output_card_version?: boolean
    error_message?: boolean
    metadata?: boolean
    started_at?: boolean
    finished_at?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryJob"]>

  export type RelationshipMemoryJobSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    session_key?: boolean
    status?: boolean
    trigger_reason?: boolean
    turn_range_start?: boolean
    turn_range_end?: boolean
    ledger_event_count?: boolean
    input_message_ids?: boolean
    output_card_version?: boolean
    error_message?: boolean
    metadata?: boolean
    started_at?: boolean
    finished_at?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryJob"]>

  export type RelationshipMemoryJobSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    session_key?: boolean
    status?: boolean
    trigger_reason?: boolean
    turn_range_start?: boolean
    turn_range_end?: boolean
    ledger_event_count?: boolean
    input_message_ids?: boolean
    output_card_version?: boolean
    error_message?: boolean
    metadata?: boolean
    started_at?: boolean
    finished_at?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryJob"]>

  export type RelationshipMemoryJobSelectScalar = {
    id?: boolean
    group_id?: boolean
    session_key?: boolean
    status?: boolean
    trigger_reason?: boolean
    turn_range_start?: boolean
    turn_range_end?: boolean
    ledger_event_count?: boolean
    input_message_ids?: boolean
    output_card_version?: boolean
    error_message?: boolean
    metadata?: boolean
    started_at?: boolean
    finished_at?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type RelationshipMemoryJobOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "group_id" | "session_key" | "status" | "trigger_reason" | "turn_range_start" | "turn_range_end" | "ledger_event_count" | "input_message_ids" | "output_card_version" | "error_message" | "metadata" | "started_at" | "finished_at" | "created_at" | "updated_at", ExtArgs["result"]["relationshipMemoryJob"]>

  export type $RelationshipMemoryJobPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "RelationshipMemoryJob"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      group_id: bigint | null
      session_key: string
      status: string
      trigger_reason: string
      turn_range_start: bigint | null
      turn_range_end: bigint | null
      ledger_event_count: number
      input_message_ids: Prisma.JsonValue
      output_card_version: number | null
      error_message: string | null
      metadata: Prisma.JsonValue | null
      started_at: Date | null
      finished_at: Date | null
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["relationshipMemoryJob"]>
    composites: {}
  }

  type RelationshipMemoryJobGetPayload<S extends boolean | null | undefined | RelationshipMemoryJobDefaultArgs> = $Result.GetResult<Prisma.$RelationshipMemoryJobPayload, S>

  type RelationshipMemoryJobCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<RelationshipMemoryJobFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: RelationshipMemoryJobCountAggregateInputType | true
    }

  export interface RelationshipMemoryJobDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['RelationshipMemoryJob'], meta: { name: 'RelationshipMemoryJob' } }
    /**
     * Find zero or one RelationshipMemoryJob that matches the filter.
     * @param {RelationshipMemoryJobFindUniqueArgs} args - Arguments to find a RelationshipMemoryJob
     * @example
     * // Get one RelationshipMemoryJob
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RelationshipMemoryJobFindUniqueArgs>(args: SelectSubset<T, RelationshipMemoryJobFindUniqueArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one RelationshipMemoryJob that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {RelationshipMemoryJobFindUniqueOrThrowArgs} args - Arguments to find a RelationshipMemoryJob
     * @example
     * // Get one RelationshipMemoryJob
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RelationshipMemoryJobFindUniqueOrThrowArgs>(args: SelectSubset<T, RelationshipMemoryJobFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipMemoryJob that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobFindFirstArgs} args - Arguments to find a RelationshipMemoryJob
     * @example
     * // Get one RelationshipMemoryJob
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RelationshipMemoryJobFindFirstArgs>(args?: SelectSubset<T, RelationshipMemoryJobFindFirstArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipMemoryJob that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobFindFirstOrThrowArgs} args - Arguments to find a RelationshipMemoryJob
     * @example
     * // Get one RelationshipMemoryJob
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RelationshipMemoryJobFindFirstOrThrowArgs>(args?: SelectSubset<T, RelationshipMemoryJobFindFirstOrThrowArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more RelationshipMemoryJobs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all RelationshipMemoryJobs
     * const relationshipMemoryJobs = await prisma.relationshipMemoryJob.findMany()
     * 
     * // Get first 10 RelationshipMemoryJobs
     * const relationshipMemoryJobs = await prisma.relationshipMemoryJob.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const relationshipMemoryJobWithIdOnly = await prisma.relationshipMemoryJob.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RelationshipMemoryJobFindManyArgs>(args?: SelectSubset<T, RelationshipMemoryJobFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a RelationshipMemoryJob.
     * @param {RelationshipMemoryJobCreateArgs} args - Arguments to create a RelationshipMemoryJob.
     * @example
     * // Create one RelationshipMemoryJob
     * const RelationshipMemoryJob = await prisma.relationshipMemoryJob.create({
     *   data: {
     *     // ... data to create a RelationshipMemoryJob
     *   }
     * })
     * 
     */
    create<T extends RelationshipMemoryJobCreateArgs>(args: SelectSubset<T, RelationshipMemoryJobCreateArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many RelationshipMemoryJobs.
     * @param {RelationshipMemoryJobCreateManyArgs} args - Arguments to create many RelationshipMemoryJobs.
     * @example
     * // Create many RelationshipMemoryJobs
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RelationshipMemoryJobCreateManyArgs>(args?: SelectSubset<T, RelationshipMemoryJobCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many RelationshipMemoryJobs and returns the data saved in the database.
     * @param {RelationshipMemoryJobCreateManyAndReturnArgs} args - Arguments to create many RelationshipMemoryJobs.
     * @example
     * // Create many RelationshipMemoryJobs
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many RelationshipMemoryJobs and only return the `id`
     * const relationshipMemoryJobWithIdOnly = await prisma.relationshipMemoryJob.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RelationshipMemoryJobCreateManyAndReturnArgs>(args?: SelectSubset<T, RelationshipMemoryJobCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a RelationshipMemoryJob.
     * @param {RelationshipMemoryJobDeleteArgs} args - Arguments to delete one RelationshipMemoryJob.
     * @example
     * // Delete one RelationshipMemoryJob
     * const RelationshipMemoryJob = await prisma.relationshipMemoryJob.delete({
     *   where: {
     *     // ... filter to delete one RelationshipMemoryJob
     *   }
     * })
     * 
     */
    delete<T extends RelationshipMemoryJobDeleteArgs>(args: SelectSubset<T, RelationshipMemoryJobDeleteArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one RelationshipMemoryJob.
     * @param {RelationshipMemoryJobUpdateArgs} args - Arguments to update one RelationshipMemoryJob.
     * @example
     * // Update one RelationshipMemoryJob
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RelationshipMemoryJobUpdateArgs>(args: SelectSubset<T, RelationshipMemoryJobUpdateArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more RelationshipMemoryJobs.
     * @param {RelationshipMemoryJobDeleteManyArgs} args - Arguments to filter RelationshipMemoryJobs to delete.
     * @example
     * // Delete a few RelationshipMemoryJobs
     * const { count } = await prisma.relationshipMemoryJob.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RelationshipMemoryJobDeleteManyArgs>(args?: SelectSubset<T, RelationshipMemoryJobDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipMemoryJobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many RelationshipMemoryJobs
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RelationshipMemoryJobUpdateManyArgs>(args: SelectSubset<T, RelationshipMemoryJobUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipMemoryJobs and returns the data updated in the database.
     * @param {RelationshipMemoryJobUpdateManyAndReturnArgs} args - Arguments to update many RelationshipMemoryJobs.
     * @example
     * // Update many RelationshipMemoryJobs
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more RelationshipMemoryJobs and only return the `id`
     * const relationshipMemoryJobWithIdOnly = await prisma.relationshipMemoryJob.updateManyAndReturn({
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
    updateManyAndReturn<T extends RelationshipMemoryJobUpdateManyAndReturnArgs>(args: SelectSubset<T, RelationshipMemoryJobUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one RelationshipMemoryJob.
     * @param {RelationshipMemoryJobUpsertArgs} args - Arguments to update or create a RelationshipMemoryJob.
     * @example
     * // Update or create a RelationshipMemoryJob
     * const relationshipMemoryJob = await prisma.relationshipMemoryJob.upsert({
     *   create: {
     *     // ... data to create a RelationshipMemoryJob
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the RelationshipMemoryJob we want to update
     *   }
     * })
     */
    upsert<T extends RelationshipMemoryJobUpsertArgs>(args: SelectSubset<T, RelationshipMemoryJobUpsertArgs<ExtArgs>>): Prisma__RelationshipMemoryJobClient<$Result.GetResult<Prisma.$RelationshipMemoryJobPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of RelationshipMemoryJobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobCountArgs} args - Arguments to filter RelationshipMemoryJobs to count.
     * @example
     * // Count the number of RelationshipMemoryJobs
     * const count = await prisma.relationshipMemoryJob.count({
     *   where: {
     *     // ... the filter for the RelationshipMemoryJobs we want to count
     *   }
     * })
    **/
    count<T extends RelationshipMemoryJobCountArgs>(
      args?: Subset<T, RelationshipMemoryJobCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RelationshipMemoryJobCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a RelationshipMemoryJob.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends RelationshipMemoryJobAggregateArgs>(args: Subset<T, RelationshipMemoryJobAggregateArgs>): Prisma.PrismaPromise<GetRelationshipMemoryJobAggregateType<T>>

    /**
     * Group by RelationshipMemoryJob.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryJobGroupByArgs} args - Group by arguments.
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
      T extends RelationshipMemoryJobGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RelationshipMemoryJobGroupByArgs['orderBy'] }
        : { orderBy?: RelationshipMemoryJobGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, RelationshipMemoryJobGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRelationshipMemoryJobGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the RelationshipMemoryJob model
   */
  readonly fields: RelationshipMemoryJobFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for RelationshipMemoryJob.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RelationshipMemoryJobClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the RelationshipMemoryJob model
   */
  interface RelationshipMemoryJobFieldRefs {
    readonly id: FieldRef<"RelationshipMemoryJob", 'BigInt'>
    readonly group_id: FieldRef<"RelationshipMemoryJob", 'BigInt'>
    readonly session_key: FieldRef<"RelationshipMemoryJob", 'String'>
    readonly status: FieldRef<"RelationshipMemoryJob", 'String'>
    readonly trigger_reason: FieldRef<"RelationshipMemoryJob", 'String'>
    readonly turn_range_start: FieldRef<"RelationshipMemoryJob", 'BigInt'>
    readonly turn_range_end: FieldRef<"RelationshipMemoryJob", 'BigInt'>
    readonly ledger_event_count: FieldRef<"RelationshipMemoryJob", 'Int'>
    readonly input_message_ids: FieldRef<"RelationshipMemoryJob", 'Json'>
    readonly output_card_version: FieldRef<"RelationshipMemoryJob", 'Int'>
    readonly error_message: FieldRef<"RelationshipMemoryJob", 'String'>
    readonly metadata: FieldRef<"RelationshipMemoryJob", 'Json'>
    readonly started_at: FieldRef<"RelationshipMemoryJob", 'DateTime'>
    readonly finished_at: FieldRef<"RelationshipMemoryJob", 'DateTime'>
    readonly created_at: FieldRef<"RelationshipMemoryJob", 'DateTime'>
    readonly updated_at: FieldRef<"RelationshipMemoryJob", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * RelationshipMemoryJob findUnique
   */
  export type RelationshipMemoryJobFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryJob to fetch.
     */
    where: RelationshipMemoryJobWhereUniqueInput
  }

  /**
   * RelationshipMemoryJob findUniqueOrThrow
   */
  export type RelationshipMemoryJobFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryJob to fetch.
     */
    where: RelationshipMemoryJobWhereUniqueInput
  }

  /**
   * RelationshipMemoryJob findFirst
   */
  export type RelationshipMemoryJobFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryJob to fetch.
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryJobs to fetch.
     */
    orderBy?: RelationshipMemoryJobOrderByWithRelationInput | RelationshipMemoryJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipMemoryJobs.
     */
    cursor?: RelationshipMemoryJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryJobs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipMemoryJobs.
     */
    distinct?: RelationshipMemoryJobScalarFieldEnum | RelationshipMemoryJobScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryJob findFirstOrThrow
   */
  export type RelationshipMemoryJobFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryJob to fetch.
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryJobs to fetch.
     */
    orderBy?: RelationshipMemoryJobOrderByWithRelationInput | RelationshipMemoryJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipMemoryJobs.
     */
    cursor?: RelationshipMemoryJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryJobs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipMemoryJobs.
     */
    distinct?: RelationshipMemoryJobScalarFieldEnum | RelationshipMemoryJobScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryJob findMany
   */
  export type RelationshipMemoryJobFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryJobs to fetch.
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryJobs to fetch.
     */
    orderBy?: RelationshipMemoryJobOrderByWithRelationInput | RelationshipMemoryJobOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing RelationshipMemoryJobs.
     */
    cursor?: RelationshipMemoryJobWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryJobs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryJobs.
     */
    skip?: number
    distinct?: RelationshipMemoryJobScalarFieldEnum | RelationshipMemoryJobScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryJob create
   */
  export type RelationshipMemoryJobCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * The data needed to create a RelationshipMemoryJob.
     */
    data: XOR<RelationshipMemoryJobCreateInput, RelationshipMemoryJobUncheckedCreateInput>
  }

  /**
   * RelationshipMemoryJob createMany
   */
  export type RelationshipMemoryJobCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many RelationshipMemoryJobs.
     */
    data: RelationshipMemoryJobCreateManyInput | RelationshipMemoryJobCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipMemoryJob createManyAndReturn
   */
  export type RelationshipMemoryJobCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * The data used to create many RelationshipMemoryJobs.
     */
    data: RelationshipMemoryJobCreateManyInput | RelationshipMemoryJobCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipMemoryJob update
   */
  export type RelationshipMemoryJobUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * The data needed to update a RelationshipMemoryJob.
     */
    data: XOR<RelationshipMemoryJobUpdateInput, RelationshipMemoryJobUncheckedUpdateInput>
    /**
     * Choose, which RelationshipMemoryJob to update.
     */
    where: RelationshipMemoryJobWhereUniqueInput
  }

  /**
   * RelationshipMemoryJob updateMany
   */
  export type RelationshipMemoryJobUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update RelationshipMemoryJobs.
     */
    data: XOR<RelationshipMemoryJobUpdateManyMutationInput, RelationshipMemoryJobUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipMemoryJobs to update
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * Limit how many RelationshipMemoryJobs to update.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryJob updateManyAndReturn
   */
  export type RelationshipMemoryJobUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * The data used to update RelationshipMemoryJobs.
     */
    data: XOR<RelationshipMemoryJobUpdateManyMutationInput, RelationshipMemoryJobUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipMemoryJobs to update
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * Limit how many RelationshipMemoryJobs to update.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryJob upsert
   */
  export type RelationshipMemoryJobUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * The filter to search for the RelationshipMemoryJob to update in case it exists.
     */
    where: RelationshipMemoryJobWhereUniqueInput
    /**
     * In case the RelationshipMemoryJob found by the `where` argument doesn't exist, create a new RelationshipMemoryJob with this data.
     */
    create: XOR<RelationshipMemoryJobCreateInput, RelationshipMemoryJobUncheckedCreateInput>
    /**
     * In case the RelationshipMemoryJob was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RelationshipMemoryJobUpdateInput, RelationshipMemoryJobUncheckedUpdateInput>
  }

  /**
   * RelationshipMemoryJob delete
   */
  export type RelationshipMemoryJobDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
    /**
     * Filter which RelationshipMemoryJob to delete.
     */
    where: RelationshipMemoryJobWhereUniqueInput
  }

  /**
   * RelationshipMemoryJob deleteMany
   */
  export type RelationshipMemoryJobDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipMemoryJobs to delete
     */
    where?: RelationshipMemoryJobWhereInput
    /**
     * Limit how many RelationshipMemoryJobs to delete.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryJob without action
   */
  export type RelationshipMemoryJobDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryJob
     */
    select?: RelationshipMemoryJobSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryJob
     */
    omit?: RelationshipMemoryJobOmit<ExtArgs> | null
  }


  /**
   * Model RelationshipMemoryCard
   */

  export type AggregateRelationshipMemoryCard = {
    _count: RelationshipMemoryCardCountAggregateOutputType | null
    _avg: RelationshipMemoryCardAvgAggregateOutputType | null
    _sum: RelationshipMemoryCardSumAggregateOutputType | null
    _min: RelationshipMemoryCardMinAggregateOutputType | null
    _max: RelationshipMemoryCardMaxAggregateOutputType | null
  }

  export type RelationshipMemoryCardAvgAggregateOutputType = {
    id: number | null
    group_id: number | null
    target_user_id: number | null
    version: number | null
    importance_score: number | null
    freshness_score: number | null
    decayed_score: number | null
  }

  export type RelationshipMemoryCardSumAggregateOutputType = {
    id: bigint | null
    group_id: bigint | null
    target_user_id: bigint | null
    version: number | null
    importance_score: number | null
    freshness_score: number | null
    decayed_score: number | null
  }

  export type RelationshipMemoryCardMinAggregateOutputType = {
    id: bigint | null
    card_type: string | null
    group_id: bigint | null
    target_user_id: bigint | null
    version: number | null
    is_active: boolean | null
    summary_text: string | null
    context_before: string | null
    trigger: string | null
    interaction: string | null
    outcome: string | null
    importance_score: number | null
    freshness_score: number | null
    decayed_score: number | null
    retrieval_text: string | null
    embedding_text: string | null
    last_hit_at: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type RelationshipMemoryCardMaxAggregateOutputType = {
    id: bigint | null
    card_type: string | null
    group_id: bigint | null
    target_user_id: bigint | null
    version: number | null
    is_active: boolean | null
    summary_text: string | null
    context_before: string | null
    trigger: string | null
    interaction: string | null
    outcome: string | null
    importance_score: number | null
    freshness_score: number | null
    decayed_score: number | null
    retrieval_text: string | null
    embedding_text: string | null
    last_hit_at: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type RelationshipMemoryCardCountAggregateOutputType = {
    id: number
    card_type: number
    group_id: number
    target_user_id: number
    version: number
    is_active: number
    summary_text: number
    actors: number
    context_before: number
    trigger: number
    interaction: number
    outcome: number
    source_event_ids: number
    source_message_ids: number
    importance_score: number
    freshness_score: number
    decayed_score: number
    retrieval_text: number
    embedding_text: number
    last_hit_at: number
    metadata: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type RelationshipMemoryCardAvgAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    version?: true
    importance_score?: true
    freshness_score?: true
    decayed_score?: true
  }

  export type RelationshipMemoryCardSumAggregateInputType = {
    id?: true
    group_id?: true
    target_user_id?: true
    version?: true
    importance_score?: true
    freshness_score?: true
    decayed_score?: true
  }

  export type RelationshipMemoryCardMinAggregateInputType = {
    id?: true
    card_type?: true
    group_id?: true
    target_user_id?: true
    version?: true
    is_active?: true
    summary_text?: true
    context_before?: true
    trigger?: true
    interaction?: true
    outcome?: true
    importance_score?: true
    freshness_score?: true
    decayed_score?: true
    retrieval_text?: true
    embedding_text?: true
    last_hit_at?: true
    created_at?: true
    updated_at?: true
  }

  export type RelationshipMemoryCardMaxAggregateInputType = {
    id?: true
    card_type?: true
    group_id?: true
    target_user_id?: true
    version?: true
    is_active?: true
    summary_text?: true
    context_before?: true
    trigger?: true
    interaction?: true
    outcome?: true
    importance_score?: true
    freshness_score?: true
    decayed_score?: true
    retrieval_text?: true
    embedding_text?: true
    last_hit_at?: true
    created_at?: true
    updated_at?: true
  }

  export type RelationshipMemoryCardCountAggregateInputType = {
    id?: true
    card_type?: true
    group_id?: true
    target_user_id?: true
    version?: true
    is_active?: true
    summary_text?: true
    actors?: true
    context_before?: true
    trigger?: true
    interaction?: true
    outcome?: true
    source_event_ids?: true
    source_message_ids?: true
    importance_score?: true
    freshness_score?: true
    decayed_score?: true
    retrieval_text?: true
    embedding_text?: true
    last_hit_at?: true
    metadata?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type RelationshipMemoryCardAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipMemoryCard to aggregate.
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryCards to fetch.
     */
    orderBy?: RelationshipMemoryCardOrderByWithRelationInput | RelationshipMemoryCardOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RelationshipMemoryCardWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryCards from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryCards.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned RelationshipMemoryCards
    **/
    _count?: true | RelationshipMemoryCardCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: RelationshipMemoryCardAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: RelationshipMemoryCardSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RelationshipMemoryCardMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RelationshipMemoryCardMaxAggregateInputType
  }

  export type GetRelationshipMemoryCardAggregateType<T extends RelationshipMemoryCardAggregateArgs> = {
        [P in keyof T & keyof AggregateRelationshipMemoryCard]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRelationshipMemoryCard[P]>
      : GetScalarType<T[P], AggregateRelationshipMemoryCard[P]>
  }




  export type RelationshipMemoryCardGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RelationshipMemoryCardWhereInput
    orderBy?: RelationshipMemoryCardOrderByWithAggregationInput | RelationshipMemoryCardOrderByWithAggregationInput[]
    by: RelationshipMemoryCardScalarFieldEnum[] | RelationshipMemoryCardScalarFieldEnum
    having?: RelationshipMemoryCardScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RelationshipMemoryCardCountAggregateInputType | true
    _avg?: RelationshipMemoryCardAvgAggregateInputType
    _sum?: RelationshipMemoryCardSumAggregateInputType
    _min?: RelationshipMemoryCardMinAggregateInputType
    _max?: RelationshipMemoryCardMaxAggregateInputType
  }

  export type RelationshipMemoryCardGroupByOutputType = {
    id: bigint
    card_type: string
    group_id: bigint | null
    target_user_id: bigint | null
    version: number
    is_active: boolean
    summary_text: string
    actors: JsonValue
    context_before: string | null
    trigger: string | null
    interaction: string | null
    outcome: string | null
    source_event_ids: JsonValue
    source_message_ids: JsonValue
    importance_score: number
    freshness_score: number
    decayed_score: number
    retrieval_text: string | null
    embedding_text: string | null
    last_hit_at: Date | null
    metadata: JsonValue | null
    created_at: Date
    updated_at: Date
    _count: RelationshipMemoryCardCountAggregateOutputType | null
    _avg: RelationshipMemoryCardAvgAggregateOutputType | null
    _sum: RelationshipMemoryCardSumAggregateOutputType | null
    _min: RelationshipMemoryCardMinAggregateOutputType | null
    _max: RelationshipMemoryCardMaxAggregateOutputType | null
  }

  type GetRelationshipMemoryCardGroupByPayload<T extends RelationshipMemoryCardGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RelationshipMemoryCardGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RelationshipMemoryCardGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RelationshipMemoryCardGroupByOutputType[P]>
            : GetScalarType<T[P], RelationshipMemoryCardGroupByOutputType[P]>
        }
      >
    >


  export type RelationshipMemoryCardSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    card_type?: boolean
    group_id?: boolean
    target_user_id?: boolean
    version?: boolean
    is_active?: boolean
    summary_text?: boolean
    actors?: boolean
    context_before?: boolean
    trigger?: boolean
    interaction?: boolean
    outcome?: boolean
    source_event_ids?: boolean
    source_message_ids?: boolean
    importance_score?: boolean
    freshness_score?: boolean
    decayed_score?: boolean
    retrieval_text?: boolean
    embedding_text?: boolean
    last_hit_at?: boolean
    metadata?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryCard"]>

  export type RelationshipMemoryCardSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    card_type?: boolean
    group_id?: boolean
    target_user_id?: boolean
    version?: boolean
    is_active?: boolean
    summary_text?: boolean
    actors?: boolean
    context_before?: boolean
    trigger?: boolean
    interaction?: boolean
    outcome?: boolean
    source_event_ids?: boolean
    source_message_ids?: boolean
    importance_score?: boolean
    freshness_score?: boolean
    decayed_score?: boolean
    retrieval_text?: boolean
    embedding_text?: boolean
    last_hit_at?: boolean
    metadata?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryCard"]>

  export type RelationshipMemoryCardSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    card_type?: boolean
    group_id?: boolean
    target_user_id?: boolean
    version?: boolean
    is_active?: boolean
    summary_text?: boolean
    actors?: boolean
    context_before?: boolean
    trigger?: boolean
    interaction?: boolean
    outcome?: boolean
    source_event_ids?: boolean
    source_message_ids?: boolean
    importance_score?: boolean
    freshness_score?: boolean
    decayed_score?: boolean
    retrieval_text?: boolean
    embedding_text?: boolean
    last_hit_at?: boolean
    metadata?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryCard"]>

  export type RelationshipMemoryCardSelectScalar = {
    id?: boolean
    card_type?: boolean
    group_id?: boolean
    target_user_id?: boolean
    version?: boolean
    is_active?: boolean
    summary_text?: boolean
    actors?: boolean
    context_before?: boolean
    trigger?: boolean
    interaction?: boolean
    outcome?: boolean
    source_event_ids?: boolean
    source_message_ids?: boolean
    importance_score?: boolean
    freshness_score?: boolean
    decayed_score?: boolean
    retrieval_text?: boolean
    embedding_text?: boolean
    last_hit_at?: boolean
    metadata?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type RelationshipMemoryCardOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "card_type" | "group_id" | "target_user_id" | "version" | "is_active" | "summary_text" | "actors" | "context_before" | "trigger" | "interaction" | "outcome" | "source_event_ids" | "source_message_ids" | "importance_score" | "freshness_score" | "decayed_score" | "retrieval_text" | "embedding_text" | "last_hit_at" | "metadata" | "created_at" | "updated_at", ExtArgs["result"]["relationshipMemoryCard"]>

  export type $RelationshipMemoryCardPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "RelationshipMemoryCard"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      card_type: string
      group_id: bigint | null
      target_user_id: bigint | null
      version: number
      is_active: boolean
      summary_text: string
      actors: Prisma.JsonValue
      context_before: string | null
      trigger: string | null
      interaction: string | null
      outcome: string | null
      source_event_ids: Prisma.JsonValue
      source_message_ids: Prisma.JsonValue
      importance_score: number
      freshness_score: number
      decayed_score: number
      retrieval_text: string | null
      embedding_text: string | null
      last_hit_at: Date | null
      metadata: Prisma.JsonValue | null
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["relationshipMemoryCard"]>
    composites: {}
  }

  type RelationshipMemoryCardGetPayload<S extends boolean | null | undefined | RelationshipMemoryCardDefaultArgs> = $Result.GetResult<Prisma.$RelationshipMemoryCardPayload, S>

  type RelationshipMemoryCardCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<RelationshipMemoryCardFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: RelationshipMemoryCardCountAggregateInputType | true
    }

  export interface RelationshipMemoryCardDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['RelationshipMemoryCard'], meta: { name: 'RelationshipMemoryCard' } }
    /**
     * Find zero or one RelationshipMemoryCard that matches the filter.
     * @param {RelationshipMemoryCardFindUniqueArgs} args - Arguments to find a RelationshipMemoryCard
     * @example
     * // Get one RelationshipMemoryCard
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RelationshipMemoryCardFindUniqueArgs>(args: SelectSubset<T, RelationshipMemoryCardFindUniqueArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one RelationshipMemoryCard that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {RelationshipMemoryCardFindUniqueOrThrowArgs} args - Arguments to find a RelationshipMemoryCard
     * @example
     * // Get one RelationshipMemoryCard
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RelationshipMemoryCardFindUniqueOrThrowArgs>(args: SelectSubset<T, RelationshipMemoryCardFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipMemoryCard that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardFindFirstArgs} args - Arguments to find a RelationshipMemoryCard
     * @example
     * // Get one RelationshipMemoryCard
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RelationshipMemoryCardFindFirstArgs>(args?: SelectSubset<T, RelationshipMemoryCardFindFirstArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipMemoryCard that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardFindFirstOrThrowArgs} args - Arguments to find a RelationshipMemoryCard
     * @example
     * // Get one RelationshipMemoryCard
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RelationshipMemoryCardFindFirstOrThrowArgs>(args?: SelectSubset<T, RelationshipMemoryCardFindFirstOrThrowArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more RelationshipMemoryCards that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all RelationshipMemoryCards
     * const relationshipMemoryCards = await prisma.relationshipMemoryCard.findMany()
     * 
     * // Get first 10 RelationshipMemoryCards
     * const relationshipMemoryCards = await prisma.relationshipMemoryCard.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const relationshipMemoryCardWithIdOnly = await prisma.relationshipMemoryCard.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RelationshipMemoryCardFindManyArgs>(args?: SelectSubset<T, RelationshipMemoryCardFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a RelationshipMemoryCard.
     * @param {RelationshipMemoryCardCreateArgs} args - Arguments to create a RelationshipMemoryCard.
     * @example
     * // Create one RelationshipMemoryCard
     * const RelationshipMemoryCard = await prisma.relationshipMemoryCard.create({
     *   data: {
     *     // ... data to create a RelationshipMemoryCard
     *   }
     * })
     * 
     */
    create<T extends RelationshipMemoryCardCreateArgs>(args: SelectSubset<T, RelationshipMemoryCardCreateArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many RelationshipMemoryCards.
     * @param {RelationshipMemoryCardCreateManyArgs} args - Arguments to create many RelationshipMemoryCards.
     * @example
     * // Create many RelationshipMemoryCards
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RelationshipMemoryCardCreateManyArgs>(args?: SelectSubset<T, RelationshipMemoryCardCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many RelationshipMemoryCards and returns the data saved in the database.
     * @param {RelationshipMemoryCardCreateManyAndReturnArgs} args - Arguments to create many RelationshipMemoryCards.
     * @example
     * // Create many RelationshipMemoryCards
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many RelationshipMemoryCards and only return the `id`
     * const relationshipMemoryCardWithIdOnly = await prisma.relationshipMemoryCard.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RelationshipMemoryCardCreateManyAndReturnArgs>(args?: SelectSubset<T, RelationshipMemoryCardCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a RelationshipMemoryCard.
     * @param {RelationshipMemoryCardDeleteArgs} args - Arguments to delete one RelationshipMemoryCard.
     * @example
     * // Delete one RelationshipMemoryCard
     * const RelationshipMemoryCard = await prisma.relationshipMemoryCard.delete({
     *   where: {
     *     // ... filter to delete one RelationshipMemoryCard
     *   }
     * })
     * 
     */
    delete<T extends RelationshipMemoryCardDeleteArgs>(args: SelectSubset<T, RelationshipMemoryCardDeleteArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one RelationshipMemoryCard.
     * @param {RelationshipMemoryCardUpdateArgs} args - Arguments to update one RelationshipMemoryCard.
     * @example
     * // Update one RelationshipMemoryCard
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RelationshipMemoryCardUpdateArgs>(args: SelectSubset<T, RelationshipMemoryCardUpdateArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more RelationshipMemoryCards.
     * @param {RelationshipMemoryCardDeleteManyArgs} args - Arguments to filter RelationshipMemoryCards to delete.
     * @example
     * // Delete a few RelationshipMemoryCards
     * const { count } = await prisma.relationshipMemoryCard.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RelationshipMemoryCardDeleteManyArgs>(args?: SelectSubset<T, RelationshipMemoryCardDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipMemoryCards.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many RelationshipMemoryCards
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RelationshipMemoryCardUpdateManyArgs>(args: SelectSubset<T, RelationshipMemoryCardUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipMemoryCards and returns the data updated in the database.
     * @param {RelationshipMemoryCardUpdateManyAndReturnArgs} args - Arguments to update many RelationshipMemoryCards.
     * @example
     * // Update many RelationshipMemoryCards
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more RelationshipMemoryCards and only return the `id`
     * const relationshipMemoryCardWithIdOnly = await prisma.relationshipMemoryCard.updateManyAndReturn({
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
    updateManyAndReturn<T extends RelationshipMemoryCardUpdateManyAndReturnArgs>(args: SelectSubset<T, RelationshipMemoryCardUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one RelationshipMemoryCard.
     * @param {RelationshipMemoryCardUpsertArgs} args - Arguments to update or create a RelationshipMemoryCard.
     * @example
     * // Update or create a RelationshipMemoryCard
     * const relationshipMemoryCard = await prisma.relationshipMemoryCard.upsert({
     *   create: {
     *     // ... data to create a RelationshipMemoryCard
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the RelationshipMemoryCard we want to update
     *   }
     * })
     */
    upsert<T extends RelationshipMemoryCardUpsertArgs>(args: SelectSubset<T, RelationshipMemoryCardUpsertArgs<ExtArgs>>): Prisma__RelationshipMemoryCardClient<$Result.GetResult<Prisma.$RelationshipMemoryCardPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of RelationshipMemoryCards.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardCountArgs} args - Arguments to filter RelationshipMemoryCards to count.
     * @example
     * // Count the number of RelationshipMemoryCards
     * const count = await prisma.relationshipMemoryCard.count({
     *   where: {
     *     // ... the filter for the RelationshipMemoryCards we want to count
     *   }
     * })
    **/
    count<T extends RelationshipMemoryCardCountArgs>(
      args?: Subset<T, RelationshipMemoryCardCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RelationshipMemoryCardCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a RelationshipMemoryCard.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends RelationshipMemoryCardAggregateArgs>(args: Subset<T, RelationshipMemoryCardAggregateArgs>): Prisma.PrismaPromise<GetRelationshipMemoryCardAggregateType<T>>

    /**
     * Group by RelationshipMemoryCard.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryCardGroupByArgs} args - Group by arguments.
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
      T extends RelationshipMemoryCardGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RelationshipMemoryCardGroupByArgs['orderBy'] }
        : { orderBy?: RelationshipMemoryCardGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, RelationshipMemoryCardGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRelationshipMemoryCardGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the RelationshipMemoryCard model
   */
  readonly fields: RelationshipMemoryCardFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for RelationshipMemoryCard.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RelationshipMemoryCardClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the RelationshipMemoryCard model
   */
  interface RelationshipMemoryCardFieldRefs {
    readonly id: FieldRef<"RelationshipMemoryCard", 'BigInt'>
    readonly card_type: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly group_id: FieldRef<"RelationshipMemoryCard", 'BigInt'>
    readonly target_user_id: FieldRef<"RelationshipMemoryCard", 'BigInt'>
    readonly version: FieldRef<"RelationshipMemoryCard", 'Int'>
    readonly is_active: FieldRef<"RelationshipMemoryCard", 'Boolean'>
    readonly summary_text: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly actors: FieldRef<"RelationshipMemoryCard", 'Json'>
    readonly context_before: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly trigger: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly interaction: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly outcome: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly source_event_ids: FieldRef<"RelationshipMemoryCard", 'Json'>
    readonly source_message_ids: FieldRef<"RelationshipMemoryCard", 'Json'>
    readonly importance_score: FieldRef<"RelationshipMemoryCard", 'Float'>
    readonly freshness_score: FieldRef<"RelationshipMemoryCard", 'Float'>
    readonly decayed_score: FieldRef<"RelationshipMemoryCard", 'Float'>
    readonly retrieval_text: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly embedding_text: FieldRef<"RelationshipMemoryCard", 'String'>
    readonly last_hit_at: FieldRef<"RelationshipMemoryCard", 'DateTime'>
    readonly metadata: FieldRef<"RelationshipMemoryCard", 'Json'>
    readonly created_at: FieldRef<"RelationshipMemoryCard", 'DateTime'>
    readonly updated_at: FieldRef<"RelationshipMemoryCard", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * RelationshipMemoryCard findUnique
   */
  export type RelationshipMemoryCardFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryCard to fetch.
     */
    where: RelationshipMemoryCardWhereUniqueInput
  }

  /**
   * RelationshipMemoryCard findUniqueOrThrow
   */
  export type RelationshipMemoryCardFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryCard to fetch.
     */
    where: RelationshipMemoryCardWhereUniqueInput
  }

  /**
   * RelationshipMemoryCard findFirst
   */
  export type RelationshipMemoryCardFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryCard to fetch.
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryCards to fetch.
     */
    orderBy?: RelationshipMemoryCardOrderByWithRelationInput | RelationshipMemoryCardOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipMemoryCards.
     */
    cursor?: RelationshipMemoryCardWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryCards from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryCards.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipMemoryCards.
     */
    distinct?: RelationshipMemoryCardScalarFieldEnum | RelationshipMemoryCardScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryCard findFirstOrThrow
   */
  export type RelationshipMemoryCardFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryCard to fetch.
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryCards to fetch.
     */
    orderBy?: RelationshipMemoryCardOrderByWithRelationInput | RelationshipMemoryCardOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipMemoryCards.
     */
    cursor?: RelationshipMemoryCardWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryCards from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryCards.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipMemoryCards.
     */
    distinct?: RelationshipMemoryCardScalarFieldEnum | RelationshipMemoryCardScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryCard findMany
   */
  export type RelationshipMemoryCardFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryCards to fetch.
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryCards to fetch.
     */
    orderBy?: RelationshipMemoryCardOrderByWithRelationInput | RelationshipMemoryCardOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing RelationshipMemoryCards.
     */
    cursor?: RelationshipMemoryCardWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryCards from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryCards.
     */
    skip?: number
    distinct?: RelationshipMemoryCardScalarFieldEnum | RelationshipMemoryCardScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryCard create
   */
  export type RelationshipMemoryCardCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * The data needed to create a RelationshipMemoryCard.
     */
    data: XOR<RelationshipMemoryCardCreateInput, RelationshipMemoryCardUncheckedCreateInput>
  }

  /**
   * RelationshipMemoryCard createMany
   */
  export type RelationshipMemoryCardCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many RelationshipMemoryCards.
     */
    data: RelationshipMemoryCardCreateManyInput | RelationshipMemoryCardCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipMemoryCard createManyAndReturn
   */
  export type RelationshipMemoryCardCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * The data used to create many RelationshipMemoryCards.
     */
    data: RelationshipMemoryCardCreateManyInput | RelationshipMemoryCardCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipMemoryCard update
   */
  export type RelationshipMemoryCardUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * The data needed to update a RelationshipMemoryCard.
     */
    data: XOR<RelationshipMemoryCardUpdateInput, RelationshipMemoryCardUncheckedUpdateInput>
    /**
     * Choose, which RelationshipMemoryCard to update.
     */
    where: RelationshipMemoryCardWhereUniqueInput
  }

  /**
   * RelationshipMemoryCard updateMany
   */
  export type RelationshipMemoryCardUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update RelationshipMemoryCards.
     */
    data: XOR<RelationshipMemoryCardUpdateManyMutationInput, RelationshipMemoryCardUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipMemoryCards to update
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * Limit how many RelationshipMemoryCards to update.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryCard updateManyAndReturn
   */
  export type RelationshipMemoryCardUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * The data used to update RelationshipMemoryCards.
     */
    data: XOR<RelationshipMemoryCardUpdateManyMutationInput, RelationshipMemoryCardUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipMemoryCards to update
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * Limit how many RelationshipMemoryCards to update.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryCard upsert
   */
  export type RelationshipMemoryCardUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * The filter to search for the RelationshipMemoryCard to update in case it exists.
     */
    where: RelationshipMemoryCardWhereUniqueInput
    /**
     * In case the RelationshipMemoryCard found by the `where` argument doesn't exist, create a new RelationshipMemoryCard with this data.
     */
    create: XOR<RelationshipMemoryCardCreateInput, RelationshipMemoryCardUncheckedCreateInput>
    /**
     * In case the RelationshipMemoryCard was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RelationshipMemoryCardUpdateInput, RelationshipMemoryCardUncheckedUpdateInput>
  }

  /**
   * RelationshipMemoryCard delete
   */
  export type RelationshipMemoryCardDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
    /**
     * Filter which RelationshipMemoryCard to delete.
     */
    where: RelationshipMemoryCardWhereUniqueInput
  }

  /**
   * RelationshipMemoryCard deleteMany
   */
  export type RelationshipMemoryCardDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipMemoryCards to delete
     */
    where?: RelationshipMemoryCardWhereInput
    /**
     * Limit how many RelationshipMemoryCards to delete.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryCard without action
   */
  export type RelationshipMemoryCardDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryCard
     */
    select?: RelationshipMemoryCardSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryCard
     */
    omit?: RelationshipMemoryCardOmit<ExtArgs> | null
  }


  /**
   * Model RelationshipMemoryOverride
   */

  export type AggregateRelationshipMemoryOverride = {
    _count: RelationshipMemoryOverrideCountAggregateOutputType | null
    _avg: RelationshipMemoryOverrideAvgAggregateOutputType | null
    _sum: RelationshipMemoryOverrideSumAggregateOutputType | null
    _min: RelationshipMemoryOverrideMinAggregateOutputType | null
    _max: RelationshipMemoryOverrideMaxAggregateOutputType | null
  }

  export type RelationshipMemoryOverrideAvgAggregateOutputType = {
    id: number | null
    card_id: number | null
  }

  export type RelationshipMemoryOverrideSumAggregateOutputType = {
    id: bigint | null
    card_id: bigint | null
  }

  export type RelationshipMemoryOverrideMinAggregateOutputType = {
    id: bigint | null
    card_id: bigint | null
    action_type: string | null
    manual_note: string | null
    created_by: string | null
    created_at: Date | null
  }

  export type RelationshipMemoryOverrideMaxAggregateOutputType = {
    id: bigint | null
    card_id: bigint | null
    action_type: string | null
    manual_note: string | null
    created_by: string | null
    created_at: Date | null
  }

  export type RelationshipMemoryOverrideCountAggregateOutputType = {
    id: number
    card_id: number
    action_type: number
    manual_note: number
    created_by: number
    metadata: number
    created_at: number
    _all: number
  }


  export type RelationshipMemoryOverrideAvgAggregateInputType = {
    id?: true
    card_id?: true
  }

  export type RelationshipMemoryOverrideSumAggregateInputType = {
    id?: true
    card_id?: true
  }

  export type RelationshipMemoryOverrideMinAggregateInputType = {
    id?: true
    card_id?: true
    action_type?: true
    manual_note?: true
    created_by?: true
    created_at?: true
  }

  export type RelationshipMemoryOverrideMaxAggregateInputType = {
    id?: true
    card_id?: true
    action_type?: true
    manual_note?: true
    created_by?: true
    created_at?: true
  }

  export type RelationshipMemoryOverrideCountAggregateInputType = {
    id?: true
    card_id?: true
    action_type?: true
    manual_note?: true
    created_by?: true
    metadata?: true
    created_at?: true
    _all?: true
  }

  export type RelationshipMemoryOverrideAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipMemoryOverride to aggregate.
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryOverrides to fetch.
     */
    orderBy?: RelationshipMemoryOverrideOrderByWithRelationInput | RelationshipMemoryOverrideOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RelationshipMemoryOverrideWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryOverrides from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryOverrides.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned RelationshipMemoryOverrides
    **/
    _count?: true | RelationshipMemoryOverrideCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: RelationshipMemoryOverrideAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: RelationshipMemoryOverrideSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RelationshipMemoryOverrideMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RelationshipMemoryOverrideMaxAggregateInputType
  }

  export type GetRelationshipMemoryOverrideAggregateType<T extends RelationshipMemoryOverrideAggregateArgs> = {
        [P in keyof T & keyof AggregateRelationshipMemoryOverride]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRelationshipMemoryOverride[P]>
      : GetScalarType<T[P], AggregateRelationshipMemoryOverride[P]>
  }




  export type RelationshipMemoryOverrideGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RelationshipMemoryOverrideWhereInput
    orderBy?: RelationshipMemoryOverrideOrderByWithAggregationInput | RelationshipMemoryOverrideOrderByWithAggregationInput[]
    by: RelationshipMemoryOverrideScalarFieldEnum[] | RelationshipMemoryOverrideScalarFieldEnum
    having?: RelationshipMemoryOverrideScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RelationshipMemoryOverrideCountAggregateInputType | true
    _avg?: RelationshipMemoryOverrideAvgAggregateInputType
    _sum?: RelationshipMemoryOverrideSumAggregateInputType
    _min?: RelationshipMemoryOverrideMinAggregateInputType
    _max?: RelationshipMemoryOverrideMaxAggregateInputType
  }

  export type RelationshipMemoryOverrideGroupByOutputType = {
    id: bigint
    card_id: bigint
    action_type: string
    manual_note: string | null
    created_by: string | null
    metadata: JsonValue | null
    created_at: Date
    _count: RelationshipMemoryOverrideCountAggregateOutputType | null
    _avg: RelationshipMemoryOverrideAvgAggregateOutputType | null
    _sum: RelationshipMemoryOverrideSumAggregateOutputType | null
    _min: RelationshipMemoryOverrideMinAggregateOutputType | null
    _max: RelationshipMemoryOverrideMaxAggregateOutputType | null
  }

  type GetRelationshipMemoryOverrideGroupByPayload<T extends RelationshipMemoryOverrideGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RelationshipMemoryOverrideGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RelationshipMemoryOverrideGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RelationshipMemoryOverrideGroupByOutputType[P]>
            : GetScalarType<T[P], RelationshipMemoryOverrideGroupByOutputType[P]>
        }
      >
    >


  export type RelationshipMemoryOverrideSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    card_id?: boolean
    action_type?: boolean
    manual_note?: boolean
    created_by?: boolean
    metadata?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryOverride"]>

  export type RelationshipMemoryOverrideSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    card_id?: boolean
    action_type?: boolean
    manual_note?: boolean
    created_by?: boolean
    metadata?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryOverride"]>

  export type RelationshipMemoryOverrideSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    card_id?: boolean
    action_type?: boolean
    manual_note?: boolean
    created_by?: boolean
    metadata?: boolean
    created_at?: boolean
  }, ExtArgs["result"]["relationshipMemoryOverride"]>

  export type RelationshipMemoryOverrideSelectScalar = {
    id?: boolean
    card_id?: boolean
    action_type?: boolean
    manual_note?: boolean
    created_by?: boolean
    metadata?: boolean
    created_at?: boolean
  }

  export type RelationshipMemoryOverrideOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "card_id" | "action_type" | "manual_note" | "created_by" | "metadata" | "created_at", ExtArgs["result"]["relationshipMemoryOverride"]>

  export type $RelationshipMemoryOverridePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "RelationshipMemoryOverride"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: bigint
      card_id: bigint
      action_type: string
      manual_note: string | null
      created_by: string | null
      metadata: Prisma.JsonValue | null
      created_at: Date
    }, ExtArgs["result"]["relationshipMemoryOverride"]>
    composites: {}
  }

  type RelationshipMemoryOverrideGetPayload<S extends boolean | null | undefined | RelationshipMemoryOverrideDefaultArgs> = $Result.GetResult<Prisma.$RelationshipMemoryOverridePayload, S>

  type RelationshipMemoryOverrideCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<RelationshipMemoryOverrideFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: RelationshipMemoryOverrideCountAggregateInputType | true
    }

  export interface RelationshipMemoryOverrideDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['RelationshipMemoryOverride'], meta: { name: 'RelationshipMemoryOverride' } }
    /**
     * Find zero or one RelationshipMemoryOverride that matches the filter.
     * @param {RelationshipMemoryOverrideFindUniqueArgs} args - Arguments to find a RelationshipMemoryOverride
     * @example
     * // Get one RelationshipMemoryOverride
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RelationshipMemoryOverrideFindUniqueArgs>(args: SelectSubset<T, RelationshipMemoryOverrideFindUniqueArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one RelationshipMemoryOverride that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {RelationshipMemoryOverrideFindUniqueOrThrowArgs} args - Arguments to find a RelationshipMemoryOverride
     * @example
     * // Get one RelationshipMemoryOverride
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RelationshipMemoryOverrideFindUniqueOrThrowArgs>(args: SelectSubset<T, RelationshipMemoryOverrideFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipMemoryOverride that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideFindFirstArgs} args - Arguments to find a RelationshipMemoryOverride
     * @example
     * // Get one RelationshipMemoryOverride
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RelationshipMemoryOverrideFindFirstArgs>(args?: SelectSubset<T, RelationshipMemoryOverrideFindFirstArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RelationshipMemoryOverride that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideFindFirstOrThrowArgs} args - Arguments to find a RelationshipMemoryOverride
     * @example
     * // Get one RelationshipMemoryOverride
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RelationshipMemoryOverrideFindFirstOrThrowArgs>(args?: SelectSubset<T, RelationshipMemoryOverrideFindFirstOrThrowArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more RelationshipMemoryOverrides that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all RelationshipMemoryOverrides
     * const relationshipMemoryOverrides = await prisma.relationshipMemoryOverride.findMany()
     * 
     * // Get first 10 RelationshipMemoryOverrides
     * const relationshipMemoryOverrides = await prisma.relationshipMemoryOverride.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const relationshipMemoryOverrideWithIdOnly = await prisma.relationshipMemoryOverride.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RelationshipMemoryOverrideFindManyArgs>(args?: SelectSubset<T, RelationshipMemoryOverrideFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a RelationshipMemoryOverride.
     * @param {RelationshipMemoryOverrideCreateArgs} args - Arguments to create a RelationshipMemoryOverride.
     * @example
     * // Create one RelationshipMemoryOverride
     * const RelationshipMemoryOverride = await prisma.relationshipMemoryOverride.create({
     *   data: {
     *     // ... data to create a RelationshipMemoryOverride
     *   }
     * })
     * 
     */
    create<T extends RelationshipMemoryOverrideCreateArgs>(args: SelectSubset<T, RelationshipMemoryOverrideCreateArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many RelationshipMemoryOverrides.
     * @param {RelationshipMemoryOverrideCreateManyArgs} args - Arguments to create many RelationshipMemoryOverrides.
     * @example
     * // Create many RelationshipMemoryOverrides
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RelationshipMemoryOverrideCreateManyArgs>(args?: SelectSubset<T, RelationshipMemoryOverrideCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many RelationshipMemoryOverrides and returns the data saved in the database.
     * @param {RelationshipMemoryOverrideCreateManyAndReturnArgs} args - Arguments to create many RelationshipMemoryOverrides.
     * @example
     * // Create many RelationshipMemoryOverrides
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many RelationshipMemoryOverrides and only return the `id`
     * const relationshipMemoryOverrideWithIdOnly = await prisma.relationshipMemoryOverride.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RelationshipMemoryOverrideCreateManyAndReturnArgs>(args?: SelectSubset<T, RelationshipMemoryOverrideCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a RelationshipMemoryOverride.
     * @param {RelationshipMemoryOverrideDeleteArgs} args - Arguments to delete one RelationshipMemoryOverride.
     * @example
     * // Delete one RelationshipMemoryOverride
     * const RelationshipMemoryOverride = await prisma.relationshipMemoryOverride.delete({
     *   where: {
     *     // ... filter to delete one RelationshipMemoryOverride
     *   }
     * })
     * 
     */
    delete<T extends RelationshipMemoryOverrideDeleteArgs>(args: SelectSubset<T, RelationshipMemoryOverrideDeleteArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one RelationshipMemoryOverride.
     * @param {RelationshipMemoryOverrideUpdateArgs} args - Arguments to update one RelationshipMemoryOverride.
     * @example
     * // Update one RelationshipMemoryOverride
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RelationshipMemoryOverrideUpdateArgs>(args: SelectSubset<T, RelationshipMemoryOverrideUpdateArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more RelationshipMemoryOverrides.
     * @param {RelationshipMemoryOverrideDeleteManyArgs} args - Arguments to filter RelationshipMemoryOverrides to delete.
     * @example
     * // Delete a few RelationshipMemoryOverrides
     * const { count } = await prisma.relationshipMemoryOverride.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RelationshipMemoryOverrideDeleteManyArgs>(args?: SelectSubset<T, RelationshipMemoryOverrideDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipMemoryOverrides.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many RelationshipMemoryOverrides
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RelationshipMemoryOverrideUpdateManyArgs>(args: SelectSubset<T, RelationshipMemoryOverrideUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RelationshipMemoryOverrides and returns the data updated in the database.
     * @param {RelationshipMemoryOverrideUpdateManyAndReturnArgs} args - Arguments to update many RelationshipMemoryOverrides.
     * @example
     * // Update many RelationshipMemoryOverrides
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more RelationshipMemoryOverrides and only return the `id`
     * const relationshipMemoryOverrideWithIdOnly = await prisma.relationshipMemoryOverride.updateManyAndReturn({
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
    updateManyAndReturn<T extends RelationshipMemoryOverrideUpdateManyAndReturnArgs>(args: SelectSubset<T, RelationshipMemoryOverrideUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one RelationshipMemoryOverride.
     * @param {RelationshipMemoryOverrideUpsertArgs} args - Arguments to update or create a RelationshipMemoryOverride.
     * @example
     * // Update or create a RelationshipMemoryOverride
     * const relationshipMemoryOverride = await prisma.relationshipMemoryOverride.upsert({
     *   create: {
     *     // ... data to create a RelationshipMemoryOverride
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the RelationshipMemoryOverride we want to update
     *   }
     * })
     */
    upsert<T extends RelationshipMemoryOverrideUpsertArgs>(args: SelectSubset<T, RelationshipMemoryOverrideUpsertArgs<ExtArgs>>): Prisma__RelationshipMemoryOverrideClient<$Result.GetResult<Prisma.$RelationshipMemoryOverridePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of RelationshipMemoryOverrides.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideCountArgs} args - Arguments to filter RelationshipMemoryOverrides to count.
     * @example
     * // Count the number of RelationshipMemoryOverrides
     * const count = await prisma.relationshipMemoryOverride.count({
     *   where: {
     *     // ... the filter for the RelationshipMemoryOverrides we want to count
     *   }
     * })
    **/
    count<T extends RelationshipMemoryOverrideCountArgs>(
      args?: Subset<T, RelationshipMemoryOverrideCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RelationshipMemoryOverrideCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a RelationshipMemoryOverride.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends RelationshipMemoryOverrideAggregateArgs>(args: Subset<T, RelationshipMemoryOverrideAggregateArgs>): Prisma.PrismaPromise<GetRelationshipMemoryOverrideAggregateType<T>>

    /**
     * Group by RelationshipMemoryOverride.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RelationshipMemoryOverrideGroupByArgs} args - Group by arguments.
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
      T extends RelationshipMemoryOverrideGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RelationshipMemoryOverrideGroupByArgs['orderBy'] }
        : { orderBy?: RelationshipMemoryOverrideGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, RelationshipMemoryOverrideGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRelationshipMemoryOverrideGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the RelationshipMemoryOverride model
   */
  readonly fields: RelationshipMemoryOverrideFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for RelationshipMemoryOverride.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RelationshipMemoryOverrideClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
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
   * Fields of the RelationshipMemoryOverride model
   */
  interface RelationshipMemoryOverrideFieldRefs {
    readonly id: FieldRef<"RelationshipMemoryOverride", 'BigInt'>
    readonly card_id: FieldRef<"RelationshipMemoryOverride", 'BigInt'>
    readonly action_type: FieldRef<"RelationshipMemoryOverride", 'String'>
    readonly manual_note: FieldRef<"RelationshipMemoryOverride", 'String'>
    readonly created_by: FieldRef<"RelationshipMemoryOverride", 'String'>
    readonly metadata: FieldRef<"RelationshipMemoryOverride", 'Json'>
    readonly created_at: FieldRef<"RelationshipMemoryOverride", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * RelationshipMemoryOverride findUnique
   */
  export type RelationshipMemoryOverrideFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryOverride to fetch.
     */
    where: RelationshipMemoryOverrideWhereUniqueInput
  }

  /**
   * RelationshipMemoryOverride findUniqueOrThrow
   */
  export type RelationshipMemoryOverrideFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryOverride to fetch.
     */
    where: RelationshipMemoryOverrideWhereUniqueInput
  }

  /**
   * RelationshipMemoryOverride findFirst
   */
  export type RelationshipMemoryOverrideFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryOverride to fetch.
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryOverrides to fetch.
     */
    orderBy?: RelationshipMemoryOverrideOrderByWithRelationInput | RelationshipMemoryOverrideOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipMemoryOverrides.
     */
    cursor?: RelationshipMemoryOverrideWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryOverrides from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryOverrides.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipMemoryOverrides.
     */
    distinct?: RelationshipMemoryOverrideScalarFieldEnum | RelationshipMemoryOverrideScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryOverride findFirstOrThrow
   */
  export type RelationshipMemoryOverrideFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryOverride to fetch.
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryOverrides to fetch.
     */
    orderBy?: RelationshipMemoryOverrideOrderByWithRelationInput | RelationshipMemoryOverrideOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RelationshipMemoryOverrides.
     */
    cursor?: RelationshipMemoryOverrideWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryOverrides from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryOverrides.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RelationshipMemoryOverrides.
     */
    distinct?: RelationshipMemoryOverrideScalarFieldEnum | RelationshipMemoryOverrideScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryOverride findMany
   */
  export type RelationshipMemoryOverrideFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * Filter, which RelationshipMemoryOverrides to fetch.
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RelationshipMemoryOverrides to fetch.
     */
    orderBy?: RelationshipMemoryOverrideOrderByWithRelationInput | RelationshipMemoryOverrideOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing RelationshipMemoryOverrides.
     */
    cursor?: RelationshipMemoryOverrideWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RelationshipMemoryOverrides from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RelationshipMemoryOverrides.
     */
    skip?: number
    distinct?: RelationshipMemoryOverrideScalarFieldEnum | RelationshipMemoryOverrideScalarFieldEnum[]
  }

  /**
   * RelationshipMemoryOverride create
   */
  export type RelationshipMemoryOverrideCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * The data needed to create a RelationshipMemoryOverride.
     */
    data: XOR<RelationshipMemoryOverrideCreateInput, RelationshipMemoryOverrideUncheckedCreateInput>
  }

  /**
   * RelationshipMemoryOverride createMany
   */
  export type RelationshipMemoryOverrideCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many RelationshipMemoryOverrides.
     */
    data: RelationshipMemoryOverrideCreateManyInput | RelationshipMemoryOverrideCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipMemoryOverride createManyAndReturn
   */
  export type RelationshipMemoryOverrideCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * The data used to create many RelationshipMemoryOverrides.
     */
    data: RelationshipMemoryOverrideCreateManyInput | RelationshipMemoryOverrideCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RelationshipMemoryOverride update
   */
  export type RelationshipMemoryOverrideUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * The data needed to update a RelationshipMemoryOverride.
     */
    data: XOR<RelationshipMemoryOverrideUpdateInput, RelationshipMemoryOverrideUncheckedUpdateInput>
    /**
     * Choose, which RelationshipMemoryOverride to update.
     */
    where: RelationshipMemoryOverrideWhereUniqueInput
  }

  /**
   * RelationshipMemoryOverride updateMany
   */
  export type RelationshipMemoryOverrideUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update RelationshipMemoryOverrides.
     */
    data: XOR<RelationshipMemoryOverrideUpdateManyMutationInput, RelationshipMemoryOverrideUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipMemoryOverrides to update
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * Limit how many RelationshipMemoryOverrides to update.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryOverride updateManyAndReturn
   */
  export type RelationshipMemoryOverrideUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * The data used to update RelationshipMemoryOverrides.
     */
    data: XOR<RelationshipMemoryOverrideUpdateManyMutationInput, RelationshipMemoryOverrideUncheckedUpdateManyInput>
    /**
     * Filter which RelationshipMemoryOverrides to update
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * Limit how many RelationshipMemoryOverrides to update.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryOverride upsert
   */
  export type RelationshipMemoryOverrideUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * The filter to search for the RelationshipMemoryOverride to update in case it exists.
     */
    where: RelationshipMemoryOverrideWhereUniqueInput
    /**
     * In case the RelationshipMemoryOverride found by the `where` argument doesn't exist, create a new RelationshipMemoryOverride with this data.
     */
    create: XOR<RelationshipMemoryOverrideCreateInput, RelationshipMemoryOverrideUncheckedCreateInput>
    /**
     * In case the RelationshipMemoryOverride was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RelationshipMemoryOverrideUpdateInput, RelationshipMemoryOverrideUncheckedUpdateInput>
  }

  /**
   * RelationshipMemoryOverride delete
   */
  export type RelationshipMemoryOverrideDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
    /**
     * Filter which RelationshipMemoryOverride to delete.
     */
    where: RelationshipMemoryOverrideWhereUniqueInput
  }

  /**
   * RelationshipMemoryOverride deleteMany
   */
  export type RelationshipMemoryOverrideDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RelationshipMemoryOverrides to delete
     */
    where?: RelationshipMemoryOverrideWhereInput
    /**
     * Limit how many RelationshipMemoryOverrides to delete.
     */
    limit?: number
  }

  /**
   * RelationshipMemoryOverride without action
   */
  export type RelationshipMemoryOverrideDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RelationshipMemoryOverride
     */
    select?: RelationshipMemoryOverrideSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RelationshipMemoryOverride
     */
    omit?: RelationshipMemoryOverrideOmit<ExtArgs> | null
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
    continuous_learning_enabled: 'continuous_learning_enabled',
    auto_reply_enabled: 'auto_reply_enabled',
    transcript_compact_offset: 'transcript_compact_offset',
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
    continuous_learning_enabled: 'continuous_learning_enabled',
    auto_reply_enabled: 'auto_reply_enabled',
    transcript_compact_offset: 'transcript_compact_offset',
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


  export const HttpTrafficLogScalarFieldEnum: {
    id: 'id',
    request_id: 'request_id',
    trace_id: 'trace_id',
    conversation_id: 'conversation_id',
    user_id: 'user_id',
    session_id: 'session_id',
    agent_turn: 'agent_turn',
    llm_call_id: 'llm_call_id',
    tool_call_id: 'tool_call_id',
    container_name: 'container_name',
    service_name: 'service_name',
    method: 'method',
    url: 'url',
    host: 'host',
    path: 'path',
    query_params: 'query_params',
    request_headers: 'request_headers',
    request_body: 'request_body',
    request_content_type: 'request_content_type',
    request_size: 'request_size',
    response_status: 'response_status',
    response_headers: 'response_headers',
    response_body: 'response_body',
    response_content_type: 'response_content_type',
    response_size: 'response_size',
    duration_ms: 'duration_ms',
    request_timestamp: 'request_timestamp',
    response_timestamp: 'response_timestamp',
    is_ai_request: 'is_ai_request',
    api_type: 'api_type',
    api_version: 'api_version',
    client_ip: 'client_ip',
    user_agent: 'user_agent',
    error_message: 'error_message',
    created_at: 'created_at'
  };

  export type HttpTrafficLogScalarFieldEnum = (typeof HttpTrafficLogScalarFieldEnum)[keyof typeof HttpTrafficLogScalarFieldEnum]


  export const ConversationItemScalarFieldEnum: {
    id: 'id',
    conversation_id: 'conversation_id',
    session_key: 'session_key',
    role: 'role',
    phase: 'phase',
    content: 'content',
    group_index: 'group_index',
    item_index: 'item_index',
    source: 'source',
    delivery_message_id: 'delivery_message_id',
    run_id: 'run_id',
    trace_id: 'trace_id',
    created_at: 'created_at'
  };

  export type ConversationItemScalarFieldEnum = (typeof ConversationItemScalarFieldEnum)[keyof typeof ConversationItemScalarFieldEnum]


  export const TrafficReplayHistoryScalarFieldEnum: {
    id: 'id',
    original_log_id: 'original_log_id',
    replay_name: 'replay_name',
    target_url: 'target_url',
    request_method: 'request_method',
    request_headers: 'request_headers',
    request_body: 'request_body',
    response_status: 'response_status',
    response_headers: 'response_headers',
    response_body: 'response_body',
    duration_ms: 'duration_ms',
    status: 'status',
    error_message: 'error_message',
    replayed_at: 'replayed_at',
    replayed_by: 'replayed_by',
    modified_method: 'modified_method',
    modified_url: 'modified_url',
    modified_headers: 'modified_headers',
    modified_body: 'modified_body',
    modification_summary: 'modification_summary',
    replay_request_headers: 'replay_request_headers',
    replay_request_body: 'replay_request_body',
    replay_response_status: 'replay_response_status',
    replay_duration_ms: 'replay_duration_ms',
    replay_response_headers: 'replay_response_headers',
    replay_response_body: 'replay_response_body',
    replay_response_size: 'replay_response_size',
    diff_summary: 'diff_summary',
    status_code_match: 'status_code_match',
    response_body_match: 'response_body_match',
    duration_diff_ms: 'duration_diff_ms',
    body_size_diff: 'body_size_diff',
    success: 'success',
    template_id: 'template_id'
  };

  export type TrafficReplayHistoryScalarFieldEnum = (typeof TrafficReplayHistoryScalarFieldEnum)[keyof typeof TrafficReplayHistoryScalarFieldEnum]


  export const RelationshipLedgerEventScalarFieldEnum: {
    id: 'id',
    group_id: 'group_id',
    target_user_id: 'target_user_id',
    session_key: 'session_key',
    event_type: 'event_type',
    event_weight: 'event_weight',
    confidence: 'confidence',
    source_message_ids: 'source_message_ids',
    source_excerpt: 'source_excerpt',
    metadata: 'metadata',
    created_at: 'created_at',
    last_reinforced_at: 'last_reinforced_at'
  };

  export type RelationshipLedgerEventScalarFieldEnum = (typeof RelationshipLedgerEventScalarFieldEnum)[keyof typeof RelationshipLedgerEventScalarFieldEnum]


  export const RelationshipMemoryJobScalarFieldEnum: {
    id: 'id',
    group_id: 'group_id',
    session_key: 'session_key',
    status: 'status',
    trigger_reason: 'trigger_reason',
    turn_range_start: 'turn_range_start',
    turn_range_end: 'turn_range_end',
    ledger_event_count: 'ledger_event_count',
    input_message_ids: 'input_message_ids',
    output_card_version: 'output_card_version',
    error_message: 'error_message',
    metadata: 'metadata',
    started_at: 'started_at',
    finished_at: 'finished_at',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type RelationshipMemoryJobScalarFieldEnum = (typeof RelationshipMemoryJobScalarFieldEnum)[keyof typeof RelationshipMemoryJobScalarFieldEnum]


  export const RelationshipMemoryCardScalarFieldEnum: {
    id: 'id',
    card_type: 'card_type',
    group_id: 'group_id',
    target_user_id: 'target_user_id',
    version: 'version',
    is_active: 'is_active',
    summary_text: 'summary_text',
    actors: 'actors',
    context_before: 'context_before',
    trigger: 'trigger',
    interaction: 'interaction',
    outcome: 'outcome',
    source_event_ids: 'source_event_ids',
    source_message_ids: 'source_message_ids',
    importance_score: 'importance_score',
    freshness_score: 'freshness_score',
    decayed_score: 'decayed_score',
    retrieval_text: 'retrieval_text',
    embedding_text: 'embedding_text',
    last_hit_at: 'last_hit_at',
    metadata: 'metadata',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type RelationshipMemoryCardScalarFieldEnum = (typeof RelationshipMemoryCardScalarFieldEnum)[keyof typeof RelationshipMemoryCardScalarFieldEnum]


  export const RelationshipMemoryOverrideScalarFieldEnum: {
    id: 'id',
    card_id: 'card_id',
    action_type: 'action_type',
    manual_note: 'manual_note',
    created_by: 'created_by',
    metadata: 'metadata',
    created_at: 'created_at'
  };

  export type RelationshipMemoryOverrideScalarFieldEnum = (typeof RelationshipMemoryOverrideScalarFieldEnum)[keyof typeof RelationshipMemoryOverrideScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


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
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


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
    continuous_learning_enabled?: IntFilter<"GroupChatSetting"> | number
    auto_reply_enabled?: IntFilter<"GroupChatSetting"> | number
    transcript_compact_offset?: IntFilter<"GroupChatSetting"> | number
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: IntFilter<"GroupChatSetting"> | number
    auto_reply_enabled?: IntFilter<"GroupChatSetting"> | number
    transcript_compact_offset?: IntFilter<"GroupChatSetting"> | number
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: IntWithAggregatesFilter<"GroupChatSetting"> | number
    auto_reply_enabled?: IntWithAggregatesFilter<"GroupChatSetting"> | number
    transcript_compact_offset?: IntWithAggregatesFilter<"GroupChatSetting"> | number
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
    continuous_learning_enabled?: IntFilter<"PrivateChatSetting"> | number
    auto_reply_enabled?: IntFilter<"PrivateChatSetting"> | number
    transcript_compact_offset?: IntFilter<"PrivateChatSetting"> | number
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: IntFilter<"PrivateChatSetting"> | number
    auto_reply_enabled?: IntFilter<"PrivateChatSetting"> | number
    transcript_compact_offset?: IntFilter<"PrivateChatSetting"> | number
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: IntWithAggregatesFilter<"PrivateChatSetting"> | number
    auto_reply_enabled?: IntWithAggregatesFilter<"PrivateChatSetting"> | number
    transcript_compact_offset?: IntWithAggregatesFilter<"PrivateChatSetting"> | number
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

  export type HttpTrafficLogWhereInput = {
    AND?: HttpTrafficLogWhereInput | HttpTrafficLogWhereInput[]
    OR?: HttpTrafficLogWhereInput[]
    NOT?: HttpTrafficLogWhereInput | HttpTrafficLogWhereInput[]
    id?: BigIntFilter<"HttpTrafficLog"> | bigint | number
    request_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    trace_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    conversation_id?: BigIntNullableFilter<"HttpTrafficLog"> | bigint | number | null
    user_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    session_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    agent_turn?: IntNullableFilter<"HttpTrafficLog"> | number | null
    llm_call_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    tool_call_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    container_name?: StringNullableFilter<"HttpTrafficLog"> | string | null
    service_name?: StringNullableFilter<"HttpTrafficLog"> | string | null
    method?: StringFilter<"HttpTrafficLog"> | string
    url?: StringFilter<"HttpTrafficLog"> | string
    host?: StringFilter<"HttpTrafficLog"> | string
    path?: StringFilter<"HttpTrafficLog"> | string
    query_params?: JsonNullableFilter<"HttpTrafficLog">
    request_headers?: JsonFilter<"HttpTrafficLog">
    request_body?: StringNullableFilter<"HttpTrafficLog"> | string | null
    request_content_type?: StringNullableFilter<"HttpTrafficLog"> | string | null
    request_size?: IntNullableFilter<"HttpTrafficLog"> | number | null
    response_status?: IntNullableFilter<"HttpTrafficLog"> | number | null
    response_headers?: JsonNullableFilter<"HttpTrafficLog">
    response_body?: StringNullableFilter<"HttpTrafficLog"> | string | null
    response_content_type?: StringNullableFilter<"HttpTrafficLog"> | string | null
    response_size?: IntNullableFilter<"HttpTrafficLog"> | number | null
    duration_ms?: BigIntNullableFilter<"HttpTrafficLog"> | bigint | number | null
    request_timestamp?: DateTimeFilter<"HttpTrafficLog"> | Date | string
    response_timestamp?: DateTimeNullableFilter<"HttpTrafficLog"> | Date | string | null
    is_ai_request?: BoolFilter<"HttpTrafficLog"> | boolean
    api_type?: StringNullableFilter<"HttpTrafficLog"> | string | null
    api_version?: StringNullableFilter<"HttpTrafficLog"> | string | null
    client_ip?: StringNullableFilter<"HttpTrafficLog"> | string | null
    user_agent?: StringNullableFilter<"HttpTrafficLog"> | string | null
    error_message?: StringNullableFilter<"HttpTrafficLog"> | string | null
    created_at?: DateTimeFilter<"HttpTrafficLog"> | Date | string
  }

  export type HttpTrafficLogOrderByWithRelationInput = {
    id?: SortOrder
    request_id?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    conversation_id?: SortOrderInput | SortOrder
    user_id?: SortOrderInput | SortOrder
    session_id?: SortOrderInput | SortOrder
    agent_turn?: SortOrderInput | SortOrder
    llm_call_id?: SortOrderInput | SortOrder
    tool_call_id?: SortOrderInput | SortOrder
    container_name?: SortOrderInput | SortOrder
    service_name?: SortOrderInput | SortOrder
    method?: SortOrder
    url?: SortOrder
    host?: SortOrder
    path?: SortOrder
    query_params?: SortOrderInput | SortOrder
    request_headers?: SortOrder
    request_body?: SortOrderInput | SortOrder
    request_content_type?: SortOrderInput | SortOrder
    request_size?: SortOrderInput | SortOrder
    response_status?: SortOrderInput | SortOrder
    response_headers?: SortOrderInput | SortOrder
    response_body?: SortOrderInput | SortOrder
    response_content_type?: SortOrderInput | SortOrder
    response_size?: SortOrderInput | SortOrder
    duration_ms?: SortOrderInput | SortOrder
    request_timestamp?: SortOrder
    response_timestamp?: SortOrderInput | SortOrder
    is_ai_request?: SortOrder
    api_type?: SortOrderInput | SortOrder
    api_version?: SortOrderInput | SortOrder
    client_ip?: SortOrderInput | SortOrder
    user_agent?: SortOrderInput | SortOrder
    error_message?: SortOrderInput | SortOrder
    created_at?: SortOrder
  }

  export type HttpTrafficLogWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: HttpTrafficLogWhereInput | HttpTrafficLogWhereInput[]
    OR?: HttpTrafficLogWhereInput[]
    NOT?: HttpTrafficLogWhereInput | HttpTrafficLogWhereInput[]
    request_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    trace_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    conversation_id?: BigIntNullableFilter<"HttpTrafficLog"> | bigint | number | null
    user_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    session_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    agent_turn?: IntNullableFilter<"HttpTrafficLog"> | number | null
    llm_call_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    tool_call_id?: StringNullableFilter<"HttpTrafficLog"> | string | null
    container_name?: StringNullableFilter<"HttpTrafficLog"> | string | null
    service_name?: StringNullableFilter<"HttpTrafficLog"> | string | null
    method?: StringFilter<"HttpTrafficLog"> | string
    url?: StringFilter<"HttpTrafficLog"> | string
    host?: StringFilter<"HttpTrafficLog"> | string
    path?: StringFilter<"HttpTrafficLog"> | string
    query_params?: JsonNullableFilter<"HttpTrafficLog">
    request_headers?: JsonFilter<"HttpTrafficLog">
    request_body?: StringNullableFilter<"HttpTrafficLog"> | string | null
    request_content_type?: StringNullableFilter<"HttpTrafficLog"> | string | null
    request_size?: IntNullableFilter<"HttpTrafficLog"> | number | null
    response_status?: IntNullableFilter<"HttpTrafficLog"> | number | null
    response_headers?: JsonNullableFilter<"HttpTrafficLog">
    response_body?: StringNullableFilter<"HttpTrafficLog"> | string | null
    response_content_type?: StringNullableFilter<"HttpTrafficLog"> | string | null
    response_size?: IntNullableFilter<"HttpTrafficLog"> | number | null
    duration_ms?: BigIntNullableFilter<"HttpTrafficLog"> | bigint | number | null
    request_timestamp?: DateTimeFilter<"HttpTrafficLog"> | Date | string
    response_timestamp?: DateTimeNullableFilter<"HttpTrafficLog"> | Date | string | null
    is_ai_request?: BoolFilter<"HttpTrafficLog"> | boolean
    api_type?: StringNullableFilter<"HttpTrafficLog"> | string | null
    api_version?: StringNullableFilter<"HttpTrafficLog"> | string | null
    client_ip?: StringNullableFilter<"HttpTrafficLog"> | string | null
    user_agent?: StringNullableFilter<"HttpTrafficLog"> | string | null
    error_message?: StringNullableFilter<"HttpTrafficLog"> | string | null
    created_at?: DateTimeFilter<"HttpTrafficLog"> | Date | string
  }, "id">

  export type HttpTrafficLogOrderByWithAggregationInput = {
    id?: SortOrder
    request_id?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    conversation_id?: SortOrderInput | SortOrder
    user_id?: SortOrderInput | SortOrder
    session_id?: SortOrderInput | SortOrder
    agent_turn?: SortOrderInput | SortOrder
    llm_call_id?: SortOrderInput | SortOrder
    tool_call_id?: SortOrderInput | SortOrder
    container_name?: SortOrderInput | SortOrder
    service_name?: SortOrderInput | SortOrder
    method?: SortOrder
    url?: SortOrder
    host?: SortOrder
    path?: SortOrder
    query_params?: SortOrderInput | SortOrder
    request_headers?: SortOrder
    request_body?: SortOrderInput | SortOrder
    request_content_type?: SortOrderInput | SortOrder
    request_size?: SortOrderInput | SortOrder
    response_status?: SortOrderInput | SortOrder
    response_headers?: SortOrderInput | SortOrder
    response_body?: SortOrderInput | SortOrder
    response_content_type?: SortOrderInput | SortOrder
    response_size?: SortOrderInput | SortOrder
    duration_ms?: SortOrderInput | SortOrder
    request_timestamp?: SortOrder
    response_timestamp?: SortOrderInput | SortOrder
    is_ai_request?: SortOrder
    api_type?: SortOrderInput | SortOrder
    api_version?: SortOrderInput | SortOrder
    client_ip?: SortOrderInput | SortOrder
    user_agent?: SortOrderInput | SortOrder
    error_message?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: HttpTrafficLogCountOrderByAggregateInput
    _avg?: HttpTrafficLogAvgOrderByAggregateInput
    _max?: HttpTrafficLogMaxOrderByAggregateInput
    _min?: HttpTrafficLogMinOrderByAggregateInput
    _sum?: HttpTrafficLogSumOrderByAggregateInput
  }

  export type HttpTrafficLogScalarWhereWithAggregatesInput = {
    AND?: HttpTrafficLogScalarWhereWithAggregatesInput | HttpTrafficLogScalarWhereWithAggregatesInput[]
    OR?: HttpTrafficLogScalarWhereWithAggregatesInput[]
    NOT?: HttpTrafficLogScalarWhereWithAggregatesInput | HttpTrafficLogScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"HttpTrafficLog"> | bigint | number
    request_id?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    trace_id?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    conversation_id?: BigIntNullableWithAggregatesFilter<"HttpTrafficLog"> | bigint | number | null
    user_id?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    session_id?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    agent_turn?: IntNullableWithAggregatesFilter<"HttpTrafficLog"> | number | null
    llm_call_id?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    tool_call_id?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    container_name?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    service_name?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    method?: StringWithAggregatesFilter<"HttpTrafficLog"> | string
    url?: StringWithAggregatesFilter<"HttpTrafficLog"> | string
    host?: StringWithAggregatesFilter<"HttpTrafficLog"> | string
    path?: StringWithAggregatesFilter<"HttpTrafficLog"> | string
    query_params?: JsonNullableWithAggregatesFilter<"HttpTrafficLog">
    request_headers?: JsonWithAggregatesFilter<"HttpTrafficLog">
    request_body?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    request_content_type?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    request_size?: IntNullableWithAggregatesFilter<"HttpTrafficLog"> | number | null
    response_status?: IntNullableWithAggregatesFilter<"HttpTrafficLog"> | number | null
    response_headers?: JsonNullableWithAggregatesFilter<"HttpTrafficLog">
    response_body?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    response_content_type?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    response_size?: IntNullableWithAggregatesFilter<"HttpTrafficLog"> | number | null
    duration_ms?: BigIntNullableWithAggregatesFilter<"HttpTrafficLog"> | bigint | number | null
    request_timestamp?: DateTimeWithAggregatesFilter<"HttpTrafficLog"> | Date | string
    response_timestamp?: DateTimeNullableWithAggregatesFilter<"HttpTrafficLog"> | Date | string | null
    is_ai_request?: BoolWithAggregatesFilter<"HttpTrafficLog"> | boolean
    api_type?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    api_version?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    client_ip?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    user_agent?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    error_message?: StringNullableWithAggregatesFilter<"HttpTrafficLog"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"HttpTrafficLog"> | Date | string
  }

  export type ConversationItemWhereInput = {
    AND?: ConversationItemWhereInput | ConversationItemWhereInput[]
    OR?: ConversationItemWhereInput[]
    NOT?: ConversationItemWhereInput | ConversationItemWhereInput[]
    id?: BigIntFilter<"ConversationItem"> | bigint | number
    conversation_id?: BigIntFilter<"ConversationItem"> | bigint | number
    session_key?: StringNullableFilter<"ConversationItem"> | string | null
    role?: StringFilter<"ConversationItem"> | string
    phase?: StringNullableFilter<"ConversationItem"> | string | null
    content?: StringFilter<"ConversationItem"> | string
    group_index?: IntFilter<"ConversationItem"> | number
    item_index?: IntFilter<"ConversationItem"> | number
    source?: StringFilter<"ConversationItem"> | string
    delivery_message_id?: BigIntNullableFilter<"ConversationItem"> | bigint | number | null
    run_id?: StringNullableFilter<"ConversationItem"> | string | null
    trace_id?: StringNullableFilter<"ConversationItem"> | string | null
    created_at?: DateTimeFilter<"ConversationItem"> | Date | string
  }

  export type ConversationItemOrderByWithRelationInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    session_key?: SortOrderInput | SortOrder
    role?: SortOrder
    phase?: SortOrderInput | SortOrder
    content?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    source?: SortOrder
    delivery_message_id?: SortOrderInput | SortOrder
    run_id?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    created_at?: SortOrder
  }

  export type ConversationItemWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: ConversationItemWhereInput | ConversationItemWhereInput[]
    OR?: ConversationItemWhereInput[]
    NOT?: ConversationItemWhereInput | ConversationItemWhereInput[]
    conversation_id?: BigIntFilter<"ConversationItem"> | bigint | number
    session_key?: StringNullableFilter<"ConversationItem"> | string | null
    role?: StringFilter<"ConversationItem"> | string
    phase?: StringNullableFilter<"ConversationItem"> | string | null
    content?: StringFilter<"ConversationItem"> | string
    group_index?: IntFilter<"ConversationItem"> | number
    item_index?: IntFilter<"ConversationItem"> | number
    source?: StringFilter<"ConversationItem"> | string
    delivery_message_id?: BigIntNullableFilter<"ConversationItem"> | bigint | number | null
    run_id?: StringNullableFilter<"ConversationItem"> | string | null
    trace_id?: StringNullableFilter<"ConversationItem"> | string | null
    created_at?: DateTimeFilter<"ConversationItem"> | Date | string
  }, "id">

  export type ConversationItemOrderByWithAggregationInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    session_key?: SortOrderInput | SortOrder
    role?: SortOrder
    phase?: SortOrderInput | SortOrder
    content?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    source?: SortOrder
    delivery_message_id?: SortOrderInput | SortOrder
    run_id?: SortOrderInput | SortOrder
    trace_id?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: ConversationItemCountOrderByAggregateInput
    _avg?: ConversationItemAvgOrderByAggregateInput
    _max?: ConversationItemMaxOrderByAggregateInput
    _min?: ConversationItemMinOrderByAggregateInput
    _sum?: ConversationItemSumOrderByAggregateInput
  }

  export type ConversationItemScalarWhereWithAggregatesInput = {
    AND?: ConversationItemScalarWhereWithAggregatesInput | ConversationItemScalarWhereWithAggregatesInput[]
    OR?: ConversationItemScalarWhereWithAggregatesInput[]
    NOT?: ConversationItemScalarWhereWithAggregatesInput | ConversationItemScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"ConversationItem"> | bigint | number
    conversation_id?: BigIntWithAggregatesFilter<"ConversationItem"> | bigint | number
    session_key?: StringNullableWithAggregatesFilter<"ConversationItem"> | string | null
    role?: StringWithAggregatesFilter<"ConversationItem"> | string
    phase?: StringNullableWithAggregatesFilter<"ConversationItem"> | string | null
    content?: StringWithAggregatesFilter<"ConversationItem"> | string
    group_index?: IntWithAggregatesFilter<"ConversationItem"> | number
    item_index?: IntWithAggregatesFilter<"ConversationItem"> | number
    source?: StringWithAggregatesFilter<"ConversationItem"> | string
    delivery_message_id?: BigIntNullableWithAggregatesFilter<"ConversationItem"> | bigint | number | null
    run_id?: StringNullableWithAggregatesFilter<"ConversationItem"> | string | null
    trace_id?: StringNullableWithAggregatesFilter<"ConversationItem"> | string | null
    created_at?: DateTimeWithAggregatesFilter<"ConversationItem"> | Date | string
  }

  export type TrafficReplayHistoryWhereInput = {
    AND?: TrafficReplayHistoryWhereInput | TrafficReplayHistoryWhereInput[]
    OR?: TrafficReplayHistoryWhereInput[]
    NOT?: TrafficReplayHistoryWhereInput | TrafficReplayHistoryWhereInput[]
    id?: BigIntFilter<"TrafficReplayHistory"> | bigint | number
    original_log_id?: BigIntFilter<"TrafficReplayHistory"> | bigint | number
    replay_name?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    target_url?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    request_method?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    request_headers?: JsonNullableFilter<"TrafficReplayHistory">
    request_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    response_status?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    response_headers?: JsonNullableFilter<"TrafficReplayHistory">
    response_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    duration_ms?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    status?: StringFilter<"TrafficReplayHistory"> | string
    error_message?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    replayed_at?: DateTimeFilter<"TrafficReplayHistory"> | Date | string
    replayed_by?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modified_method?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modified_url?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modified_headers?: JsonNullableFilter<"TrafficReplayHistory">
    modified_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modification_summary?: JsonNullableFilter<"TrafficReplayHistory">
    replay_request_headers?: JsonNullableFilter<"TrafficReplayHistory">
    replay_request_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    replay_response_status?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    replay_duration_ms?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    replay_response_headers?: JsonNullableFilter<"TrafficReplayHistory">
    replay_response_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    replay_response_size?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    diff_summary?: JsonNullableFilter<"TrafficReplayHistory">
    status_code_match?: BoolFilter<"TrafficReplayHistory"> | boolean
    response_body_match?: BoolFilter<"TrafficReplayHistory"> | boolean
    duration_diff_ms?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    body_size_diff?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    success?: BoolFilter<"TrafficReplayHistory"> | boolean
    template_id?: IntNullableFilter<"TrafficReplayHistory"> | number | null
  }

  export type TrafficReplayHistoryOrderByWithRelationInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    replay_name?: SortOrderInput | SortOrder
    target_url?: SortOrderInput | SortOrder
    request_method?: SortOrderInput | SortOrder
    request_headers?: SortOrderInput | SortOrder
    request_body?: SortOrderInput | SortOrder
    response_status?: SortOrderInput | SortOrder
    response_headers?: SortOrderInput | SortOrder
    response_body?: SortOrderInput | SortOrder
    duration_ms?: SortOrderInput | SortOrder
    status?: SortOrder
    error_message?: SortOrderInput | SortOrder
    replayed_at?: SortOrder
    replayed_by?: SortOrderInput | SortOrder
    modified_method?: SortOrderInput | SortOrder
    modified_url?: SortOrderInput | SortOrder
    modified_headers?: SortOrderInput | SortOrder
    modified_body?: SortOrderInput | SortOrder
    modification_summary?: SortOrderInput | SortOrder
    replay_request_headers?: SortOrderInput | SortOrder
    replay_request_body?: SortOrderInput | SortOrder
    replay_response_status?: SortOrderInput | SortOrder
    replay_duration_ms?: SortOrderInput | SortOrder
    replay_response_headers?: SortOrderInput | SortOrder
    replay_response_body?: SortOrderInput | SortOrder
    replay_response_size?: SortOrderInput | SortOrder
    diff_summary?: SortOrderInput | SortOrder
    status_code_match?: SortOrder
    response_body_match?: SortOrder
    duration_diff_ms?: SortOrderInput | SortOrder
    body_size_diff?: SortOrderInput | SortOrder
    success?: SortOrder
    template_id?: SortOrderInput | SortOrder
  }

  export type TrafficReplayHistoryWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: TrafficReplayHistoryWhereInput | TrafficReplayHistoryWhereInput[]
    OR?: TrafficReplayHistoryWhereInput[]
    NOT?: TrafficReplayHistoryWhereInput | TrafficReplayHistoryWhereInput[]
    original_log_id?: BigIntFilter<"TrafficReplayHistory"> | bigint | number
    replay_name?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    target_url?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    request_method?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    request_headers?: JsonNullableFilter<"TrafficReplayHistory">
    request_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    response_status?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    response_headers?: JsonNullableFilter<"TrafficReplayHistory">
    response_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    duration_ms?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    status?: StringFilter<"TrafficReplayHistory"> | string
    error_message?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    replayed_at?: DateTimeFilter<"TrafficReplayHistory"> | Date | string
    replayed_by?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modified_method?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modified_url?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modified_headers?: JsonNullableFilter<"TrafficReplayHistory">
    modified_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    modification_summary?: JsonNullableFilter<"TrafficReplayHistory">
    replay_request_headers?: JsonNullableFilter<"TrafficReplayHistory">
    replay_request_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    replay_response_status?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    replay_duration_ms?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    replay_response_headers?: JsonNullableFilter<"TrafficReplayHistory">
    replay_response_body?: StringNullableFilter<"TrafficReplayHistory"> | string | null
    replay_response_size?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    diff_summary?: JsonNullableFilter<"TrafficReplayHistory">
    status_code_match?: BoolFilter<"TrafficReplayHistory"> | boolean
    response_body_match?: BoolFilter<"TrafficReplayHistory"> | boolean
    duration_diff_ms?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    body_size_diff?: IntNullableFilter<"TrafficReplayHistory"> | number | null
    success?: BoolFilter<"TrafficReplayHistory"> | boolean
    template_id?: IntNullableFilter<"TrafficReplayHistory"> | number | null
  }, "id">

  export type TrafficReplayHistoryOrderByWithAggregationInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    replay_name?: SortOrderInput | SortOrder
    target_url?: SortOrderInput | SortOrder
    request_method?: SortOrderInput | SortOrder
    request_headers?: SortOrderInput | SortOrder
    request_body?: SortOrderInput | SortOrder
    response_status?: SortOrderInput | SortOrder
    response_headers?: SortOrderInput | SortOrder
    response_body?: SortOrderInput | SortOrder
    duration_ms?: SortOrderInput | SortOrder
    status?: SortOrder
    error_message?: SortOrderInput | SortOrder
    replayed_at?: SortOrder
    replayed_by?: SortOrderInput | SortOrder
    modified_method?: SortOrderInput | SortOrder
    modified_url?: SortOrderInput | SortOrder
    modified_headers?: SortOrderInput | SortOrder
    modified_body?: SortOrderInput | SortOrder
    modification_summary?: SortOrderInput | SortOrder
    replay_request_headers?: SortOrderInput | SortOrder
    replay_request_body?: SortOrderInput | SortOrder
    replay_response_status?: SortOrderInput | SortOrder
    replay_duration_ms?: SortOrderInput | SortOrder
    replay_response_headers?: SortOrderInput | SortOrder
    replay_response_body?: SortOrderInput | SortOrder
    replay_response_size?: SortOrderInput | SortOrder
    diff_summary?: SortOrderInput | SortOrder
    status_code_match?: SortOrder
    response_body_match?: SortOrder
    duration_diff_ms?: SortOrderInput | SortOrder
    body_size_diff?: SortOrderInput | SortOrder
    success?: SortOrder
    template_id?: SortOrderInput | SortOrder
    _count?: TrafficReplayHistoryCountOrderByAggregateInput
    _avg?: TrafficReplayHistoryAvgOrderByAggregateInput
    _max?: TrafficReplayHistoryMaxOrderByAggregateInput
    _min?: TrafficReplayHistoryMinOrderByAggregateInput
    _sum?: TrafficReplayHistorySumOrderByAggregateInput
  }

  export type TrafficReplayHistoryScalarWhereWithAggregatesInput = {
    AND?: TrafficReplayHistoryScalarWhereWithAggregatesInput | TrafficReplayHistoryScalarWhereWithAggregatesInput[]
    OR?: TrafficReplayHistoryScalarWhereWithAggregatesInput[]
    NOT?: TrafficReplayHistoryScalarWhereWithAggregatesInput | TrafficReplayHistoryScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"TrafficReplayHistory"> | bigint | number
    original_log_id?: BigIntWithAggregatesFilter<"TrafficReplayHistory"> | bigint | number
    replay_name?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    target_url?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    request_method?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    request_headers?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    request_body?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    response_status?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    response_headers?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    response_body?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    duration_ms?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    status?: StringWithAggregatesFilter<"TrafficReplayHistory"> | string
    error_message?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    replayed_at?: DateTimeWithAggregatesFilter<"TrafficReplayHistory"> | Date | string
    replayed_by?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    modified_method?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    modified_url?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    modified_headers?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    modified_body?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    modification_summary?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    replay_request_headers?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    replay_request_body?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    replay_response_status?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    replay_duration_ms?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    replay_response_headers?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    replay_response_body?: StringNullableWithAggregatesFilter<"TrafficReplayHistory"> | string | null
    replay_response_size?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    diff_summary?: JsonNullableWithAggregatesFilter<"TrafficReplayHistory">
    status_code_match?: BoolWithAggregatesFilter<"TrafficReplayHistory"> | boolean
    response_body_match?: BoolWithAggregatesFilter<"TrafficReplayHistory"> | boolean
    duration_diff_ms?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    body_size_diff?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
    success?: BoolWithAggregatesFilter<"TrafficReplayHistory"> | boolean
    template_id?: IntNullableWithAggregatesFilter<"TrafficReplayHistory"> | number | null
  }

  export type RelationshipLedgerEventWhereInput = {
    AND?: RelationshipLedgerEventWhereInput | RelationshipLedgerEventWhereInput[]
    OR?: RelationshipLedgerEventWhereInput[]
    NOT?: RelationshipLedgerEventWhereInput | RelationshipLedgerEventWhereInput[]
    id?: BigIntFilter<"RelationshipLedgerEvent"> | bigint | number
    group_id?: BigIntNullableFilter<"RelationshipLedgerEvent"> | bigint | number | null
    target_user_id?: BigIntNullableFilter<"RelationshipLedgerEvent"> | bigint | number | null
    session_key?: StringFilter<"RelationshipLedgerEvent"> | string
    event_type?: StringFilter<"RelationshipLedgerEvent"> | string
    event_weight?: FloatFilter<"RelationshipLedgerEvent"> | number
    confidence?: StringFilter<"RelationshipLedgerEvent"> | string
    source_message_ids?: JsonFilter<"RelationshipLedgerEvent">
    source_excerpt?: StringNullableFilter<"RelationshipLedgerEvent"> | string | null
    metadata?: JsonNullableFilter<"RelationshipLedgerEvent">
    created_at?: DateTimeFilter<"RelationshipLedgerEvent"> | Date | string
    last_reinforced_at?: DateTimeNullableFilter<"RelationshipLedgerEvent"> | Date | string | null
  }

  export type RelationshipLedgerEventOrderByWithRelationInput = {
    id?: SortOrder
    group_id?: SortOrderInput | SortOrder
    target_user_id?: SortOrderInput | SortOrder
    session_key?: SortOrder
    event_type?: SortOrder
    event_weight?: SortOrder
    confidence?: SortOrder
    source_message_ids?: SortOrder
    source_excerpt?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    created_at?: SortOrder
    last_reinforced_at?: SortOrderInput | SortOrder
  }

  export type RelationshipLedgerEventWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: RelationshipLedgerEventWhereInput | RelationshipLedgerEventWhereInput[]
    OR?: RelationshipLedgerEventWhereInput[]
    NOT?: RelationshipLedgerEventWhereInput | RelationshipLedgerEventWhereInput[]
    group_id?: BigIntNullableFilter<"RelationshipLedgerEvent"> | bigint | number | null
    target_user_id?: BigIntNullableFilter<"RelationshipLedgerEvent"> | bigint | number | null
    session_key?: StringFilter<"RelationshipLedgerEvent"> | string
    event_type?: StringFilter<"RelationshipLedgerEvent"> | string
    event_weight?: FloatFilter<"RelationshipLedgerEvent"> | number
    confidence?: StringFilter<"RelationshipLedgerEvent"> | string
    source_message_ids?: JsonFilter<"RelationshipLedgerEvent">
    source_excerpt?: StringNullableFilter<"RelationshipLedgerEvent"> | string | null
    metadata?: JsonNullableFilter<"RelationshipLedgerEvent">
    created_at?: DateTimeFilter<"RelationshipLedgerEvent"> | Date | string
    last_reinforced_at?: DateTimeNullableFilter<"RelationshipLedgerEvent"> | Date | string | null
  }, "id">

  export type RelationshipLedgerEventOrderByWithAggregationInput = {
    id?: SortOrder
    group_id?: SortOrderInput | SortOrder
    target_user_id?: SortOrderInput | SortOrder
    session_key?: SortOrder
    event_type?: SortOrder
    event_weight?: SortOrder
    confidence?: SortOrder
    source_message_ids?: SortOrder
    source_excerpt?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    created_at?: SortOrder
    last_reinforced_at?: SortOrderInput | SortOrder
    _count?: RelationshipLedgerEventCountOrderByAggregateInput
    _avg?: RelationshipLedgerEventAvgOrderByAggregateInput
    _max?: RelationshipLedgerEventMaxOrderByAggregateInput
    _min?: RelationshipLedgerEventMinOrderByAggregateInput
    _sum?: RelationshipLedgerEventSumOrderByAggregateInput
  }

  export type RelationshipLedgerEventScalarWhereWithAggregatesInput = {
    AND?: RelationshipLedgerEventScalarWhereWithAggregatesInput | RelationshipLedgerEventScalarWhereWithAggregatesInput[]
    OR?: RelationshipLedgerEventScalarWhereWithAggregatesInput[]
    NOT?: RelationshipLedgerEventScalarWhereWithAggregatesInput | RelationshipLedgerEventScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"RelationshipLedgerEvent"> | bigint | number
    group_id?: BigIntNullableWithAggregatesFilter<"RelationshipLedgerEvent"> | bigint | number | null
    target_user_id?: BigIntNullableWithAggregatesFilter<"RelationshipLedgerEvent"> | bigint | number | null
    session_key?: StringWithAggregatesFilter<"RelationshipLedgerEvent"> | string
    event_type?: StringWithAggregatesFilter<"RelationshipLedgerEvent"> | string
    event_weight?: FloatWithAggregatesFilter<"RelationshipLedgerEvent"> | number
    confidence?: StringWithAggregatesFilter<"RelationshipLedgerEvent"> | string
    source_message_ids?: JsonWithAggregatesFilter<"RelationshipLedgerEvent">
    source_excerpt?: StringNullableWithAggregatesFilter<"RelationshipLedgerEvent"> | string | null
    metadata?: JsonNullableWithAggregatesFilter<"RelationshipLedgerEvent">
    created_at?: DateTimeWithAggregatesFilter<"RelationshipLedgerEvent"> | Date | string
    last_reinforced_at?: DateTimeNullableWithAggregatesFilter<"RelationshipLedgerEvent"> | Date | string | null
  }

  export type RelationshipMemoryJobWhereInput = {
    AND?: RelationshipMemoryJobWhereInput | RelationshipMemoryJobWhereInput[]
    OR?: RelationshipMemoryJobWhereInput[]
    NOT?: RelationshipMemoryJobWhereInput | RelationshipMemoryJobWhereInput[]
    id?: BigIntFilter<"RelationshipMemoryJob"> | bigint | number
    group_id?: BigIntNullableFilter<"RelationshipMemoryJob"> | bigint | number | null
    session_key?: StringFilter<"RelationshipMemoryJob"> | string
    status?: StringFilter<"RelationshipMemoryJob"> | string
    trigger_reason?: StringFilter<"RelationshipMemoryJob"> | string
    turn_range_start?: BigIntNullableFilter<"RelationshipMemoryJob"> | bigint | number | null
    turn_range_end?: BigIntNullableFilter<"RelationshipMemoryJob"> | bigint | number | null
    ledger_event_count?: IntFilter<"RelationshipMemoryJob"> | number
    input_message_ids?: JsonFilter<"RelationshipMemoryJob">
    output_card_version?: IntNullableFilter<"RelationshipMemoryJob"> | number | null
    error_message?: StringNullableFilter<"RelationshipMemoryJob"> | string | null
    metadata?: JsonNullableFilter<"RelationshipMemoryJob">
    started_at?: DateTimeNullableFilter<"RelationshipMemoryJob"> | Date | string | null
    finished_at?: DateTimeNullableFilter<"RelationshipMemoryJob"> | Date | string | null
    created_at?: DateTimeFilter<"RelationshipMemoryJob"> | Date | string
    updated_at?: DateTimeFilter<"RelationshipMemoryJob"> | Date | string
  }

  export type RelationshipMemoryJobOrderByWithRelationInput = {
    id?: SortOrder
    group_id?: SortOrderInput | SortOrder
    session_key?: SortOrder
    status?: SortOrder
    trigger_reason?: SortOrder
    turn_range_start?: SortOrderInput | SortOrder
    turn_range_end?: SortOrderInput | SortOrder
    ledger_event_count?: SortOrder
    input_message_ids?: SortOrder
    output_card_version?: SortOrderInput | SortOrder
    error_message?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    started_at?: SortOrderInput | SortOrder
    finished_at?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryJobWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: RelationshipMemoryJobWhereInput | RelationshipMemoryJobWhereInput[]
    OR?: RelationshipMemoryJobWhereInput[]
    NOT?: RelationshipMemoryJobWhereInput | RelationshipMemoryJobWhereInput[]
    group_id?: BigIntNullableFilter<"RelationshipMemoryJob"> | bigint | number | null
    session_key?: StringFilter<"RelationshipMemoryJob"> | string
    status?: StringFilter<"RelationshipMemoryJob"> | string
    trigger_reason?: StringFilter<"RelationshipMemoryJob"> | string
    turn_range_start?: BigIntNullableFilter<"RelationshipMemoryJob"> | bigint | number | null
    turn_range_end?: BigIntNullableFilter<"RelationshipMemoryJob"> | bigint | number | null
    ledger_event_count?: IntFilter<"RelationshipMemoryJob"> | number
    input_message_ids?: JsonFilter<"RelationshipMemoryJob">
    output_card_version?: IntNullableFilter<"RelationshipMemoryJob"> | number | null
    error_message?: StringNullableFilter<"RelationshipMemoryJob"> | string | null
    metadata?: JsonNullableFilter<"RelationshipMemoryJob">
    started_at?: DateTimeNullableFilter<"RelationshipMemoryJob"> | Date | string | null
    finished_at?: DateTimeNullableFilter<"RelationshipMemoryJob"> | Date | string | null
    created_at?: DateTimeFilter<"RelationshipMemoryJob"> | Date | string
    updated_at?: DateTimeFilter<"RelationshipMemoryJob"> | Date | string
  }, "id">

  export type RelationshipMemoryJobOrderByWithAggregationInput = {
    id?: SortOrder
    group_id?: SortOrderInput | SortOrder
    session_key?: SortOrder
    status?: SortOrder
    trigger_reason?: SortOrder
    turn_range_start?: SortOrderInput | SortOrder
    turn_range_end?: SortOrderInput | SortOrder
    ledger_event_count?: SortOrder
    input_message_ids?: SortOrder
    output_card_version?: SortOrderInput | SortOrder
    error_message?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    started_at?: SortOrderInput | SortOrder
    finished_at?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: RelationshipMemoryJobCountOrderByAggregateInput
    _avg?: RelationshipMemoryJobAvgOrderByAggregateInput
    _max?: RelationshipMemoryJobMaxOrderByAggregateInput
    _min?: RelationshipMemoryJobMinOrderByAggregateInput
    _sum?: RelationshipMemoryJobSumOrderByAggregateInput
  }

  export type RelationshipMemoryJobScalarWhereWithAggregatesInput = {
    AND?: RelationshipMemoryJobScalarWhereWithAggregatesInput | RelationshipMemoryJobScalarWhereWithAggregatesInput[]
    OR?: RelationshipMemoryJobScalarWhereWithAggregatesInput[]
    NOT?: RelationshipMemoryJobScalarWhereWithAggregatesInput | RelationshipMemoryJobScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"RelationshipMemoryJob"> | bigint | number
    group_id?: BigIntNullableWithAggregatesFilter<"RelationshipMemoryJob"> | bigint | number | null
    session_key?: StringWithAggregatesFilter<"RelationshipMemoryJob"> | string
    status?: StringWithAggregatesFilter<"RelationshipMemoryJob"> | string
    trigger_reason?: StringWithAggregatesFilter<"RelationshipMemoryJob"> | string
    turn_range_start?: BigIntNullableWithAggregatesFilter<"RelationshipMemoryJob"> | bigint | number | null
    turn_range_end?: BigIntNullableWithAggregatesFilter<"RelationshipMemoryJob"> | bigint | number | null
    ledger_event_count?: IntWithAggregatesFilter<"RelationshipMemoryJob"> | number
    input_message_ids?: JsonWithAggregatesFilter<"RelationshipMemoryJob">
    output_card_version?: IntNullableWithAggregatesFilter<"RelationshipMemoryJob"> | number | null
    error_message?: StringNullableWithAggregatesFilter<"RelationshipMemoryJob"> | string | null
    metadata?: JsonNullableWithAggregatesFilter<"RelationshipMemoryJob">
    started_at?: DateTimeNullableWithAggregatesFilter<"RelationshipMemoryJob"> | Date | string | null
    finished_at?: DateTimeNullableWithAggregatesFilter<"RelationshipMemoryJob"> | Date | string | null
    created_at?: DateTimeWithAggregatesFilter<"RelationshipMemoryJob"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"RelationshipMemoryJob"> | Date | string
  }

  export type RelationshipMemoryCardWhereInput = {
    AND?: RelationshipMemoryCardWhereInput | RelationshipMemoryCardWhereInput[]
    OR?: RelationshipMemoryCardWhereInput[]
    NOT?: RelationshipMemoryCardWhereInput | RelationshipMemoryCardWhereInput[]
    id?: BigIntFilter<"RelationshipMemoryCard"> | bigint | number
    card_type?: StringFilter<"RelationshipMemoryCard"> | string
    group_id?: BigIntNullableFilter<"RelationshipMemoryCard"> | bigint | number | null
    target_user_id?: BigIntNullableFilter<"RelationshipMemoryCard"> | bigint | number | null
    version?: IntFilter<"RelationshipMemoryCard"> | number
    is_active?: BoolFilter<"RelationshipMemoryCard"> | boolean
    summary_text?: StringFilter<"RelationshipMemoryCard"> | string
    actors?: JsonFilter<"RelationshipMemoryCard">
    context_before?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    trigger?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    interaction?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    outcome?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    source_event_ids?: JsonFilter<"RelationshipMemoryCard">
    source_message_ids?: JsonFilter<"RelationshipMemoryCard">
    importance_score?: FloatFilter<"RelationshipMemoryCard"> | number
    freshness_score?: FloatFilter<"RelationshipMemoryCard"> | number
    decayed_score?: FloatFilter<"RelationshipMemoryCard"> | number
    retrieval_text?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    embedding_text?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    last_hit_at?: DateTimeNullableFilter<"RelationshipMemoryCard"> | Date | string | null
    metadata?: JsonNullableFilter<"RelationshipMemoryCard">
    created_at?: DateTimeFilter<"RelationshipMemoryCard"> | Date | string
    updated_at?: DateTimeFilter<"RelationshipMemoryCard"> | Date | string
  }

  export type RelationshipMemoryCardOrderByWithRelationInput = {
    id?: SortOrder
    card_type?: SortOrder
    group_id?: SortOrderInput | SortOrder
    target_user_id?: SortOrderInput | SortOrder
    version?: SortOrder
    is_active?: SortOrder
    summary_text?: SortOrder
    actors?: SortOrder
    context_before?: SortOrderInput | SortOrder
    trigger?: SortOrderInput | SortOrder
    interaction?: SortOrderInput | SortOrder
    outcome?: SortOrderInput | SortOrder
    source_event_ids?: SortOrder
    source_message_ids?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
    retrieval_text?: SortOrderInput | SortOrder
    embedding_text?: SortOrderInput | SortOrder
    last_hit_at?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryCardWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: RelationshipMemoryCardWhereInput | RelationshipMemoryCardWhereInput[]
    OR?: RelationshipMemoryCardWhereInput[]
    NOT?: RelationshipMemoryCardWhereInput | RelationshipMemoryCardWhereInput[]
    card_type?: StringFilter<"RelationshipMemoryCard"> | string
    group_id?: BigIntNullableFilter<"RelationshipMemoryCard"> | bigint | number | null
    target_user_id?: BigIntNullableFilter<"RelationshipMemoryCard"> | bigint | number | null
    version?: IntFilter<"RelationshipMemoryCard"> | number
    is_active?: BoolFilter<"RelationshipMemoryCard"> | boolean
    summary_text?: StringFilter<"RelationshipMemoryCard"> | string
    actors?: JsonFilter<"RelationshipMemoryCard">
    context_before?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    trigger?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    interaction?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    outcome?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    source_event_ids?: JsonFilter<"RelationshipMemoryCard">
    source_message_ids?: JsonFilter<"RelationshipMemoryCard">
    importance_score?: FloatFilter<"RelationshipMemoryCard"> | number
    freshness_score?: FloatFilter<"RelationshipMemoryCard"> | number
    decayed_score?: FloatFilter<"RelationshipMemoryCard"> | number
    retrieval_text?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    embedding_text?: StringNullableFilter<"RelationshipMemoryCard"> | string | null
    last_hit_at?: DateTimeNullableFilter<"RelationshipMemoryCard"> | Date | string | null
    metadata?: JsonNullableFilter<"RelationshipMemoryCard">
    created_at?: DateTimeFilter<"RelationshipMemoryCard"> | Date | string
    updated_at?: DateTimeFilter<"RelationshipMemoryCard"> | Date | string
  }, "id">

  export type RelationshipMemoryCardOrderByWithAggregationInput = {
    id?: SortOrder
    card_type?: SortOrder
    group_id?: SortOrderInput | SortOrder
    target_user_id?: SortOrderInput | SortOrder
    version?: SortOrder
    is_active?: SortOrder
    summary_text?: SortOrder
    actors?: SortOrder
    context_before?: SortOrderInput | SortOrder
    trigger?: SortOrderInput | SortOrder
    interaction?: SortOrderInput | SortOrder
    outcome?: SortOrderInput | SortOrder
    source_event_ids?: SortOrder
    source_message_ids?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
    retrieval_text?: SortOrderInput | SortOrder
    embedding_text?: SortOrderInput | SortOrder
    last_hit_at?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: RelationshipMemoryCardCountOrderByAggregateInput
    _avg?: RelationshipMemoryCardAvgOrderByAggregateInput
    _max?: RelationshipMemoryCardMaxOrderByAggregateInput
    _min?: RelationshipMemoryCardMinOrderByAggregateInput
    _sum?: RelationshipMemoryCardSumOrderByAggregateInput
  }

  export type RelationshipMemoryCardScalarWhereWithAggregatesInput = {
    AND?: RelationshipMemoryCardScalarWhereWithAggregatesInput | RelationshipMemoryCardScalarWhereWithAggregatesInput[]
    OR?: RelationshipMemoryCardScalarWhereWithAggregatesInput[]
    NOT?: RelationshipMemoryCardScalarWhereWithAggregatesInput | RelationshipMemoryCardScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"RelationshipMemoryCard"> | bigint | number
    card_type?: StringWithAggregatesFilter<"RelationshipMemoryCard"> | string
    group_id?: BigIntNullableWithAggregatesFilter<"RelationshipMemoryCard"> | bigint | number | null
    target_user_id?: BigIntNullableWithAggregatesFilter<"RelationshipMemoryCard"> | bigint | number | null
    version?: IntWithAggregatesFilter<"RelationshipMemoryCard"> | number
    is_active?: BoolWithAggregatesFilter<"RelationshipMemoryCard"> | boolean
    summary_text?: StringWithAggregatesFilter<"RelationshipMemoryCard"> | string
    actors?: JsonWithAggregatesFilter<"RelationshipMemoryCard">
    context_before?: StringNullableWithAggregatesFilter<"RelationshipMemoryCard"> | string | null
    trigger?: StringNullableWithAggregatesFilter<"RelationshipMemoryCard"> | string | null
    interaction?: StringNullableWithAggregatesFilter<"RelationshipMemoryCard"> | string | null
    outcome?: StringNullableWithAggregatesFilter<"RelationshipMemoryCard"> | string | null
    source_event_ids?: JsonWithAggregatesFilter<"RelationshipMemoryCard">
    source_message_ids?: JsonWithAggregatesFilter<"RelationshipMemoryCard">
    importance_score?: FloatWithAggregatesFilter<"RelationshipMemoryCard"> | number
    freshness_score?: FloatWithAggregatesFilter<"RelationshipMemoryCard"> | number
    decayed_score?: FloatWithAggregatesFilter<"RelationshipMemoryCard"> | number
    retrieval_text?: StringNullableWithAggregatesFilter<"RelationshipMemoryCard"> | string | null
    embedding_text?: StringNullableWithAggregatesFilter<"RelationshipMemoryCard"> | string | null
    last_hit_at?: DateTimeNullableWithAggregatesFilter<"RelationshipMemoryCard"> | Date | string | null
    metadata?: JsonNullableWithAggregatesFilter<"RelationshipMemoryCard">
    created_at?: DateTimeWithAggregatesFilter<"RelationshipMemoryCard"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"RelationshipMemoryCard"> | Date | string
  }

  export type RelationshipMemoryOverrideWhereInput = {
    AND?: RelationshipMemoryOverrideWhereInput | RelationshipMemoryOverrideWhereInput[]
    OR?: RelationshipMemoryOverrideWhereInput[]
    NOT?: RelationshipMemoryOverrideWhereInput | RelationshipMemoryOverrideWhereInput[]
    id?: BigIntFilter<"RelationshipMemoryOverride"> | bigint | number
    card_id?: BigIntFilter<"RelationshipMemoryOverride"> | bigint | number
    action_type?: StringFilter<"RelationshipMemoryOverride"> | string
    manual_note?: StringNullableFilter<"RelationshipMemoryOverride"> | string | null
    created_by?: StringNullableFilter<"RelationshipMemoryOverride"> | string | null
    metadata?: JsonNullableFilter<"RelationshipMemoryOverride">
    created_at?: DateTimeFilter<"RelationshipMemoryOverride"> | Date | string
  }

  export type RelationshipMemoryOverrideOrderByWithRelationInput = {
    id?: SortOrder
    card_id?: SortOrder
    action_type?: SortOrder
    manual_note?: SortOrderInput | SortOrder
    created_by?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    created_at?: SortOrder
  }

  export type RelationshipMemoryOverrideWhereUniqueInput = Prisma.AtLeast<{
    id?: bigint | number
    AND?: RelationshipMemoryOverrideWhereInput | RelationshipMemoryOverrideWhereInput[]
    OR?: RelationshipMemoryOverrideWhereInput[]
    NOT?: RelationshipMemoryOverrideWhereInput | RelationshipMemoryOverrideWhereInput[]
    card_id?: BigIntFilter<"RelationshipMemoryOverride"> | bigint | number
    action_type?: StringFilter<"RelationshipMemoryOverride"> | string
    manual_note?: StringNullableFilter<"RelationshipMemoryOverride"> | string | null
    created_by?: StringNullableFilter<"RelationshipMemoryOverride"> | string | null
    metadata?: JsonNullableFilter<"RelationshipMemoryOverride">
    created_at?: DateTimeFilter<"RelationshipMemoryOverride"> | Date | string
  }, "id">

  export type RelationshipMemoryOverrideOrderByWithAggregationInput = {
    id?: SortOrder
    card_id?: SortOrder
    action_type?: SortOrder
    manual_note?: SortOrderInput | SortOrder
    created_by?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    created_at?: SortOrder
    _count?: RelationshipMemoryOverrideCountOrderByAggregateInput
    _avg?: RelationshipMemoryOverrideAvgOrderByAggregateInput
    _max?: RelationshipMemoryOverrideMaxOrderByAggregateInput
    _min?: RelationshipMemoryOverrideMinOrderByAggregateInput
    _sum?: RelationshipMemoryOverrideSumOrderByAggregateInput
  }

  export type RelationshipMemoryOverrideScalarWhereWithAggregatesInput = {
    AND?: RelationshipMemoryOverrideScalarWhereWithAggregatesInput | RelationshipMemoryOverrideScalarWhereWithAggregatesInput[]
    OR?: RelationshipMemoryOverrideScalarWhereWithAggregatesInput[]
    NOT?: RelationshipMemoryOverrideScalarWhereWithAggregatesInput | RelationshipMemoryOverrideScalarWhereWithAggregatesInput[]
    id?: BigIntWithAggregatesFilter<"RelationshipMemoryOverride"> | bigint | number
    card_id?: BigIntWithAggregatesFilter<"RelationshipMemoryOverride"> | bigint | number
    action_type?: StringWithAggregatesFilter<"RelationshipMemoryOverride"> | string
    manual_note?: StringNullableWithAggregatesFilter<"RelationshipMemoryOverride"> | string | null
    created_by?: StringNullableWithAggregatesFilter<"RelationshipMemoryOverride"> | string | null
    metadata?: JsonNullableWithAggregatesFilter<"RelationshipMemoryOverride">
    created_at?: DateTimeWithAggregatesFilter<"RelationshipMemoryOverride"> | Date | string
  }

  export type GroupChatSettingCreateInput = {
    group_id: bigint | number
    group_name?: string | null
    is_enabled?: number
    continuous_learning_enabled?: number
    auto_reply_enabled?: number
    transcript_compact_offset?: number
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
    continuous_learning_enabled?: number
    auto_reply_enabled?: number
    transcript_compact_offset?: number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: number
    auto_reply_enabled?: number
    transcript_compact_offset?: number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: number
    auto_reply_enabled?: number
    transcript_compact_offset?: number
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
    continuous_learning_enabled?: number
    auto_reply_enabled?: number
    transcript_compact_offset?: number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: number
    auto_reply_enabled?: number
    transcript_compact_offset?: number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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
    continuous_learning_enabled?: IntFieldUpdateOperationsInput | number
    auto_reply_enabled?: IntFieldUpdateOperationsInput | number
    transcript_compact_offset?: IntFieldUpdateOperationsInput | number
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

  export type HttpTrafficLogCreateInput = {
    id?: bigint | number
    request_id?: string | null
    trace_id?: string | null
    conversation_id?: bigint | number | null
    user_id?: string | null
    session_id?: string | null
    agent_turn?: number | null
    llm_call_id?: string | null
    tool_call_id?: string | null
    container_name?: string | null
    service_name?: string | null
    method: string
    url: string
    host: string
    path: string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers: JsonNullValueInput | InputJsonValue
    request_body?: string | null
    request_content_type?: string | null
    request_size?: number | null
    response_status?: number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: string | null
    response_content_type?: string | null
    response_size?: number | null
    duration_ms?: bigint | number | null
    request_timestamp: Date | string
    response_timestamp?: Date | string | null
    is_ai_request?: boolean
    api_type?: string | null
    api_version?: string | null
    client_ip?: string | null
    user_agent?: string | null
    error_message?: string | null
    created_at?: Date | string
  }

  export type HttpTrafficLogUncheckedCreateInput = {
    id?: bigint | number
    request_id?: string | null
    trace_id?: string | null
    conversation_id?: bigint | number | null
    user_id?: string | null
    session_id?: string | null
    agent_turn?: number | null
    llm_call_id?: string | null
    tool_call_id?: string | null
    container_name?: string | null
    service_name?: string | null
    method: string
    url: string
    host: string
    path: string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers: JsonNullValueInput | InputJsonValue
    request_body?: string | null
    request_content_type?: string | null
    request_size?: number | null
    response_status?: number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: string | null
    response_content_type?: string | null
    response_size?: number | null
    duration_ms?: bigint | number | null
    request_timestamp: Date | string
    response_timestamp?: Date | string | null
    is_ai_request?: boolean
    api_type?: string | null
    api_version?: string | null
    client_ip?: string | null
    user_agent?: string | null
    error_message?: string | null
    created_at?: Date | string
  }

  export type HttpTrafficLogUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    request_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    conversation_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    agent_turn?: NullableIntFieldUpdateOperationsInput | number | null
    llm_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    tool_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    container_name?: NullableStringFieldUpdateOperationsInput | string | null
    service_name?: NullableStringFieldUpdateOperationsInput | string | null
    method?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers?: JsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    request_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    request_size?: NullableIntFieldUpdateOperationsInput | number | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    response_size?: NullableIntFieldUpdateOperationsInput | number | null
    duration_ms?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    request_timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    response_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    is_ai_request?: BoolFieldUpdateOperationsInput | boolean
    api_type?: NullableStringFieldUpdateOperationsInput | string | null
    api_version?: NullableStringFieldUpdateOperationsInput | string | null
    client_ip?: NullableStringFieldUpdateOperationsInput | string | null
    user_agent?: NullableStringFieldUpdateOperationsInput | string | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HttpTrafficLogUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    request_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    conversation_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    agent_turn?: NullableIntFieldUpdateOperationsInput | number | null
    llm_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    tool_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    container_name?: NullableStringFieldUpdateOperationsInput | string | null
    service_name?: NullableStringFieldUpdateOperationsInput | string | null
    method?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers?: JsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    request_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    request_size?: NullableIntFieldUpdateOperationsInput | number | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    response_size?: NullableIntFieldUpdateOperationsInput | number | null
    duration_ms?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    request_timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    response_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    is_ai_request?: BoolFieldUpdateOperationsInput | boolean
    api_type?: NullableStringFieldUpdateOperationsInput | string | null
    api_version?: NullableStringFieldUpdateOperationsInput | string | null
    client_ip?: NullableStringFieldUpdateOperationsInput | string | null
    user_agent?: NullableStringFieldUpdateOperationsInput | string | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HttpTrafficLogCreateManyInput = {
    id?: bigint | number
    request_id?: string | null
    trace_id?: string | null
    conversation_id?: bigint | number | null
    user_id?: string | null
    session_id?: string | null
    agent_turn?: number | null
    llm_call_id?: string | null
    tool_call_id?: string | null
    container_name?: string | null
    service_name?: string | null
    method: string
    url: string
    host: string
    path: string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers: JsonNullValueInput | InputJsonValue
    request_body?: string | null
    request_content_type?: string | null
    request_size?: number | null
    response_status?: number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: string | null
    response_content_type?: string | null
    response_size?: number | null
    duration_ms?: bigint | number | null
    request_timestamp: Date | string
    response_timestamp?: Date | string | null
    is_ai_request?: boolean
    api_type?: string | null
    api_version?: string | null
    client_ip?: string | null
    user_agent?: string | null
    error_message?: string | null
    created_at?: Date | string
  }

  export type HttpTrafficLogUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    request_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    conversation_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    agent_turn?: NullableIntFieldUpdateOperationsInput | number | null
    llm_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    tool_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    container_name?: NullableStringFieldUpdateOperationsInput | string | null
    service_name?: NullableStringFieldUpdateOperationsInput | string | null
    method?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers?: JsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    request_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    request_size?: NullableIntFieldUpdateOperationsInput | number | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    response_size?: NullableIntFieldUpdateOperationsInput | number | null
    duration_ms?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    request_timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    response_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    is_ai_request?: BoolFieldUpdateOperationsInput | boolean
    api_type?: NullableStringFieldUpdateOperationsInput | string | null
    api_version?: NullableStringFieldUpdateOperationsInput | string | null
    client_ip?: NullableStringFieldUpdateOperationsInput | string | null
    user_agent?: NullableStringFieldUpdateOperationsInput | string | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type HttpTrafficLogUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    request_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    conversation_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    user_id?: NullableStringFieldUpdateOperationsInput | string | null
    session_id?: NullableStringFieldUpdateOperationsInput | string | null
    agent_turn?: NullableIntFieldUpdateOperationsInput | number | null
    llm_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    tool_call_id?: NullableStringFieldUpdateOperationsInput | string | null
    container_name?: NullableStringFieldUpdateOperationsInput | string | null
    service_name?: NullableStringFieldUpdateOperationsInput | string | null
    method?: StringFieldUpdateOperationsInput | string
    url?: StringFieldUpdateOperationsInput | string
    host?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    query_params?: NullableJsonNullValueInput | InputJsonValue
    request_headers?: JsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    request_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    request_size?: NullableIntFieldUpdateOperationsInput | number | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_content_type?: NullableStringFieldUpdateOperationsInput | string | null
    response_size?: NullableIntFieldUpdateOperationsInput | number | null
    duration_ms?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    request_timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    response_timestamp?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    is_ai_request?: BoolFieldUpdateOperationsInput | boolean
    api_type?: NullableStringFieldUpdateOperationsInput | string | null
    api_version?: NullableStringFieldUpdateOperationsInput | string | null
    client_ip?: NullableStringFieldUpdateOperationsInput | string | null
    user_agent?: NullableStringFieldUpdateOperationsInput | string | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationItemCreateInput = {
    id?: bigint | number
    conversation_id: bigint | number
    session_key?: string | null
    role: string
    phase?: string | null
    content: string
    group_index?: number
    item_index?: number
    source: string
    delivery_message_id?: bigint | number | null
    run_id?: string | null
    trace_id?: string | null
    created_at?: Date | string
  }

  export type ConversationItemUncheckedCreateInput = {
    id?: bigint | number
    conversation_id: bigint | number
    session_key?: string | null
    role: string
    phase?: string | null
    content: string
    group_index?: number
    item_index?: number
    source: string
    delivery_message_id?: bigint | number | null
    run_id?: string | null
    trace_id?: string | null
    created_at?: Date | string
  }

  export type ConversationItemUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    conversation_id?: BigIntFieldUpdateOperationsInput | bigint | number
    session_key?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    phase?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    group_index?: IntFieldUpdateOperationsInput | number
    item_index?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    delivery_message_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    run_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationItemUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    conversation_id?: BigIntFieldUpdateOperationsInput | bigint | number
    session_key?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    phase?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    group_index?: IntFieldUpdateOperationsInput | number
    item_index?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    delivery_message_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    run_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationItemCreateManyInput = {
    id?: bigint | number
    conversation_id: bigint | number
    session_key?: string | null
    role: string
    phase?: string | null
    content: string
    group_index?: number
    item_index?: number
    source: string
    delivery_message_id?: bigint | number | null
    run_id?: string | null
    trace_id?: string | null
    created_at?: Date | string
  }

  export type ConversationItemUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    conversation_id?: BigIntFieldUpdateOperationsInput | bigint | number
    session_key?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    phase?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    group_index?: IntFieldUpdateOperationsInput | number
    item_index?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    delivery_message_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    run_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConversationItemUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    conversation_id?: BigIntFieldUpdateOperationsInput | bigint | number
    session_key?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    phase?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    group_index?: IntFieldUpdateOperationsInput | number
    item_index?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    delivery_message_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    run_id?: NullableStringFieldUpdateOperationsInput | string | null
    trace_id?: NullableStringFieldUpdateOperationsInput | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TrafficReplayHistoryCreateInput = {
    id?: bigint | number
    original_log_id: bigint | number
    replay_name?: string | null
    target_url?: string | null
    request_method?: string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: string | null
    response_status?: number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: string | null
    duration_ms?: number | null
    status?: string
    error_message?: string | null
    replayed_at?: Date | string
    replayed_by?: string | null
    modified_method?: string | null
    modified_url?: string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: string | null
    replay_response_status?: number | null
    replay_duration_ms?: number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: string | null
    replay_response_size?: number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: number | null
    body_size_diff?: number | null
    success?: boolean
    template_id?: number | null
  }

  export type TrafficReplayHistoryUncheckedCreateInput = {
    id?: bigint | number
    original_log_id: bigint | number
    replay_name?: string | null
    target_url?: string | null
    request_method?: string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: string | null
    response_status?: number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: string | null
    duration_ms?: number | null
    status?: string
    error_message?: string | null
    replayed_at?: Date | string
    replayed_by?: string | null
    modified_method?: string | null
    modified_url?: string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: string | null
    replay_response_status?: number | null
    replay_duration_ms?: number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: string | null
    replay_response_size?: number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: number | null
    body_size_diff?: number | null
    success?: boolean
    template_id?: number | null
  }

  export type TrafficReplayHistoryUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    original_log_id?: BigIntFieldUpdateOperationsInput | bigint | number
    replay_name?: NullableStringFieldUpdateOperationsInput | string | null
    target_url?: NullableStringFieldUpdateOperationsInput | string | null
    request_method?: NullableStringFieldUpdateOperationsInput | string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    replayed_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replayed_by?: NullableStringFieldUpdateOperationsInput | string | null
    modified_method?: NullableStringFieldUpdateOperationsInput | string | null
    modified_url?: NullableStringFieldUpdateOperationsInput | string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: NullableStringFieldUpdateOperationsInput | string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_status?: NullableIntFieldUpdateOperationsInput | number | null
    replay_duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_size?: NullableIntFieldUpdateOperationsInput | number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: BoolFieldUpdateOperationsInput | boolean
    response_body_match?: BoolFieldUpdateOperationsInput | boolean
    duration_diff_ms?: NullableIntFieldUpdateOperationsInput | number | null
    body_size_diff?: NullableIntFieldUpdateOperationsInput | number | null
    success?: BoolFieldUpdateOperationsInput | boolean
    template_id?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type TrafficReplayHistoryUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    original_log_id?: BigIntFieldUpdateOperationsInput | bigint | number
    replay_name?: NullableStringFieldUpdateOperationsInput | string | null
    target_url?: NullableStringFieldUpdateOperationsInput | string | null
    request_method?: NullableStringFieldUpdateOperationsInput | string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    replayed_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replayed_by?: NullableStringFieldUpdateOperationsInput | string | null
    modified_method?: NullableStringFieldUpdateOperationsInput | string | null
    modified_url?: NullableStringFieldUpdateOperationsInput | string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: NullableStringFieldUpdateOperationsInput | string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_status?: NullableIntFieldUpdateOperationsInput | number | null
    replay_duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_size?: NullableIntFieldUpdateOperationsInput | number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: BoolFieldUpdateOperationsInput | boolean
    response_body_match?: BoolFieldUpdateOperationsInput | boolean
    duration_diff_ms?: NullableIntFieldUpdateOperationsInput | number | null
    body_size_diff?: NullableIntFieldUpdateOperationsInput | number | null
    success?: BoolFieldUpdateOperationsInput | boolean
    template_id?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type TrafficReplayHistoryCreateManyInput = {
    id?: bigint | number
    original_log_id: bigint | number
    replay_name?: string | null
    target_url?: string | null
    request_method?: string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: string | null
    response_status?: number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: string | null
    duration_ms?: number | null
    status?: string
    error_message?: string | null
    replayed_at?: Date | string
    replayed_by?: string | null
    modified_method?: string | null
    modified_url?: string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: string | null
    replay_response_status?: number | null
    replay_duration_ms?: number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: string | null
    replay_response_size?: number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: boolean
    response_body_match?: boolean
    duration_diff_ms?: number | null
    body_size_diff?: number | null
    success?: boolean
    template_id?: number | null
  }

  export type TrafficReplayHistoryUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    original_log_id?: BigIntFieldUpdateOperationsInput | bigint | number
    replay_name?: NullableStringFieldUpdateOperationsInput | string | null
    target_url?: NullableStringFieldUpdateOperationsInput | string | null
    request_method?: NullableStringFieldUpdateOperationsInput | string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    replayed_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replayed_by?: NullableStringFieldUpdateOperationsInput | string | null
    modified_method?: NullableStringFieldUpdateOperationsInput | string | null
    modified_url?: NullableStringFieldUpdateOperationsInput | string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: NullableStringFieldUpdateOperationsInput | string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_status?: NullableIntFieldUpdateOperationsInput | number | null
    replay_duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_size?: NullableIntFieldUpdateOperationsInput | number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: BoolFieldUpdateOperationsInput | boolean
    response_body_match?: BoolFieldUpdateOperationsInput | boolean
    duration_diff_ms?: NullableIntFieldUpdateOperationsInput | number | null
    body_size_diff?: NullableIntFieldUpdateOperationsInput | number | null
    success?: BoolFieldUpdateOperationsInput | boolean
    template_id?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type TrafficReplayHistoryUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    original_log_id?: BigIntFieldUpdateOperationsInput | bigint | number
    replay_name?: NullableStringFieldUpdateOperationsInput | string | null
    target_url?: NullableStringFieldUpdateOperationsInput | string | null
    request_method?: NullableStringFieldUpdateOperationsInput | string | null
    request_headers?: NullableJsonNullValueInput | InputJsonValue
    request_body?: NullableStringFieldUpdateOperationsInput | string | null
    response_status?: NullableIntFieldUpdateOperationsInput | number | null
    response_headers?: NullableJsonNullValueInput | InputJsonValue
    response_body?: NullableStringFieldUpdateOperationsInput | string | null
    duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    status?: StringFieldUpdateOperationsInput | string
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    replayed_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replayed_by?: NullableStringFieldUpdateOperationsInput | string | null
    modified_method?: NullableStringFieldUpdateOperationsInput | string | null
    modified_url?: NullableStringFieldUpdateOperationsInput | string | null
    modified_headers?: NullableJsonNullValueInput | InputJsonValue
    modified_body?: NullableStringFieldUpdateOperationsInput | string | null
    modification_summary?: NullableJsonNullValueInput | InputJsonValue
    replay_request_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_request_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_status?: NullableIntFieldUpdateOperationsInput | number | null
    replay_duration_ms?: NullableIntFieldUpdateOperationsInput | number | null
    replay_response_headers?: NullableJsonNullValueInput | InputJsonValue
    replay_response_body?: NullableStringFieldUpdateOperationsInput | string | null
    replay_response_size?: NullableIntFieldUpdateOperationsInput | number | null
    diff_summary?: NullableJsonNullValueInput | InputJsonValue
    status_code_match?: BoolFieldUpdateOperationsInput | boolean
    response_body_match?: BoolFieldUpdateOperationsInput | boolean
    duration_diff_ms?: NullableIntFieldUpdateOperationsInput | number | null
    body_size_diff?: NullableIntFieldUpdateOperationsInput | number | null
    success?: BoolFieldUpdateOperationsInput | boolean
    template_id?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type RelationshipLedgerEventCreateInput = {
    id?: bigint | number
    group_id?: bigint | number | null
    target_user_id?: bigint | number | null
    session_key: string
    event_type: string
    event_weight?: number
    confidence?: string
    source_message_ids: JsonNullValueInput | InputJsonValue
    source_excerpt?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
    last_reinforced_at?: Date | string | null
  }

  export type RelationshipLedgerEventUncheckedCreateInput = {
    id?: bigint | number
    group_id?: bigint | number | null
    target_user_id?: bigint | number | null
    session_key: string
    event_type: string
    event_weight?: number
    confidence?: string
    source_message_ids: JsonNullValueInput | InputJsonValue
    source_excerpt?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
    last_reinforced_at?: Date | string | null
  }

  export type RelationshipLedgerEventUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    event_type?: StringFieldUpdateOperationsInput | string
    event_weight?: FloatFieldUpdateOperationsInput | number
    confidence?: StringFieldUpdateOperationsInput | string
    source_message_ids?: JsonNullValueInput | InputJsonValue
    source_excerpt?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    last_reinforced_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type RelationshipLedgerEventUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    event_type?: StringFieldUpdateOperationsInput | string
    event_weight?: FloatFieldUpdateOperationsInput | number
    confidence?: StringFieldUpdateOperationsInput | string
    source_message_ids?: JsonNullValueInput | InputJsonValue
    source_excerpt?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    last_reinforced_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type RelationshipLedgerEventCreateManyInput = {
    id?: bigint | number
    group_id?: bigint | number | null
    target_user_id?: bigint | number | null
    session_key: string
    event_type: string
    event_weight?: number
    confidence?: string
    source_message_ids: JsonNullValueInput | InputJsonValue
    source_excerpt?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
    last_reinforced_at?: Date | string | null
  }

  export type RelationshipLedgerEventUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    event_type?: StringFieldUpdateOperationsInput | string
    event_weight?: FloatFieldUpdateOperationsInput | number
    confidence?: StringFieldUpdateOperationsInput | string
    source_message_ids?: JsonNullValueInput | InputJsonValue
    source_excerpt?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    last_reinforced_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type RelationshipLedgerEventUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    event_type?: StringFieldUpdateOperationsInput | string
    event_weight?: FloatFieldUpdateOperationsInput | number
    confidence?: StringFieldUpdateOperationsInput | string
    source_message_ids?: JsonNullValueInput | InputJsonValue
    source_excerpt?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    last_reinforced_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type RelationshipMemoryJobCreateInput = {
    id?: bigint | number
    group_id?: bigint | number | null
    session_key: string
    status: string
    trigger_reason: string
    turn_range_start?: bigint | number | null
    turn_range_end?: bigint | number | null
    ledger_event_count?: number
    input_message_ids: JsonNullValueInput | InputJsonValue
    output_card_version?: number | null
    error_message?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: Date | string | null
    finished_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type RelationshipMemoryJobUncheckedCreateInput = {
    id?: bigint | number
    group_id?: bigint | number | null
    session_key: string
    status: string
    trigger_reason: string
    turn_range_start?: bigint | number | null
    turn_range_end?: bigint | number | null
    ledger_event_count?: number
    input_message_ids: JsonNullValueInput | InputJsonValue
    output_card_version?: number | null
    error_message?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: Date | string | null
    finished_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type RelationshipMemoryJobUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    trigger_reason?: StringFieldUpdateOperationsInput | string
    turn_range_start?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    turn_range_end?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    ledger_event_count?: IntFieldUpdateOperationsInput | number
    input_message_ids?: JsonNullValueInput | InputJsonValue
    output_card_version?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finished_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryJobUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    trigger_reason?: StringFieldUpdateOperationsInput | string
    turn_range_start?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    turn_range_end?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    ledger_event_count?: IntFieldUpdateOperationsInput | number
    input_message_ids?: JsonNullValueInput | InputJsonValue
    output_card_version?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finished_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryJobCreateManyInput = {
    id?: bigint | number
    group_id?: bigint | number | null
    session_key: string
    status: string
    trigger_reason: string
    turn_range_start?: bigint | number | null
    turn_range_end?: bigint | number | null
    ledger_event_count?: number
    input_message_ids: JsonNullValueInput | InputJsonValue
    output_card_version?: number | null
    error_message?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: Date | string | null
    finished_at?: Date | string | null
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type RelationshipMemoryJobUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    trigger_reason?: StringFieldUpdateOperationsInput | string
    turn_range_start?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    turn_range_end?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    ledger_event_count?: IntFieldUpdateOperationsInput | number
    input_message_ids?: JsonNullValueInput | InputJsonValue
    output_card_version?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finished_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryJobUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    session_key?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    trigger_reason?: StringFieldUpdateOperationsInput | string
    turn_range_start?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    turn_range_end?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    ledger_event_count?: IntFieldUpdateOperationsInput | number
    input_message_ids?: JsonNullValueInput | InputJsonValue
    output_card_version?: NullableIntFieldUpdateOperationsInput | number | null
    error_message?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    started_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    finished_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryCardCreateInput = {
    id?: bigint | number
    card_type: string
    group_id?: bigint | number | null
    target_user_id?: bigint | number | null
    version?: number
    is_active?: boolean
    summary_text: string
    actors: JsonNullValueInput | InputJsonValue
    context_before?: string | null
    trigger?: string | null
    interaction?: string | null
    outcome?: string | null
    source_event_ids: JsonNullValueInput | InputJsonValue
    source_message_ids: JsonNullValueInput | InputJsonValue
    importance_score?: number
    freshness_score?: number
    decayed_score?: number
    retrieval_text?: string | null
    embedding_text?: string | null
    last_hit_at?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type RelationshipMemoryCardUncheckedCreateInput = {
    id?: bigint | number
    card_type: string
    group_id?: bigint | number | null
    target_user_id?: bigint | number | null
    version?: number
    is_active?: boolean
    summary_text: string
    actors: JsonNullValueInput | InputJsonValue
    context_before?: string | null
    trigger?: string | null
    interaction?: string | null
    outcome?: string | null
    source_event_ids: JsonNullValueInput | InputJsonValue
    source_message_ids: JsonNullValueInput | InputJsonValue
    importance_score?: number
    freshness_score?: number
    decayed_score?: number
    retrieval_text?: string | null
    embedding_text?: string | null
    last_hit_at?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type RelationshipMemoryCardUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_type?: StringFieldUpdateOperationsInput | string
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    version?: IntFieldUpdateOperationsInput | number
    is_active?: BoolFieldUpdateOperationsInput | boolean
    summary_text?: StringFieldUpdateOperationsInput | string
    actors?: JsonNullValueInput | InputJsonValue
    context_before?: NullableStringFieldUpdateOperationsInput | string | null
    trigger?: NullableStringFieldUpdateOperationsInput | string | null
    interaction?: NullableStringFieldUpdateOperationsInput | string | null
    outcome?: NullableStringFieldUpdateOperationsInput | string | null
    source_event_ids?: JsonNullValueInput | InputJsonValue
    source_message_ids?: JsonNullValueInput | InputJsonValue
    importance_score?: FloatFieldUpdateOperationsInput | number
    freshness_score?: FloatFieldUpdateOperationsInput | number
    decayed_score?: FloatFieldUpdateOperationsInput | number
    retrieval_text?: NullableStringFieldUpdateOperationsInput | string | null
    embedding_text?: NullableStringFieldUpdateOperationsInput | string | null
    last_hit_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryCardUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_type?: StringFieldUpdateOperationsInput | string
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    version?: IntFieldUpdateOperationsInput | number
    is_active?: BoolFieldUpdateOperationsInput | boolean
    summary_text?: StringFieldUpdateOperationsInput | string
    actors?: JsonNullValueInput | InputJsonValue
    context_before?: NullableStringFieldUpdateOperationsInput | string | null
    trigger?: NullableStringFieldUpdateOperationsInput | string | null
    interaction?: NullableStringFieldUpdateOperationsInput | string | null
    outcome?: NullableStringFieldUpdateOperationsInput | string | null
    source_event_ids?: JsonNullValueInput | InputJsonValue
    source_message_ids?: JsonNullValueInput | InputJsonValue
    importance_score?: FloatFieldUpdateOperationsInput | number
    freshness_score?: FloatFieldUpdateOperationsInput | number
    decayed_score?: FloatFieldUpdateOperationsInput | number
    retrieval_text?: NullableStringFieldUpdateOperationsInput | string | null
    embedding_text?: NullableStringFieldUpdateOperationsInput | string | null
    last_hit_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryCardCreateManyInput = {
    id?: bigint | number
    card_type: string
    group_id?: bigint | number | null
    target_user_id?: bigint | number | null
    version?: number
    is_active?: boolean
    summary_text: string
    actors: JsonNullValueInput | InputJsonValue
    context_before?: string | null
    trigger?: string | null
    interaction?: string | null
    outcome?: string | null
    source_event_ids: JsonNullValueInput | InputJsonValue
    source_message_ids: JsonNullValueInput | InputJsonValue
    importance_score?: number
    freshness_score?: number
    decayed_score?: number
    retrieval_text?: string | null
    embedding_text?: string | null
    last_hit_at?: Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type RelationshipMemoryCardUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_type?: StringFieldUpdateOperationsInput | string
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    version?: IntFieldUpdateOperationsInput | number
    is_active?: BoolFieldUpdateOperationsInput | boolean
    summary_text?: StringFieldUpdateOperationsInput | string
    actors?: JsonNullValueInput | InputJsonValue
    context_before?: NullableStringFieldUpdateOperationsInput | string | null
    trigger?: NullableStringFieldUpdateOperationsInput | string | null
    interaction?: NullableStringFieldUpdateOperationsInput | string | null
    outcome?: NullableStringFieldUpdateOperationsInput | string | null
    source_event_ids?: JsonNullValueInput | InputJsonValue
    source_message_ids?: JsonNullValueInput | InputJsonValue
    importance_score?: FloatFieldUpdateOperationsInput | number
    freshness_score?: FloatFieldUpdateOperationsInput | number
    decayed_score?: FloatFieldUpdateOperationsInput | number
    retrieval_text?: NullableStringFieldUpdateOperationsInput | string | null
    embedding_text?: NullableStringFieldUpdateOperationsInput | string | null
    last_hit_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryCardUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_type?: StringFieldUpdateOperationsInput | string
    group_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    target_user_id?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    version?: IntFieldUpdateOperationsInput | number
    is_active?: BoolFieldUpdateOperationsInput | boolean
    summary_text?: StringFieldUpdateOperationsInput | string
    actors?: JsonNullValueInput | InputJsonValue
    context_before?: NullableStringFieldUpdateOperationsInput | string | null
    trigger?: NullableStringFieldUpdateOperationsInput | string | null
    interaction?: NullableStringFieldUpdateOperationsInput | string | null
    outcome?: NullableStringFieldUpdateOperationsInput | string | null
    source_event_ids?: JsonNullValueInput | InputJsonValue
    source_message_ids?: JsonNullValueInput | InputJsonValue
    importance_score?: FloatFieldUpdateOperationsInput | number
    freshness_score?: FloatFieldUpdateOperationsInput | number
    decayed_score?: FloatFieldUpdateOperationsInput | number
    retrieval_text?: NullableStringFieldUpdateOperationsInput | string | null
    embedding_text?: NullableStringFieldUpdateOperationsInput | string | null
    last_hit_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryOverrideCreateInput = {
    id?: bigint | number
    card_id: bigint | number
    action_type: string
    manual_note?: string | null
    created_by?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
  }

  export type RelationshipMemoryOverrideUncheckedCreateInput = {
    id?: bigint | number
    card_id: bigint | number
    action_type: string
    manual_note?: string | null
    created_by?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
  }

  export type RelationshipMemoryOverrideUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_id?: BigIntFieldUpdateOperationsInput | bigint | number
    action_type?: StringFieldUpdateOperationsInput | string
    manual_note?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryOverrideUncheckedUpdateInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_id?: BigIntFieldUpdateOperationsInput | bigint | number
    action_type?: StringFieldUpdateOperationsInput | string
    manual_note?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryOverrideCreateManyInput = {
    id?: bigint | number
    card_id: bigint | number
    action_type: string
    manual_note?: string | null
    created_by?: string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: Date | string
  }

  export type RelationshipMemoryOverrideUpdateManyMutationInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_id?: BigIntFieldUpdateOperationsInput | bigint | number
    action_type?: StringFieldUpdateOperationsInput | string
    manual_note?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RelationshipMemoryOverrideUncheckedUpdateManyInput = {
    id?: BigIntFieldUpdateOperationsInput | bigint | number
    card_id?: BigIntFieldUpdateOperationsInput | bigint | number
    action_type?: StringFieldUpdateOperationsInput | string
    manual_note?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableJsonNullValueInput | InputJsonValue
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
    admin_user_id?: SortOrder
  }

  export type GroupChatSettingMaxOrderByAggregateInput = {
    group_id?: SortOrder
    group_name?: SortOrder
    is_enabled?: SortOrder
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
  }

  export type PrivateChatSettingMaxOrderByAggregateInput = {
    user_id?: SortOrder
    username?: SortOrder
    is_enabled?: SortOrder
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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
    continuous_learning_enabled?: SortOrder
    auto_reply_enabled?: SortOrder
    transcript_compact_offset?: SortOrder
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

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }
  export type JsonNullableFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
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

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type HttpTrafficLogCountOrderByAggregateInput = {
    id?: SortOrder
    request_id?: SortOrder
    trace_id?: SortOrder
    conversation_id?: SortOrder
    user_id?: SortOrder
    session_id?: SortOrder
    agent_turn?: SortOrder
    llm_call_id?: SortOrder
    tool_call_id?: SortOrder
    container_name?: SortOrder
    service_name?: SortOrder
    method?: SortOrder
    url?: SortOrder
    host?: SortOrder
    path?: SortOrder
    query_params?: SortOrder
    request_headers?: SortOrder
    request_body?: SortOrder
    request_content_type?: SortOrder
    request_size?: SortOrder
    response_status?: SortOrder
    response_headers?: SortOrder
    response_body?: SortOrder
    response_content_type?: SortOrder
    response_size?: SortOrder
    duration_ms?: SortOrder
    request_timestamp?: SortOrder
    response_timestamp?: SortOrder
    is_ai_request?: SortOrder
    api_type?: SortOrder
    api_version?: SortOrder
    client_ip?: SortOrder
    user_agent?: SortOrder
    error_message?: SortOrder
    created_at?: SortOrder
  }

  export type HttpTrafficLogAvgOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    agent_turn?: SortOrder
    request_size?: SortOrder
    response_status?: SortOrder
    response_size?: SortOrder
    duration_ms?: SortOrder
  }

  export type HttpTrafficLogMaxOrderByAggregateInput = {
    id?: SortOrder
    request_id?: SortOrder
    trace_id?: SortOrder
    conversation_id?: SortOrder
    user_id?: SortOrder
    session_id?: SortOrder
    agent_turn?: SortOrder
    llm_call_id?: SortOrder
    tool_call_id?: SortOrder
    container_name?: SortOrder
    service_name?: SortOrder
    method?: SortOrder
    url?: SortOrder
    host?: SortOrder
    path?: SortOrder
    request_body?: SortOrder
    request_content_type?: SortOrder
    request_size?: SortOrder
    response_status?: SortOrder
    response_body?: SortOrder
    response_content_type?: SortOrder
    response_size?: SortOrder
    duration_ms?: SortOrder
    request_timestamp?: SortOrder
    response_timestamp?: SortOrder
    is_ai_request?: SortOrder
    api_type?: SortOrder
    api_version?: SortOrder
    client_ip?: SortOrder
    user_agent?: SortOrder
    error_message?: SortOrder
    created_at?: SortOrder
  }

  export type HttpTrafficLogMinOrderByAggregateInput = {
    id?: SortOrder
    request_id?: SortOrder
    trace_id?: SortOrder
    conversation_id?: SortOrder
    user_id?: SortOrder
    session_id?: SortOrder
    agent_turn?: SortOrder
    llm_call_id?: SortOrder
    tool_call_id?: SortOrder
    container_name?: SortOrder
    service_name?: SortOrder
    method?: SortOrder
    url?: SortOrder
    host?: SortOrder
    path?: SortOrder
    request_body?: SortOrder
    request_content_type?: SortOrder
    request_size?: SortOrder
    response_status?: SortOrder
    response_body?: SortOrder
    response_content_type?: SortOrder
    response_size?: SortOrder
    duration_ms?: SortOrder
    request_timestamp?: SortOrder
    response_timestamp?: SortOrder
    is_ai_request?: SortOrder
    api_type?: SortOrder
    api_version?: SortOrder
    client_ip?: SortOrder
    user_agent?: SortOrder
    error_message?: SortOrder
    created_at?: SortOrder
  }

  export type HttpTrafficLogSumOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    agent_turn?: SortOrder
    request_size?: SortOrder
    response_status?: SortOrder
    response_size?: SortOrder
    duration_ms?: SortOrder
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
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
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type ConversationItemCountOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    session_key?: SortOrder
    role?: SortOrder
    phase?: SortOrder
    content?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    source?: SortOrder
    delivery_message_id?: SortOrder
    run_id?: SortOrder
    trace_id?: SortOrder
    created_at?: SortOrder
  }

  export type ConversationItemAvgOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    delivery_message_id?: SortOrder
  }

  export type ConversationItemMaxOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    session_key?: SortOrder
    role?: SortOrder
    phase?: SortOrder
    content?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    source?: SortOrder
    delivery_message_id?: SortOrder
    run_id?: SortOrder
    trace_id?: SortOrder
    created_at?: SortOrder
  }

  export type ConversationItemMinOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    session_key?: SortOrder
    role?: SortOrder
    phase?: SortOrder
    content?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    source?: SortOrder
    delivery_message_id?: SortOrder
    run_id?: SortOrder
    trace_id?: SortOrder
    created_at?: SortOrder
  }

  export type ConversationItemSumOrderByAggregateInput = {
    id?: SortOrder
    conversation_id?: SortOrder
    group_index?: SortOrder
    item_index?: SortOrder
    delivery_message_id?: SortOrder
  }

  export type TrafficReplayHistoryCountOrderByAggregateInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    replay_name?: SortOrder
    target_url?: SortOrder
    request_method?: SortOrder
    request_headers?: SortOrder
    request_body?: SortOrder
    response_status?: SortOrder
    response_headers?: SortOrder
    response_body?: SortOrder
    duration_ms?: SortOrder
    status?: SortOrder
    error_message?: SortOrder
    replayed_at?: SortOrder
    replayed_by?: SortOrder
    modified_method?: SortOrder
    modified_url?: SortOrder
    modified_headers?: SortOrder
    modified_body?: SortOrder
    modification_summary?: SortOrder
    replay_request_headers?: SortOrder
    replay_request_body?: SortOrder
    replay_response_status?: SortOrder
    replay_duration_ms?: SortOrder
    replay_response_headers?: SortOrder
    replay_response_body?: SortOrder
    replay_response_size?: SortOrder
    diff_summary?: SortOrder
    status_code_match?: SortOrder
    response_body_match?: SortOrder
    duration_diff_ms?: SortOrder
    body_size_diff?: SortOrder
    success?: SortOrder
    template_id?: SortOrder
  }

  export type TrafficReplayHistoryAvgOrderByAggregateInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    response_status?: SortOrder
    duration_ms?: SortOrder
    replay_response_status?: SortOrder
    replay_duration_ms?: SortOrder
    replay_response_size?: SortOrder
    duration_diff_ms?: SortOrder
    body_size_diff?: SortOrder
    template_id?: SortOrder
  }

  export type TrafficReplayHistoryMaxOrderByAggregateInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    replay_name?: SortOrder
    target_url?: SortOrder
    request_method?: SortOrder
    request_body?: SortOrder
    response_status?: SortOrder
    response_body?: SortOrder
    duration_ms?: SortOrder
    status?: SortOrder
    error_message?: SortOrder
    replayed_at?: SortOrder
    replayed_by?: SortOrder
    modified_method?: SortOrder
    modified_url?: SortOrder
    modified_body?: SortOrder
    replay_request_body?: SortOrder
    replay_response_status?: SortOrder
    replay_duration_ms?: SortOrder
    replay_response_body?: SortOrder
    replay_response_size?: SortOrder
    status_code_match?: SortOrder
    response_body_match?: SortOrder
    duration_diff_ms?: SortOrder
    body_size_diff?: SortOrder
    success?: SortOrder
    template_id?: SortOrder
  }

  export type TrafficReplayHistoryMinOrderByAggregateInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    replay_name?: SortOrder
    target_url?: SortOrder
    request_method?: SortOrder
    request_body?: SortOrder
    response_status?: SortOrder
    response_body?: SortOrder
    duration_ms?: SortOrder
    status?: SortOrder
    error_message?: SortOrder
    replayed_at?: SortOrder
    replayed_by?: SortOrder
    modified_method?: SortOrder
    modified_url?: SortOrder
    modified_body?: SortOrder
    replay_request_body?: SortOrder
    replay_response_status?: SortOrder
    replay_duration_ms?: SortOrder
    replay_response_body?: SortOrder
    replay_response_size?: SortOrder
    status_code_match?: SortOrder
    response_body_match?: SortOrder
    duration_diff_ms?: SortOrder
    body_size_diff?: SortOrder
    success?: SortOrder
    template_id?: SortOrder
  }

  export type TrafficReplayHistorySumOrderByAggregateInput = {
    id?: SortOrder
    original_log_id?: SortOrder
    response_status?: SortOrder
    duration_ms?: SortOrder
    replay_response_status?: SortOrder
    replay_duration_ms?: SortOrder
    replay_response_size?: SortOrder
    duration_diff_ms?: SortOrder
    body_size_diff?: SortOrder
    template_id?: SortOrder
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type RelationshipLedgerEventCountOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    session_key?: SortOrder
    event_type?: SortOrder
    event_weight?: SortOrder
    confidence?: SortOrder
    source_message_ids?: SortOrder
    source_excerpt?: SortOrder
    metadata?: SortOrder
    created_at?: SortOrder
    last_reinforced_at?: SortOrder
  }

  export type RelationshipLedgerEventAvgOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    event_weight?: SortOrder
  }

  export type RelationshipLedgerEventMaxOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    session_key?: SortOrder
    event_type?: SortOrder
    event_weight?: SortOrder
    confidence?: SortOrder
    source_excerpt?: SortOrder
    created_at?: SortOrder
    last_reinforced_at?: SortOrder
  }

  export type RelationshipLedgerEventMinOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    session_key?: SortOrder
    event_type?: SortOrder
    event_weight?: SortOrder
    confidence?: SortOrder
    source_excerpt?: SortOrder
    created_at?: SortOrder
    last_reinforced_at?: SortOrder
  }

  export type RelationshipLedgerEventSumOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    event_weight?: SortOrder
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type RelationshipMemoryJobCountOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    session_key?: SortOrder
    status?: SortOrder
    trigger_reason?: SortOrder
    turn_range_start?: SortOrder
    turn_range_end?: SortOrder
    ledger_event_count?: SortOrder
    input_message_ids?: SortOrder
    output_card_version?: SortOrder
    error_message?: SortOrder
    metadata?: SortOrder
    started_at?: SortOrder
    finished_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryJobAvgOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    turn_range_start?: SortOrder
    turn_range_end?: SortOrder
    ledger_event_count?: SortOrder
    output_card_version?: SortOrder
  }

  export type RelationshipMemoryJobMaxOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    session_key?: SortOrder
    status?: SortOrder
    trigger_reason?: SortOrder
    turn_range_start?: SortOrder
    turn_range_end?: SortOrder
    ledger_event_count?: SortOrder
    output_card_version?: SortOrder
    error_message?: SortOrder
    started_at?: SortOrder
    finished_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryJobMinOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    session_key?: SortOrder
    status?: SortOrder
    trigger_reason?: SortOrder
    turn_range_start?: SortOrder
    turn_range_end?: SortOrder
    ledger_event_count?: SortOrder
    output_card_version?: SortOrder
    error_message?: SortOrder
    started_at?: SortOrder
    finished_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryJobSumOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    turn_range_start?: SortOrder
    turn_range_end?: SortOrder
    ledger_event_count?: SortOrder
    output_card_version?: SortOrder
  }

  export type RelationshipMemoryCardCountOrderByAggregateInput = {
    id?: SortOrder
    card_type?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    version?: SortOrder
    is_active?: SortOrder
    summary_text?: SortOrder
    actors?: SortOrder
    context_before?: SortOrder
    trigger?: SortOrder
    interaction?: SortOrder
    outcome?: SortOrder
    source_event_ids?: SortOrder
    source_message_ids?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
    retrieval_text?: SortOrder
    embedding_text?: SortOrder
    last_hit_at?: SortOrder
    metadata?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryCardAvgOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    version?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
  }

  export type RelationshipMemoryCardMaxOrderByAggregateInput = {
    id?: SortOrder
    card_type?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    version?: SortOrder
    is_active?: SortOrder
    summary_text?: SortOrder
    context_before?: SortOrder
    trigger?: SortOrder
    interaction?: SortOrder
    outcome?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
    retrieval_text?: SortOrder
    embedding_text?: SortOrder
    last_hit_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryCardMinOrderByAggregateInput = {
    id?: SortOrder
    card_type?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    version?: SortOrder
    is_active?: SortOrder
    summary_text?: SortOrder
    context_before?: SortOrder
    trigger?: SortOrder
    interaction?: SortOrder
    outcome?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
    retrieval_text?: SortOrder
    embedding_text?: SortOrder
    last_hit_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type RelationshipMemoryCardSumOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    target_user_id?: SortOrder
    version?: SortOrder
    importance_score?: SortOrder
    freshness_score?: SortOrder
    decayed_score?: SortOrder
  }

  export type RelationshipMemoryOverrideCountOrderByAggregateInput = {
    id?: SortOrder
    card_id?: SortOrder
    action_type?: SortOrder
    manual_note?: SortOrder
    created_by?: SortOrder
    metadata?: SortOrder
    created_at?: SortOrder
  }

  export type RelationshipMemoryOverrideAvgOrderByAggregateInput = {
    id?: SortOrder
    card_id?: SortOrder
  }

  export type RelationshipMemoryOverrideMaxOrderByAggregateInput = {
    id?: SortOrder
    card_id?: SortOrder
    action_type?: SortOrder
    manual_note?: SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
  }

  export type RelationshipMemoryOverrideMinOrderByAggregateInput = {
    id?: SortOrder
    card_id?: SortOrder
    action_type?: SortOrder
    manual_note?: SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
  }

  export type RelationshipMemoryOverrideSumOrderByAggregateInput = {
    id?: SortOrder
    card_id?: SortOrder
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

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
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

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
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

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
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