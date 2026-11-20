/**
 * `ui/auction/arena/bid-rules.ts` — the auction's **own** bidding rules, applied
 * to a typed amount, and the words a bidder is shown when one fails.
 *
 * ## Why this is a pure module and not part of the form
 *
 * The same three questions are asked in two places — "is this amount biddable
 * right now?" (the form) and "may this amount be published?" (the platform
 * publish path, which must never trust a disabled button). A second copy of a
 * money rule is how a form and a publish path start disagreeing, so there is
 * one copy, here, and both sides call it.
 *
 * ## What it is, and what it is not
 *
 * It is a **client-side pre-check against the terms the create published and
 * the chain's own committed params** (the effective `min_increment_bps`).
 * It is not validity: a 1441 that passes this can still be refused, because
 * the terms are read from relays and a relay can be stale or lying, and because
 * the auction is the *chain's* (the relay notifies, the chain decides). The
 * form says so in words rather than implying that a green button is a
 * guarantee (`AGENTS.md:41-46`: do not collapse payment states into a boolean).
 *
 * ## Money is integer sats
 *
 * `AGENTS.md:41-46` — never collapse a payment state into a boolean — and the
 * auction's terms are sats (`starting_bid`, `min_increment`, `reserve` are
 * integer sats in the 1440 content; the read adapter only ever yields
 * `number`s). So an amount is parsed **digit by digit**: `10` and `"10"` are
 * ten sats; `"10.5"` is **not** rounded to 10 or 11 — it is refused with its
 * own reason, because `10.5 sats` cannot be published and the alternative
 * (silently flooring) would stake an amount the bidder never typed. `sats` is
 * the unit displayed and the unit stored; there is no fiat conversion here and
 * none may be added without a rate source, which a bid must never guess at.
 */

import type { ArenaAuctionDetailModel, ArenaAuctionPhase } from './model'

// =========================================================================
// Who the bidder is, as far as the surface can tell
// =========================================================================

/**
 * The viewer's identity and wallet, as the platform host resolved them.
 *
 * Two separate facts on purpose (`AGENTS.md:41-46`): being signed in and having
 * a wallet that can sign-and-pay are different states, and a bidder with one
 * and not the other needs a different sentence than a bidder with neither.
 *
 * `wallet` is a *readiness* claim, not a proof: the arena bid this slice builds
 * carries no funding payloads, so nothing here moves money.
 */
export interface ArenaBidderState {
	/** The signed-in pubkey, or `null` while logged out. */
	pubkey: string | null
	/**
	 * - `ready`      — a wallet that can sign is available;
	 * - `missing`    — signed in, no wallet;
	 * - `unavailable`— a wallet exists but cannot be used right now (locked, erroring).
	 */
	wallet: 'ready' | 'missing' | 'unavailable'
}

export const ARENA_BIDDER_SIGNED_OUT: ArenaBidderState = { pubkey: null, wallet: 'missing' }

// =========================================================================
// Reasons
// =========================================================================

/**
 * Every reason a bid is refused **before** anything is published. Names, not
 * sentences, so a test can tell one failure from another and the UI owns its
 * copy.
 */
export type ArenaBidBlockedReason =
	/** The read did not deliver the auction — nothing to bid on. */
	| 'auction-not-read'
	/** The read has not finished, so the terms below may be stale. */
	| 'read-incomplete'
	/** The create stated no duration, so there is no end to bid against. */
	| 'end-unknown'
	/** `now >= endsAt`. */
	| 'ended'
	/**
	 * The chain has published no create-admission fact (`arena.createadmit.v1`,
	 * kind 1449) for this lot, so the app does not follow it and nothing is
	 * offered on it. Not "refused": a refused create states its reason
	 * separately, in the chain's own words.
	 */
	| 'not-accepted'
	/** The auction started after now (rare: the root's `created_at` is in the future). */
	| 'not-started'
	/** The viewer is the seller. */
	| 'own-auction'
	/** No signed-in viewer. */
	| 'no-wallet'
	/** Signed in, but nothing that can sign and pay. */
	| 'wallet-unavailable'
	/** A verdict was already published — the auction is concluded whatever the clock says. */
	| 'concluded'
	/** Empty input. */
	| 'empty'
	/** Not a non-negative integer (a decimal, a negative, junk, `1e9`, `1,000`). */
	| 'not-integer-sats'
	/** Zero. Not an amount. */
	| 'zero'
	/** The create published no `starting_bid`, so no first bid can be checked against it. */
	| 'no-starting-bid'
	/** Below the lowest bid the published terms allow. The amount it names lives on the verdict. */
	| 'below-minimum'
	/**
	 * The typed **position** is at or below the bidder's own position: there is
	 * nothing to add, so the chain's delta would be zero or negative. A bid is an
	 * increase on where the bidder already stands.
	 */
	| 'at-or-below-own-position'
	/**
	 * The read has not settled what the bidder already holds (their legs could
	 * not all be vouched for, or the read has not caught up), so the delta the
	 * chain expects cannot be known. The app refuses rather than treating an
	 * unknown position as `0`, which would publish the whole intent as a delta.
	 */
	| 'own-position-unknown'
	/** Passes the client pre-check. Publishable — not valid. */
	| 'ok'

