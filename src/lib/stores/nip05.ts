/**
 * src/lib/stores/nip05.ts — the shim: `src/`'s view of the SDK NIP-05 module.
 *
 * The NIP-05 state and actions moved to `@sdk/config/nip05` (rebuilt on `sdk/core/state`). Every existing call
 * site keeps importing `@/lib/stores/nip05` unchanged: it only imports `nip05Actions`
 * (`platform/web/app/useNip05Sync.ts:1`, `platform/web/routes/_dashboard-layout/dashboard/account/nostr-address.tsx:14`),
 * which the `export *` below re-exports from the SDK module. The source module exported no React accessor and
 * no consumer reads a `Store`, so no temporary adapter is needed here.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The reactive binding therefore lives in
 * the platform layer next to the state it renders, not in this shim
 * (`platform/web/config/nip05Binding.ts`); consumers migrate to it lazily.
 */
export * from '@sdk/config/nip05'
