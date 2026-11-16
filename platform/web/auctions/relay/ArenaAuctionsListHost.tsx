/**
 * `ArenaAuctionsListHost.tsx` — the `/auctions` **index** surface: every live
 * 1440 lot, as cards, with the arena read's honesty rules kept intact.
 *
 * ## Why a host and not the route
 *
 * `platform/web/routes/*` assembles; it does not define presentational
 * components (`ADR-0007` §1b, enforced by `scripts/check-ui-assembler.sh`). The
 * route therefore holds the filter `useState` and the read, and this host is a
 * pure function of props — which is also what makes it testable without a relay:
 * the read's state is handed in, so a test can render every state literally.
 *
 * ## The read is `useArenaSurfacesRead`, and nothing here reconstructs it
 *
 * The cards come from `toAuctionCardModel`, the same projection
 * `auctions.$auctionId.tsx` uses, so a lot reads identically in a list and on its
 * own page. `status` and `relayHealth` are passed **through** to every card and to
 * the list's own notices; this host never re-derives them, because a second
 * implementation of the read's honesty rule would eventually disagree with the
 * first:
 *
 * - `loading` never states how many lots exist — the only sentence is that the
 *   read has not finished;
 * - `incomplete` keeps every lot that arrived and says the picture is partial;
 * - `no-relays` is a read that got no answer, never "there are no auctions";
 * - **"No auctions yet" is reachable only from `settled`** — every relay answered
 *   and none of them carried a 1440;
 * - relay disagreement reaches the card (`divergent`), never smoothed away.
 *
 * ## What this page offers, and what it deliberately does not
 *
 * The filter bar is the same `AuctionFiltersView` the route used before, but its
 * vocabulary is now **only what the arena read-model can support**: "hide ended
 * auctions" (a real `phase` filter) and a real sort over fields the card model
 * actually carries. The retired controls are gone rather than left inert:
 *
 * - the 30408 **category chips** are deleted — a 1440 create carries no category
 *   in the read's content (`ArenaCreateContent`), so a chip could not filter
 *   anything;
 * - the **`Show test listings`** toggle is deleted — the arena read has no
 *   test-label concept, so the toggle gated nothing.
 */

import type { ArenaAuctionSnapshot, ArenaAuctionView, ArenaVerdictDivergence } from '@platform/web/auctions/relay/arenaAuctionRead'
import { auctionEndsAt, toAuctionCardModel } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { ArenaAuctionCard } from '@ui/auction/arena/auction-card'
import { AuctionFiltersView } from '@ui/auction/auction-list-views'
import type { ArenaAuctionCardModel, ArenaRelayHealth, ArenaSurfaceStatus } from '@ui/auction/arena/model'
import { ItemGrid } from '@ui/shared/item-grid'
import { Button } from '@ui/wrappers/button'

// =========================================================================
// The link shape — the `d` tag only, the existing contract
// =========================================================================

/**
 * `/auctions/<d>`.
 *
 * The route's param is the `d` tag (`auctions.$auctionId.tsx` reads it as the
 * auction id), so the seller and the kind do not belong in the URL. This mirrors
 * `auctionHref` in `platform/web/storefront/StorefrontBlockSlots.tsx` — the same
 * contract, deliberately not a second convention.
 */
export function arenaAuctionHref(d: string): string {
	return `/auctions/${encodeURIComponent(d)}`
}

// =========================================================================
// Selection — filter and sort over the read-model, never over an event
// =========================================================================

/**
 * The sorts the arena card model can actually perform.
 *
 * Every option here reads a field `ArenaAuctionCardModel` carries; there is no
 * option for a field the read does not deliver (no category, no bid count as an
 * order key — a count that is still arriving is not an order).
 */
export type ArenaListSort = 'newest' | 'ending-soon' | 'highest-starting-bid' | 'title-a-z'

export const arenaListSortOptions: readonly { value: ArenaListSort; title: string }[] = [
	{ value: 'newest', title: 'Newest first' },
	{ value: 'ending-soon', title: 'Ending soonest' },
	{ value: 'highest-starting-bid', title: 'Highest starting bid' },
	{ value: 'title-a-z', title: 'Title A–Z' },
]

export interface ArenaListSelection {
	/** Unix seconds, supplied by the caller so the projection stays pure. */
	now: number
	/** The read state, as `arenaSurfaceStatus` computed it. */
	status: ArenaSurfaceStatus
	sort: ArenaListSort
	hideEnded: boolean
	/** `snapshot.verdictDivergence`, so a card can flag relay disagreement. */
	divergences?: readonly ArenaVerdictDivergence[]
}

