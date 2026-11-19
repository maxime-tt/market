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
 * - `settled`   — every relay has been accounted for (answered, refused the
 *                 subscription, or unreachable), so an empty result is a verdict;
 * - `incomplete` — the read stopped while some relay had not been heard from at
 *                 all;
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

/**
 * Where a lot's displayed end came from. This is the distinction the increment
 * exists for: the create-derived end is what the create states, and the
 * committed end is what the chain has actually committed after a bid moved it.
 */
export type ArenaEndSource = 'committed' | 'create-derived' | 'unknown'

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
	/**
	 * The end the countdown uses: the **committed end** (kind 1449) when the
	 * chain published one, otherwise the create-derived end
	 * (`root.created_at + duration_seconds`). `null` when neither is known.
	 * {@link ArenaAuctionCardModel.endSource} says which it is — the two must
	 * never be presented as one.
	 */
	endsAt: number | null
	/**
	 * Where {@link ArenaAuctionCardModel.endsAt} came from:
	 * `committed` a kind-1449 the chain published (the end a bid moved to),
	 * `create-derived` the create's own `root.created_at + duration_seconds`,
	 * `unknown` neither. Never blur these: a create-derived end shown as
	 * committed would state a deadline the chain has already moved.
	 */
	endSource: ArenaEndSource
	/**
	 * The create-derived end (`root.created_at + duration_seconds`), or `null`
	 * when the create stated no positive duration. Carried **always**, so a
	 * surface can label the create-derived end as such even when a committed end
	 * overrides it in the countdown.
	 */
	createDerivedEndsAt: number | null
	/** The anchored height of the committed end, or `null` when none was read. */
	committedEndHeight: number | null
	/**
	 * The **per-bid ordinal** of the extension that produced the committed end —
	 * NOT the lot's running count. `null` when no committed end was read, or the
	 * event stated none. Never render as "extended N times".
	 */
	committedEndOrdinal: number | null
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

/**
 * One row of the **V4V split** a create commits (`MERGED-PROTOCOL-SPEC.md` §6):
 * a role (`validator` | `v4v`), the recipient's pubkey, and an integer share of
 * the settle in basis points. The seller receives the remainder
 * (`10000 − Σ allocationBps`, §6).
 */
export interface ArenaV4vSplitRow {
	role: string
	recipientPubkey: string
	allocationBps: number
}

/**
 * The seller's share of a committed split, in bps: `10000 − Σ allocations`,
 * floored at 0 so a malformed over-allocation reads as "no remainder" rather
 * than a negative number.
 */
export function sellerRemainderBps(v4vSplit: readonly ArenaV4vSplitRow[]): number {
	const allocated = v4vSplit.reduce((sum, row) => sum + (Number.isFinite(row.allocationBps) ? row.allocationBps : 0), 0)
	return Math.max(0, 10_000 - allocated)
}

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

/** One destination of a money receipt, as a surface may state it. */
export interface ArenaReceiptOutputModel {
	/** Compressed wallet pubkey, or `null` when unreadable. */
	recipient: string | null
	amount: number | null
	/** The mint's keyset id, or `null`. */
	id: string | null
}

/**
 * One money receipt (kind 1443 refund / 1444 settle), as a surface renders it.
 *
 * Distinct from {@link ArenaVerdictRow} on purpose: a verdict is a **claim**,
 * a receipt is **money that moved**. The proof secrets (`secret`/`C`/`dleq`)
 * are deliberately absent here — this shape is display only; the claim work
 * reads them from the read adapter's own receipt.
 */
export interface ArenaReceiptModel {
	eventId: string
	/** The 1441 event id whose escrow moved. */
	bidId: string
	outcome: 'refund' | 'settle'
	height: number
	blockHash: string
	settledAt: number | null
	/** The params digest in force — an opaque token, recorded, never a refusal. */
	paramsVersion: string | null
	/** `true` when a held params reading disagrees; `null` when no comparison was possible. */
	paramsVersionMismatch: boolean | null
	outputs: ArenaReceiptOutputModel[]
	/** `Σ out[].amount` over the readable amounts; `null` when none was readable. */
	total: number | null
	/** How many committed destinations the move paid. */
	destinationCount: number
	/** Outputs whose `amount` was unreadable, so `total` is partial when > 0. */
	outputsWithoutAmount: number
}

