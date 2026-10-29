/**
 * src/lib/stores/auth.ts — the shim: `src/`'s view of the auth composition root (Wave F slice W-E5b).
 *
 * The machine, the storage port, the lazy signer session and every cross-store effect moved to
 * `platform/web/auth/authStore.ts`; the `@tanstack/store` bridge there stays bidirectional, so the
 * eleven test files that call `authStore.setState(...)` and the 36 `src/` importers keep working
 * unchanged. Deleted in E1b once the last `src/` importer retires.
 */
export * from '@platform/web/auth/authStore'