/** The outcome of pre-checking one typed amount against one auction. */
export interface ArenaBidCheck {
	/** `true` only for `ok`. */
	allowed: boolean
	/** Why. Always populated — `ok` is a reason too. */
	reason: ArenaBidBlockedReason
	/**
	 * The **delta** this bid publishes — the chain's `BidContent.Amount`, an
	 * integer added to the bidder's position — or `null` when it would not be a
	 * positive integer: the input does not parse, the bidder's own position is
	 * not known, or the intent is not a raise on it. This is the number the
	 * event names and the escrow locks, never the panel's (position) number.
	 */
	amount: number | null
	/**
	 * The lowest **position** the published terms and the chain's committed
	 * params allow this bidder to reach at `now` — the number the panel's field
	 * is a position *of* — or `null` when it cannot be computed (`starting_bid`
	 * unstated, or a raise whose `min_increment_bps` has not been read).
	 */
	minimum: number | null
	/**
	 * The bidder's own **position** on the lot (the sum of their live legs), or
	 * `null` when the read has not settled it. `0` when the read is settled and
	 * they have no legs. The input is a position, and this is what the delta is
	 * measured against.
	 */
	ownPosition: number | null
}

// =========================================================================
// Parsing: digits and nothing else
// =========================================================================

/**
 * Parse a typed amount as **integer sats**, or `null`.
 *
 * Deliberately strict, and deliberately not `Number()`:
 *
 * - leading/trailing whitespace is tolerated (a paste from a wallet often has it);
 * - `Number('')` is `0` and `Number('  ')` is `0` — both are "the bidder typed
 *   nothing", which is not a zero-sat bid;
 * - `Number('0x10')`, `Number('1e3')`, `Number('Infinity')` all succeed and
 *   none of them is something a bidder meant to type;
 * - `parseInt('10.9')` silently truncates to 10, i.e. stakes a different
 *   amount than the one shown.
 *
 * So: `/^\d+$/` on the trimmed string, then a safe-integer check. A string too
 * large to be a safe integer is not a bid either — it would lose precision at
 * exactly the moment the number becomes money.
 */
export function parseBidAmountSats(raw: string | number | null | undefined): number | null {
	if (raw === null || raw === undefined) return null
	const text = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : raw.trim()
	if (text === '' || !/^\d+$/.test(text)) return null
	const value = Number(text)
	return Number.isSafeInteger(value) ? value : null
}

// =========================================================================
// The minimum the published terms allow
// =========================================================================

/**
 * Bids are **deltas** added to a bidder's position, not the resulting total
 * (the reference chain's `BidContent.Amount`, `chain/app.go`: "a DELTA added to
 * the bidder's existing position, not their new total"). The panel's number is
 * the **position** the bidder means to hold — it is displayed and pre-filled
 * against a position floor — so the figure "can this bid stand?" compares is
 * that intended position, `ownPosition + delta`, which is the typed number
 * itself. `arenaBidDelta` performs the one conversion between the two.
 *
 * A bidder who already holds 1,000 sats and types `1,100` means to hold 1,100:
 * the published delta is 100.
 */
export interface ArenaBidFloor {
	/**
	 * - `first`   — no bid read yet: the opening must reach `starting_bid`;
	 * - `raise`   — there is a top position: the new position must reach
	 *               `top + arenaRequiredRaise(top, min_increment_bps)`;
	 * - `unknown` — the create stated no `starting_bid`, or there is a top whose
	 *               raise cannot be known because the chain's `min_increment_bps`
	 *               has not been read.
	 */
	kind: 'first' | 'raise' | 'unknown'
	/** The amount a bidder's position must reach, or `null` for `unknown`. */
	minimum: number | null
	/** The top position the floor was computed from, when `kind === 'raise'`. */
	topTotal: number | null
}

