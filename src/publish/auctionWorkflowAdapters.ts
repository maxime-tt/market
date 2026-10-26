/**
 * Shim — the auction workflow host adapters moved to
 * `platform/web/auctions/auctionWorkflowAdapters.ts` (store drain D2, slice 6).
 *
 * These are pure host boundaries over the SDK auction workflows — no NDK client, no signer
 * singleton, no src import — so the Platform copy needs no `platform -> src` edge. Vacated
 * path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/auctions/auctionWorkflowAdapters'
