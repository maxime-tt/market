import { useState } from 'react'
import { DashboardCollectionDetails, DashboardCollectionTrigger } from '@ui/dashboard/dashboard-collection-list-item'
import { DashboardOverviewStats } from '@ui/dashboard/dashboard-overview-stats'
import { DashboardProductDetails, DashboardProductTrigger } from '@ui/dashboard/dashboard-product-list-item'
import { TestLabelButtonView, TestLabelDialogView, type TestLabelDialogMode } from '@ui/dashboard/test-label-views'
import type { WidgetLibrary } from '../libraries'

/**
 * Dashboard list-item and overview views drained into ui/dashboard.
 *
 * The list items read their state from `sdk/` read-model tags, so each entry
 * passes the smallest literal event that type-checks. Routing links are plain
 * anchors (`renderLink`) and images come from the provider default, keeping the
 * catalogue free of `platform/` plumbing.
 */

/** Offline, deterministic stand-in for a relay-provided image. */
const IMAGE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23525252'/%3E%3Ccircle cx='100' cy='80' r='36' fill='%23888888'/%3E%3Crect x='60' y='128' width='80' height='14' fill='%23888888'/%3E%3C/svg%3E"

const SELLER_PUBKEY = 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782'
const BUYER_PUBKEY = 'aabb0011223344556677889900aabbccddeeff0011223344556677889900aabb'

/** Full collection event: title, summary, description, header image and two product references. */
const collectionEvent = {
	pubkey: SELLER_PUBKEY,
	content: 'Hand-picked miners that ship before the difficulty bump.',
	tags: [
		['d', 'autumn-drops'],
		['title', 'Autumn Drops'],
		['summary', 'Fresh hardware for the heating season.'],
		['image', IMAGE],
		['a', `30402:${SELLER_PUBKEY}:antminer-s21`],
		['a', `30402:${SELLER_PUBKEY}:whatscheck-plug`],
	],
}

/** Bare collection event: every view falls back to its default copy. */
const bareCollectionEvent = {
	pubkey: SELLER_PUBKEY,
	tags: [['d', 'bare-collection']],
}

/** On-sale product with an image, a price and stock. */
const productEvent = {
	pubkey: SELLER_PUBKEY,
	created_at: 1729500000,
	content: 'A quiet, efficient home miner in original packaging.',
	tags: [
		['d', 'antminer-s21'],
		['title', 'Antminer S21'],
		['price', '2100', 'SATS'],
		['image', IMAGE],
		['stock', '12'],
		['visibility', 'on-sale'],
	],
}

/** Hidden product with no image: exercises the placeholder box and the muted eye. */
const hiddenProductEvent = {
	pubkey: SELLER_PUBKEY,
	content: 'Draft listing, not yet browsable.',
	tags: [
		['d', 'test-rig'],
		['title', 'Test Rig (hidden)'],
		['visibility', 'hidden'],
	],
}

/** Two counted orders (one placed by the user, one received) plus an unrelated one. */
const overviewOrders = [
	{ order: { pubkey: BUYER_PUBKEY, tags: [['p', SELLER_PUBKEY]] } },
	{ order: { pubkey: SELLER_PUBKEY, tags: [['p', BUYER_PUBKEY]] } },
	{ order: { pubkey: BUYER_PUBKEY, tags: [['p', BUYER_PUBKEY]] } },
]

/** Test-label dialog demo: held closed at rest like `ConfirmDialogDemo`, driven by the button view. */
function TestLabelDialogDemo({ mode }: { mode: TestLabelDialogMode }) {
	const [open, setOpen] = useState(false)
	const [content, setContent] = useState('Curated test listing — appeal to the marketplace team to relist.')
	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<TestLabelButtonView isLabeled={mode === 'unmark'} itemLabel="Product" kindSlug="product" onPress={() => setOpen(true)} />
			<TestLabelDialogView
				mode={mode}
				open={open}
				onOpenChange={setOpen}
				itemLabel="Product"
				kindSlug="product"
				content={content}
				onContentChange={setContent}
				isBusy={false}
				onConfirm={() => setOpen(false)}
			/>
		</div>
	)
}

export const dashboard: WidgetLibrary = {
	name: 'dashboard',
	entries: [
		{
			name: 'DashboardCollectionTrigger',
			render: () => (
				<div className="max-w-md rounded-md border p-3">
					<DashboardCollectionTrigger collection={collectionEvent} />
				</div>
			),
		},
		{
			name: 'DashboardCollectionDetails',
			render: () => (
				<div className="max-w-md">
					<DashboardCollectionDetails collection={collectionEvent} />
				</div>
			),
		},
		{
			name: 'DashboardCollectionDetailsBare',
			render: () => (
				<div className="max-w-md">
					<DashboardCollectionDetails collection={bareCollectionEvent} />
				</div>
			),
		},
		{
			name: 'DashboardProductTrigger',
			render: () => (
				<div className="max-w-md rounded-md border p-3">
					<DashboardProductTrigger product={productEvent} />
				</div>
			),
		},
		{
			name: 'DashboardProductTriggerHidden',
			render: () => (
				<div className="max-w-md rounded-md border p-3">
					<DashboardProductTrigger product={hiddenProductEvent} />
				</div>
			),
		},
		{
			name: 'DashboardProductDetails',
			render: () => (
				<div className="max-w-md">
					<DashboardProductDetails product={productEvent} renderLink={(children) => <a href="/product/antminer-s21">{children}</a>} />
				</div>
			),
		},
		{
			name: 'DashboardOverviewStats',
			render: () => (
				<DashboardOverviewStats
					products={[productEvent, hiddenProductEvent]}
					orders={overviewOrders}
					userPubkey={SELLER_PUBKEY}
					conversationCount={4}
					isLoading={false}
				/>
			),
		},
		{
			name: 'DashboardOverviewStatsLoading',
			render: () => (
				<DashboardOverviewStats
					products={[productEvent, hiddenProductEvent]}
					orders={overviewOrders}
					userPubkey={SELLER_PUBKEY}
					conversationCount={4}
					isLoading
				/>
			),
		},
		{
			name: 'TestLabelButtonView',
			render: () => (
				<div className="flex gap-2">
					<TestLabelButtonView isLabeled={false} itemLabel="Product" kindSlug="product" onPress={() => {}} />
				</div>
			),
		},
		{
			name: 'TestLabelButtonViewLabeled',
			render: () => (
				<div className="flex gap-2">
					<TestLabelButtonView isLabeled itemLabel="Product" kindSlug="product" onPress={() => {}} />
				</div>
			),
		},
		{
			name: 'TestLabelDialogView',
			render: () => <TestLabelDialogDemo mode="mark" />,
		},
		{
			name: 'TestLabelDialogViewUnmark',
			render: () => <TestLabelDialogDemo mode="unmark" />,
		},
	],
}
