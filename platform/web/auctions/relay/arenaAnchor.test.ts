import { describe, expect, test } from 'bun:test'
import {
	ARENA_AUCTION_KINDS,
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_VERDICT_KIND,
} from '@sdk/commerce/auctions/constants'
import {
	ARENA_REFUSAL_BAD_HEIGHT,
	ARENA_REFUSAL_BAD_HASH,
	ARENA_REFUSAL_BAD_SCHEMA,
	ArenaContractError,
	ArenaUnanchoredError,
	isAnchoredArenaEvent,
	parseArenaStateCommitment,
	parseArenaVerdict,
	type ArenaEventLike,
	type ArenaRefusalName,
} from './arenaAnchor'

// ---------- Fixtures -------------------------------------------------------

const AUCTION_ID = '7c1f0e5b-2a3d-4f60-9c11-3d2e4f5a6b70'
const BID_ID = 'b1d'
const VALIDATOR = 'aa'.repeat(32)
const BLOCK_HASH = 'a3f1' + 'deadbeef'.repeat(6)

function verdict(
	overrides: {
		tags?: string[][]
		content?: Record<string, unknown>
		kind?: number
	} = {},
): ArenaEventLike {
	const content: Record<string, unknown> = {
		schema: 'arena.verdict.v1',
		auction_id: AUCTION_ID,
		bid_id: BID_ID,
		outcome: 'winner',
		payout_token_sha256: null,
		height: 12345,
		block_hash: BLOCK_HASH,
		derived_from: 'committed_state',
		...overrides.content,
	}
	const tags: string[][] = overrides.tags ?? [
		['auction', AUCTION_ID],
		['bid', BID_ID],
		['height', '12345'],
		['hash', BLOCK_HASH],
		['outcome', 'winner'],
		['p', VALIDATOR],
	]
	return { kind: overrides.kind ?? ARENA_VERDICT_KIND, tags, content: JSON.stringify(content) }
}

function stateCommit(
	overrides: { tags?: string[][]; content?: Record<string, unknown> } = {},
): ArenaEventLike {
	const content: Record<string, unknown> = {
		schema: 'arena.statecommit.v1',
		height: 12345,
		app_hash: BLOCK_HASH,
		time: 1_760_000_000,
		...overrides.content,
	}
	const tags: string[][] = overrides.tags ?? [
		['height', '12345'],
		['hash', BLOCK_HASH],
		['p', VALIDATOR],
	]
	return { kind: ARENA_STATE_COMMITMENT_KIND, tags, content: JSON.stringify(content) }
}

/** Assert a call throws the named refusal (and, for the class, that class). */
function expectRefusal(fn: () => unknown, refusal: ArenaRefusalName, cls: typeof ArenaContractError = ArenaContractError): void {
	let caught: unknown
	try {
		fn()
	} catch (err) {
		caught = err
	}
	expect(caught).toBeInstanceOf(cls)
	expect((caught as ArenaContractError).refusal).toBe(refusal)
}

// ---------- Kind map -------------------------------------------------------

describe('ARENA_AUCTION_KINDS', () => {
	test('pins the frozen 1440-series numbers in one record', () => {
		expect(ARENA_AUCTION_KINDS).toEqual({
			create: 1440,
			bid: 1441,
			chat: 1442,
			refund: 1443,
			settle: 1444,
			verdict: 1445,
			fundingAbort: 1446,
			stateCommitment: 1447,
		})
		expect(ARENA_VERDICT_KIND).toBe(1445)
		expect(ARENA_STATE_COMMITMENT_KIND).toBe(1447)
	})
})

// ---------- Verdict (kind 1445) --------------------------------------------

