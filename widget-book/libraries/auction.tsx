import { useState } from 'react'
import type { ParsedValidatorVerdictEvent } from '@sdk/commerce/auctions/events'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { BidGroupStatus } from '@sdk/commerce/auctions/bidGroupStatus'
import type {
	AuctionAntiSnipeWindowMinutesPreset,
	AuctionFormData,
	AuctionMinBidCurvePeakPreset,
	AuctionMinBidCurveShape,
	AuctionSettlementGracePreset,
} from '@sdk/commerce/auctions/auctionForm'
import { AuctionCategoryTab, AuctionImagesTab, AuctionNameTab, AuctionSpecTab } from '@ui/auction/auction-editor-tabs'
import { AuctionFiltersView, AuctionListItemView, AuctionTopBidBox } from '@ui/auction/auction-list-views'
import { AuctionDisplayView } from '@ui/auction/auction-display-view'
import { AuctionShippingView } from '@ui/auction/auction-shipping-view'
import { AuctionTabView } from '@ui/auction/auction-tab-view'
import type { AuctionShippingOptionSummary } from '@ui/auction/model'
import { AuctionTimelinePreview } from '@ui/auction/auction-timeline-preview'
import { AntiSnipeCurveSettings } from '@ui/auction/anti-snipe-curve-settings'
import { BidLadderPreview } from '@ui/auction/bid-ladder-preview'
import { SettlementGraceSettings } from '@ui/auction/settlement-grace-settings'
import { BidStatusBanner, BidStatusPill, getBidStatusCopy, type BidStatusDisplayInput } from '@ui/auction/bid-status-views'
import { AuctionShippingDetailRow, AuctionShippingOptionCard } from '@ui/auction/shipping-option-views'
import { AuctionVerdictView } from '@ui/auction/auction-verdict-view'
import { AuctionBidsView } from '@ui/auction/auction-bids-view'
import { AuctionTimelineChartView } from '@ui/auction/auction-timeline-chart-view'
import { AuctionActivityRow } from '@ui/auction/auction-overview-views'
import {
	AuctionDetailCard,
	AuctionPartyCard,
	AuctionSettlementBadge,
	AuctionStatusBadge,
	AuctionTechnicalRow,
} from '@ui/auction/auction-detail-views'
import type { WidgetLibrary } from '../libraries'

/**
 * Auction detail presentations. Every entry is a literal-prop render so the
 * gallery and the Playwright spec show a deterministic state.
 *
 * The components are presentation-only: the host resolves status, settlement
 * state, pubkeys and copy values and passes them in, so the library needs no
 * query plumbing. `AuctionPartyCard` receives its identity cluster as a node
 * because resolving a pubkey to an avatar and display name is host work.
 */

/** Stand-in for the host's `<AvatarUser>` + `<ProfileName>` cluster. */
function SamplePartyIdentity() {
	return (
		<span className="flex items-center gap-2">
			<span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
				S
			</span>
			<span className="text-sm font-medium text-foreground">satoshi</span>
		</span>
	)
}

