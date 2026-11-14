import type { StatusTone } from '../../shared/status-badge'

/**
 * The read-models the 1440-series auction surfaces render, and the pure
 * formatters they share.
 *
 * These are **plain data**: an auction read by
 * `platform/web/auctions/relay/auctionSurfacesRead.ts` through the verified
 * `arenaAuctionRead` adapter, projected into exactly the fields a view can show.
 * `ui/` never sees a relay, an event or a promise (`ui/AGENTS.md:18-28`,
 * `ui/AGENTS.md:120`).
 *
 * ## Why `null` is load-bearing in every one of these shapes
 *
 * The adapter reports what the relay said. A create with no
 * `duration_seconds` has **no end time** — not a zero-length auction. A bid
 * whose `amount` is not a number contributes **no** position — it does not
 * contribute zero. A verdict that was never published is **unknown**, which is
 * not the same claim as "no outcome". Every `null` below carries that meaning,
 * and the views say so in words rather than rendering a `0`.
 */

// =========================================================================
// Read state
// =========================================================================

/**
 * The state of the read that produced a surface.
 *
 * Deliberately the same five words the storefront auction block uses
 * (`ui/storefront/blocks/AuctionListBlock.tsx:67-76`), because it is the same
 * read and two vocabularies for one truth is how a page starts lying:
 *
 * - `loading`   — still running; anything shown is what arrived *so far*;
 * - `settled`   — every relay answered, so an empty result is a verdict;
 * - `incomplete` — the read stopped without every relay answering;
 * - `no-relays` — nothing answered; this is not "there is no auction";
 * - `error`     — the read threw, or no host supplied data.
 */
export type ArenaSurfaceStatus = 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'

/** Relays that answered, out of the relays the read opened. */
export interface ArenaRelayHealth {
	answered: number
	total: number
}

/**
 * An auction's time phase.
 *
 * `unknown` is a real answer, not a fallback: a 1440 that states no
 * `duration_seconds` has no end to compute, and a surface that guessed one
 * would be inventing a deadline the protocol never agreed to.
 */
export type ArenaAuctionPhase = 'open' | 'ended' | 'unknown'

// =========================================================================
// Card
// =========================================================================

/** One auction, as a list card renders it. */
export interface ArenaAuctionCardModel {
	/** `1440:<seller>:<d>`. */
	coordinate: string
	seller: string
	/** The auction's `d` tag; the label of last resort when no title was published. */
	d: string
	title: string | null
	imageUrl: string | null
	startingBid: number | null
	/**
	 * The best **derived** position: bid *deltas* summed per bidder. Not the
	 * outcome — the 1445 verdict is the authority on who won, and the mint is
	 * the authority on whether money moved.
	 */
	topBidTotal: number | null
	bidCount: number
	/** Bids whose `amount` was not a finite number, so the positions above are incomplete. */
	bidsWithoutAmount: number
	/** `root.created_at + duration_seconds`, or `null` when the create stated no positive duration. */
	endsAt: number | null
	phase: ArenaAuctionPhase
	/** The relay-reported verdict outcome, or `null` when none was read. */
	verdict: string | null
	/** How many verdict events were read — a count of events, never of validators. */
	verdictCount: number
	/** Validators that published at least one verdict — the count a reader actually wants. */
	validatorCount: number
	/** Two relays reported different outcome sets for this auction. A signal, not proof. */
	divergent: boolean
	/** Relays that delivered this auction's events. */
	relayCount: number
}

// =========================================================================
// Detail
// =========================================================================

export interface ArenaAuctionBidModel {
	eventId: string
	bidder: string
	createdAt: number
	/** The **delta** this bid added, or `null` when the content carried no readable amount. */
	amount: number | null
	relays: string[]
}

/** One derived per-bidder position. */
export interface ArenaAuctionPositionModel {
	bidder: string
	total: number
}

