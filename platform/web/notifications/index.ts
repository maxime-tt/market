/**
 * platform/web/notifications/index.ts — the app's notifications configuration, in one import.
 *
 * The vocabulary (`types`), the modal policy (`modalPolicy`), the rules (`rules`), the instance (`instance`),
 * the typed ledger reads (`reads`), the auction-win operations (`auctionWin`) and the React binding (`binding`).
 *
 * The auction-win flow is already wired through this barrel (`useAuctionWinMonitor`, `AuctionWonModal`,
 * `auth.logout`); the remaining consumers of the legacy notification store are rewired next, and this barrel
 * is what they import from.
 */
export * from './types'
export * from './modalPolicy'
export * from './rules'
export * from './producers'
export * from './auctionWin'
export * from './reads'
export * from './instance'
export * from './binding'
