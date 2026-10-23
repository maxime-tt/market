import { CheckCheck, Gavel, Hourglass } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Media } from '../shared/media'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../primitives/accordion'
import { StatusBadge } from '../shared/status-badge'
import { cn } from '../utils/cn'
import { Button } from '../wrappers/button'
import { AuctionStatusBadge } from './auction-detail-views'
import { AuctionActivityRow } from './auction-overview-views'

/**
 * Auction **list** presentations, lifted out of the dashboard auctions route
 * (`platform/web/routes/_dashboard-layout/dashboard/products/auctions.tsx`).
 *
 * The route is an assembler and must not define components. Everything that
 * acquires data — the notification store, the comments / live-chat /
 * claim-order queries, the protocol derivations, the top-bid selection and the
 * sorting — stays in the host (`src/components/dashboard/AuctionListItemHost.tsx`)
 * and reaches these views as props. Host-owned pieces are injected as nodes:
 * the bidder identity (an avatar inside the host's link), the open-auction
 * action, the countdown, the test-label control, and the settlement / order
 * actions.
 *
 * Declared visible changes: none. Markup, class strings and copy are identical
 * to the route's inline versions; the only difference is the prop surface.
 *
 * Declared styling change (T6.2): raw-palette classes were migrated to the
 * Tier-1 role vocabulary — greys to surface/text/border roles, red/rose to
 * `error`, amber to `warning`, sky to `info`, emerald to `success`. The state
 * families use the Tailwind-500 base shade, so a family hue may shift slightly.
 */

/** Relative "time ago" label for the top bid's creation time. */
function formatTimeAgo(timestamp: number): string {
	if (!timestamp) return ''
	const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
	if (diffSeconds < 60) return 'just now'
	const diffMinutes = Math.floor(diffSeconds / 60)
	if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`
	const diffHours = Math.floor(diffMinutes / 60)
	if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
	const diffDays = Math.floor(diffHours / 24)
	return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

/** Relative "time left" label for the settlement release window. */
function formatTimeLeft(seconds: number): string {
	if (seconds <= 0) return 'Expired'
	const days = Math.floor(seconds / 86400)
	if (days > 0) return `${days} day${days === 1 ? '' : 's'}`
	const hours = Math.floor(seconds / 3600)
	if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`
	const minutes = Math.floor(seconds / 60)
	if (minutes > 0) return `${minutes} min${minutes === 1 ? '' : 's'}`
	return `${seconds} sec${seconds === 1 ? '' : 's'}`
}

function formatMaybeDate(timestamp: number): string {
	if (!timestamp) return 'N/A'
	return new Date(timestamp * 1000).toLocaleString('en-US', {
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		month: 'long',
		year: 'numeric',
	})
}

