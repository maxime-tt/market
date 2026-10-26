/**
 * Shim — the bug-report read binding moved to `platform/web/messaging/bugReportQuery.ts`
 * (store drain D1, slice 2).
 *
 * The framework-free read model (`readBugReportsWorkflow`) and the query keys (`bugReportKeys`)
 * live in `sdk/commerce/messaging/bugReportRead.ts`; the React binding lives in the Platform
 * feature file and pins its port to the instance's bug relay through
 * `createBugRelayReadContext()` in `platform/web/ndkReadContext.ts` instead of
 * `@/lib/stores/ndk`. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/messaging/bugReportQuery'
