/**
 * src/lib/instance-config.ts — the shim: `src/`'s view of the SDK instance-config module.
 *
 * The instance-config substrate (the `InstanceConfig`/`PublicAppConfig` shapes, `DEFAULT_INSTANCE_CONFIG`,
 * the environment parser/resolver and `resolveHandlerIdChain`) moved to `@sdk/config/instance-config` as part
 * of the app-config substrate move (increment B1e). Every existing call site keeps importing
 * `@/lib/instance-config` unchanged.
 *
 * The module is pure data, types and functions, so a plain `export *` re-exports the whole surface and no
 * adapter is needed — every consumer imports named values and types (`resolveInstanceConfig`,
 * `parseInstanceConfigEnvironment`, `DEFAULT_INSTANCE_CONFIG`, `resolveHandlerIdChain`, `type PublicAppConfig`,
 * …), never a store or a callable object. Inside the SDK the module now imports `../core` (the SDK root) rather
 * than `@sdk/core`, so it stays inside the SDK boundary.
 */
export * from '@sdk/config/instance-config'
