/**
 * `platform/web/featured/featuredAuctionLots.ts` — the featured-auctions list's
 * view of the arena read.
 *
 * ## What a featured auction is now
 *
 * A curated entry is the coordinate `1440:<seller>:<d>` of a live arena lot, so
 * "the entry" and "the lot" are two different things: the list remembers the
 * coordinate, and only a read can say whether that lot is published right now.
 * An entry whose lot the read did not deliver is **not** rendered as an auction
 * — there is no title, no price and no end time to render, and inventing them
 * would be the fabrication this module exists to prevent.
 *
 * ## Three outcomes, never two
 *
 * A coordinate the read did not deliver means different things depending on the
 * read, so {@link resolveFeaturedAuctionEntries} keeps them apart:
 *
 * - `missing` — the read **settled** (every relay answered) and no relay carried
 *   that lot: it is not published any more;
 * - `unread` — the read has not settled (`loading` / `incomplete` / `no-relays` /
 *   `error`): the lot may well exist, nobody has told us yet;
 * - `lot` — the read delivered it.
 *
 * Collapsing `unread` into `missing` would accuse a live lot of being deleted
 * every time a relay was slow. `status` and `relayHealth` are passed through
 * untouched — this module adds no second opinion on the read's honesty.
 *
 * ## The picker offers only what the read delivered
 *
 * {@link featuredAuctionOptions} is the admin picker's whole vocabulary: the
 * published lots, minus the ones already featured. There is no free-text path,
 * so a curator cannot name a coordinate that does not resolve.
 */

import type { ArenaAuctionSnapshot, ArenaVerdictDivergence } from '@platform/web/auctions/relay/arenaAuctionRead'
import { findAuction, toAuctionCardModel, type ArenaSurfaceContext } from '@platform/web/auctions/relay/auctionSurfacesRead'
import type { ArenaAuctionCardModel, ArenaRelayHealth, ArenaSurfaceStatus } from '@ui/auction/arena/model'

/** The read state a featured-auctions surface composes from (`useArenaSurfacesRead`). */
export interface FeaturedAuctionRead {
	snapshot: ArenaAuctionSnapshot | null
	status: ArenaSurfaceStatus
	relayHealth: ArenaRelayHealth
}

/** One curated entry, as the admin list renders it. */
export type FeaturedAuctionEntry =
	/** The read delivered the lot. */
	| { kind: 'lot'; coordinate: string; card: ArenaAuctionCardModel }
	/** The read has not settled, so the entry's lot is simply not known yet. */
	| { kind: 'unread'; coordinate: string }
	/** The read settled and no relay carried the lot: it is no longer published. */
	| { kind: 'missing'; coordinate: string }

/** One published lot the curator may feature. */
export interface FeaturedAuctionOption {
	/** `1440:<seller>:<d>`. */
	coordinate: string
	/** The lot's title, falling back to its `d` tag — the label of last resort. */
	label: string
}

function projectionContext(read: FeaturedAuctionRead, now: number): ArenaSurfaceContext {
	const context: ArenaSurfaceContext = { now, status: read.status }
	const divergences: readonly ArenaVerdictDivergence[] | undefined = read.snapshot?.verdictDivergence
	return divergences === undefined ? context : { ...context, divergences }
}

/**
 * Resolve the curated coordinates against the read, in list order.
 *
 * Order is the curator's, not the read's: the whole point of the list is the
 * sequence an editor chose. A coordinate the read dropped keeps its place, so
 * removing or reordering one entry never silently moves the others.
 */
export function resolveFeaturedAuctionEntries(
	coordinates: readonly string[],
	read: FeaturedAuctionRead,
	now: number,
): FeaturedAuctionEntry[] {
	const settled = read.status === 'settled'
	const context = projectionContext(read, now)
	return coordinates.map((coordinate): FeaturedAuctionEntry => {
		const view = read.snapshot ? findAuction(read.snapshot, coordinate) : null
		if (view) return { kind: 'lot', coordinate, card: toAuctionCardModel(view, context) }
		return settled ? { kind: 'missing', coordinate } : { kind: 'unread', coordinate }
	})
}

/**
 * The published lots worth offering, newest first (the snapshot's own order),
 * with the already-featured ones removed.
 */
export function featuredAuctionOptions(read: FeaturedAuctionRead, featured: readonly string[]): FeaturedAuctionOption[] {
	if (!read.snapshot) return []
	const already = new Set(featured)
	return read.snapshot.auctions
		.map((view) => ({ coordinate: view.coordinate, label: view.content.title?.trim() || view.d }))
		.filter((option) => !already.has(option.coordinate))
}

/**
 * Just the lots, in the curator's order — the public featured strip's shape.
 *
 * A curated entry the read did not deliver contributes nothing here: a
 * promotional strip has no way to act on "not published", and a card with a
 * blank title would be the fabrication. The admin surface, which *can* act on
 * it, uses {@link resolveFeaturedAuctionEntries} instead and says so.
 */
export function featuredAuctionCards(coordinates: readonly string[], read: FeaturedAuctionRead, now: number): ArenaAuctionCardModel[] {
	return resolveFeaturedAuctionEntries(coordinates, read, now).flatMap((entry) => (entry.kind === 'lot' ? [entry.card] : []))
}

/**
 * The one sentence the picker may state about the read itself, or `null` when
 * the read is settled and the picker can speak for the lots it lists.
 *
 * A settled read with an empty list is not this function's business: only the
 * surface knows whether no lot is published at all or every published lot is
 * already featured.
 */
export function featuredAuctionReadNotice(read: FeaturedAuctionRead): string | null {
	switch (read.status) {
		case 'settled':
			return null
		case 'loading':
			return 'Reading published auctions from relays… Nothing is offered until the read answers, because an empty picker while the read runs would claim there are no lots.'
		case 'incomplete':
			return `The read stopped before every relay answered (${read.relayHealth.answered}/${read.relayHealth.total}), so this list of published auctions is partial.`
		case 'no-relays':
			return 'No relay answered, so the published auctions could not be read. This is not the same as there being none.'
		case 'error':
			return 'The published auctions could not be read right now. Retrying is the only honest next step.'
	}
}