/** One gallery item: a photo, a recorded video, or a live stream. */
export interface ArenaLotMediaItem {
	type: 'image' | 'video' | 'live'
	url: string
}

/** One auction in full. */
export interface ArenaAuctionDetailModel extends ArenaAuctionCardModel {
	description: string | null
	/**
	 * The whole gallery in display order: the main photo (`imageUrl`) first, then the
	 * create's `media` items. Empty when the lot published no safe image.
	 */
	media: ArenaLotMediaItem[]
	minIncrement: number | null
	/** `fixed` | `antisnipe`, or `null` when the create stated no mode. */
	mode: string | null
	/**
	 * The anti-snipe window in seconds. On an `antisnipe` lot an accepted bid
	 * inside the window pushes the end to `now + windowSec`; there is no cap and
	 * no hard end. `null` when the create stated none.
	 */
	windowSec: number | null
	/** The lot's stated duration in seconds; `null` when the create stated none. */
	durationSec: number | null
	/** The seller's wallet key the settle locks value to; `null` when unstated. */
	sellerWallet: string | null
	/** The committed V4V split (§6), or `null` when the create stated none. */
	v4vSplit: ArenaV4vSplitRow[] | null
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
	/**
	 * The auction's money receipts (kinds 1443/1444), earliest anchored height
	 * first. A verdict is a claim; these are money that moved.
	 */
	receipts: ArenaReceiptModel[]
	/**
	 * The earliest refund height per bidder pubkey, for a position line. A bidder
	 * with no refund receipt is absent — a missing receipt is *no receipt read*,
	 * never a `null` height on the position.
	 */
	refundsByBidder: Record<string, number>
	/** The lot-level settle: the earliest-anchored 1444, or `null` when none was read. */
	settleReceipt: ArenaReceiptModel | null
	/**
	 * The chain's refusal of this lot's **create** (a kind-1450 naming the root
	 * create's event id), with the chain's own reason verbatim, or `null` when
	 * the chain did not refuse it (or no 1450 was read). A surface that shows
	 * this must state the chain's words, never "not found".
	 */
	createRefusal: ArenaCreateRefusalModel | null
	/**
	 * The chain's refusals of this lot's **bids**, keyed by the refused bid's
	 * event id, with the chain's own reason verbatim.
	 *
	 * A bid is named here only when the chain refused it **at delivery** (the
	 * late family, the block-time locktime floor, a duplicate). A bid refused at
	 * admission is discarded in `CheckTx` and leaves no record, so an absent
	 * entry is *no refusal read* — never "accepted", and never a reason invented
	 * for it (owner ruling, `notes/DECISION-2026-11-18-refused-bids-are-not-committed.md`).
	 */
	bidRefusals: Record<string, ArenaCreateRefusalModel>
}

/** The chain's refusal of a create, as a surface may state it. */
export interface ArenaCreateRefusalModel {
	/** The chain's own reason, verbatim — never invented, never re-worded. */
	reason: string
	/** The anchored height the refusal names. */
	height: number
	/** The refusal event's id. */
	refusalEventId: string
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
	/**
	 * The lot's phase, from the same end the countdown shows
	 * ({@link ArenaAuctionCardModel.endsAt}). The panel needs it to say *why*
	 * it has no rows: an open lot has no verdict yet because the chain has not
	 * closed it, which is a fact about the lot, not an absence in the read.
	 */
	phase: ArenaAuctionPhase
	rows: ArenaVerdictRow[]
	/** Distinct validator keys among `rows`, ignoring rows with no `p` tag. */
	validatorCount: number
	/** Distinct outcomes among `rows`, sorted. More than one means the validators disagree. */
	outcomes: string[]
	/** Relay-level disagreement, as the read adapter computed it. */
	divergence: ArenaVerdictRelayDivergence | null
}

// =========================================================================
// Chain clock
// =========================================================================

/**
 * How fresh the anchored chain time is, against how far wall clock has moved
 * since it. `unknown` means no chain time arrived at all — never a `0`, never
 * `now`.
 */
export type ArenaChainClockFreshness = 'unknown' | 'fresh' | 'stale'

