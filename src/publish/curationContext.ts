/**
 * Shim — the curation publish binding moved to `platform/web/curationContext.ts`
 * (store drain D2, slice 10).
 *
 * The binding routes the app-settings submission through the Platform publish bridge's
 * re-exported `submitAppSettingsEvent` accessor instead of importing `@/lib/appSettings`
 * directly, so a Platform host module consumes it without a counted `platform -> src`
 * edge. Vacated path kept as a re-export so no call sites break; deleted in E1.
 */
export * from '@platform/web/curationContext'