/**
 * The chain's **required raise** on a top position: `max(1, ceil(top * bps /
 * 10000))`. This is the rule the chain applies at bid admission, where `bps` is
 * the params' effective `min_increment_bps` (200 = 2%). It is the **single**
 * copy of that arithmetic: the floor, the pre-check and the floor label all
 * derive from it, so a third variant cannot appear.
 *
 * `top` and the result are integer sats; the result is at least 1, so a 1-sat
 * self-raise cannot exist even at a top of 0.
 */
export function arenaRequiredRaise(top: number, bps: number): number {
	return Math.max(1, Math.ceil((top * bps) / 10000))
}

/**
 * The floor for a bid placed **now**, from the published terms.
 *
 * - No bid read → `starting_bid` (the create's own opening price). No
 *   `starting_bid` → `unknown`; the adapter refuses rather than inventing `0`.
 * - A top position exists but its total is unknown (bids without readable
 *   amounts) → a raise the client cannot compute: `unknown`, until the read is
 *   complete. An auction *with* the top known is the normal case.
 * - A top position → `top + arenaRequiredRaise(top, min_increment_bps)`, the
 *   chain's own rule, **including when the viewer is the current leader**: the
 *   chain no longer exempts a leader's self-raise, so the app must not either.
 *   When `min_increment_bps` has not been read (`null`) the raise is not known,
 *   so the floor is `unknown` — the app refuses rather than inventing one from
 *   the lot's create-time `min_increment`, which the chain does not use and
 *   which can be lower than the chain's rule.
 */
export function arenaBidFloor(
	model: Pick<ArenaAuctionDetailModel, 'startingBid' | 'minIncrementBps' | 'topBidTotal' | 'bidCount' | 'bidsWithoutAmount'>,
	ownPosition: number | null,
): ArenaBidFloor {
	if (model.bidsWithoutAmount > 0 || (model.bidCount > 0 && model.topBidTotal === null)) {
		// Some bid exists whose amount could not be read, so the top is not known
		// and neither is where the next raise has to land.
		return { kind: 'unknown', minimum: null, topTotal: null }
	}
	const top = model.topBidTotal
	if (top !== null) {
		if (!Number.isSafeInteger(top)) {
			return { kind: 'unknown', minimum: null, topTotal: top }
		}
		// The chain's rule needs its committed `bps`. Without it the raise cannot
		// be known, so the app refuses (`unknown`) rather than guessing.
		const bps = model.minIncrementBps
		if (bps === null || !Number.isSafeInteger(bps) || bps < 0) {
			return { kind: 'unknown', minimum: null, topTotal: top }
		}
		return { kind: 'raise', minimum: top + arenaRequiredRaise(top, bps), topTotal: top }
	}
	if (model.startingBid === null || !Number.isSafeInteger(model.startingBid)) {
		return { kind: 'unknown', minimum: null, topTotal: null }
	}
	// The bidder has already bid on an auction whose bids were not read into a
	// top — the read is partial. Their own position is the best floor known.
	if (ownPosition !== null && ownPosition > 0 && model.startingBid <= 0) {
		return { kind: 'first', minimum: ownPosition, topTotal: null }
	}
	return { kind: 'first', minimum: model.startingBid, topTotal: null }
}

// =========================================================================
// Intent → delta: the one conversion
// =========================================================================

/**
 * The bidder's own **position** on the lot: the sum of their live legs, as the
 * read records it (`auctionSurfacesRead.ts` → `ArenaAuctionDetailModel.positions`,
 * `arenaAuctionRead.ts`). The chain adds a bid's `Amount` (a delta) to whatever
 * the bidder already holds, so this is the figure the panel's intended
 * *position* is measured against.
 *
 * The honest answers, and never a substitute:
 *
 * - the bidder's entry carries a number → that sum;
 * - the entry carries `null` (a leg whose liveness the read could not vouch
 *   for) → `null`: **not known**;
 * - the bidder has no entry and the read is `settled` → `0` (they hold
 *   nothing);
 * - the bidder has no entry and the read has not settled → `null`. Absence in a
 *   partial read is not a zero: a leg the read has not delivered yet would
 *   become one, and the whole intent would be published as a delta.
 */
export function ownArenaPosition(
	model: Pick<ArenaAuctionDetailModel, 'positions'> | null,
	pubkey: string | null,
	status: ArenaBidCheckInput['status'],
): number | null {
	if (model === null || pubkey === null) return null
	const entry = model.positions.find((position) => position.bidder === pubkey)
	if (entry !== undefined) return entry.total
	return status === 'settled' ? 0 : null
}

