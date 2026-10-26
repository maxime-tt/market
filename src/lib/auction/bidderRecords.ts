/**
 * src/lib/auction/bidderRecords.ts — the shim: `src/`'s view of the SDK bidder-record store.
 *
 * The bidder-side persistent record store (`BidderBidRecord`, `loadBidderRecords`,
 * `upsertBidderRecord`, the pre-lock recovery records, …) moved to
 * `@sdk/commerce/auctions/bidderRecords` as part of the `src/lib/wallet/` drain (increment B4d).
 * It is auction-domain, so it lands with its auction siblings rather than in the wallet subtree.
 * Every existing call site keeps importing `@/lib/auction/bidderRecords` unchanged: the module is
 * pure functions and types over the user-scoped storage, so a plain `export *` re-exports the
 * whole surface and no adapter is needed.
 */
export * from '@sdk/commerce/auctions/bidderRecords'
