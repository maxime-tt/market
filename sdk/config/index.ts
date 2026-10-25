/**
 * sdk/config/index.ts — the app's configuration modules that live in the SDK, in one import.
 *
 * `blacklist` is the first: the blacklist state and actions, rebuilt on `sdk/core/state`, which the src/
 * drain repoints `src/lib/stores/blacklist.ts` onto. More configuration modules move here as the drain
 * proceeds.
 */
export * from './blacklist'
