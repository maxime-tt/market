import { cn } from '@ui/utils/cn'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'

/**
 * A listing of auctions an author can place in a page.
 *
 * This is the "interconnected" step for auctions: they stop being a route with
 * no inbound links and become something an author composes with.
 *
 * Props-only, per `ui/AGENTS.md`: no `fetch`, no `useQuery`, no relay client,
 * no `@platform/…` import. The platform host reads the auctions through
 * `arenaAuctionRead` and passes them down as plain data — including the state
 * of the read itself, because this block's whole job is to be *honest* about
 * what it does and does not know.
 *
 * ## The honesty rules this view enforces
 *
 * - A count is a **verdict**, and a verdict is only true once the read has
 *   finished. While `status === 'loading'` the block never claims how many
 *   auctions exist; it says what it has delivered *so far*.
 * - `incomplete` (a relay timed out, or the read stopped early) keeps the
 *   auctions that arrived and says the picture is partial. It never falls
 *   through to "no auctions here", which would be a claim it cannot make.
 * - `no-relays` is not an empty result: nothing was read, so nothing is said
 *   about whether auctions exist.
 * - An auction whose on-chain verification is unknown says so. The verdict is
 *   relay-reported and the block labels it that way — the relay notifies, the
 *   chain decides.
 * - `emptyMessage` ("no auctions yet") is reachable **only** from `settled`.
 *
 * The read-model types below are deliberately structural: `ui/` may import
 * `@sdk/…` types, and these are the plain shapes the platform adapter produces.
 */

/** The document-facing configuration of the block (what the page event stores). */
export interface AuctionListBlockProps {
	title: string
	/** `mine` = the page author's auctions; `picked` = the explicit coordinates below. */
	source: 'mine' | 'picked'
	/** Ordered `1440:<seller>:<d>` references, used when `source` is `picked`. */
	auctionCoordinates: string[]
	limit: number
	emptyMessage: string
}

/** One auction, as the host read it. No field here is stored in the document. */
export interface AuctionListItem {
	/** `1440:<seller>:<d>`, the identity this block links with. */
	coordinate: string
	seller: string
	/** The auction's `d` tag. */
	d: string
	title: string | null
	startingBid: number | null
	/** Summed from the bid **deltas** — a derived view, not the outcome. */
	topBidTotal: number | null
	bidCount: number
	/** `created_at + duration_seconds`, or `null` when the create carried no duration. */
	endsAt: number | null
	/** `unknown` is a real answer: a create with no duration has no end to state. */
	phase: 'open' | 'ended' | 'unknown'
	/** The relay-reported verdict outcome, or `null` when no verdict has been read. */
	verdict: string | null
}

/**
 * The state of the read that produced the list.
 *
 * `loading`  — still running; the items are what arrived so far.
 * `settled`  — every relay answered; an empty list is a verdict.
 * `incomplete` — the read stopped without every relay answering.
 * `no-relays` — nothing answered; this is not "no auctions".
 * `error`    — the read threw, or no host supplied the data.
 */
export type AuctionListStatus = 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'

/** The props-only view contract: the block plus its data and read state. */
export interface AuctionListBlockViewProps extends AuctionListBlockProps {
	/** The auctions read so far; `null` means no data reached the view. */
	auctions: AuctionListItem[] | null
	/** Requested coordinates the read did not deliver. Meaning depends on `status`. */
	missing: string[]
	status: AuctionListStatus
	/** Relays that answered, out of the relays the read opened. */
	relayHealth: { answered: number; total: number }
	/** Host-supplied link target for one auction (the block never invents a route). */
	auctionHref: (coordinate: string) => string
}

/** A pubkey is unreadable in full at card size; keep the ends, drop the middle. */
function shortKey(key: string): string {
	return key.length <= 14 ? key : `${key.slice(0, 6)}…${key.slice(-4)}`
}

function phaseLabel(item: AuctionListItem): string {
	if (item.phase === 'open') return 'Open'
	if (item.phase === 'ended') return 'Ended'
	return 'End time unknown'
}

