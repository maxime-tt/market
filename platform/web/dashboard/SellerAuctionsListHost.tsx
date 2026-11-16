/**
 * `SellerAuctionsListHost.tsx` — the seller dashboard's **own lots**, read from
 * the arena 1440 series and scoped to the signed-in seller.
 *
 * ## Why a new host and not `ArenaAuctionsListHost`
 *
 * The public `/auctions` index and this page read the **same** 1440 series
 * through the same adapter, so they share every projection: the card model, the
 * sort vocabulary, the honesty rules. What differs is the **subject**: the
 * public list is every live lot, and this one is *your* lots only. That subject
 * is a parameter the shared host does not carry, and `ADR-0007`'s rule is to add
 * a file rather than bend a shared one — editing `ArenaAuctionsListHost` would
 * put a seller filter on a public surface, and its empty sentence ("Every relay
 * answered and none of them carry a 1440 auction") would become a lie the moment
 * the read carried *other* sellers' lots but none of yours.
 *
 * So the filter lives here, the projection is **imported** (`selectArenaListCards`,
 * `arenaListSortOptions`, `arenaListPartialNotice`), and only the empty
 * sentences are seller-scoped. There is no second read and no second projection.
 *
 * ## Honesty, carried over unchanged
 *
 * The read state is a prop and is never re-derived: `loading` claims no count,
 * `incomplete` keeps every lot that arrived, `no-relays` is "no answer" and not
 * "you have none", and **"You have no auctions yet" is reachable only from
 * `settled`** — a finished read that carried no lot of yours.
 */

import type { ArenaAuctionSnapshot } from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	arenaListPartialNotice,
	arenaListSortOptions,
	selectArenaListCards,
	type ArenaListSort,
} from '@platform/web/auctions/relay/ArenaAuctionsListHost'
import { ArenaAuctionCard } from '@ui/auction/arena/auction-card'
import { AuctionFiltersView } from '@ui/auction/auction-list-views'
import type { ArenaRelayHealth, ArenaSurfaceStatus } from '@ui/auction/arena/model'
import { ItemGrid } from '@ui/shared/item-grid'
import { Button } from '@ui/wrappers/button'
import { sellerAuctionHref } from '@platform/web/dashboard/sellerAuctionHref'

// =========================================================================
// The seller scope
// =========================================================================

/**
 * The snapshot narrowed to one seller's lots, preserving order and every other
 * field (so `verdictDivergence` still reaches the cards). `null` in, `null` out:
 * "not read yet" is not "read and empty".
 */
export function sellerAuctionsSnapshot(
	snapshot: ArenaAuctionSnapshot | null,
	seller: string,
): ArenaAuctionSnapshot | null {
	if (snapshot === null) return null
	return { ...snapshot, auctions: snapshot.auctions.filter((auction) => auction.seller === seller) }
}

// =========================================================================
// The list's own sentences — one per read state, none interchangeable
// =========================================================================

export interface SellerListMessage {
	title: string
	detail: string
}

/**
 * What the seller's list says when it has no lot to show.
 *
 * The public list's sentences would be wrong here: a settled read that carried
 * only *other* sellers' lots is not "none of them carry a 1440 auction". Each
 * state keeps its own meaning, and only `settled` may say you have none.
 */
export function sellerListEmptyMessage(status: ArenaSurfaceStatus): SellerListMessage {
	switch (status) {
		case 'loading':
			return {
				title: 'Reading your auctions from relays…',
				detail: 'Nothing has arrived yet. An empty list here means the read has not finished, not that you have no auctions.',
			}
		case 'incomplete':
			return {
				title: 'The read stopped before every relay answered.',
				detail: 'Anything listed here is what arrived, not the whole picture.',
			}
		case 'no-relays':
			return {
				title: 'No relay answered, so your auctions could not be read.',
				detail: 'This is not the same as you having no auctions.',
			}
		case 'error':
			return {
				title: 'Your auctions could not be read right now.',
				detail: 'The read failed rather than answering. Retrying is the only honest next step.',
			}
		case 'settled':
			return {
				title: 'You have no auctions yet.',
				detail: 'Every relay answered and none of them carry a 1440 auction from you.',
			}
	}
}

// =========================================================================
// The host
// =========================================================================

export interface SellerAuctionsListHostProps {
	/** The read's snapshot, or `null` while nothing has been projected yet. */
	snapshot: ArenaAuctionSnapshot | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
	/** Unix seconds, supplied by the route so the projection is deterministic. */
	now: number
	/** The signed-in seller whose lots this list shows. */
	seller: string
	sort: ArenaListSort
	hideEnded: boolean
	onSortChange: (value: string) => void
	onToggleHideEnded: () => void
	onReset: () => void
}

/**
 * The seller's own lots: one `ArenaAuctionCard` per 1440 lot the seller
 * published. Controlled on purpose — the route owns the filter state, so the
 * host is a pure function of props and a test renders every state with literals.
 */
export function SellerAuctionsListHost({
	snapshot,
	status,
	relayHealth,
	now,
	seller,
	sort,
	hideEnded,
	onSortChange,
	onToggleHideEnded,
	onReset,
}: SellerAuctionsListHostProps) {
	const scoped = sellerAuctionsSnapshot(snapshot, seller)
	const { cards, total } = selectArenaListCards(scoped, {
		now,
		status,
		sort,
		hideEnded,
		divergences: scoped?.verdictDivergence,
	})

	const partialNotice = arenaListPartialNotice(status)
	const appliedFilterCount = (hideEnded ? 1 : 0) + (sort === 'newest' ? 0 : 1)
	// Settled, your lots exist, none visible: the filter did this, not the relays.
	const filteredToNothing = status === 'settled' && total > 0 && cards.length === 0
	const empty = sellerListEmptyMessage(status)

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
							data-slot="seller-auctions-list-notice"
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
								href={sellerAuctionHref(card.d, card.seller)}
							/>
						))}
					</ItemGrid>
				</>
			) : filteredToNothing ? (
				<div
					data-slot="seller-auctions-list-empty"
					data-state="filtered"
					className="flex min-h-[40vh] flex-col items-center justify-center gap-2 py-16 text-center"
				>
					<h2 className="text-xl font-semibold">No auctions match the current filter</h2>
					<p className="text-text-mid">Every relay answered and your lots were read — the filter above is hiding them all.</p>
					<Button variant="outline" onClick={onReset}>
						Reset filters
					</Button>
				</div>
			) : (
				<div
					data-slot="seller-auctions-list-empty"
					data-state={status}
					role="status"
					className="flex min-h-[40vh] flex-col items-center justify-center gap-2 py-16 text-center"
				>
					<h2 className="text-xl font-semibold">{empty.title}</h2>
					<p className="text-text-mid">{empty.detail}</p>
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
