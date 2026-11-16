/**
 * platform/web/notifications/arenaMonitorRules.ts — the arena 1440-series rules the notification
 * monitor applies to the events it reads.
 *
 * Every rule here is pure: no NDK, no relay, no clock. The monitor owns the transport and the
 * subscriptions; it hands each arriving event to one of these functions and acts on the answer.
 * Keeping them separate is what makes the mapping testable without a relay double, and it is the
 * same split the rest of this directory already uses (`productNotificationScopes`, `rules`).
 *
 * What these replace, and why nothing is left behind: the monitor used to read the retired
 * `cashu_p2pk_bidder_path_v1` series — kind 30408 auctions, 1023 bids and 1024 settlements — through
 * the `auctionRead` getters (`getAuctionStartAt`, `getAuctionBiddingCutoffAt`, `getBidAmount`,
 * `getBidAuctionEventId`, …). None of those kinds can arrive any more, so each branch is retargeted
 * to the arena wire shape rather than kept as a second path:
 *
 *   - the notification key of a lot is its **coordinate** `1440:<seller>:<d>` (a 1440 is a regular
 *     kind, so versions of one lot share a `d`, and a bid binds to the lot, not to a version);
 *   - phase times come from the **root** create's `created_at` and its `content.durationSec`
 *     (`arenaAuctionRead` roots a lot at the earliest 1440 and treats every event carrying an `e`
 *     tag as an update — an update never re-announces a start);
 *   - a bid's amount is a **delta** added to the bidder's position (`arenaBidRead`'s
 *     `client.ts:63` note; the read adapter sums the deltas), so "a higher bid" is decided on the
 *     summed positions, never on a single event's number;
 *   - the terminal event is the **1445 verdict**, which names its lot by `auction` (a `d` or a
 *     coordinate) and carries no `a` tag, so it is bound locally against the lots the user watches.
 *
 * The 1023 `status` tag has no arena equivalent — a 1441 carries funding proofs and a delta, not a
 * lifecycle status — so the monitor's "ignore cancelled/refunded bids" branch is gone rather than
 * retargeted to a field that does not exist.
 */

import { ARENA_AUCTION_BID_KIND, ARENA_AUCTION_CREATE_KIND, ARENA_VERDICT_KIND } from '@sdk/commerce/auctions/constants'
import { arenaAuctionCoordinate } from '@platform/web/auctions/relay/arenaAuctionRead'

/** The part of an NDK event (or any relay event) these rules read. */
export interface ArenaEventLike {
	id?: string
	pubkey: string
	kind: number
	created_at?: number
	tags: string[][]
	content: string
}

const tagValue = (tags: readonly string[][], name: string): string => {
	const tag = tags.find((candidate) => candidate[0] === name)
	return typeof tag?.[1] === 'string' ? tag[1].trim() : ''
}