export interface AuctionTopBidBoxProps {
	/** Top bid in sats; `null` renders the "no bids yet" state. */
	topBidSats: number | null
	/** Creation time of the top bid (unix seconds), rendered as a relative label. */
	topBidCreatedAt?: number
	/** Display name for the bidder; the host resolves the profile. */
	bidderName?: string
	/** Host-owned identity node for the bidder (avatar inside the host's link). */
	bidderIdentity?: ReactNode
	isSettlementPhase?: boolean
	showReleasePathDetails?: boolean
	showWaitingForReleasePath?: boolean
	showReleasePathReceived?: boolean
	showSettlementGrieved?: boolean
	showSettlementGrievedNoRelease?: boolean
	showWaitingForShippingMethod?: boolean
	/** Seconds left to publish the settlement, rendered as a relative label. */
	releasePathSecondsLeft?: number
	/** Identity of the settlement-details accordion item; the host scopes it to the bid. */
	releaseDetailsItemValue?: string
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** The top-bid panel of a dashboard auction card. */
export function AuctionTopBidBox({
	topBidSats,
	topBidCreatedAt = 0,
	bidderName,
	bidderIdentity,
	isSettlementPhase = false,
	showReleasePathDetails = false,
	showWaitingForReleasePath = false,
	showReleasePathReceived = false,
	showSettlementGrieved = false,
	showSettlementGrievedNoRelease = false,
	showWaitingForShippingMethod = false,
	releasePathSecondsLeft = 0,
	releaseDetailsItemValue = 'release-details',
	className,
	ref,
}: AuctionTopBidBoxProps) {
	if (topBidSats === null) {
		return (
			<div
				ref={ref}
				data-slot="auction-top-bid-box"
				className={cn(
					'flex h-full min-h-32 items-center justify-center rounded-xl border border-dashed border-border-default bg-surface-sunken px-5 py-4',
					className,
				)}
			>
				<p className="text-center text-sm text-text-mid">No bids yet. Winning bid will appear here.</p>
			</div>
		)
	}

	return (
		<div
			ref={ref}
			data-slot="auction-top-bid-box"
			className={cn(
				'h-full min-h-32 rounded-xl border-2 px-4 py-4',
				isSettlementPhase ? 'border-success-border bg-success-muted' : 'border-border-default bg-surface-sunken',
				className,
			)}
		>
			<div>
				<div
					className={cn(
						'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]',
						isSettlementPhase ? 'text-success-foreground' : 'text-text-high',
					)}
				>
					<span>Top bid:</span>
					<span>{formatTimeAgo(topBidCreatedAt)}</span>
				</div>
				<p className="mt-1 text-2xl font-semibold tracking-tight text-text-high">{topBidSats.toLocaleString()} sats</p>
			</div>
			<div className="mt-2 flex items-center justify-between gap-2">
				<StatusBadge
					status={isSettlementPhase ? 'Winning bid' : 'Current top bid'}
					tone={isSettlementPhase ? 'success' : 'neutral'}
					className="bg-surface-raised"
				/>

				<div className="flex items-center gap-2">
					{bidderIdentity}
					<span className="truncate max-w-32 text-sm font-medium">{bidderName}</span>
				</div>
			</div>
			{showReleasePathDetails && (
				<Accordion type="single" collapsible className="mt-3 rounded-xl border border-border-default bg-surface-raised px-4">
					<AccordionItem value={releaseDetailsItemValue} className="border-none">
						<AccordionTrigger className="py-4 text-sm font-semibold text-text-high hover:no-underline">Settlement details</AccordionTrigger>
						<AccordionContent className="space-y-3 pb-4">
							{showWaitingForReleasePath && (
								<div className="rounded-lg border border-warning-border bg-warning-muted px-3 py-2 text-sm text-warning-foreground">
									<div className="font-medium">Waiting for release path</div>
									<div className="mt-1">Bidder must publish the release path before settlement can be published.</div>
								</div>
							)}
							{showReleasePathReceived && (
								<div className="rounded-lg border border-info-border bg-info-muted px-3 py-2 text-sm text-info-foreground">
									<div className="font-medium">Release path received</div>
									<div className="mt-1">{formatTimeLeft(releasePathSecondsLeft)} to publish settlement</div>
								</div>
							)}
							{showSettlementGrieved && (
								<div className="rounded-lg border border-error-border bg-error-muted px-3 py-2 text-sm text-error-foreground">
									Bid was not settled. It was grieved after release path.
								</div>
							)}
							{showSettlementGrievedNoRelease && (
								<div className="rounded-lg border border-error-border bg-error-muted px-3 py-2 text-sm text-error-foreground">
									Bid was not settled. It was grieved because release path was not published.
								</div>
							)}
							{showWaitingForShippingMethod && (
								<Button
									type="button"
									variant="outline"
									disabled
									className="w-full justify-start gap-2 border-info-border bg-info-muted text-info-foreground hover:bg-info-muted"
								>
									<Hourglass className="h-4 w-4" aria-hidden="true" />
									Waiting for bidder shipping method
								</Button>
							)}
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			)}
		</div>
	)
}

export interface AuctionListItemActivity {
	bids: number
	newBids: number
	comments: number
	newComments: number
	liveChat: number
	newChat: number
}

export interface AuctionListItemViewProps {
	title: string
	summary: string
	/** Creation time of the auction (unix seconds), rendered as a date label. */
	createdAt?: number
	thumbnailUrl?: string | null
	/** Lifecycle status; rendered through `AuctionStatusBadge`. */
	status: string
	/** Host-owned nodes: actions, countdown, top-bid panel, test-label control. */
	openAuctionAction?: ReactNode
	testLabelAction?: ReactNode
	topBidBox?: ReactNode
	countdown?: ReactNode
	settlementAction?: ReactNode
	orderAction?: ReactNode
	shippingMethodNotice?: ReactNode
	/** Activity counts, resolved by the host. */
	activity?: AuctionListItemActivity
	hasNewActivity?: boolean
	onMarkActivitySeen?: () => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** One auction row of the dashboard auctions list. */
export function AuctionListItemView({
	title,
	summary,
	createdAt = 0,
	thumbnailUrl,
	status,
	openAuctionAction,
	testLabelAction,
	topBidBox,
	countdown,
	settlementAction,
	orderAction,
	shippingMethodNotice,
	activity,
	hasNewActivity = false,
	onMarkActivitySeen,
	className,
	ref,
}: AuctionListItemViewProps) {
	const counts = activity ?? { bids: 0, newBids: 0, comments: 0, newComments: 0, liveChat: 0, newChat: 0 }

	return (
		<div ref={ref} data-slot="auction-list-item" className={cn('rounded-lg border border-border-default bg-bg p-6 shadow-md', className)}>
			<div className="flex flex-col gap-6 lg:flex-row">
				<div className="flex shrink-0 items-center gap-3 lg:flex-col lg:items-center">
					{thumbnailUrl ? (
						<div className="overflow-hidden rounded-xl border border-border-default bg-surface-sunken p-1 shadow-sm ring-1 ring-border-default">
							<Media src={thumbnailUrl} alt="" className="h-24 w-24 shrink-0 object-cover lg:h-32 lg:w-32" />
						</div>
					) : (
						<div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-default bg-surface-sunken shadow-sm ring-1 ring-border-default lg:h-32 lg:w-32">
							<Gavel className="h-8 w-8 text-text-mid" />
						</div>
					)}
					{openAuctionAction}
					{testLabelAction}
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-4 lg:max-w-[28rem]">
					<div className="min-w-0">
						<h3 className="text-lg font-semibold text-text-high truncate">{title}</h3>
						<p className="text-sm text-text-mid truncate">{summary}</p>
						<p className="mt-1 text-xs text-text-mid">Created: {formatMaybeDate(createdAt)}</p>
					</div>

					{topBidBox}

					{settlementAction}

					{orderAction}

					{shippingMethodNotice}
				</div>

				<div className="ml-auto flex w-full shrink-0 flex-col items-end gap-3 lg:w-[22rem]">
					<div className="flex w-full items-center gap-2">
						<div className="min-w-0 flex-1">{countdown}</div>
						<AuctionStatusBadge status={status} />
					</div>
					<div className="w-full space-y-3 rounded-xl border border-border-default bg-surface-sunken px-5 py-5">
						<div className="flex items-center justify-between gap-3">
							<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-mid">Activity</p>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={onMarkActivitySeen}
								disabled={!hasNewActivity}
								className="h-7 rounded-md border border-border-default bg-surface-raised px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-mid hover:bg-surface-hover hover:text-text-high"
							>
								<CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
								Mark as seen
							</Button>
						</div>
						<AuctionActivityRow header="Bids" unit="Bid" count={counts.bids} newCount={counts.newBids} />
						<AuctionActivityRow header="Comments" unit="Comment" count={counts.comments} newCount={counts.newComments} />
						<AuctionActivityRow header="Live Chat" unit="Message" count={counts.liveChat} newCount={counts.newChat} />
					</div>
				</div>
			</div>
		</div>
	)
}
