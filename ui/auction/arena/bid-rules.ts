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
 * It is a **client-side pre-check against the terms the create published**.
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
	/** Passes the client pre-check. Publishable — not valid. */
	| 'ok'

/** The outcome of pre-checking one amount against one auction. */
export interface ArenaBidCheck {
	/** `true` only for `ok`. */
	allowed: boolean
	/** Why. Always populated — `ok` is a reason too. */
	reason: ArenaBidBlockedReason
	/** The integer sats the input represents, or `null` when it does not parse. */
	amount: number | null
	/**
	 * The lowest amount the published terms allow for this bidder at `now`,
	 * or `null` when it cannot be computed (`starting_bid` unstated).
	 */
	minimum: number | null
	/** The bidder's own position, if they already have one. Tells the UI the input is a **delta**. */
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
 * (`platform/web/auctions/protocol/client.ts:62-63`: "A DELTA added to the
 * bidder's existing position, not their new total"). So the comparable figure
 * for "can this bid stand?" is the bidder's position **after** the delta, which
 * is `ownPosition + amount` — not `amount` on its own.
 *
 * A bidder who already holds 1,000 sats and types `100` on an auction whose
 * floor is 1,100 has not bid 1,100; they have bid 100 and their position is
 * 1,100. The check compares positions.
 */
export interface ArenaBidFloor {
	/**
	 * - `first`   — no bid read yet: the opening must reach `starting_bid`;
	 * - `raise`   — there is a top position: the new position must reach
	 *               `top + min_increment` (the increment when the create stated
	 *               one, otherwise the top itself — see below);
	 * - `unknown` — the create stated no `starting_bid`, so no floor can be computed.
	 */
	kind: 'first' | 'raise' | 'unknown'
	/** The amount a bidder's position must reach, or `null` for `unknown`. */
	minimum: number | null
	/** The top position the floor was computed from, when `kind === 'raise'`. */
	topTotal: number | null
}

/**
 * The floor for a bid placed **now**, from the published terms.
 *
 * - No bid read → `starting_bid` (the create's own opening price). No
 *   `starting_bid` → `unknown`; the adapter refuses rather than inventing `0`.
 * - A top position exists but its total is unknown (bids without readable
 *   amounts) → a raise the client cannot compute: `unknown`, until the read is
 *   complete. An auction *with* the top known is the normal case.
 * - A top position → `top + min_increment`. An **unstated** `min_increment` is
 *   not zero: the terms are silent, so the client will not invent a raise
 *   below the top. It requires **one more sat than the top** — the floor the
 *   protocol itself enforces on a raise regardless of the increment, and the
 *   strictest reading available without guessing. This is stated in the UI
 *   (`minIncrement === null` → "no minimum increment was published").
 */
export function arenaBidFloor(
	model: Pick<ArenaAuctionDetailModel, 'startingBid' | 'minIncrement' | 'topBidTotal' | 'bidCount' | 'bidsWithoutAmount'>,
	ownPosition: number | null,
): ArenaBidFloor {
	if (model.bidsWithoutAmount > 0 || (model.bidCount > 0 && model.topBidTotal === null)) {
		// Some bid exists whose amount could not be read, so the top is not known
		// and neither is where the next raise has to land.
		return { kind: 'unknown', minimum: null, topTotal: null }
	}
	const top = model.topBidTotal
	if (top !== null) {
		const step = model.minIncrement === null ? 1 : model.minIncrement
		if (!Number.isSafeInteger(top) || !Number.isSafeInteger(step) || step < 0) {
			return { kind: 'unknown', minimum: null, topTotal: top }
		}
		// A bidder improving their OWN standing need only reach the top: their
		// position already is the top. Requiring top + increment from the current
		// leader would make them outbid themselves by a step.
		if (ownPosition !== null && ownPosition >= top) {
			return { kind: 'raise', minimum: top, topTotal: top }
		}
		return { kind: 'raise', minimum: top + step, topTotal: top }
	}
	if (model.startingBid === null || !Number.isSafeInteger(model.startingBid)) {
		return { kind: 'unknown', minimum: null, topTotal: null }
	}
	// The bidder has already bid on an auction whose bids were not read into a
	// top — the read is partial. Their own position is the best floor known.
	if (ownPosition !== null && model.startingBid <= 0) {
		return { kind: 'first', minimum: ownPosition, topTotal: null }
	}
	return { kind: 'first', minimum: model.startingBid, topTotal: null }
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
	/** The typed amount, verbatim. */
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
	if (model.phase === 'unknown') return 'end-unknown'
	if (model.phase === 'ended' || (model.endsAt !== null && now >= model.endsAt)) return 'ended'
	if (model.endsAt !== null && now < model.rootCreatedAt) return 'not-started'
	if (bidder.pubkey === null) return 'no-wallet'
	if (bidder.pubkey === model.seller) return 'own-auction'
	if (bidder.wallet !== 'ready') return 'wallet-unavailable'
	return null
}

/**
 * Pre-check one amount. Blocking reasons outrank amount reasons: a bidder
 * cannot fix "the auction ended" by typing a bigger number.
 */
export function checkArenaBid(input: ArenaBidCheckInput): ArenaBidCheck {
	const { model, status, now, bidder, raw } = input
	const blocked = arenaBidBlock(model, status, now, bidder)
	const amount = parseBidAmountSats(raw)
	const ownPosition = model !== null && bidder.pubkey !== null ? (model.positions.find((p) => p.bidder === bidder.pubkey)?.total ?? null) : null
	const floor = model !== null ? arenaBidFloor(model, ownPosition) : { kind: 'unknown' as const, minimum: null, topTotal: null }
	const base = { amount, minimum: floor.minimum, ownPosition }

	if (blocked !== null) {
		// An empty box on an ended auction is still `ended`, not `empty`: the
		// first thing the bidder needs to know is that bidding is closed.
		if (blocked === 'ended' || blocked === 'concluded' || blocked === 'end-unknown' || blocked === 'own-auction' || blocked === 'no-wallet' || blocked === 'wallet-unavailable' || blocked === 'auction-not-read' || blocked === 'not-started') {
			return { allowed: false, reason: blocked, ...base }
		}
	}
	if (raw.trim() === '') return { allowed: false, reason: 'empty', ...base }
	if (amount === null) return { allowed: false, reason: 'not-integer-sats', ...base }
	if (amount === 0) return { allowed: false, reason: 'zero', ...base }
	if (floor.minimum === null) {
		return { allowed: false, reason: model?.startingBid === null ? 'no-starting-bid' : 'read-incomplete', ...base }
	}
	const resulting = (ownPosition ?? 0) + amount
	if (resulting < floor.minimum) return { allowed: false, reason: 'below-minimum', ...base }
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
			return 'The auction’s bids could not all be read, so the minimum for your next bid is not known. Reload to try again.'
		case 'end-unknown':
			return 'This auction states no end time, so the app cannot say whether bidding is open. Nothing is offered for bid until an end time is published.'
		case 'ended':
			return 'Bidding has closed for this auction.'
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
				? check.ownPosition !== null
					? `A bid adds to your position rather than replacing it. This one must bring your position to at least ${sats(check.minimum)}.`
					: `The lowest bid accepted here is ${sats(check.minimum)}.`
				: 'This bid is below the auction’s minimum.'
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