/**
 * Shim — the NIP-15 migration read binding moved to `platform/web/migration/migrationQuery.ts`
 * (store drain D1, slice 5).
 *
 * The framework-free pieces already live in `@sdk/commerce/products/nip15MigrationRead`; the React
 * binding keeps the host relay orchestration and the react-query options and resolves the NDK client +
 * app relay from the platform contexts. `platform/web/migration.tsx` is the untouched D2 publish
 * binding. Vacated path kept as a re-export so no call site breaks; deleted in E1.
 */
export * from '@platform/web/migration/migrationQuery'