/**
 * The arena **chain clock**: the anchored chain time the *rules* judge against,
 * with the freshness a surface must show and the refusals it must explain.
 *
 * The clock is a combination of wall time and block time: the route's ticking
 * `now` drives the *display*, and this anchored value drives the *rules* — is
 * the window open, has the end passed, is a lock settleable. It is "as of height
 * N", so it always carries its age; an old time is never presented as now, a
 * missing one is `null` (rendered `unknown`), and a refused (forked or
 * regressive) reading is carried, not silently dropped.
 *
 * Every field is plain data; a surface reads it and says the words.
 */
export interface ArenaChainClockModel {
	/** The anchored chain time (unix seconds), or `null` when none arrived. */
	time: number | null
	/** The height the chain time is anchored at, or `null`. */
	height: number | null
	/** The validator that signed the anchor, or `null`. */
	validatorPubkey: string | null
	/** Every relay that delivered the anchor. */
	relays: string[]
	/** How far wall clock has moved since the anchored time, or `null` when it is unknown. */
	ageSec: number | null
	/** `unknown` (no anchor) | `fresh` (within the threshold) | `stale` (past it). */
	freshness: ArenaChainClockFreshness
	/** The instant the **rules** judge against — the anchored time at the highest *agreed* height, or `null`. */
	rulesTime: number | null
	/** The height the rules time is anchored at, or `null`. */
	rulesHeight: number | null
	/** Heights the clock refused to advance on because relays disagreed (commitmentForks), highest first. */
	refusedHeights: number[]
	/** True when the newest reading would have moved the clock backwards and was refused. */
	regressionRefused: boolean
}

// =========================================================================
// Pure formatters
// =========================================================================

/** The one sentence a surface may say when no chain time has arrived. */
export const ARENA_CHAIN_CLOCK_UNKNOWN_LABEL = 'Chain time unknown'

/** The one word a surface appends when the anchored time is past the threshold. */
export const ARENA_CHAIN_CLOCK_STALE_LABEL = 'stale'

/** The one sentence a surface appends when a reading was refused for moving the clock backwards. */
export const ARENA_CHAIN_CLOCK_REGRESSION_LABEL = 'a later reading was older and was refused'

/**
 * The one sentence a surface may render for the chain clock. It states the
 * anchored time **as of its height** with its age — never as "now" — says
 * `unknown` when there is none, marks a stale reading, and names any forked
 * height it refused and any regressive reading it refused. `M s ago` is the
 * model's own `ageSec`: the age when the reading was taken.
 */
export function chainClockLabel(clock: ArenaChainClockModel): string {
	const parts: string[] = []
	if (clock.time === null || clock.height === null || clock.ageSec === null) {
		parts.push(ARENA_CHAIN_CLOCK_UNKNOWN_LABEL)
	} else {
		parts.push(`Chain time as of height ${clock.height}, ${clock.ageSec} s ago`)
		if (clock.freshness === 'stale') parts.push(ARENA_CHAIN_CLOCK_STALE_LABEL)
	}
	if (clock.refusedHeights.length > 0) {
		const noun = clock.refusedHeights.length === 1 ? 'height' : 'heights'
		parts.push(`refused forked ${noun} ${clock.refusedHeights.join(', ')}`)
	}
	if (clock.regressionRefused) parts.push(ARENA_CHAIN_CLOCK_REGRESSION_LABEL)
	return parts.join(' — ')
}

/** The one sentence a surface may say about an auction with no stated end. */
export const ARENA_UNKNOWN_END_LABEL = 'End time unknown'

/** The one phrase a surface appends to a create-derived end, so it is never read as the committed end. */
export const ARENA_CREATE_DERIVED_END_LABEL = 'create-derived end'

/** The one phrase a surface appends when no committed end (kind 1449) was read for this lot. */
export const ARENA_NO_COMMITTED_END_LABEL = 'no committed end read'

/**
 * The line a surface states for a lot whose end the chain committed (kind 1449):
 * the end, the height of the bid that moved it, and — when the event named one —
 * the **per-bid ordinal** of the extension. The ordinal is never rendered as
 * "extended N times": it is the ordinal that belongs to *this* end.
 *
 * `committedEndsAt` and `height` are what the read delivered; `ordinal` is
 * `null` when the event stated none, in which case the ordinal clause is
 * omitted rather than guessed.
 */
