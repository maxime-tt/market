/**
 * src/lib/wallet/proofs.ts — the shim: `src/`'s view of the SDK cashu proof-source module.
 *
 * The proof extractors (`extractProofsByMint`, `getProofsForMint`, `getSpendableProofsForMint`)
 * and the `WalletProofSource` shape moved to `@sdk/commerce/payments/wallet/proofs` as part of
 * the `src/lib/wallet/` drain (increment B4b, stage 1). Every existing call site keeps importing
 * `@/lib/wallet/proofs` (and the `@/lib/wallet` barrel re-exports it) unchanged: the module is
 * pure functions and types, so a plain `export *` re-exports the whole surface and no adapter is
 * needed.
 */
export * from '@sdk/commerce/payments/wallet/proofs'