/**
 * The **delta** the chain expects, from the panel's intended *position*.
 *
 * The panel's number is a position: `arenaBidFloor` states its floor against
 * positions, the field is pre-filled with that floor, and the bidder reads the
 * box as "where I will stand". The chain's `BidContent.Amount` is a delta added
 * to the bidder's existing position (`chain/app.go`). This is the **one**
 * conversion between the two, so the pre-check, the published `amount` and the
 * escrow cannot disagree: a 100-sat position and a 102-sat intent become a
 * 2-sat delta.
 *
 * An unknown own position (`ownArenaPosition` → `null`) yields `null`: the delta
 * cannot be known without knowing where the bidder stands, and treating it as
 * `0` is exactly the bug this conversion exists to prevent.
 */
export function arenaBidDelta(ownPosition: number | null, intent: number): number | null {
	if (ownPosition === null) return null
	return intent - ownPosition
}

// =========================================================================
// The check
// =========================================================================

export interface ArenaBidCheckInput {
	model: ArenaAuctionDetailModel | null
	/** The read state the model came from. */
	status: 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'
	/** Unix seconds, supplied by the caller so this stays pure. */
	now: number
	bidder: ArenaBidderState
	/**
	 * The typed bid, verbatim: the **position** the bidder means to hold after
	 * this bid — the number the panel shows — never the delta that gets
	 * published. `arenaBidDelta` turns it into that delta.
	 */
	raw: string
}

/** Whether the auction may be bid on at all, before any amount is typed. */
export function arenaBidBlock(
	model: ArenaAuctionDetailModel | null,
	status: ArenaBidCheckInput['status'],
	now: number,
	bidder: ArenaBidderState,
): ArenaBidBlockedReason | null {
	if (model === null) return 'auction-not-read'
	// A verdict is the auction's conclusion — the chain decided. The clock is a
	// second opinion and the weaker one, so a published verdict closes bidding
	// even if `endsAt` has not passed by local time.
	if (model.verdict !== null) return 'concluded'
	// The gate: the chain has published no create-admission fact for this lot, so
	// the app does not follow it at all. This outranks the clock — a lot nobody
	// accepted is not biddable whether or not a create-derived end has passed.
	if (model.phase === 'unaccepted') return 'not-accepted'
	if (model.phase === 'unknown') return 'end-unknown'
	if (model.phase === 'ended' || (model.endsAt !== null && now >= model.endsAt)) return 'ended'
	if (model.endsAt !== null && now < model.rootCreatedAt) return 'not-started'
	if (bidder.pubkey === null) return 'no-wallet'
	if (bidder.pubkey === model.seller) return 'own-auction'
	if (bidder.wallet !== 'ready') return 'wallet-unavailable'
	return null
}

/**
 * Pre-check one typed **position**. Blocking reasons outrank amount reasons: a
 * bidder cannot fix "the auction ended" by typing a bigger number.
 *
 * The typed number is a position; the chain is handed a delta. The guards, in
 * order, are: it parses; it is not zero; the floor is known; the bidder's own
 * position is known (the read has settled what they hold); the intent is a
 * raise on that position (delta ≥ 1); and the intent reaches the floor. The
 * delta — `arenaBidDelta(ownPosition, intent)` — is what `amount` carries, and
 * is the only number the publish and the escrow ever see.
 */