/** Inline SVG data URI so the list-item thumbnail renders without any network. */
const svgImage = (fill: string) =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${fill}"/><circle cx="100" cy="100" r="55" fill="rgba(255,255,255,0.7)"/></svg>`,
	)}`

const AUCTION_THUMBNAIL = svgImage('#10b981')

/** Fixed offsets from load time; the labels stay stable for the length of a test run. */
const AUCTION_CREATED_AT = Math.floor(Date.now() / 1000) - 3 * 86_400
const TOP_BID_CREATED_AT = Math.floor(Date.now() / 1000) - 5 * 60

/** Full literal `BidStatusDisplayInput` so each demo only overrides its state. */
function bidInput(status: BidGroupStatus, overrides: Partial<BidStatusDisplayInput> = {}): BidStatusDisplayInput {
	return {
		status,
		reclaimableCount: 2,
		waitingForReclaim: false,
		hasTrackedTokens: true,
		latestLocktime: 1_760_000_000,
		reclaimCountdownLabel: 'Reclaim opens in 4m 10s',
		...overrides,
	}
}

/** Full dashboard list row: thumbnail, top-bid panel, countdown and fresh activity. */
function AuctionListItemDemo() {
	return (
		<div className="max-w-5xl">
			<AuctionListItemView
				title="Handmade mug auction"
				summary="One-of-a-kind stoneware mug"
				createdAt={AUCTION_CREATED_AT}
				thumbnailUrl={AUCTION_THUMBNAIL}
				status="Live"
				openAuctionAction={
					<button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
						View auction
					</button>
				}
				topBidBox={
					<AuctionTopBidBox
						topBidSats={15000}
						topBidCreatedAt={TOP_BID_CREATED_AT}
						bidderName="satoshi"
						bidderIdentity={<SamplePartyIdentity />}
					/>
				}
				countdown={
					<span className="text-sm font-medium text-text-high" data-slot="demo-countdown">
						2d 4h left
					</span>
				}
				activity={{ bids: 4, newBids: 2, comments: 1, newComments: 0, liveChat: 0, newChat: 0 }}
				hasNewActivity
				onMarkActivitySeen={() => {}}
			/>
		</div>
	)
}

/** The app-settings featured-auction row: a static auction with a stubbed countdown slot. */
function AuctionDisplayViewDemo() {
	return (
		<div className="max-w-2xl">
			<AuctionDisplayView
				title="Handmade mug auction"
				summary="One-of-a-kind stoneware mug"
				imageUrl={AUCTION_THUMBNAIL}
				endAtLabel="1/1/2027, 12:00:00 PM"
				coordsIdentifier="handmade-mug"
				countdownSlot={
					<span className="text-sm font-medium text-text-high" data-slot="demo-countdown">
						2d 4h left
					</span>
				}
				onMoveUp={() => {}}
				onMoveDown={() => {}}
				onRemove={() => {}}
				canMoveUp
				canMoveDown
				isReordering={false}
				isRemoving={false}
			/>
		</div>
	)
}

/** The drained-down state: no thumbnail, no top bid, no countdown, nothing unseen. */
function AuctionListItemSeenDemo() {
	return (
		<div className="max-w-5xl">
			<AuctionListItemView
				title="Frosted vase auction"
				summary="Cut-glass vase, reserve met"
				createdAt={AUCTION_CREATED_AT}
				thumbnailUrl={null}
				status="Ended"
				topBidBox={<AuctionTopBidBox topBidSats={null} />}
				activity={{ bids: 3, newBids: 0, comments: 0, newComments: 0, liveChat: 2, newChat: 0 }}
				hasNewActivity={false}
				onMarkActivitySeen={() => {}}
			/>
		</div>
	)
}

/** Local state mirrors the host's anti-snipe slice so the spec can click the
 * switch/window/shape/peak controls and observe the `onFormPatch` wiring. */
function AntiSnipeCurveSettingsDemo() {
	const [slice, setSlice] = useState<{
		antiSnipeWindowMinutes: AuctionAntiSnipeWindowMinutesPreset
		minBidCurveShape: AuctionMinBidCurveShape
		minBidCurvePeakMultiplier: AuctionMinBidCurvePeakPreset
	}>({ antiSnipeWindowMinutes: 0, minBidCurveShape: 'none', minBidCurvePeakMultiplier: 2 })
	return (
		<div className="max-w-md">
			<AntiSnipeCurveSettings
				antiSnipeWindowMinutes={slice.antiSnipeWindowMinutes}
				minBidCurveShape={slice.minBidCurveShape}
				minBidCurvePeakMultiplier={slice.minBidCurvePeakMultiplier}
				onFormPatch={(patch) => setSlice((prev) => ({ ...prev, ...patch }))}
				startAtSeconds={1_760_000_000}
				endAtSeconds={1_760_086_400}
				maxEndAtSeconds={1_760_090_000}
				settlementGraceSeconds={86_400}
				startingBid={1000}
				bidIncrement={50}
				reserve={2500}
			/>
		</div>
	)
}

/** The settlement-grace card with its own `value` state, so the spec can click a
 * preset and observe the active choice move through `onValueChange`. */
function SettlementGraceSettingsDemo() {
	const [value, setValue] = useState<AuctionSettlementGracePreset>('1h')
	return (
		<div className="max-w-md">
			<SettlementGraceSettings value={value} onValueChange={setValue} />
		</div>
	)
}

/** A full literal `AuctionFormData` for the editor-tab demos (T6.3 S5a). */
const AUCTION_FORM_DATA: AuctionFormData = {
	title: 'Handmade mug',
	summary: 'One-of-a-kind stoneware mug',
	description: 'Wheel-thrown, food-safe glaze.',
	startingBid: '1000',
	bidIncrement: '50',
	reserve: '2500',
	startAt: '',
	endAt: '',
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h',
	mainCategory: 'Collectibles',
	categories: [],
	imageUrls: [],
	specs: [
		{ key: 'Brand', value: 'Leica' },
		{ key: 'Condition', value: 'Mint' },
	],
	shippings: [],
	trustedMints: ['https://mint.one'],
	isNSFW: false,
	enableLiveChat: true,
	auditorPubkey: '',
}

/** The flattened option shape the host hands the shipping view. */
const SHIPPING_OPTION: AuctionShippingOptionSummary = {
	id: '30406:me:std',
	name: 'Standard Post',
	price: '10',
	currency: 'USD',
	service: 'standard',
	carrier: 'DHL',
}

/** Host-owned uploader stand-in: each slot renders its own delete control. */
function renderUploaderDemo({ src, index, onDelete }: { src: string | null; index: number; onDelete: (index: number) => void }) {
	return (
		<div className="flex items-center justify-between rounded-md border p-2 text-sm" data-slot="uploader-slot">
			<span>{src ?? 'Add an image'}</span>
			<button type="button" onClick={() => onDelete(index)}>
				Delete
			</button>
		</div>
	)
}

/** Host stand-in for `AvatarHost`: the book shows a plain deterministic chip. */
function SampleVerdictAvatar({ pubkey }: { pubkey: string }) {
	return (
		<span
			data-slot="verdict-avatar"
			data-pubkey={pubkey}
			className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground"
		>
			{pubkey.slice(0, 1).toUpperCase()}
		</span>
	)
}

const VERDICT_VALIDATOR_PUBKEY = 'a'.repeat(64)
const VERDICT_BIDDER_PUBKEY = 'b'.repeat(64)
const VERDICT_OTHER_BIDDER_PUBKEY = 'c'.repeat(64)
const VERDICT_OBSERVED_AT = 1_760_000_000

/** One literal kind-30440 verdict row; overrides carry the per-claim differences. */
function verdictFixture(
	id: string,
	claim: ParsedValidatorVerdictEvent['claim'],
	overrides: Partial<ParsedValidatorVerdictEvent> = {},
): ParsedValidatorVerdictEvent {
	return {
		rawEvent: { id, pubkey: VERDICT_VALIDATOR_PUBKEY, kind: 30440, created_at: VERDICT_OBSERVED_AT, content: '', tags: [] },
		id,
		validatorPubkey: VERDICT_VALIDATOR_PUBKEY,
		createdAt: VERDICT_OBSERVED_AT,
		dTag: `${VERDICT_BIDDER_PUBKEY}:root-event:bid-event`,
		bidderPubkey: VERDICT_BIDDER_PUBKEY,
		auctionRootEventId: 'root-event',
		auctionCoordinate: '30402:root-event:handmade-mug',
		bidEventId: 'bid-event',
		claim,
		observedAt: VERDICT_OBSERVED_AT,
		...overrides,
	}
}

/** Every claim tone the panel maps: settled, valid, fraudulent and griefed. */
function AuctionVerdictViewDemo() {
	return (
		<div className="max-w-md">
			<AuctionVerdictView
				verdicts={[
					verdictFixture('v-settled', 'settled_promptly', { nut7State: 'spent' }),
					verdictFixture('v-valid', 'valid_bid_placed', { nut7State: 'unspent' }),
					verdictFixture('v-fraud', 'fraudulent_bid', { bidderPubkey: VERDICT_OTHER_BIDDER_PUBKEY, reason: 'proof_double_spent' }),
					verdictFixture('v-griefed', 'griefed', { bidderPubkey: VERDICT_OTHER_BIDDER_PUBKEY, reason: 'no_release' }),
				]}
				renderAvatar={(pubkey) => <SampleVerdictAvatar pubkey={pubkey} />}
			/>
		</div>
	)
}

/** Host stand-in for `UserCardHost` in the bids list: a plain deterministic node. */
function SampleBidderCard({ pubkey }: { pubkey: string }) {
	return (
		<span data-slot="bidder-card" data-pubkey={pubkey} className="inline-flex items-center gap-2 text-sm text-text-high">
			<span className="flex h-7 w-7 items-center justify-center rounded-full bg-fill-accent text-xs font-semibold text-on-fill-accent">
				{pubkey.slice(0, 1).toUpperCase()}
			</span>
			{pubkey.slice(0, 8)}
		</span>
	)
}

const BIDS_VIEW_TOP_PUBKEY = 'd'.repeat(64)
const BIDS_VIEW_OTHER_PUBKEY = 'e'.repeat(64)
const BIDS_VIEW_CREATED_AT = 1_760_000_000

/** One literal bid event; overrides carry the per-bid amount/mint/timestamp. */
function auctionBidFixture(overrides: Partial<NostrEventLike>): NostrEventLike {
	return {
		id: 'bid-top',
		pubkey: BIDS_VIEW_TOP_PUBKEY,
		kind: 1024,
		created_at: BIDS_VIEW_CREATED_AT,
		content: '',
		tags: [
			['amount', '15000'],
			['mint', 'https://mint.example.com'],
		],
		...overrides,
	}
}

/** S5a: the bid list with a top bid and one latest bid, each behind its
 * collapsed technical accordion. */
function AuctionBidsViewDemo() {
	return (
		<div className="max-w-md">
			<AuctionBidsView
				bids={[
					auctionBidFixture({}),
					auctionBidFixture({
						id: 'bid-other',
						pubkey: BIDS_VIEW_OTHER_PUBKEY,
						created_at: BIDS_VIEW_CREATED_AT - 60,
						tags: [
							['amount', '12000'],
							['mint', 'https://mint.two'],
						],
					}),
				]}
				renderUserCard={(pubkey) => <SampleBidderCard pubkey={pubkey} />}
			/>
		</div>
	)
}

const TIMELINE_AUCTION_START = 1_760_000_000
const TIMELINE_AUCTION_END = TIMELINE_AUCTION_START + 86_400
const TIMELINE_AUCTION_MAX_END = TIMELINE_AUCTION_END + 1_800

/** Fixed-timestamp auction + bid set so the timeline chart is stable. */
const TIMELINE_AUCTION: NostrEventLike = {
	id: 'auction-timeline',
	pubkey: BIDS_VIEW_TOP_PUBKEY,
	kind: 30408,
	created_at: TIMELINE_AUCTION_START - 3_600,
	content: '',
	tags: [
		['start_at', String(TIMELINE_AUCTION_START)],
		['end_at', String(TIMELINE_AUCTION_END)],
		['max_end_at', String(TIMELINE_AUCTION_MAX_END)],
		['settlement_grace', '3600'],
		['starting_bid', '10000'],
		['reserve', '20000'],
	],
}

const TIMELINE_BIDS: NostrEventLike[] = [
	auctionBidFixture({
		id: 'timeline-1',
		pubkey: BIDS_VIEW_TOP_PUBKEY,
		created_at: TIMELINE_AUCTION_START + 3_600,
		tags: [['amount', '12000']],
	}),
	auctionBidFixture({
		id: 'timeline-2',
		pubkey: BIDS_VIEW_OTHER_PUBKEY,
		created_at: TIMELINE_AUCTION_START + 7_200,
		tags: [['amount', '18000']],
	}),
	auctionBidFixture({ id: 'timeline-3', pubkey: 'f'.repeat(64), created_at: TIMELINE_AUCTION_START + 10_800, tags: [['amount', '22000']] }),
]

/** S5b: the bid timeline chart — lollipop bids over time with the reserve and
 * settlement reference lines and a plain host-injected identity slot. */
function AuctionTimelineChartViewDemo() {
	return (
		<div className="max-w-2xl">
			<AuctionTimelineChartView
				bids={TIMELINE_BIDS}
				auction={TIMELINE_AUCTION}
				renderUserCard={(pubkey) => <SampleBidderCard pubkey={pubkey} />}
			/>
		</div>
	)
}

/** Interactive images tab: deleting a slot proves the `onDelete` wiring. */
function AuctionImagesTabDemo() {
	const [images, setImages] = useState([
		{ imageUrl: 'https://img.example/1.png', imageOrder: 0 },
		{ imageUrl: 'https://img.example/2.png', imageOrder: 1 },
	])
	return (
		<div className="max-w-md">
			<AuctionImagesTab images={images} setImages={setImages} renderUploader={renderUploaderDemo} />
		</div>
	)
}

/** The mechanics tab with local form state so the spec can open Advanced. */
function AuctionTabViewDemo() {
	const [formData, setFormData] = useState<AuctionFormData>(AUCTION_FORM_DATA)
	const [startMode, setStartMode] = useState<'immediate' | 'scheduled'>('immediate')
	const [endMode, setEndMode] = useState<'duration' | 'absolute'>('duration')
	const [durationSeconds, setDurationSeconds] = useState(86_400)
	return (
		<div className="max-w-md">
			<AuctionTabView
				formData={formData}
				setFormData={setFormData}
				availableMints={['https://mint.one', 'https://mint.two']}
				startMode={startMode}
				setStartMode={setStartMode}
				endMode={endMode}
				setEndMode={setEndMode}
				durationSeconds={durationSeconds}
				setDurationSeconds={setDurationSeconds}
				validationMessages={{}}
				userRemovedMints={new Set<string>()}
				onUserRemovedMintsChange={() => {}}
			/>
		</div>
	)
}

export const auction: WidgetLibrary = {
	name: 'auction',
	entries: [
		{
			name: 'AuctionStatusBadge',
			render: () => (
				<div className="flex flex-wrap gap-2">
					<AuctionStatusBadge status="Live" />
					<AuctionStatusBadge status="Scheduled" />
					<AuctionStatusBadge status="Ended" />
				</div>
			),
		},
		{
			name: 'AuctionSettlementBadge',
			render: () => (
				<div className="flex flex-wrap gap-2">
					<AuctionSettlementBadge state="awaiting" />
					<AuctionSettlementBadge state="ready" />
					<AuctionSettlementBadge state="settled" />
					<AuctionSettlementBadge state="reserve_not_met" />
					<AuctionSettlementBadge state="cancelled" />
				</div>
			),
		},
		{
			name: 'AuctionDetailCard',
			render: () => (
				<div className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
					<AuctionDetailCard label="Auction type" value="English" helper="Primary format shown to buyers." />
					<AuctionDetailCard label="Currency" value="sats" helper="Display currency for bidding." />
					<AuctionDetailCard label="Schedule" value="Oct 20, 2026 to Oct 22, 2026" />
				</div>
			),
		},
		{
			name: 'AuctionPartyCard',
			render: () => (
				<div className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
					<AuctionPartyCard label="Seller" helper="You" identity={<SamplePartyIdentity />} />
					<AuctionPartyCard label="Winner" identity={<SamplePartyIdentity />} />
				</div>
			),
		},
		{
			name: 'AuctionActivityRow',
			render: () => (
				<div className="max-w-xs space-y-3 rounded-xl border p-5">
					<AuctionActivityRow header="Bids" unit="Bid" count={3} newCount={1} />
					<AuctionActivityRow header="Comments" unit="Comment" count={1} newCount={0} />
					<AuctionActivityRow header="Live Chat" unit="Message" count={0} newCount={0} />
				</div>
			),
		},
		{
			name: 'AuctionTechnicalRow',
			render: () => (
				<div className="max-w-md space-y-3">
					<AuctionTechnicalRow
						label="Bidder pubkey"
						value="d943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782"
						copyValue="d943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782"
					/>
					<AuctionTechnicalRow label="Schema" value="N/A" />
					<AuctionTechnicalRow label="Trusted mints" value={'mint.one\nmint.two'} stacked />
				</div>
			),
		},
		{
			// T3.0 debt: the dashboard auctions list lifts this row out of the route.
			name: 'AuctionListItemView',
			render: () => <AuctionListItemDemo />,
		},
		{
			name: 'AuctionListItemViewSeen',
			render: () => <AuctionListItemSeenDemo />,
		},
		{
			// T6.x: the auctions-index filter/sort control, lifted out of the
			// legacy host so the route assembles it from host-resolved props.
			name: 'AuctionFiltersView',
			render: () => (
				<AuctionFiltersView
					appliedFilterCount={2}
					hideEnded
					sort="newest"
					sortOptions={[
						{ value: 'newest', title: 'Newest' },
						{ value: 'oldest', title: 'Oldest' },
					]}
					onToggleHideEnded={() => {}}
					onSortChange={() => {}}
					onReset={() => {}}
				/>
			),
		},
		{
			// W-E7.1: the app-settings featured-auction row, lifted out of the retired
			// src/components/AuctionDisplayComponent.tsx leaf.
			name: 'AuctionDisplayView',
			render: () => <AuctionDisplayViewDemo />,
		},
		{
			// T3.0 debt: the top-bid panel of the same card.
			name: 'AuctionTopBidBox',
			render: () => (
				<div className="max-w-sm">
					<AuctionTopBidBox
						topBidSats={15000}
						topBidCreatedAt={TOP_BID_CREATED_AT}
						bidderName="satoshi"
						bidderIdentity={<SamplePartyIdentity />}
					/>
				</div>
			),
		},
		{
			name: 'AuctionTopBidBoxEmpty',
			render: () => (
				<div className="max-w-sm">
					<AuctionTopBidBox topBidSats={null} />
				</div>
			),
		},
		{
			// Settlement phase: the success frame plus the settlement-details accordion.
			name: 'AuctionTopBidBoxSettlement',
			render: () => (
				<div className="max-w-sm">
					<AuctionTopBidBox
						topBidSats={15000}
						topBidCreatedAt={TOP_BID_CREATED_AT}
						bidderName="satoshi"
						bidderIdentity={<SamplePartyIdentity />}
						isSettlementPhase
						showReleasePathDetails
						showWaitingForReleasePath
						showReleasePathReceived
						releasePathSecondsLeft={2 * 86_400 + 3 * 3_600}
						showSettlementGrievedNoRelease
						showWaitingForShippingMethod
						releaseDetailsItemValue="demo-release-details"
					/>
				</div>
			),
		},
		{
			name: 'BidStatusPill',
			render: () => (
				<div className="flex flex-wrap gap-2">
					<BidStatusPill copy={getBidStatusCopy(bidInput('winning'))} />
					<BidStatusPill copy={getBidStatusCopy(bidInput('reclaim_available', { reclaimableCount: 1 }))} />
					<BidStatusPill copy={getBidStatusCopy(bidInput('locked'))} />
					<BidStatusPill copy={getBidStatusCopy(bidInput('outbid'))} />
					<BidStatusPill copy={getBidStatusCopy(bidInput('cancelled'))} />
				</div>
			),
		},
		{
			name: 'BidStatusBanner',
			render: () => (
				<div className="max-w-md space-y-3">
					<BidStatusBanner copy={getBidStatusCopy(bidInput('winning'))} />
					<BidStatusBanner copy={getBidStatusCopy(bidInput('reclaim_available', { reclaimableCount: 1 }))} />
					<BidStatusBanner copy={getBidStatusCopy(bidInput('outbid'))} />
				</div>
			),
		},
		{
			name: 'AuctionShippingDetailRow',
			render: () => (
				// Rows with an empty value render nothing, so only two rows appear.
				<dl className="grid max-w-sm gap-3">
					<AuctionShippingDetailRow label="Base price" value="500 sats" />
					<AuctionShippingDetailRow label="Service" value="International Priority" />
					<AuctionShippingDetailRow label="Carrier" />
				</dl>
			),
		},
		{
			name: 'AuctionShippingOptionCard',
			render: () => (
				<ul className="max-w-md space-y-4">
					<AuctionShippingOptionCard
						status="valid"
						title="International Priority"
						description="Door-to-door courier with tracking"
						priceLabel="1,200 sats"
						basePriceLabel="1,000 sats"
						extraCost="200 sats"
						service="Courier"
						carrier="DHL"
						destination="Worldwide"
						duration="3–5 days"
					/>
				</ul>
			),
		},
		{
			// The three degenerate branches of the same card, stacked.
			name: 'AuctionShippingOptionCardStates',
			render: () => (
				<ul className="max-w-md space-y-4">
					<AuctionShippingOptionCard status="invalid" title="Ignored" priceLabel="" description="Event 30402:abc123 could not be parsed." />
					<AuctionShippingOptionCard status="valid" isLoading title="Loading" priceLabel="" />
					<AuctionShippingOptionCard status="valid" isUnavailable title="Unavailable" priceLabel="" />
				</ul>
			),
		},
		{
			name: 'AuctionShippingOptionCardPartial',
			render: () => (
				<ul className="max-w-md">
					<AuctionShippingOptionCard
						status="valid"
						title="Standard Post"
						priceLabel="500 sats"
						basePriceLabel="500 sats"
						carrier="Royal Mail"
						hasPartialShippingInfo
					/>
				</ul>
			),
		},
		{
			// The bid-ladder preview: sats-only price progression (T6.3 S3).
			name: 'BidLadderPreview',
			render: () => (
				<div className="max-w-md">
					<BidLadderPreview startingBid={1000} bidIncrement={50} reserve={2500} />
				</div>
			),
		},
		{
			// Same preview with the reserve below the starting bid: the "no reserve" column.
			name: 'BidLadderPreviewNoReserve',
			render: () => (
				<div className="max-w-md">
					<BidLadderPreview startingBid={1000} bidIncrement={50} reserve={0} />
				</div>
			),
		},
		{
			// The time-axis preview with an anti-snipe window and a curve (T6.3 S3).
			name: 'AuctionTimelinePreview',
			render: () => (
				<div className="max-w-md">
					<AuctionTimelinePreview
						startingBid={1000}
						bidIncrement={50}
						reserve={2500}
						curveShape="linear"
						curvePeakMultiplier={2}
						startAtSeconds={1_760_000_000}
						endAtSeconds={1_760_086_400}
						maxEndAtSeconds={1_760_090_000}
						settlementGraceSeconds={86_400}
						showCurve
					/>
				</div>
			),
		},
		{
			// No anti-snipe window: the flat auction, no curve phase.
			name: 'AuctionTimelinePreviewFlat',
			render: () => (
				<div className="max-w-md">
					<AuctionTimelinePreview
						startingBid={1000}
						bidIncrement={50}
						reserve={0}
						curveShape="none"
						curvePeakMultiplier={1}
						startAtSeconds={1_760_000_000}
						endAtSeconds={1_760_086_400}
						maxEndAtSeconds={1_760_086_400}
						settlementGraceSeconds={86_400}
						showCurve={false}
					/>
				</div>
			),
		},
		{
			// The early return: no end time picked yet, so the preview prompts instead of charting.
			name: 'AuctionTimelinePreviewWaiting',
			render: () => (
				<div className="max-w-md">
					<AuctionTimelinePreview
						startingBid={1000}
						bidIncrement={50}
						reserve={0}
						curveShape="none"
						curvePeakMultiplier={1}
						startAtSeconds={1_760_000_000}
						endAtSeconds={0}
						maxEndAtSeconds={0}
						settlementGraceSeconds={86_400}
						showCurve={false}
					/>
				</div>
			),
		},
		{
			// The anti-snipe policy card with a window, a curve and its timeline (T6.3 S4).
			name: 'AntiSnipeCurveSettings',
			render: () => (
				<div className="max-w-md">
					<AntiSnipeCurveSettings
						antiSnipeWindowMinutes={15}
						minBidCurveShape="linear"
						minBidCurvePeakMultiplier={5}
						onFormPatch={() => {}}
						startAtSeconds={1_760_000_000}
						endAtSeconds={1_760_086_400}
						maxEndAtSeconds={1_760_090_000}
						settlementGraceSeconds={86_400}
						startingBid={1000}
						bidIncrement={50}
						reserve={2500}
					/>
				</div>
			),
		},
		{
			// The same card with no window: the curve controls are gated and the timeline is flat.
			name: 'AntiSnipeCurveSettingsOff',
			render: () => (
				<div className="max-w-md">
					<AntiSnipeCurveSettings
						antiSnipeWindowMinutes={0}
						minBidCurveShape="none"
						minBidCurvePeakMultiplier={2}
						onFormPatch={() => {}}
						startAtSeconds={1_760_000_000}
						endAtSeconds={1_760_086_400}
						maxEndAtSeconds={1_760_086_400}
						settlementGraceSeconds={86_400}
						startingBid={1000}
						bidIncrement={50}
						reserve={0}
					/>
				</div>
			),
		},
		{
			// Interactive: click the controls to prove the `onFormPatch` wiring.
			name: 'AntiSnipeCurveSettingsInteractive',
			render: () => <AntiSnipeCurveSettingsDemo />,
		},
		{
			// The settlement-grace picker with 1 hour selected (T6.3 S4).
			name: 'SettlementGraceSettings',
			render: () => (
				<div className="max-w-md">
					<SettlementGraceSettings value="1h" onValueChange={() => {}} />
				</div>
			),
		},
		{
			// Interactive: click a preset to prove the `onValueChange` wiring.
			name: 'SettlementGraceSettingsInteractive',
			render: () => <SettlementGraceSettingsDemo />,
		},
		{
			// The four simple editor tabs, as one cluster file (T6.3 S5a).
			name: 'AuctionNameTab',
			render: () => (
				<div className="max-w-md">
					<AuctionNameTab formData={AUCTION_FORM_DATA} setFormData={() => {}} />
				</div>
			),
		},
		{
			name: 'AuctionCategoryTab',
			render: () => (
				<div className="max-w-md">
					<AuctionCategoryTab
						formData={AUCTION_FORM_DATA}
						setFormData={() => {}}
						subCategoryInput="Cameras, Optics"
						setSubCategoryInput={() => {}}
						mainCategories={['Collectibles', 'Art', 'Bitcoin']}
					/>
				</div>
			),
		},
		{
			name: 'AuctionSpecTab',
			render: () => (
				<div className="max-w-md">
					<AuctionSpecTab formData={AUCTION_FORM_DATA} setFormData={() => {}} />
				</div>
			),
		},
		{
			name: 'AuctionImagesTab',
			render: () => (
				<div className="max-w-md">
					<AuctionImagesTab
						images={[{ imageUrl: 'https://img.example/1.png', imageOrder: 0 }]}
						setImages={() => {}}
						renderUploader={renderUploaderDemo}
					/>
				</div>
			),
		},
		{
			// Interactive: delete a slot to prove the `onDelete` wiring.
			name: 'AuctionImagesTabInteractive',
			render: () => <AuctionImagesTabDemo />,
		},
		{
			// The mechanics tab: start/end timing, starting bid, Advanced (T6.3 S5a).
			name: 'AuctionTabView',
			render: () => (
				<div className="max-w-md">
					<AuctionTabView
						formData={AUCTION_FORM_DATA}
						setFormData={() => {}}
						availableMints={['https://mint.one', 'https://mint.two']}
						startMode="immediate"
						setStartMode={() => {}}
						endMode="duration"
						setEndMode={() => {}}
						durationSeconds={86_400}
						setDurationSeconds={() => {}}
						validationMessages={{}}
						userRemovedMints={new Set<string>()}
						onUserRemovedMintsChange={() => {}}
					/>
				</div>
			),
		},
		{
			// The same tab with the date pickers selected instead of the duration slider.
			name: 'AuctionTabViewScheduled',
			render: () => (
				<div className="max-w-md">
					<AuctionTabView
						formData={AUCTION_FORM_DATA}
						setFormData={() => {}}
						availableMints={[]}
						startMode="scheduled"
						setStartMode={() => {}}
						endMode="absolute"
						setEndMode={() => {}}
						durationSeconds={3600}
						setDurationSeconds={() => {}}
						validationMessages={{}}
						userRemovedMints={new Set<string>()}
						onUserRemovedMintsChange={() => {}}
					/>
				</div>
			),
		},
		{
			// Interactive: open Advanced to prove the collapsible composition of the
			// bid-increment/reserve inputs, the curve card and the mints list.
			name: 'AuctionTabViewAdvanced',
			render: () => <AuctionTabViewDemo />,
		},
		{
			// The shipping panel with attached and available options (T6.3 S5a).
			name: 'AuctionShippingView',
			render: () => (
				<div className="max-w-md">
					<AuctionShippingView
						attached={[
							{ shippingRef: '30406:me:std', extraCost: '5', option: SHIPPING_OPTION },
							{ shippingRef: '30406:me:gone', extraCost: '', option: null },
						]}
						unselected={[SHIPPING_OPTION]}
						hasUser
						isLoading={false}
						hasAnyOptions
						extraCostErrors={{ 0: 'Enter a whole number' }}
						onAdd={() => {}}
						onRemove={() => {}}
						onExtraCostChange={() => {}}
					/>
				</div>
			),
		},
		{
			// S4b: the kind-30440 verdict list with its claim-tone mapping and
			// host-injected avatars.
			name: 'AuctionVerdictView',
			render: () => <AuctionVerdictViewDemo />,
		},
		{
			// S5a: the streaming bid list (top bid + latest bid) with the collapsed
			// technical accordion and a plain host-injected bidder slot.
			name: 'AuctionBidsView',
			render: () => <AuctionBidsViewDemo />,
		},
		{
			// S5b: the bid timeline scatter chart — lollipop bids over time, the
			// reserve/starting-bid reference lines, the anti-snipe and settlement
			// windows, and a plain host-injected identity slot.
			name: 'AuctionTimelineChartView',
			render: () => <AuctionTimelineChartViewDemo />,
		},
		{
			// S5b: the degenerate Available branches as four reachable states.
			// Each renders the shared state kit: not-connected -> EmptyState,
			// loading -> LoadingState, no-options -> EmptyState with the link in
			// its action slot, all-attached -> Notice.
			name: 'AuctionShippingViewNotConnected',
			render: () => (
				<div className="max-w-md">
					<AuctionShippingView
						attached={[]}
						unselected={[]}
						hasUser={false}
						isLoading={false}
						hasAnyOptions
						extraCostErrors={{}}
						onAdd={() => {}}
						onRemove={() => {}}
						onExtraCostChange={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'AuctionShippingViewLoading',
			render: () => (
				<div className="max-w-md">
					<AuctionShippingView
						attached={[]}
						unselected={[]}
						hasUser
						isLoading
						hasAnyOptions
						extraCostErrors={{}}
						onAdd={() => {}}
						onRemove={() => {}}
						onExtraCostChange={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'AuctionShippingViewNoOptions',
			render: () => (
				<div className="max-w-md">
					<AuctionShippingView
						attached={[]}
						unselected={[]}
						hasUser
						isLoading={false}
						hasAnyOptions={false}
						extraCostErrors={{}}
						onAdd={() => {}}
						onRemove={() => {}}
						onExtraCostChange={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'AuctionShippingViewAllAttached',
			render: () => (
				<div className="max-w-md">
					<AuctionShippingView
						attached={[]}
						unselected={[]}
						hasUser
						isLoading={false}
						hasAnyOptions
						extraCostErrors={{}}
						onAdd={() => {}}
						onRemove={() => {}}
						onExtraCostChange={() => {}}
					/>
				</div>
			),
		},
	],
}
