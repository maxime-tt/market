/**
 * `arenaClock.ts` — the arena **chain clock**: a pure reading of chain time from
 * the kind-1447 state commitments the read already carries, with the policy the
 * rules need.
 *
 * ## The ruling this implements
 *
 * The clock is a **combination of wall time and block time**:
 *
 * - the **wall clock** drives the *display* (the route's one ticking `now`);
 * - the **anchored commitment** drives the *rules* — is the window open, has the
 *   end passed, is a lock settleable — because a pulse that is not anchored to
 *   committed state can never authorise anything.
 *
 * The commitment is a step function (cadence every 100 blocks, and this chain
 * produces blocks on demand), so it can never be the countdown's tick; it is the
 * **rules clock** and a freshness signal. When the ephemeral heartbeat lands it
 * becomes a second, faster source on top of the same rule, and its several ticks
 * at one height are simply more commitments — which is why the read's dedupe key
 * had to start including `time` (`arenaAuctionRead.ts`). This module is written
 * against the commitment only and needs no new kind.
 *
 * ## Honesty (the house rules)
 *
 * - **Nothing is substituted.** No `0` and no `Date.now()` is ever put where a
 *   chain time did not arrive: an unknown chain time stays `null` and reads as
 *   the word `unknown`, and an old time is never presented as now.
 * - **A forked height does not advance the rules clock.** Two relays reporting a
 *   different `app_hash` at one height is a signal, not proof, so a height named
 *   in `commitmentForks` is skipped and named in `refusedHeights` — never
 *   averaged, never picked.
 * - **The clock never regresses.** A later reading with a lower height (or an
 *   equal height with an older `time`) keeps the earlier reading and sets
 *   `regressionRefused`; the refusal is carried in the value, never silent.
 *
 * Pure: no network, no React, no clock of its own — the wall clock is an input.
 */

import type { ArenaChainClockModel } from '@ui/auction/arena/model'

/**
 * The staleness threshold, in seconds.
 *
 * Chain time is "as of height N", and the rules it drives sit at the protocol's
 * own safety scale: `SettlementSafetySec = 900 s` (a pushed settlement is only
 * safe within that margin of the committed end) and anti-snipe windows of
 * 60–900 s. So the anchored time is **fresh** while wall clock is within the
 * longest of those — 900 s — of it, and **stale** beyond: past that margin the
 * anchor can no longer underwrite a rule at the protocol's own scale, and a
 * surface must say so rather than present the old time as now. This is a *rules*
 * bound, not a heartbeat bound: when the ~10 s heartbeat lands it can tighten
 * this, but no rule this clock serves needs finer than 900 s to stay honest.
 */
export const ARENA_CHAIN_CLOCK_STALE_AFTER_SEC = 900

/**
 * A commitment as this module reads it — the parsed anchor, plus provenance when
 * the caller has it. `ParsedArenaStateCommitment` is assignable (it simply has
 * no `relays`); the read's own `stateCommitments` carry the relays.
 */
export interface ArenaChainClockCommitment {
	height: number
	appHash: string
	/** The content's `time` (unix seconds), or `null` when it stated none. */
	time: number | null
	/** The signing validator, or `null`. */
	validatorPubkey: string | null
	/** Every relay that delivered it, when the caller has provenance. */
	relays?: readonly string[]
}

/** A forked height as this module reads it: relays disagreed on the `app_hash` at it. */
export interface ArenaChainClockFork {
	height: number
}

export interface ArenaChainClockInput {
	/** The read's `stateCommitments`. */
	stateCommitments: readonly ArenaChainClockCommitment[]
	/** The read's `commitmentForks`. */
	commitmentForks: readonly ArenaChainClockFork[]
	/** Wall clock, unix seconds. */
	now: number
	/** The previous reading, so the clock can refuse to move backwards. */
	previous?: ArenaChainClockModel | null
}

interface ResolvedAnchor {
	time: number | null
	height: number
	validatorPubkey: string | null
	relays: string[]
}

function byHeightThenTimeDesc(a: ArenaChainClockCommitment, b: ArenaChainClockCommitment): number {
	if (a.height !== b.height) return b.height - a.height
	if (a.time !== b.time) {
		if (a.time === null) return 1
		if (b.time === null) return -1
		return b.time - a.time
	}
	return (a.validatorPubkey ?? '').localeCompare(b.validatorPubkey ?? '')
}