describe('parseArenaVerdict', () => {
	test('parses a well-formed anchored verdict', () => {
		const parsed = parseArenaVerdict(verdict())
		expect(parsed.auctionId).toBe(AUCTION_ID)
		expect(parsed.bidId).toBe(BID_ID)
		expect(parsed.outcome).toBe('winner')
		expect(parsed.payoutTokenSha256).toBeNull()
		expect(parsed.height).toBe(12345)
		expect(parsed.blockHash).toBe(BLOCK_HASH)
		expect(parsed.derivedFrom).toBe('committed_state')
		expect(parsed.validatorPubkey).toBe(VALIDATOR)
	})

	test('rejects a verdict with a MISSING height anchor, by name', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['hash', BLOCK_HASH],
				['outcome', 'winner'],
			],
			content: { height: undefined },
		})
		expectRefusal(() => parseArenaVerdict(ev), 'arena.unanchored', ArenaUnanchoredError)
	})

	test('rejects a verdict with a MISSING hash anchor, by name', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['height', '12345'],
				['outcome', 'winner'],
			],
			content: { block_hash: undefined },
		})
		expectRefusal(() => parseArenaVerdict(ev), 'arena.unanchored', ArenaUnanchoredError)
	})

	test('rejects a NON-NUMERIC height', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['height', 'not-a-number'],
				['hash', BLOCK_HASH],
			],
			content: { height: undefined },
		})
		expectRefusal(() => parseArenaVerdict(ev), ARENA_REFUSAL_BAD_HEIGHT)
	})

	test('rejects a height of zero', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['height', '0'],
				['hash', BLOCK_HASH],
			],
			content: { height: 0 },
		})
		expectRefusal(() => parseArenaVerdict(ev), ARENA_REFUSAL_BAD_HEIGHT)
	})

	test('rejects a negative height', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['height', '-5'],
				['hash', BLOCK_HASH],
			],
			content: { height: -5 },
		})
		expectRefusal(() => parseArenaVerdict(ev), ARENA_REFUSAL_BAD_HEIGHT)
	})

	test('rejects a non-hex hash', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['height', '12345'],
				['hash', 'zzzz-not-hex'],
			],
			content: { block_hash: undefined },
		})
		expectRefusal(() => parseArenaVerdict(ev), ARENA_REFUSAL_BAD_HASH)
	})

	test('rejects a wrong schema, by name', () => {
		const ev = verdict({
			tags: [
				['auction', AUCTION_ID],
				['height', '12345'],
				['hash', BLOCK_HASH],
			],
			content: { schema: 'arena.verdict.v2' },
		})
		expectRefusal(() => parseArenaVerdict(ev), ARENA_REFUSAL_BAD_SCHEMA)
	})

	test('rejects a verdict of the wrong kind', () => {
		const ev = verdict({ kind: ARENA_AUCTION_KINDS.create })
		expectRefusal(() => parseArenaVerdict(ev), 'arena.bad_kind')
	})
})

// ---------- State commitment (kind 1447) -----------------------------------

describe('parseArenaStateCommitment', () => {
	test('parses a well-formed anchored state commitment', () => {
		const parsed = parseArenaStateCommitment(stateCommit())
		expect(parsed.height).toBe(12345)
		expect(parsed.appHash).toBe(BLOCK_HASH)
		expect(parsed.time).toBe(1_760_000_000)
		expect(parsed.validatorPubkey).toBe(VALIDATOR)
	})

	test('rejects an unanchored state commitment (missing height), by name', () => {
		const ev = stateCommit({
			tags: [
				['hash', BLOCK_HASH],
				['p', VALIDATOR],
			],
			content: { height: undefined },
		})
		expectRefusal(() => parseArenaStateCommitment(ev), 'arena.unanchored', ArenaUnanchoredError)
	})

	test('rejects an unanchored state commitment (missing app_hash), by name', () => {
		const ev = stateCommit({
			tags: [['height', '12345']],
			content: { app_hash: undefined },
		})
		expectRefusal(() => parseArenaStateCommitment(ev), 'arena.unanchored', ArenaUnanchoredError)
	})

	test('rejects a wrong schema', () => {
		const ev = stateCommit({
			tags: [
				['height', '12345'],
				['hash', BLOCK_HASH],
			],
			content: { schema: 'arena.statecommit.v2' },
		})
		expectRefusal(() => parseArenaStateCommitment(ev), ARENA_REFUSAL_BAD_SCHEMA)
	})
})

// ---------- Anchor gate ----------------------------------------------------

describe('isAnchoredArenaEvent', () => {
	test('is true for anchored events and false for unanchored / unknown kinds', () => {
		expect(isAnchoredArenaEvent(verdict())).toBe(true)
		expect(isAnchoredArenaEvent(stateCommit())).toBe(true)
		expect(
			isAnchoredArenaEvent(verdict({ tags: [['auction', AUCTION_ID]], content: { height: undefined, block_hash: undefined } })),
		).toBe(false)
		expect(isAnchoredArenaEvent({ kind: 1, tags: [], content: 'hi' })).toBe(false)
	})
})