export function committedEndLabel(committedEndsAt: number, height: number, ordinal: number | null): string {
	const end = new Date(committedEndsAt * 1000).toISOString()
	if (ordinal === null) return `end moved to ${end} by a bid at height ${height}`
	return `end moved to ${end} by a bid at height ${height} — extension ${ordinal} of this lot`
}

/**
 * The one sentence a surface says when the chain **refused a create**. The
 * reason is the chain's own words, verbatim: `the chain refused this listing:
 * <reason>`. Never "not found", never a re-worded reason — the app diagnoses
 * from committed state and never invents a reason.
 */
export function createRefusalLabel(reason: string): string {
	return `the chain refused this listing: ${reason}`
}

/**
 * The one sentence a surface may say about anti-snipe, or `null` when the
 * create did not state an `antisnipe` mode with a positive window. Anti-snipe
 * is behaviour, not a knob: an accepted bid inside the window pushes the end to
 * `now + windowSec`, and there is no cap and no hard end (`MERGED-PROTOCOL-SPEC.md`
 * §3 — `MaxTotalExtension` is removed by the protocol).
 */
export function antisnipeBehaviourLabel(mode: string | null, windowSec: number | null): string | null {
	if (mode !== 'antisnipe' || windowSec === null || windowSec <= 0) return null
	return `extends by ${windowSec.toLocaleString()}s while bids keep arriving, no hard end`
}

/** A basis-point share, as a surface states it. `null` is the words, never `0`. */
export function bpsLabel(value: number | null): string {
	return value === null ? 'not stated' : `${value.toLocaleString()} bps`
}

/**
 * The one escrow sentence a surface may show. Abstract on purpose: it names the
 * two destinations and the refund, and never a wallet key or a proof.
 */
export const ARENA_ESCROW_COPY =
	'Sats are locked in escrow until the lot closes: they go to the seller if you win, and come back to you otherwise. If the lot never resolves they are refundable after its close. No wallet keys or proofs are shown here.'

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

// =========================================================================
// Money receipts
// =========================================================================

/**
 * The one sentence a surface may say when a receipt it might have shown was
 * **not delivered**. It is emphatically not "not paid": the read has no receipt,
 * which is a fact about the read, not about the money.
 */
export const ARENA_NO_RECEIPT_LABEL = 'no receipt read'

/** The per-position line a refund receipt earns, e.g. `refunded at height 400`. */
export function refundReceiptLabel(height: number): string {
	return `refunded at height ${height}`
}

/**
 * The lot-level line a settle receipt earns. One destination is the seller;
 * several is a V4V settle, and the words say how many destinations were paid —
 * a settle that paid three recipients is not "paid to the seller".
 */
export function settleReceiptLabel(receipt: ArenaReceiptModel): string {
	const amount = receipt.total === null ? 'an unstated amount of sats' : `${receipt.total.toLocaleString()} sats`
	if (receipt.destinationCount <= 1) return `paid ${amount} to the seller at height ${receipt.height}`
	return `paid ${amount} to ${receipt.destinationCount} destinations at height ${receipt.height}`
}

/**
 * The one sentence a surface says about an unresolved params session: a
 * receipt's `params_version` disagrees with the params reading the app holds.
 * It is a **flag**, never a refusal — the money moved, and the signature, the
 * roster and the anchor are the gate.
 */
export const ARENA_RECEIPT_PARAMS_MISMATCH_LABEL = 'the receipt names a different params version than the one this app holds'

/**
 * The one place the panel is allowed to say what it is not doing. It is
 * rendered **with the verdict rows** — it explains the list on screen. It is
 * never the empty state: "quorum is not implemented" over zero rows reads as a
 * product admission rather than a property of the list.
 */
export const ARENA_QUORUM_DISCLAIMER =
	'Quorum is not implemented. This panel lists the verdicts validators published to the relay — it does not tally them, does not choose a winner, and does not confirm that any money moved.'

/**
 * The empty-state sentence for a lot that has **not closed**. A verdict does not
 * exist yet because the chain has not closed the lot — never phrased as an
 * absence in the read, which would imply the absence is informative.
 */
export const ARENA_VERDICT_NOT_CLOSED_LABEL =
	'This lot is still open. Validators publish a verdict when the chain closes a lot, so there is no verdict to read yet.'

