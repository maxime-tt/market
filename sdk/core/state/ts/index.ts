/**
 * state/ts/index.ts — the entry: the factory, the refusal and the vocabulary.
 *
 * The primitive is domain-free: `T` is the host's own state shape, the storage key is the host's, and no
 * feature name appears here. The host supplies the state and (optionally) the port and key; this module
 * supplies only the mechanism those are configured against.
 */
export { createStateStore } from './state'
export { StateError } from './errors'
export type { PersistentStateStore, StateStore, StateStoreOptions } from './types'
