/**
 * src/lib/terms.ts — the shim: `src/`'s view of the app-level terms-acceptance concern
 * (Wave F slice W-E5a). The implementation moved to `platform/web/app/terms.ts`; existing
 * call sites (the terms dialog, the login dialog, `src/lib/stores/auth.ts`) keep importing
 * this path unchanged. Deleted in E1b once the last `src/` importer retires.
 */
export * from '@platform/web/app/terms'
