/**
 * platform/web/notifications/index.ts — the app's notifications configuration, in one import.
 *
 * The vocabulary (`types`), the modal policy (`modalPolicy`), the rules (`rules`), the instance (`instance`)
 * and the React binding (`binding`). This slice is additive: nothing consumes it yet, and no existing store or
 * consumer is rewired. The rewire slice imports from here.
 */
export * from './types'
export * from './modalPolicy'
export * from './rules'
export * from './instance'
export * from './binding'
