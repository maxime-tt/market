import { useState } from 'react'
import { DetailField } from '@ui/shared/detail-field'
import { EmptyState } from '@ui/shared/empty-state'
import { ErrorState } from '@ui/shared/error-state'
import { LoadingState } from '@ui/shared/loading-state'
import { StatCard } from '@ui/shared/stat-card'
import { ConfirmDialog } from '@ui/shared/confirm-dialog'
import { EntityListItem } from '@ui/shared/entity-list-item'
import { Notice } from '@ui/shared/notice'
import { StatusBadge } from '@ui/shared/status-badge'
import { CopyButton } from '@ui/shared/copy-button'
import { TruncatedText } from '@ui/shared/truncated-text'
import { PackageIcon, PencilIcon, StoreIcon, TrashIcon } from 'lucide-react'

import type { WidgetLibrary } from '../libraries'

/**
 * Confirmation dialog demo. Kept closed at rest: a mounted open modal hides the
 * whole catalogue from the accessibility tree, which broke every role-based
 * assertion in this spec, so the dialog is opened from a trigger instead.
 */
function ConfirmDialogDemo({ destructive = false }: { destructive?: boolean }) {
	const [open, setOpen] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				{destructive ? 'Open destructive confirmation' : 'Open confirmation'}
			</button>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={destructive ? 'Delete collection?' : 'Delete product?'}
				description={
					destructive ? 'Are you sure you want to delete "Summer favourites"?' : 'Are you sure you want to delete "Handmade mug"?'
				}
				confirmLabel="Delete"
				destructive={destructive}
				onConfirm={() => setOpen(false)}
			/>
		</div>
	)
}

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
					<StatCard eyebrow="Live pulse" label="Current price" value="12,000 sats" />
					<StatCard eyebrow="Ready to settle" label="Reserve" value="10,000 sats" />
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
		{
			name: 'ConfirmDialog',
			render: () => <ConfirmDialogDemo />,
		},
		{
			name: 'ConfirmDialogDestructive',
			render: () => <ConfirmDialogDemo destructive />,
		},
		{
			name: 'EntityListItem',
			render: () => (
				<div className="w-full">
					<EntityListItem
						isOpen
						onOpenChange={() => {}}
						trigger={
							<div>
								<p className="font-semibold">Handmade mug</p>
								<p className="text-sm text-muted-foreground">12,000 sats · Active</p>
							</div>
						}
						icon={<PackageIcon className="h-5 w-5" />}
						actions={[
							{ key: 'edit', label: 'Edit product', icon: <PencilIcon className="h-4 w-4" />, onClick: () => {} },
							{ key: 'delete', label: 'Delete product', icon: <TrashIcon className="h-4 w-4" />, onClick: () => {}, destructive: true },
						]}
					>
						<p className="text-sm text-muted-foreground">Expanded details for the selected product.</p>
					</EntityListItem>
				</div>
			),
		},
		{
			name: 'EntityListItemPending',
			render: () => (
				<div className="w-full">
					<EntityListItem
						isOpen={false}
						onOpenChange={() => {}}
						trigger={
							<div>
								<p className="font-semibold">Summer favourites</p>
								<p className="text-sm text-muted-foreground">8 products</p>
							</div>
						}
						icon={<StoreIcon className="h-5 w-5" />}
						actions={[
							{
								key: 'delete',
								label: 'Delete collection',
								icon: <TrashIcon className="h-4 w-4" />,
								onClick: () => {},
								destructive: true,
								pending: true,
							},
						]}
					>
						<p className="text-sm text-muted-foreground">Deleting…</p>
					</EntityListItem>
				</div>
			),
		},
		{
			name: 'Notice',
			render: () => (
				<div className="space-y-3">
					<Notice tone="info" title="Heads up">
						Orders settle on the relay you publish to.
					</Notice>
					<Notice tone="warning" title="Delivery unconfirmed">
						Verify shipping before continuing.
					</Notice>
					<Notice tone="error" title="Payment failed">
						The invoice expired before payment.
					</Notice>
					<Notice tone="success" title="Saved">
						Your payment detail is live.
					</Notice>
					<Notice tone="info" onDismiss={() => {}} compact>
						Dismissible notice
					</Notice>
				</div>
			),
		},
		{
			name: 'StatusBadge',
			render: () => (
				<div className="flex flex-wrap gap-2">
					<StatusBadge status="Neutral" tone="neutral" />
					<StatusBadge status="Info" tone="info" />
					<StatusBadge status="Warning" tone="warning" />
					<StatusBadge status="Error" tone="error" />
					<StatusBadge status="Success" tone="success" />
				</div>
			),
		},
		{
			name: 'CopyButton',
			render: () => <CopyButton value="npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" label="Copy npub" />,
		},
		{
			name: 'CopyButtonIconOnly',
			render: () => <CopyButton value="nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" />,
		},
		{
			name: 'TruncatedText',
			render: () => (
				<div className="flex flex-col gap-1">
					<TruncatedText text="npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" />
					<TruncatedText text="short" />
				</div>
			),
		},
	],
}
