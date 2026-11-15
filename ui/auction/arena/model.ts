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
 * `durationSec` has **no end time** — not a zero-length auction. A bid
 * whose `amount` is not a number contributes **no** position — it does not
 * contribute zero. A verdict that was never published is **unknown**, which is
 * not the same claim as "no outcome". Every `null` below carries that meaning,
 * and the views say so in words rather than rendering a `0`.
 *
 * The money and timing fields carry the **consolidated protocol's** own names
 * (`startPrice`, `minIncrement`, `mode`, `windowSec`, `durationSec`,
 * `sellerWallet`, `v4vSplit`), because the create content uses exactly those
 * and two vocabularies for one truth is how a page starts lying. The retired
 * 30408 names (`reserve`, `lateBidWindowSeconds`, `locktimeSeconds`,
 * `fundingMode`, …) are gone: there is no reserve to state, the anti-snipe
 * knobs are one `mode` + one `windowSec`, a locktime is derived per bid rather
 * than published, and a split is a first-class money field.
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
	/** The create's stated opening price (`startPrice` on the wire), or `null` when it stated none. */
	startPrice: number | null
	/**
	 * The best **derived** position: bid *deltas* summed per bidder. Not the
	 * outcome — the 1445 verdict is the authority on who won, and the mint is
	 * the authority on whether money moved.
	 */
	topBidTotal: number | null
	bidCount: number
	/** Bids whose `amount` was not a finite number, so the positions above are incomplete. */
	bidsWithoutAmount: number
	/** `root.created_at + durationSec`, or `null` when the create stated no positive duration. */
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

/**
 * One committed V4V payout row, as the detail page renders it:
 * `{role, recipientPubkey, allocationBps}` in integer basis points
 * (consolidated protocol §6). `role` is `validator` or `v4v`.
 */
export interface ArenaV4VRow {
	role: string | null
	recipientPubkey: string | null
	allocationBps: number | null
}

/** One auction in full. */
export interface ArenaAuctionDetailModel extends ArenaAuctionCardModel {
	description: string | null
	minIncrement: number | null
	/** `fixed` or `antisnipe`; the create states how the end behaves. `null` when unstated. */
	mode: string | null
	/**
	 * The anti-snipe reset window in seconds: an accepted bid inside it pushes
	 * the end out to `now + windowSec`. `0` (or `null`) on a fixed lot. This is
	 * the **behaviour**, not a knob — the retired `lateBidExtensionSeconds` and
	 * `maxTotalExtensionSeconds` no longer exist.
	 */
	windowSec: number | null
	/** The lot's stated duration in seconds (`durationSec` on the wire). */
	durationSec: number | null
	/** The committed seller payout key — the destination settlement locks value to. */
	sellerWallet: string | null
	/** The committed V4V payout rows, or `null` when the seller is paid alone. */
	v4vSplit: readonly ArenaV4VRow[] | null
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

/**
 * The settlement-safety window the consolidated protocol adds to every locktime
 * (`minLock = max(EndAt, now + WindowSec) + settlement_safety + latency`,
 * spec §2.1/§10). Exposed so a view can name the date a last-resort refund opens
 * without re-deriving the rule.
 */
export const ARENA_SETTLEMENT_SAFETY_SEC = 900

/**
 * The unix second a **last-resort refund** opens for a lot that never settles:
 * the lot's own end, plus the anti-snipe window, plus the settlement safety.
 * `null` when the create stated no end, because then there is no date to name.
 *
 * This is the escrow's honest deadline in words — "your sats are locked until
 * the lot closes; refundable from this date if nothing settles". It is not a
 * promise about a *specific* bid's locktime (that is derived per bid and may be
 * later), so the view says "from" rather than "at".
 */
export function escrowRefundableFrom(endsAt: number | null, windowSec: number | null): number | null {
	if (endsAt === null) return null
	return endsAt + (windowSec ?? 0) + ARENA_SETTLEMENT_SAFETY_SEC
}

/**
 * The end behaviour in words. Anti-snipe is one sentence about behaviour, not
 * three knobs: "extends by <windowSec>s while bids keep arriving, no hard end".
 */
export function endModeBehaviour(mode: string | null, windowSec: number | null): string {
	if (mode === 'antisnipe') {
		const window = windowSec !== null && windowSec > 0 ? `${windowSec}s` : 'the window'
		return `Anti-snipe: every accepted bid inside ${window} of the close pushes the end out by ${window}. There is no hard end — the lot closes when the bidding stops.`
	}
	if (mode === 'fixed') return 'Fixed: the lot closes at the stated time and the end never moves.'
	return 'The create stated no end mode, so how the end behaves is unknown.'
}

/**
 * The seller's remainder in basis points: `10000 − Σ(allocationBps)`, or `null`
 * when no split was committed (the seller is paid alone) or a row is unreadable.
 */
export function v4vSellerRemainderBps(rows: readonly ArenaV4VRow[] | null): number | null {
	if (rows === null || rows.length === 0) return null
	let sum = 0
	for (const row of rows) {
		if (row.allocationBps === null) return null
		sum += row.allocationBps
	}
	return 10000 - sum
}

/** `320 bps` reads badly alone; show the percentage too. */
export function bpsLabel(bps: number | null): string {
	if (bps === null) return 'not stated'
	return `${bps.toLocaleString()} bps (${(bps / 100).toFixed(2)}%)`
}

/** The one place the panel is allowed to say what it is not doing. */
export const ARENA_QUORUM_DISCLAIMER =
	'Quorum is not implemented. This panel lists the verdicts validators published to the relay — it does not tally them, does not choose a winner, and does not confirm that any money moved.'