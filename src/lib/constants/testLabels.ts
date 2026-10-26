/**
 * Shim — the NIP-32 test-label protocol constants moved to `sdk/config/test-label-constants.ts`
 * (store drain D1, slice 3), so the framework-free test-label read can share them.
 *
 * Every named export is unchanged (`LABEL_EVENT_KIND`, `LABEL_NAMESPACE`, `A_TAG`, …), so no call
 * site breaks. Deleted in E1 together with the rest of the `src/` shims.
 *
 * The authoritative doc for the design lives on the SDK module:
 * docs/adr/ADR-0009-test-listing-labels-via-nip-32.md.
 */
export * from '@sdk/config/test-label-constants'
