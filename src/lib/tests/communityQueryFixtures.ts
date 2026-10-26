/**
 * Shim — the community-query fixture seam moved to `sdk/core/query/communityQueryFixtures.ts`
 * (store drain D1, slice 5), so the v4v (and later collections) Platform bindings can resolve a
 * seeded fixture step without a counted `platform -> src` edge. Vacated path kept as a re-export so
 * the e2e fixture seeding (`e2e/tests/community.progressive-loading.spec.ts`) and every src caller
 * keep working; deleted in E1.
 */
export * from '@sdk/core/query/communityQueryFixtures'
