/**
 * sdk/config/index.ts — the app's configuration modules that live in the SDK, in one import.
 *
 * `blacklist` was the first: the blacklist state and actions, rebuilt on `sdk/core/state`, which the src/
 * drain repoints `src/lib/stores/blacklist.ts` onto. `test-labels`, `vanity` and `nip05` follow the same
 * pattern. More configuration modules move here as the drain proceeds.
 *
 * These modules are deliberately NOT re-exported from `sdk/index.ts`: `vanity` exports `VanityEntry` and
 * `nip05` exports `Nip05Entry`, names already reached through `sdk/commerce` (`VanityEntry`) and
 * `sdk/core/profile` (`Nip05Entry`) by the barrel's `export *` chains. Two `export *` chains reaching one
 * name make TypeScript silently drop it, so a consumer importing it from `@sdk` would break confusingly. A
 * consumer takes these by explicit path — `@sdk/config/vanity` — which is how `blacklist` is already used.
 */
export * from './blacklist'
export * from './nip05'
export * from './test-labels'
export * from './vanity'
