/**
 * src/lib/wallet/walletKeys.ts — the shim: `src/`'s view of the SDK cashu-wallet module.
 *
 * the wallet P2PK keypair and the auction HD derivation over it (`WalletKeyMaterial`, `WalletKeyStore`, `normalizeWalletKeyMaterial`, `loadWalletKeyMaterial`, `deriveAuctionHdXpub`, `deriveAuctionChildPrivkey`, `InMemoryWalletKeyStore`) moved to
 * `@sdk/commerce/payments/wallet/walletKeys` as part of the `src/lib/wallet/` drain (increment B4b,
 * stage 2). Every existing call site keeps importing `@/lib/wallet/walletKeys` (and the
 * `@/lib/wallet` barrel re-exports it) unchanged: a plain `export *` re-exports the whole
 * surface and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/walletKeys'
