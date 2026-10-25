/**
 * src/lib/stores/testLabels.ts — the shim: `src/`'s view of the SDK test-label module, plus a temporary
 * adapter.
 *
 * The test-label state and actions moved to `@sdk/config/test-labels` (rebuilt on `sdk/core/state`). Every
 * existing call site keeps importing `@/lib/stores/testLabels` unchanged:
 *
 *   - `testLabelActions.*` and `TestLabelInfo` — re-exported by the `export *` below from the SDK module.
 *   - `useTestLabelStore` — the non-reactive accessor; kept here, now reading the SDK state store.
 *   - `testLabelStore` — a `@tanstack/store` `Store`, read by `useStore(testLabelStore, selector)` in
 *     `src/components/ShowTestListingsToggle.tsx:16`, `src/hooks/useStreamingProducts.ts:57` and
 *     `src/queries/testLabels.tsx:395-397`. Those consumers want a store-shaped object (`.state`,
 *     `.subscribe`), which the SDK primitive deliberately is not, so this file bridges the two: the `Store`
 *     is kept in step by the SDK store's `subscribe`. This adapter is TEMPORARY and is deleted when those
 *     call sites are rewired to the real reactive binding
 *     (`platform/web/config/testLabelsBinding.ts`, `useTestLabelState`); no consumer is rewired in this
 *     increment.
 *
 * Owner ruling (2026-10-25): nostr-derived state should be REACTIVE. The reactive binding therefore lives in
 * the platform layer next to the state it renders, not in this shim; consumers migrate to it lazily.
 */
export * from '@sdk/config/test-labels'

import { Store } from '@tanstack/store'
import { testLabelActions, testLabelState } from '@sdk/config/test-labels'
import type { TestLabelState } from '@sdk/config/test-labels'

/**
 * TEMPORARY (deleted when the `useStore` call sites are rewired): a `@tanstack/store` view of the SDK
 * test-label state.
 *
 * `useStore` needs a source with a stable `state` and a `subscribe`; the SDK primitive exposes `get`/
 * `subscribe` instead. A `Store` bridges them: it starts at the current state and the SDK store pushes each
 * change into it.
 */
export const testLabelStore = new Store<TestLabelState>(testLabelState.get())
testLabelState.subscribe((state) => testLabelStore.setState(() => state))

/**
 * Non-reactive accessor: the current test-label state merged with the actions. Kept for the call sites that
 * read it imperatively; a component that must re-render on a label change uses the reactive binding in the
 * platform layer instead.
 */
export const useTestLabelStore = () => {
	return {
		...testLabelState.get(),
		...testLabelActions,
	}
}
