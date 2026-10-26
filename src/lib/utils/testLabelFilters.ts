/**
 * Shim — the framework-free test-label curation filters moved to
 * `sdk/config/testLabelFilters.ts` (store drain D1, slice 3b).
 *
 * The filters are synchronous reads over the SDK test-label state, so they can live in `sdk/` and
 * be consumed by the Platform binding without a counted `platform -> src` edge. Every named export
 * is unchanged (`getItemTestLabelCoordinate`, `collectTestLabelCoordinates`,
 * `filterTestLabeledEvents`, `isProductTestLabeled`, `isAuctionTestLabeled`,
 * `isItemEventTestLabeled`, `filterTestLabeledCoordinates`, `useTestLabelFilters`), so no call site
 * breaks. Deleted in E1 together with the rest of the `src/` shims.
 *
 * The authoritative doc for the design lives on the SDK module:
 * docs/adr/ADR-0009-test-listing-labels-via-nip-32.md.
 */
export * from '@sdk/config/testLabelFilters'
