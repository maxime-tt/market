import { DetailField } from '@ui/shared/detail-field'
import { EmptyState } from '@ui/shared/empty-state'
import { ErrorState } from '@ui/shared/error-state'
import { LoadingState } from '@ui/shared/loading-state'
import { StatCard } from '@ui/shared/stat-card'

import type { WidgetLibrary } from '../libraries'

/**
 * Shared state atoms (ADR-0007 slice 1). Each entry is a literal-prop render so
 * the gallery and the Playwright spec show a deterministic state.
 */
export const shared: WidgetLibrary = {
	name: 'shared',
	entries: [
		{
			name: 'EmptyState',
			render: () => <EmptyState title="No products yet" description="Products you publish will appear here." />,
		},
		{
			name: 'EmptyStateAction',
			render: () => (
				<EmptyState
					title="No shipping options"
					description="Add an option to start offering delivery."
					action={
						<button
							type="button"
							className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
						>
							Add option
						</button>
					}
				/>
			),
		},
		{
			name: 'ErrorState',
			render: () => (
				<ErrorState title="Could not load orders" message="The relay did not respond in time." onRetry={() => {}} retryLabel="Try again" />
			),
		},
		{
			name: 'LoadingStateSpinner',
			render: () => <LoadingState label="Loading orders…" />,
		},
		{
			name: 'LoadingStateSkeleton',
			render: () => <LoadingState variant="skeleton" rows={3} label="Loading orders" />,
		},
		{
			name: 'StatCard',
			render: () => (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<StatCard label="Revenue" value="128,400 sats" helper="Last 30 days" trend="up" />
					<StatCard label="Refunds" value="4,200 sats" helper="Last 30 days" trend="down" />
				</div>
			),
		},
		{
			name: 'DetailField',
			render: () => (
				<div className="w-72 space-y-2">
					<DetailField label="Order" value="#abc123" />
					<DetailField label="Total" value="2,100 sats" helper="includes shipping" />
					<DetailField label="Note" value="Handle with care" align="start" />
				</div>
			),
		},
	],
}