/** One auction in full. */
export interface ArenaAuctionDetailModel extends ArenaAuctionCardModel {
	description: string | null
	minIncrement: number | null
	reserve: number | null
	durationSeconds: number | null
	lateBidWindowSeconds: number | null
	lateBidExtensionSeconds: number | null
	maxTotalExtensionSeconds: number | null
	locktimeSeconds: number | null
	fundingMode: string | null
	/** How many 1440 versions exist — accepted or not. A display aid, never a count of edits accepted. */
	versions: number
	/** The first 1440 for `(seller, d)`; bids bind to this id, not to a version. */
	rootEventId: string
	/** The latest version that passed the immutable check. */
	canonicalEventId: string
	/** The root's `created_at` — when the auction started, as opposed to when it was last edited. */
	rootCreatedAt: number
	bids: ArenaAuctionBidModel[]
	positions: ArenaAuctionPositionModel[]
}

// =========================================================================
// Verdict panel
// =========================================================================

/** One published validator verdict, as the panel renders it. */
export interface ArenaVerdictRow {
	/** The signing validator, or `null` when the event carried no `p` tag. */
	validator: string | null
	outcome: string
	/** The anchored height the verdict claims. */
	height: number
	/** The anchored block hash the verdict claims. */
	blockHash: string
	/** `null` when the auction had no bid (no-bid / aborted). */
	bidId: string | null
	/** `null` when no payout exists. A *claim*, not a receipt. */
	payoutTokenSha256: string | null
	/** Always `committed_state` in the frozen contract; surfaced verbatim. */
	derivedFrom: string
}

/** Two relays returned different outcome sets for one auction. */
export interface ArenaVerdictRelayDivergence {
	auctionId: string
	/** Relay url → the distinct outcomes it reports, sorted. */
	byRelay: Record<string, string[]>
}

export interface ArenaVerdictPanelModel {
	auctionId: string
	rows: ArenaVerdictRow[]
	/** Distinct validator keys among `rows`, ignoring rows with no `p` tag. */
	validatorCount: number
	/** Distinct outcomes among `rows`, sorted. More than one means the validators disagree. */
	outcomes: string[]
	/** Relay-level disagreement, as the read adapter computed it. */
	divergence: ArenaVerdictRelayDivergence | null
}

// =========================================================================
// Pure formatters
// =========================================================================

/** The one sentence a surface may say about an auction with no stated end. */
export const ARENA_UNKNOWN_END_LABEL = 'End time unknown'

export function phaseLabel(phase: ArenaAuctionPhase): string {
	if (phase === 'open') return 'Open'
	if (phase === 'ended') return 'Ended'
	return ARENA_UNKNOWN_END_LABEL
}

export function phaseTone(phase: ArenaAuctionPhase): StatusTone {
	if (phase === 'open') return 'success'
	if (phase === 'ended') return 'neutral'
	return 'warning'
}

/** Verdict outcomes are four frozen words; anything else renders neutral rather than guessed. */
export function verdictTone(outcome: string): StatusTone {
	if (outcome === 'winner') return 'success'
	if (outcome === 'reserve_not_met') return 'warning'
	if (outcome === 'cancelled' || outcome === 'aborted') return 'error'
	return 'neutral'
}

/**
 * A pubkey is unreadable in full at card size; keep the ends and drop the
 * middle. Returns a visible placeholder rather than an empty span when the
 * event stated no key at all.
 */
export function shortKey(key: string | null): string {
	if (key === null || key.length === 0) return 'key not stated'
	return key.length <= 14 ? key : `${key.slice(0, 6)}…${key.slice(-4)}`
}

/** `null` → the words, never `0`. */
export function satsLabel(value: number | null): string {
	return value === null ? 'not stated' : `${value.toLocaleString()} sats`
}

/** The one place the panel is allowed to say what it is not doing. */
export const ARENA_QUORUM_DISCLAIMER =
	'Quorum is not implemented. This panel lists the verdicts validators published to the relay — it does not tally them, does not choose a winner, and does not confirm that any money moved.'