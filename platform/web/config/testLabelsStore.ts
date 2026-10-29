/**
 * platform/web/config/testLabelsStore.ts — the platform home of the temporary test-label
 * `@tanstack/store` adapter.
 *
 * The test-label state and actions live in `@sdk/config/test-labels` (rebuilt on `sdk/core/state`).
 * A call site wants a store-shaped object (`.state`, `.subscribe`) rather than the SDK primitive's
 * `get`/`subscribe`, so this file bridges the two with a one-way mirror
 * (`testLabelState.subscribe`). Nothing writes this store directly, so no write-through is needed.
 *
 * The READ path (`useStore(testLabelStore, selector)` in `platform/web/products/useStreamingProducts.ts`) and the
 * non-reactive `useTestLabelStore()` accessor now resolve here. Moved out of
 * `src/lib/stores/testLabels.ts` in Wave E adapter drain W-E3.3; that file is the src/ shim. The
 * adapter is TEMPORARY: it is deleted when the `useStore` call site is rewired to the reactive binding
 * (`platform/web/config/testLabelsBinding.ts`, `useTestLabelState`). (`src/queries/testLabels.tsx`,
 * named alongside `useStreamingProducts.ts` in the original shim comment, now re-exports the binding
 * rather than reading this adapter.)
 */
export * from '@sdk/config/test-labels'

import { Store } from '@tanstack/store'
import { testLabelActions, testLabelState } from '@sdk/config/test-labels'
import type { TestLabelState } from '@sdk/config/test-labels'

/**
 * The `@tanstack/store` view of the SDK test-label state: it starts at the current state and the SDK
 * store pushes every change into it, so `useStore(testLabelStore, selector)` and `testLabelStore.state`
 * render the live value. One-way mirror — no consumer writes it.
 */
export const testLabelStore = new Store<TestLabelState>(testLabelState.get())
testLabelState.subscribe((state) => testLabelStore.setState(() => state))

/**
 * Non-reactive accessor: the current test-label state merged with the actions. Kept for the call sites
 * that read it imperatively; a component that must re-render on a label change uses the reactive
 * binding in the platform layer instead.
 */
export const useTestLabelStore = () => {
	return {
		...testLabelState.get(),
		...testLabelActions,
	}
}
