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
import { CopyableField } from '@ui/shared/copyable-field'
import { TruncatedText } from '@ui/shared/truncated-text'
import { Media } from '@ui/shared/media'
import { ImageCarousel } from '@ui/shared/image-carousel'
import { ImageViewerModal } from '@ui/shared/image-viewer-modal'
import { ItemGrid } from '@ui/shared/item-grid'
import { ConfettiBurst } from '@ui/shared/confetti-burst'
import { PriceDisplayView } from '@ui/shared/price-display'
import { CityCombobox } from '@ui/shared/city-combobox'
import { CountryCombobox } from '@ui/shared/country-combobox'
import { PhoneInput } from '@ui/shared/phone-input'
import { DateTimePicker } from '@ui/shared/datetime-picker'
import { PackageIcon, PencilIcon, ServerIcon, StoreIcon, TrashIcon } from 'lucide-react'

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

/** Inline SVG data URI so media entries render without any network. */
const svgImage = (fill: string) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${fill}"/><circle cx="200" cy="200" r="110" fill="rgba(255,255,255,0.7)"/></svg>`,
	)}`

const SAMPLE_IMAGE_GREEN = svgImage('#10b981')
const SAMPLE_IMAGE_AMBER = svgImage('#f59e0b')
const SAMPLE_IMAGE_BLUE = svgImage('#3b82f6')

/**
 * Image viewer demo. Kept closed at rest for the same reason as the confirm
 * dialog: a mounted open modal hides the whole catalogue from the
 * accessibility tree. The viewer drives its own index state.
 */
function ImageViewerModalDemo() {
	const [open, setOpen] = useState(false)
	const [index, setIndex] = useState(0)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open image viewer
			</button>
			<ImageViewerModal
				isOpen={open}
				onClose={() => setOpen(false)}
				images={[
					{ url: SAMPLE_IMAGE_GREEN, title: 'Handmade mug' },
					{ url: SAMPLE_IMAGE_AMBER, title: 'Handmade vase' },
				]}
				currentIndex={index}
				onIndexChange={setIndex}
			/>
		</div>
	)
}

/** The comboboxes and phone input are controlled: the demo holds the value. */
function CityComboboxDemo() {
	const [city, setCity] = useState('')

	return (
		<div className="w-72">
			<CityCombobox value={city} onChange={setCity} selectedCountry="United States" placeholder="e.g. San Francisco" />
		</div>
	)
}

function CountryComboboxDemo() {
	const [country, setCountry] = useState('')

	return (
		<div className="w-72">
			<CountryCombobox value={country} onChange={setCountry} placeholder="e.g. United Kingdom" />
		</div>
	)
}

function PhoneInputDemo() {
	const [phone, setPhone] = useState('')

	return (
		<div className="w-72">
			<PhoneInput value={phone} onChange={setPhone} selectedCountry="Germany" placeholder="7751892718" />
		</div>
	)
}

/** Date-time picker demo: holds the `datetime-local` string the caller would own. */
function DateTimePickerDemo({ initial = '' }: { initial?: string }) {
	const [value, setValue] = useState(initial)

	return (
		<div className="w-72">
			<DateTimePicker value={value} onChange={setValue} placeholder="Pick a start date & time" />
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
			name: 'StatCardGlass',
			render: () => (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<StatCard label="Revenue" value="128,400 sats" helper="Frosted surface" trend="up" surface="glass" />
					<StatCard label="Refunds" value="4,200 sats" helper="Frosted surface" trend="down" surface="glass" />
				</div>
			),
		},
		{
			name: 'StatCardHandmade',
			render: () => (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<StatCard eyebrow="Hand-cut" label="Revenue" value="128,400 sats" helper="Irregular corners" trend="up" corners="handmade" />
					<StatCard eyebrow="Hand-cut" label="Refunds" value="4,200 sats" helper="Irregular corners" trend="down" corners="handmade" />
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
			name: 'EntityListItemGlass',
			render: () => (
				<div className="w-full">
					<EntityListItem
						isOpen
						onOpenChange={() => {}}
						surface="glass"
						corners="handmade"
						trigger={
							<div>
								<p className="font-semibold">Frosted vase</p>
								<p className="text-sm text-muted-foreground">18,000 sats · Hand-cut</p>
							</div>
						}
						icon={<PackageIcon className="h-5 w-5" />}
						actions={[{ key: 'edit', label: 'Edit product', icon: <PencilIcon className="h-4 w-4" />, onClick: () => {} }]}
					>
						<p className="text-sm text-muted-foreground">Frosted item with hand-cut corners.</p>
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
			name: 'CopyableField',
			render: () => (
				<div className="w-96">
					<CopyableField label="App Relay" value="wss://relay.plebeian.market" icon={<ServerIcon />} />
				</div>
			),
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
		{
			name: 'Media',
			render: () => (
				<div className="h-48 w-full overflow-hidden rounded-md border">
					<Media src={SAMPLE_IMAGE_GREEN} alt="Handmade mug" className="h-full w-full object-cover" />
				</div>
			),
		},
		{
			// Unroutable local port: the image errors instantly, no network needed.
			name: 'MediaFallback',
			render: () => (
				<div className="h-48 w-full overflow-hidden rounded-md border">
					<Media src="http://127.0.0.1:9/missing.jpg" alt="Missing media" className="h-full w-full object-cover" />
				</div>
			),
		},
		{
			name: 'ImageCarousel',
			render: () => (
				<div className="mx-auto w-full max-w-sm">
					<ImageCarousel
						title="Handmade mug"
						images={[{ url: SAMPLE_IMAGE_GREEN }, { url: SAMPLE_IMAGE_AMBER }, { url: SAMPLE_IMAGE_BLUE }]}
					/>
				</div>
			),
		},
		{
			name: 'ImageCarouselEmpty',
			render: () => (
				<div className="h-48 w-full">
					<ImageCarousel title="Unpublished product" images={[]} />
				</div>
			),
		},
		{
			name: 'ImageViewerModal',
			render: () => <ImageViewerModalDemo />,
		},
		{
			name: 'ItemGrid',
			render: () => (
				<ItemGrid title="Products" cols={2} smCols={2} lgCols={3} gap={4}>
					{['Handmade mug', 'Wool scarf', 'Ceramic bowl'].map((label) => (
						<div key={label} className="rounded-md border p-4 text-sm">
							{label}
						</div>
					))}
				</ItemGrid>
			),
		},
		{
			name: 'ConfettiBurst',
			render: () => (
				<div className="space-y-2 text-sm text-muted-foreground">
					<p className="font-medium text-foreground">Viewport confetti via portal</p>
					<p>Bursts launch from the bottom edge; suppressed under prefers-reduced-motion.</p>
					<ConfettiBurst />
				</div>
			),
		},
		{
			name: 'PriceDisplayView',
			render: () => (
				<div className="w-64">
					<PriceDisplayView
						priceValue={120000}
						originalCurrency="SATS"
						selectedCurrency="USD"
						price={{ isBitcoinCurrency: true, satsValue: 120000, fiatValue: { value: 135.12, currency: 'USD' } }}
						isLoading={false}
					/>
				</div>
			),
		},
		{
			name: 'PriceDisplayViewLoading',
			render: () => (
				<div className="w-64">
					<PriceDisplayView
						priceValue={0}
						originalCurrency="EUR"
						selectedCurrency="USD"
						price={{ isBitcoinCurrency: false, satsValue: null, fiatValue: null }}
						isLoading
					/>
				</div>
			),
		},
		{
			name: 'CityCombobox',
			render: () => <CityComboboxDemo />,
		},
		{
			name: 'CountryCombobox',
			render: () => <CountryComboboxDemo />,
		},
		{
			name: 'PhoneInput',
			render: () => <PhoneInputDemo />,
		},
		{
			name: 'DateTimePicker',
			render: () => <DateTimePickerDemo />,
		},
		{
			name: 'DateTimePickerSelected',
			render: () => <DateTimePickerDemo initial="2026-10-24T15:30" />,
		},
	],
}
