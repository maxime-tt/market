/**
 * platform/web/config/testListingsToggleHost.tsx — host for the test-listings toggle.
 *
 * Legacy source: `src/components/ShowTestListingsToggle.tsx` (deleted in this fused slice, D4 S3a).
 * It reads the reactive platform binding (`@platform/web/config/testLabelsBinding`) and mutates
 * through `@sdk/config/test-labels`, rather than the temporary `src/lib/stores/testLabels.ts`
 * adapter, so the host holds NO `platform -> src` edge.
 */
import { useQueryClient } from '@tanstack/react-query'
import { testLabelActions } from '@sdk/config/test-labels'
import { useTestLabelState } from '@platform/web/config/testLabelsBinding'
import { TestListingsToggleView } from '@ui/dashboard/test-label-views'

export function ShowTestListingsToggleHost() {
	const queryClient = useQueryClient()
	const { showTestListings } = useTestLabelState()

	const handleChange = (checked: boolean) => {
		testLabelActions.setShowTestListings(checked)
		// Prefix invalidation matches paginated/search/collection keys too.
		void queryClient.invalidateQueries({ queryKey: ['products'] })
		void queryClient.invalidateQueries({ queryKey: ['auctions'] })
	}

	return <TestListingsToggleView checked={showTestListings} onCheckedChange={handleChange} />
}