/** True when `a` is strictly older than `b`; a `null` time is older than any stated one. */
function isOlder(a: number | null, b: number | null): boolean {
	if (a === b) return false
	if (a === null) return true
	if (b === null) return false
	return a < b
}

function build(parts: {
	time: number | null
	height: number | null
	validatorPubkey: string | null
	relays: string[]
	refusedHeights: readonly number[]
	regressionRefused: boolean
	now: number
}): ArenaChainClockModel {
	const ageSec = parts.time === null ? null : parts.now - parts.time
	return {
		time: parts.time,
		height: parts.height,
		validatorPubkey: parts.validatorPubkey,
		relays: parts.relays,
		ageSec,
		freshness: ageSec === null ? 'unknown' : ageSec > ARENA_CHAIN_CLOCK_STALE_AFTER_SEC ? 'stale' : 'fresh',
		// The rules judge against the same anchored instant the clock states; the
		// field is named separately so a rules consumer reads a named thing.
		rulesTime: parts.time,
		rulesHeight: parts.height,
		refusedHeights: [...new Set(parts.refusedHeights)].sort((a, b) => b - a),
		regressionRefused: parts.regressionRefused,
	}
}

/**
 * Read the chain clock from the commitments the read delivered.
 *
 * The anchor is the highest **agreed** height: highest-first, skipping every
 * forked height. Against the optional `previous` reading the clock refuses to
 * move backwards; with no agreed commitment it holds the previous anchor rather
 * than blanking it (it ages and goes stale on its own). With neither, it is
 * honestly unknown: a `null` time, no number invented in its place.
 */
export function arenaChainClock(input: ArenaChainClockInput): ArenaChainClockModel {
	const forked = new Set(input.commitmentForks.map((fork) => fork.height))

	// The input is authored height desc, time desc (`arenaAuctionRead.ts`), but sort
	// so this module does not depend on the caller's order.
	const ordered = [...input.stateCommitments].sort(byHeightThenTimeDesc)

	let candidate: ResolvedAnchor | null = null
	const refusedHeights: number[] = []
	for (const commitment of ordered) {
		if (forked.has(commitment.height)) {
			// A forked height must not advance the rules clock: skip it, name it.
			if (!refusedHeights.includes(commitment.height)) refusedHeights.push(commitment.height)
			continue
		}
		candidate = {
			time: commitment.time,
			height: commitment.height,
			validatorPubkey: commitment.validatorPubkey,
			relays: commitment.relays === undefined ? [] : [...commitment.relays],
		}
		break
	}

	const previous = input.previous ?? null

	// Monotonic guard: never regress. A later reading with a lower height, or an
	// equal height with an older time, must not move the clock backwards; the
	// earlier reading is kept and the refusal is carried in the value.
	if (candidate !== null && previous !== null && previous.height !== null) {
		const lowerHeight = candidate.height < previous.height
		const sameHeightOlder = candidate.height === previous.height && isOlder(candidate.time, previous.time)
		if (lowerHeight || sameHeightOlder) {
			return build({
				time: previous.time,
				height: previous.height,
				validatorPubkey: previous.validatorPubkey,
				relays: [...previous.relays],
				refusedHeights: [...refusedHeights, ...previous.refusedHeights],
				regressionRefused: true,
				now: input.now,
			})
		}
	}

	if (candidate !== null) {
		return build({ ...candidate, refusedHeights, regressionRefused: false, now: input.now })
	}

	// No agreed commitment this reading: hold the last known anchor rather than
	// blank it, so the clock never drops backwards and its age keeps growing.
	if (previous !== null && previous.height !== null) {
		return build({
			time: previous.time,
			height: previous.height,
			validatorPubkey: previous.validatorPubkey,
			relays: [...previous.relays],
			refusedHeights: [...refusedHeights, ...previous.refusedHeights],
			regressionRefused: false,
			now: input.now,
		})
	}

	return build({
		time: null,
		height: null,
		validatorPubkey: null,
		relays: [],
		refusedHeights,
		regressionRefused: false,
		now: input.now,
	})
}