export function checkArenaBid(input: ArenaBidCheckInput): ArenaBidCheck {
	const { model, status, now, bidder, raw } = input
	const blocked = arenaBidBlock(model, status, now, bidder)
	// The typed integer is the **position** the bidder means to hold.
	const intent = parseBidAmountSats(raw)
	const ownPosition = ownArenaPosition(model, bidder.pubkey, status)
	const delta = intent === null ? null : arenaBidDelta(ownPosition, intent)
	// `amount` is the delta, and only when it is a positive integer: a delta at
	// or below zero is not an amount to publish, and a `0` here would read as one
	// to every consumer that checks `amount !== null`.
	const amount = delta !== null && delta >= 1 ? delta : null
	const floor = model !== null ? arenaBidFloor(model, ownPosition) : { kind: 'unknown' as const, minimum: null, topTotal: null }
	const base = { amount, minimum: floor.minimum, ownPosition }

	if (blocked !== null) {
		// An empty box on an ended auction is still `ended`, not `empty`: the
		// first thing the bidder needs to know is that bidding is closed.
		if (
			blocked === 'ended' ||
			blocked === 'concluded' ||
			blocked === 'not-accepted' ||
			blocked === 'end-unknown' ||
			blocked === 'own-auction' ||
			blocked === 'no-wallet' ||
			blocked === 'wallet-unavailable' ||
			blocked === 'auction-not-read' ||
			blocked === 'not-started'
		) {
			return { allowed: false, reason: blocked, ...base }
		}
	}
	if (raw.trim() === '') return { allowed: false, reason: 'empty', ...base }
	if (intent === null) return { allowed: false, reason: 'not-integer-sats', ...base }
	if (intent === 0) return { allowed: false, reason: 'zero', ...base }
	if (floor.minimum === null) {
		return { allowed: false, reason: model?.startingBid === null ? 'no-starting-bid' : 'read-incomplete', ...base }
	}
	// The read has not settled what the bidder holds, so the delta cannot be
	// known. Refused, never treated as a `0` own position.
	if (ownPosition === null) return { allowed: false, reason: 'own-position-unknown', ...base }
	// A bid adds to the bidder's position; an intent at or below where they
	// already stand has nothing to add (the delta would be ≤ 0).
	if (amount === null) return { allowed: false, reason: 'at-or-below-own-position', ...base }
	// The resulting position is the typed intent (`ownPosition + delta`); it must
	// reach the chain's floor.
	if (intent < floor.minimum) return { allowed: false, reason: 'below-minimum', ...base }
	return { allowed: true, reason: 'ok', ...base }
}

// =========================================================================
// The words
// =========================================================================

function sats(value: number): string {
	return `${value.toLocaleString()} sats`
}

/** The panel's own headline for a blocked or invalid bid. Empty for `ok`. */
export function bidBlockedCopy(reason: ArenaBidBlockedReason, check: Pick<ArenaBidCheck, 'minimum' | 'ownPosition'>): string {
	switch (reason) {
		case 'auction-not-read':
			return 'This auction could not be read, so there is nothing to bid on yet.'
		case 'read-incomplete':
			return 'The auction’s bids or the chain’s terms could not all be read, so the minimum for your next bid is not known. Reload to try again.'
		case 'end-unknown':
			return 'This auction states no end time, so the app cannot say whether bidding is open. Nothing is offered for bid until an end time is published.'
		case 'ended':
			return 'Bidding has closed for this auction.'
		case 'not-accepted':
			return 'The chain has not accepted this listing, so this app does not follow it and nothing may be bid on it. Bidding opens when the chain accepts the create.'
		case 'not-started':
			return 'This auction has not opened yet.'
		case 'own-auction':
			return 'This is your auction. You cannot bid on your own listing.'
		case 'no-wallet':
			return 'Sign in with a wallet to bid — a bid is a signed event, and only a key of your own can sign it.'
		case 'wallet-unavailable':
			return 'Your wallet is not ready to sign right now. Unlock it and try again.'
		case 'concluded':
			return 'A verdict has been published for this auction, so bidding is over.'
		case 'empty':
			return 'Enter a bid amount in sats.'
		case 'not-integer-sats':
			return 'Bids are whole satoshis. Enter a whole number with no decimal point — an amount the app would otherwise round is not an amount you typed.'
		case 'zero':
			return 'A bid must be more than zero sats.'
		case 'no-starting-bid':
			return 'This auction published no starting bid, so there is no opening price to meet. Bidding is not offered rather than guessed at.'
		case 'below-minimum':
			return check.minimum !== null
				? check.ownPosition !== null && check.ownPosition > 0
					? `Your position must reach at least ${sats(check.minimum)}; you hold ${sats(check.ownPosition)} now.`
					: `The lowest position this auction accepts is ${sats(check.minimum)}.`
				: 'This bid is below the auction’s minimum.'
		case 'at-or-below-own-position':
			return check.ownPosition !== null
				? `Your bid must raise your position above the ${sats(check.ownPosition)} you already hold.`
				: 'Your bid must raise the position you already hold.'
		case 'own-position-unknown':
			return 'The app could not settle the position you already hold on this auction, so it cannot work out how much your bid adds. It will not guess — reload to try again.'
		case 'ok':
			return ''
	}
}

/**
 * The one sentence that must accompany every enabled bid button: a pre-check is
 * not validity, and the money decision is not the client's.
 */
export const ARENA_BID_ADVISORY =
	'This app checks your bid against the terms published on the relays. It cannot accept or refuse a bid: the relay stores what you sign and the chain decides. No funds move when you publish.'