export interface ArenaListSelectionResult {
	/** The cards to render, in the selected order. */
	cards: ArenaAuctionCardModel[]
	/** How many lots the read delivered, **before** the filter. */
	total: number
}

/** The label a lot falls back to when the create stated no title. */
function labelOf(view: ArenaAuctionView): string {
	return view.content.title?.trim() || view.d
}

/** A stable last-resort tiebreak, so two renders of one read are the same order. */
function byCoordinate(a: ArenaAuctionView, b: ArenaAuctionView): number {
	return a.coordinate.localeCompare(b.coordinate)
}

/**
 * Order the views before projection.
 *
 * `newest` is the **root** create's `created_at` (`rootCreatedAt`), not the
 * canonical version's: an edit to a title moves the canonical timestamp, and a
 * list that reorders itself when someone fixes a typo is not ordered by time.
 *
 * `null` is ordered **last** in both field orders, never as a zero: a lot with no
 * stated end has no position in a time order (it is not "ending now"), and a lot
 * with no stated price has no position in a price order (it is not "cheapest").
 */
export function orderArenaViews(views: readonly ArenaAuctionView[], sort: ArenaListSort): ArenaAuctionView[] {
	const ordered = [...views]
	if (sort === 'newest') return ordered.sort((a, b) => b.rootCreatedAt - a.rootCreatedAt || byCoordinate(a, b))
	if (sort === 'ending-soon') {
		return ordered.sort((a, b) => {
			const aEnd = auctionEndsAt(a)
			const bEnd = auctionEndsAt(b)
			if (aEnd === null && bEnd === null) return byCoordinate(a, b)
			if (aEnd === null) return 1
			if (bEnd === null) return -1
			return aEnd - bEnd || byCoordinate(a, b)
		})
	}
	if (sort === 'highest-starting-bid') {
		return ordered.sort((a, b) => {
			const aPrice = a.content.startPrice
			const bPrice = b.content.startPrice
			if (aPrice === null && bPrice === null) return byCoordinate(a, b)
			if (aPrice === null) return 1
			if (bPrice === null) return -1
			return bPrice - aPrice || byCoordinate(a, b)
		})
	}
	return ordered.sort((a, b) => labelOf(a).localeCompare(labelOf(b)) || byCoordinate(a, b))
}

/**
 * Project the snapshot, apply the filter, then the sort.
 *
 * `total` is the count **before** the filter and exists for one reason: a
 * settled read that produced lots but no visible lot is a filter's fault, and an
 * empty read is not — the two sentences must not be confused.
 */
export function selectArenaListCards(
	snapshot: ArenaAuctionSnapshot | null,
	selection: ArenaListSelection,
): ArenaListSelectionResult {
	const views = snapshot?.auctions ?? []
	const context = { now: selection.now, status: selection.status, divergences: selection.divergences }
	const cards = orderArenaViews(views, selection.sort).map((view) => toAuctionCardModel(view, context))
	const kept = selection.hideEnded ? cards.filter((card) => card.phase !== 'ended') : cards
	return { cards: kept, total: cards.length }
}

// =========================================================================
// The list's own sentences — one per read state, none interchangeable
// =========================================================================

export interface ArenaListMessage {
	title: string
	detail: string
}

/**
 * What the list says when it has no card to show.
 *
 * Each state gets its own sentence. `settled` alone may say there are no
 * auctions; the other four say what the read is doing (or failed to do), because
 * "nothing on screen" has four different causes and only one of them is a fact
 * about the world.
 */
export function arenaListEmptyMessage(status: ArenaSurfaceStatus): ArenaListMessage {
	switch (status) {
		case 'loading':
			return {
				title: 'Reading auctions from relays…',
				detail: 'Nothing has arrived yet. An empty list here means the read has not finished, not that there are no auctions.',
			}
		case 'incomplete':
			return {
				title: 'The read stopped before every relay answered.',
				detail: 'Anything listed here is what arrived, not the whole picture.',
			}
		case 'no-relays':
			return {
				title: 'No relay answered, so no auctions could be read.',
				detail: 'This is not the same as there being no auctions.',
			}
		case 'error':
			return {
				title: 'Auctions could not be read right now.',
				detail: 'The read failed rather than answering. Retrying is the only honest next step.',
			}
		case 'settled':
			return {
				title: 'No auctions yet.',
				detail: 'Every relay answered and none of them carry a 1440 auction.',
			}
	}
}

