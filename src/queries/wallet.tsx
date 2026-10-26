/**
 * Shim — the NWC wallet read binding moved to `platform/web/wallet/walletQuery.ts`
 * (store drain D1, slice 4).
 *
 * The framework-free reads (`readNwcWalletsWorkflow`, `readNwcBalanceWorkflow`) live in
 * `sdk/commerce/payments/wallet/nwcWalletRead.ts`; the React binding resolves the ports from
 * `platform/web/ndkPublishContext.ts` (relay fetch, signer) and `@sdk/config/wallet`
 * (`getOrCreateNwcClient`) instead of `@/lib/stores/ndk`. `src/lib/wallet/nwcWalletRead.ts` stays as the
 * adapter `src/lib/stores/ndk.ts` calls. Vacated path kept as a re-export so no call site breaks;
 * deleted in E1.
 */
export * from '@platform/web/wallet/walletQuery'
