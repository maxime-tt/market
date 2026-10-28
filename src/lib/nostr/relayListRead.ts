/**
 * src/lib/nostr/relayListRead.ts — the shim: the NDK relay-list adapter moved to
 * `platform/web/relays/relayListNdkRead.ts` (Wave C, ndk drain S2); the name is distinct because the pure
 * `sdk/core/relays/relayListRead.ts` already exists. Deleted in E1b.
 */
export * from '@platform/web/relays/relayListNdkRead'
