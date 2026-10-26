/**
 * Shim — the ContextVM currency client moved to
 * `sdk/commerce/payments/ctxcnClient.ts` (store drain D1, slice 4).
 *
 * The client is framework-free relay I/O (`nostr-tools` + `SimplePool`), so it belongs in the SDK
 * payments area next to `exchangeRates.ts`. The Platform exchange-rates binding imports the SDK path
 * directly; the `src/` path is kept as a re-export so the existing `src/lib/__tests__/contextvm-client*`
 * suites keep working. Deleted in E1.
 */
export * from '@sdk/commerce/payments/ctxcnClient'