/**
 * The band a list shows **above** the lots while the read is not finished, or
 * `null` once it has settled.
 *
 * It states no count on purpose: a lot count while the read runs would be a
 * verdict about a read that has not reached one. The cards below it are what the
 * read has delivered; each card qualifies its own numbers.
 */
export function arenaListPartialNotice(status: ArenaSurfaceStatus): string | null {
	switch (status) {
		case 'loading':
			return 'Still reading from relays — what is listed below is what has arrived so far.'
		case 'incomplete':
			return 'The read stopped before every relay answered — what is listed below is what arrived, not the whole picture.'
		case 'error':
			return 'The read failed — what is listed below is what had arrived when it stopped.'
		case 'no-relays':
			return 'No relay answered, so nothing could be read.'
		case 'settled':
			return null
	}
}

// =========================================================================
// The host
// =========================================================================

export interface ArenaAuctionsListHostProps {
	/** The read's snapshot, or `null` while nothing has been projected yet. */
	snapshot: ArenaAuctionSnapshot | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds, supplied by the route so the projection is deterministic. */
	now: number
	sort: ArenaListSort
	hideEnded: boolean
	onSortChange: (value: string) => void
	onToggleHideEnded: () => void
	onReset: () => void
}

/**
 * The index list: one `ArenaAuctionCard` per live 1440 lot.
 *
 * Controlled on purpose — the route owns the filter state, so the host is a pure
 * function of props and a test renders any state with literals.
 */
export function ArenaAuctionsListHost({
	snapshot,
	status,
	relayHealth,
	now,
	sort,
	hideEnded,
	onSortChange,
	onToggleHideEnded,
	onReset,
}: ArenaAuctionsListHostProps) {
	const { cards, total } = selectArenaListCards(snapshot, {
		now,
		status,
		sort,
		hideEnded,
		divergences: snapshot?.verdictDivergence,
	})

	const partialNotice = arenaListPartialNotice(status)
	const appliedFilterCount = (hideEnded ? 1 : 0) + (sort === 'newest' ? 0 : 1)
	// Settled, lots exist, none visible: the filter did this, not the relays.
	const filteredToNothing = status === 'settled' && total > 0 && cards.length === 0

	return (
		<div className="flex flex-col gap-4">
			<AuctionFiltersView
				appliedFilterCount={appliedFilterCount}
				hideEnded={hideEnded}
				sort={sort}
				sortOptions={arenaListSortOptions}
				onToggleHideEnded={onToggleHideEnded}
				onSortChange={onSortChange}
				onReset={onReset}
			/>

			{cards.length > 0 ? (
				<>
					{partialNotice !== null && (
						<p
							data-slot="arena-auctions-list-notice"
							data-state={status}
							role="status"
							className="rounded-md border border-dashed border-border-default bg-surface-sunken px-4 py-3 text-sm text-text-mid"
						>
							{partialNotice}
						</p>
					)}
					<ItemGrid className="gap-4 sm:gap-8">
						{cards.map((card) => (
							<ArenaAuctionCard
								key={card.coordinate}
								model={card}
								status={status}
								relayHealth={relayHealth}
								href={arenaAuctionHref(card.d)}
							/>
						))}
					</ItemGrid>
				</>
			) : filteredToNothing ? (
				<div
					data-slot="arena-auctions-list-empty"
					data-state="filtered"
					className="flex min-h-[40vh] flex-col items-center justify-center gap-2 py-16 text-center"
				>
					<h2 className="text-xl font-semibold">No auctions match the current filter</h2>
					<p className="text-text-mid">Every relay answered and the lots were read — the filter above is hiding them all.</p>
					<Button variant="outline" onClick={onReset}>
						Reset filters
					</Button>
				</div>
			) : (
				<div
					data-slot="arena-auctions-list-empty"
					data-state={status}
					role="status"
					className="flex min-h-[40vh] flex-col items-center justify-center gap-2 py-16 text-center"
				>
					<h2 className="text-xl font-semibold">{arenaListEmptyMessage(status).title}</h2>
					<p className="text-text-mid">{arenaListEmptyMessage(status).detail}</p>
					{relayHealth.total > 0 && (
						<p className="text-xs text-text-mid opacity-80">
							{relayHealth.answered} of {relayHealth.total} relays answered
						</p>
					)}
				</div>
			)}
		</div>
	)
}
