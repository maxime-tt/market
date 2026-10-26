/**
 * src/lib/wallet/nip60WalletEvent.ts — the shim: `src/`'s view of the SDK NIP-60 wallet-event module.
 *
 * Reading a NIP-60 wallet event's decrypted content and the never-choose-a-key rule
 * (`parseNip60WalletEventContent`, `selectWalletKeyPair`, `Nip60WalletEventError` and the content /
 * candidate types) moved to `@sdk/commerce/payments/wallet/nip60WalletEvent` as part of the
 * `src/lib/wallet/` drain (increment B4b, stage 1). Every existing call site keeps importing
 * `@/lib/wallet/nip60WalletEvent` (and the `@/lib/wallet` barrel re-exports it) unchanged: the
 * module is pure parsing functions and types, so a plain `export *` re-exports the whole surface
 * and no adapter is needed.
 */
export * from '@sdk/commerce/payments/wallet/nip60WalletEvent'
