/**
 * Shim — the payment publish binding moved to
 * `platform/web/payments/paymentPublish.ts` (store drain D2, slice 14).
 *
 * The binding resolves the NDK client, signer and publish action through the Platform
 * publish bridge, the app public key through the Platform app-config binding, the NWC URI
 * parser through the framework-free SDK and the preimage validator through
 * `@sdk/commerce/payments/preimage` instead of `@/lib/stores/ndk`, `@/lib/stores/config`,
 * `@platform/web/config/walletStore` and the moved `platform/web/payments/paymentMethods` — so a Platform host module
 * consumes it without a counted `platform -> src` edge. Vacated path kept as a re-export so
 * no call site breaks; deleted in E1.
 */
export * from '@platform/web/payments/paymentPublish'
