import { useState } from 'react'
import type { BidGroupStatus } from '@sdk/commerce/auctions/bidGroupStatus'
import type {
	AuctionAntiSnipeWindowMinutesPreset,
	AuctionMinBidCurvePeakPreset,
	AuctionMinBidCurveShape,
	AuctionSettlementGracePreset,
} from '@sdk/commerce/auctions/auctionForm'
import { AuctionListItemView, AuctionTopBidBox } from '@ui/auction/auction-list-views'
import { AuctionTimelinePreview } from '@ui/auction/auction-timeline-preview'
import { AntiSnipeCurveSettings } from '@ui/auction/anti-snipe-curve-settings'
import { BidLadderPreview } from '@ui/auction/bid-ladder-preview'
import { SettlementGraceSettings } from '@ui/auction/settlement-grace-settings'
import { BidStatusBanner, BidStatusPill, getBidStatusCopy, type BidStatusDisplayInput } from '@ui/auction/bid-status-views'
import { AuctionShippingDetailRow, AuctionShippingOptionCard } from '@ui/auction/shipping-option-views'
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
	],
}
