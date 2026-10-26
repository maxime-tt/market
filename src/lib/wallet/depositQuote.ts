/**
 * src/lib/wallet/depositQuote.ts — the shim: `src/`'s view of the SDK coco deposit-quote module.
 *
 * The deposit lifecycle over coco's mint-quote events (`createCocoDepositQuote`, the
 * `CocoDepositManager`/`CocoMintQuoteManager` contracts, `toCocoDepositManager`, the state and
 * option types, and the confirmation-timeout constants) moved to
 * `@sdk/commerce/payments/wallet/depositQuote` as part of the `src/lib/wallet/` drain (increment
 * B4b, stage 1). Every existing call site keeps importing `@/lib/wallet/depositQuote` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: the module is pure functions and types with an
 * injected coco manager, so a plain `export *` re-exports the whole surface and no adapter is
 * needed.
 */
export * from '@sdk/commerce/payments/wallet/depositQuote'
