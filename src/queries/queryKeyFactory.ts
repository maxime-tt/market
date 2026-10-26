/**
 * Shim — the query-key module moved to `sdk/core/query/queryKeyFactory.ts`
 * (store drain D2 enabler).
 *
 * The module is pure key builders with no imports, so it lives in the
 * framework-free SDK and both the read models (sdk) and the react-query
 * bindings (platform) can reach it without a `platform -> src` edge.
 * Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@sdk/core/query/queryKeyFactory'
