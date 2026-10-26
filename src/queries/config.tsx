/**
 * Shim — the public app-config read binding moved to `platform/web/config/publicConfigQuery.ts`
 * (store drain D1, slice 1).
 *
 * The framework-free envelope validation stays in `sdk/core/publicConfig`
 * (`parsePublicConfigEnvelope`); the `/api/config` fetch, the `getConfig` memory and the
 * `useConfigQuery` hook live in the Platform config feature. The binding import is the only
 * `src -> platform` edge this shim owns; it imports no `@/lib/stores/ndk`. Vacated path kept
 * as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/config/publicConfigQuery'