function AuctionCard({ item, auctionHref }: { item: AuctionListItem; auctionHref: (coordinate: string) => string }) {
	const label = item.title?.trim() || item.d
	return (
		<article
			data-testid={`storefront-auction-${item.d}`}
			data-phase={item.phase}
			data-verdict={item.verdict ?? 'unknown'}
			className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
		>
			<a href={auctionHref(item.coordinate)} className="font-header text-lg font-semibold text-foreground hover:underline">
				{label}
			</a>
			<p className="text-xs text-muted-foreground">by {shortKey(item.seller)}</p>

			<p data-testid={`storefront-auction-${item.d}-phase`} className="text-sm text-foreground">
				{phaseLabel(item)}
			</p>

			{item.startingBid !== null && (
				<p data-testid={`storefront-auction-${item.d}-starting-bid`} className="text-sm text-muted-foreground">
					Starting bid {item.startingBid} sats
				</p>
			)}

			{item.topBidTotal !== null && (
				<p data-testid={`storefront-auction-${item.d}-top-bid`} className="text-sm text-foreground">
					{item.bidCount === 1 ? '1 bid' : `${item.bidCount} bids`} · top {item.topBidTotal} sats
				</p>
			)}

			{item.verdict !== null ? (
				<p data-testid={`storefront-auction-${item.d}-verdict`} className="text-sm text-foreground">
					{/* The relay notifies, the chain decides: this is a published claim, not a receipt. */}
					Outcome: {item.verdict} (relay-reported)
				</p>
			) : item.phase === 'ended' ? (
				<p data-testid={`storefront-auction-${item.d}-unverified`} className="text-sm text-muted-foreground">
					Outcome not verified yet.
				</p>
			) : null}
		</article>
	)
}

export function AuctionListBlock({
	title,
	source,
	auctionCoordinates,
	limit,
	emptyMessage,
	auctions,
	missing,
	status,
	relayHealth,
	auctionHref,
}: AuctionListBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const items = (auctions ?? []).slice(0, Math.max(0, limit))

	// Picked mode with nothing picked is an authoring gap, not a visitor fact.
	if (source === 'picked' && auctionCoordinates.length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-8">
				<StorefrontSectionTitle title={title} />
				<StorefrontEditorHint>Pick the auctions this section should show.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	return (
		<StorefrontSection width="wide" className={cn('py-10', isEditing && 'pointer-events-none')}>
			<StorefrontSectionTitle title={title} />

			<div data-testid="storefront-auction-list" data-state={status}>
				{/* Nothing delivered yet. No count, because there is no verdict yet. */}
				{status === 'loading' && items.length === 0 && (
					<p data-testid="storefront-auction-list-loading" className="py-8 text-center text-muted-foreground">
						Reading auctions from relays…
					</p>
				)}

				{status === 'loading' && items.length > 0 && (
					<p data-testid="storefront-auction-list-progress" className="mb-4 text-sm text-muted-foreground">
						Still reading relays · {items.length} {items.length === 1 ? 'auction' : 'auctions'} so far
						{relayHealth.total > 0 && ` · ${relayHealth.answered} of ${relayHealth.total} relays answered`}
					</p>
				)}

				{status === 'incomplete' && (
					<p data-testid="storefront-auction-list-incomplete" className="mb-4 text-sm text-muted-foreground">
						This read stopped before every relay answered. What is shown is what arrived, not the whole picture.
					</p>
				)}

				{status === 'no-relays' && (
					<p data-testid="storefront-auction-list-unreachable" className="py-8 text-center text-muted-foreground">
						No relay answered, so these auctions could not be read. This is not the same as there being none.
					</p>
				)}

				{status === 'error' && (
					<p data-testid="storefront-auction-list-error" className="py-8 text-center text-muted-foreground">
						Auctions could not be loaded right now.
					</p>
				)}

				{/* The one place an empty list is allowed to be an answer. */}
				{status === 'settled' && items.length === 0 && (
					<p data-testid="storefront-auction-list-empty" className="py-8 text-center text-muted-foreground">
						{emptyMessage.trim() || 'No auctions here yet.'}
					</p>
				)}

				{items.length > 0 && (
					<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{items.map((item) => (
							<AuctionCard key={item.coordinate} item={item} auctionHref={auctionHref} />
						))}
					</div>
				)}

				{missing.length > 0 && (
					// A requested auction with no data means different things in
					// different read states, and the two are not interchangeable.
					<p
						data-testid="storefront-auction-list-missing"
						data-settled={status === 'settled'}
						className="mt-4 text-sm text-muted-foreground"
					>
						{status === 'settled'
							? `${missing.length} requested ${missing.length === 1 ? 'auction was' : 'auctions were'} not found on the relays.`
							: `${missing.length} requested ${missing.length === 1 ? 'auction has' : 'auctions have'} not arrived yet.`}
					</p>
				)}
			</div>
		</StorefrontSection>
	)
}