/**
 * The empty-state sentence for a lot that **has closed** and still carried no
 * verdict. Reserved for that case: on an open lot it would imply the absence
 * says something about the outcome.
 */
export const ARENA_VERDICT_ABSENT_LABEL =
	'No validator published a verdict for this auction that these relays carried. That is an absence, not a verdict of "no outcome".'

/**
 * The empty-state sentence when the read cannot say whether the lot closed: no
 * end was stated, so neither "still open" nor "closed" is supportable.
 */
export const ARENA_VERDICT_PHASE_UNKNOWN_LABEL =
	'This lot states no end that could be read, so whether the chain has closed it is unknown. These relays carried no verdict for it.'

/** The empty-state sentence while the read is unfinished — never a no-data notice. */
export const ARENA_VERDICT_READING_LABEL = 'No verdict has been read yet — the read has not finished, so this is not "no verdict".'

/**
 * The sentence the verdict panel states when it holds no rows. The read state
 * wins over the phase: a read that has not settled has not delivered the whole
 * picture, so it may not render a no-data notice. Once it has settled, the lot's
 * phase decides — an open lot has no verdict yet, a closed lot's silence is an
 * absence, and an unknown end states that it is unknown.
 */
export function verdictEmptyLabel(phase: ArenaAuctionPhase, status: ArenaSurfaceStatus): string {
	if (status !== 'settled') return ARENA_VERDICT_READING_LABEL
	if (phase === 'open') return ARENA_VERDICT_NOT_CLOSED_LABEL
	if (phase === 'ended') return ARENA_VERDICT_ABSENT_LABEL
	return ARENA_VERDICT_PHASE_UNKNOWN_LABEL
}

// =========================================================================
// The honesty sentences a list/card surface may state
// =========================================================================

/** A two-part honest message: a short title and the reason under it. */
export interface ReadMessage {
	title: string
	detail: string
}

/**
 * What a surface says when the read delivered no model. Each state gets its own
 * sentence: they are not interchangeable, and collapsing them into one
 * "nothing here" is the bug this exists to prevent.
 *
 * Lives here (not in a view) because it is a property of the read, not of any
 * one presentation: the retired arena card, the ported Layout A detail and the
 * verdict panel all state the same read the same way, and a second copy would
 * eventually disagree with the first.
 */
export function readStateMessage(status: ArenaSurfaceStatus, subject = 'this auction'): ReadMessage | null {
	switch (status) {
		case 'loading':
			return {
				title: `Reading ${subject} from relays…`,
				detail: 'Nothing has arrived yet. An empty card here means the read has not finished, not that the auction is missing.',
			}
		case 'no-relays':
			return {
				title: `No relay answered, so ${subject} could not be read.`,
				detail: 'This is not the same as the auction not existing.',
			}
		case 'incomplete':
			return {
				title: `The read stopped before every relay answered.`,
				detail: `Anything shown for ${subject} is what arrived, not the whole picture.`,
			}
		case 'error':
			return {
				title: `${subject[0].toUpperCase()}${subject.slice(1)} could not be read right now.`,
				detail: 'The read failed rather than answering. Retrying is the only honest next step.',
			}
		case 'settled':
			return {
				title: `No such auction was read.`,
				detail: 'Every relay answered and none of them carried it.',
			}
	}
}

/** `N bids` once the read is finished; `N bids so far` while it is not. */
export function bidCountLabel(count: number, status: ArenaSurfaceStatus): string {
	const noun = count === 1 ? 'bid' : 'bids'
	if (status === 'settled') return `${count} ${noun}`
	return `${count} ${noun} so far`
}

/** The price line, which must never assert a total it cannot support. */
export function priceLine(model: ArenaAuctionCardModel): string {
	if (model.topBidTotal !== null) return `${model.topBidTotal.toLocaleString()} sats`
	if (model.bidsWithoutAmount > 0) {
		const n = model.bidsWithoutAmount
		return `${n} ${n === 1 ? 'bid carries' : 'bids carry'} no readable amount — total unknown`
	}
	if (model.startingBid !== null) return `No bids · starting ${model.startingBid.toLocaleString()} sats`
	return 'No bid amount stated'
}