const jsonObject = (content: string): Record<string, unknown> | null => {
	try {
		const parsed: unknown = JSON.parse(content)
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

const finiteNumber = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null

/** A lot's identity on the wire: its `d`, its coordinate, and the create version it supersedes. */
export interface ArenaCreateIdentity {
	/** The lot's `d` — identity within its seller (`content.auction_id` must agree with it). */
	d: string
	/** `1440:<seller>:<d>`. */
	coordinate: string
	/** The root this version claims to supersede; empty on the root itself. */
	supersedes: string
}

/**
 * Read one 1440 create. Answers `null` for any other kind, for content that is not a JSON object,
 * and for a `d`/`content.auction_id` disagreement — the read gate refuses such an event, so the
 * monitor must not invent an identity for it either.
 */
export function arenaCreateIdentity(event: ArenaEventLike): ArenaCreateIdentity | null {
	if (event.kind !== ARENA_AUCTION_CREATE_KIND) return null
	const content = jsonObject(event.content)
	if (content === null) return null

	const tagD = tagValue(event.tags, 'd')
	const contentId = typeof content.auction_id === 'string' ? content.auction_id.trim() : ''
	if (tagD && contentId && tagD !== contentId) return null

	const d = tagD || contentId
	if (!d) return null

	return {
		d,
		coordinate: arenaAuctionCoordinate(event.pubkey, d),
		supersedes: tagValue(event.tags, 'e'),
	}
}

/** The notification key of a lot — its coordinate — or '' when the event is not a readable create. */
export function arenaNotificationKey(event: ArenaEventLike): string {
	return arenaCreateIdentity(event)?.coordinate ?? ''
}

/** The lifecycle window a **root** create announces: when it started and when bidding closes. */
export interface ArenaPhaseWindow {
	/** The root create's `created_at`, in whole seconds. */
	startAt: number
	/** `startAt + content.durationSec`, or `null` when the create states no run time. */
	cutoffAt: number | null
}

/**
 * The phase window of a lot, from its **root** create only.
 *
 * An update (an event whose `e` tag names the root) carries a later `created_at` and may not touch
 * any immutable field; treating it as a start would re-announce an auction that already began, so an
 * update answers `null` here. This mirrors `arenaAuctionRead`'s root rule.
 */
export function arenaPhaseWindow(event: ArenaEventLike): ArenaPhaseWindow | null {
	const identity = arenaCreateIdentity(event)
	if (identity === null || identity.supersedes) return null

	const createdAt = event.created_at ?? 0
	if (createdAt <= 0) return null

	const durationSec = finiteNumber(jsonObject(event.content)?.durationSec)
	const cutoffAt = durationSec !== null && durationSec > 0 ? createdAt + durationSec : null
	return { startAt: createdAt, cutoffAt }
}

/** One 1441 bid bound to the lot it names. */
export interface ArenaBidBinding {
	/** The `a` tag, `1440:<seller>:<d>`; '' when absent or not an arena coordinate. */
	coordinate: string
	/** The `e` tag — the lot's **root** create id (decision §4.2). */
	rootEventId: string
	/** `content.auction_id` (the `d`), when the bid states one. */
	auctionId: string
	/** `content.amount` — the **delta** this bid adds to the bidder's position; `null` when unreadable. */
	amount: number | null
}

/** Read one 1441 bid, or `null` for any other kind / unparseable content. */
export function arenaBidBinding(event: ArenaEventLike): ArenaBidBinding | null {
	if (event.kind !== ARENA_AUCTION_BID_KIND) return null
	const content = jsonObject(event.content)
	if (content === null) return null

	const aTag = tagValue(event.tags, 'a')
	return {
		coordinate: aTag.startsWith(`${ARENA_AUCTION_CREATE_KIND}:`) ? aTag : '',
		rootEventId: tagValue(event.tags, 'e'),
		auctionId: typeof content.auction_id === 'string' ? content.auction_id.trim() : '',
		amount: finiteNumber(content.amount),
	}
}

/** A bid the rules can attribute to a bidder and a lot. */
export interface ArenaPositionBid extends ArenaBidBinding {
	bidder: string
}

/**
 * Sum bid deltas into per-lot, per-bidder positions — the same derivation `projectArenaEvents`
 * makes from `ArenaBidView[]`. A bid with no readable amount contributes nothing (it is counted on
 * the read path as `bidsWithoutAmount`; a notification rule has nothing to say about it).
 */
export function arenaBidPositions(bids: readonly ArenaPositionBid[]): Record<string, Record<string, number>> {
	const positions: Record<string, Record<string, number>> = {}
	for (const bid of bids) {
		if (!bid.coordinate || bid.amount === null) continue
		const lot = (positions[bid.coordinate] ??= {})
		lot[bid.bidder] = (lot[bid.bidder] ?? 0) + bid.amount
	}
	return positions
}

/**
 * Bind one 1445 verdict to a watched lot.
 *
 * A verdict names its lot by the `auction` tag (falling back to `content.auction_id`), and that value
 * is either the full coordinate or the bare `d`. Because the tag is not an `a`/`e` tag the relay
 * cannot filter on it, so the monitor asks the relay for verdicts and binds them here: a bare `d`
 * resolves only when exactly one watched lot carries it, and anything else answers '' rather than
 * guessing which lot a verdict is about.
 */
export function arenaVerdictKey(event: ArenaEventLike, watched: readonly { coordinate: string; d: string }[]): string {
	if (event.kind !== ARENA_VERDICT_KIND) return ''
	const content = jsonObject(event.content)
	const auctionId = tagValue(event.tags, 'auction') || (typeof content?.auction_id === 'string' ? content.auction_id.trim() : '')
	if (!auctionId) return ''

	if (auctionId.includes(':')) {
		return watched.some((lot) => lot.coordinate === auctionId) ? auctionId : ''
	}

	const matches = watched.filter((lot) => lot.d === auctionId)
	return matches.length === 1 ? matches[0].coordinate : ''
}