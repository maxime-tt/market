/**
 * Shim — the admin/editor settings read binding moved to
 * `platform/web/app-settings/appSettingsQuery.ts` (store drain D1, slice 5).
 *
 * The framework-free reads (`readAdminSettingsWorkflow` / `readEditorSettingsWorkflow`) and the parsers
 * live in `@sdk/commerce/curation`; the React binding owns the hooks, the live list subscriptions and the
 * port resolution from `platform/web/ndkReadContext.ts`. Vacated path kept as a re-export so no call site
 * breaks (including `readAuthorizedLabelers`' dynamic import and `src/publish/app-settings.tsx`); deleted
 * in E1.
 */
export * from '@platform/web/app-settings/appSettingsQuery'
