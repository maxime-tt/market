/**
 * src/lib/schemas/app.ts — the shim: `src/`'s view of the SDK app-settings schema module.
 *
 * The app-settings zod schemas (`AppSettingsSchema`, `SocialLinksSchema`, `ExtendedSettingsSchema` and the
 * shared URL schemas, plus their inferred types) moved to `@sdk/config/schemas/app` as part of the app-config
 * substrate move (increment B1e). Every existing call site keeps importing `@/lib/schemas/app` unchanged: the
 * module is pure zod schemas and types, so a plain `export *` re-exports the whole surface and no adapter is
 * needed — every consumer imports named values and types, never a store or a callable object.
 *
 * `instance-config`, now also in the SDK, resolves `./schemas/app` by relative path, so both the schema module
 * and this shim point at the same single definition.
 */
export * from '@sdk/config/schemas/app'
