/**
 * `arenaLotStateRead.test.ts` — the chain's state half read: the committed end
 * (kind 1449, `arena.lot.v1`) and the refusals (kind 1450, `arena.refused.v1`),
 * verified the way the app verifies a kind-1448 params event.
 *
 * The fixtures are **signed with a deterministic key** with `nostr-tools`, so a
 * tampered signature, a wrong schema, a missing anchor, a disagreeing anchor, a
 * non-roster signer and a 1450 whose `e` tag disagrees with `event_id` each
 * reach their own named refusal. The shapes are taken from the live events in
 * `docs/CHAIN-STATE-HALF-2026-11-18-RESULT.md` §4.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { ARENA_LOT_STATE_KIND, ARENA_REFUSED_KIND } from '@sdk/commerce/auctions/constants'
import {
	ARENA_LOT_STATE_REFUSAL_ANCHOR_MISMATCH,
	ARENA_LOT_STATE_REFUSAL_BAD_ANCHOR,
	ARENA_LOT_STATE_REFUSAL_BAD_CONTENT,
	ARENA_LOT_STATE_REFUSAL_BAD_KIND,
	ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA,
	ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE,
	ARENA_LOT_STATE_REFUSAL_SIGNER_NOT_IN_ROSTER,
	ARENA_LOT_STATE_REFUSAL_UNANCHORED,
	ArenaLotStateError,
	dedupeArenaRefusals,
	dedupeArenaLotStates,
	isVerifiedArenaRefusalEvent,
	isVerifiedArenaLotStateEvent,
	lotStateForLot,
	lotStateKey,
	parseArenaRefusalEvent,
	parseArenaLotStateEvent,
	readArenaLotState,
	refusalKey,
	type ArenaLotStateEventLike,
	type ArenaLotStateRefusalName,
} from './arenaLotStateRead'

// ---------- The deterministic signer --------------------------------------

const SK = new Uint8Array(32).fill(9)
const PUB = getPublicKey(SK)
const OTHER_SK = new Uint8Array(32).fill(11)
const OTHER = getPublicKey(OTHER_SK)

const AUCTION = '1440:3e936db1aad4706d79b20a486c1f2a73aaadf0f3af4b909e7835464ec9b441dd:lot1449-1795021494772'
const CREATE_ID = '00189699a970057ed792605801d420fcae40403518ae7998d4e7eced0605f376'

// ---------- Fixtures built from the contract ------------------------------

function lotStateContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: 'arena.lot.v1',
		auction_id: AUCTION,
		end_time: 1_795_021_627,
		original_end_time: 1_795_021_615,
		extensions: 1,
		height: 1734,
		block_hash: 'a8e25d2044c0be17413f822a4e867af5b4332f599c760dc6da180f604cb9542f',
		...over,
	}
}

function refusalContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: 'arena.refused.v1',
		event_id: CREATE_ID,
		kind: 1440,
		reason: 'title required (max 120 chars)',
		height: 1749,
		block_hash: '0210e491ea9750bc2673d5d5ab3cfad2adabab56dff0bf095ff2bc5fa9ba8fb6',
		...over,
	}
}

const lotStateTags = (content: Record<string, unknown>): string[][] => [
	['auction', String(content.auction_id)],
	['height', String(content.height)],
	['hash', String(content.block_hash)],
]

const refusalTags = (content: Record<string, unknown>): string[][] => [
	['e', String(content.event_id)],
	['height', String(content.height)],
	['hash', String(content.block_hash)],
]

function signed(
	kind: number,
	content: Record<string, unknown>,
	over: { tags?: string[][]; sk?: Uint8Array; created_at?: number } = {},
): ArenaLotStateEventLike {
	const sk = over.sk ?? SK
	const tags = over.tags ?? (kind === ARENA_LOT_STATE_KIND ? lotStateTags(content) : refusalTags(content))
	return finalizeEvent(
		{ kind, created_at: over.created_at ?? 1_795_021_527, tags, content: JSON.stringify(content) },
		sk,
	) as unknown as ArenaLotStateEventLike
}

const lotStateEvent = (
	over: { content?: Record<string, unknown>; tags?: string[][]; sk?: Uint8Array; kind?: number; created_at?: number } = {},
): ArenaLotStateEventLike => signed(over.kind ?? ARENA_LOT_STATE_KIND, lotStateContent(over.content), over)

const refusalEvent = (
	over: { content?: Record<string, unknown>; tags?: string[][]; sk?: Uint8Array; kind?: number; created_at?: number } = {},
): ArenaLotStateEventLike => signed(over.kind ?? ARENA_REFUSED_KIND, refusalContent(over.content), over)

const refusalOf = (parse: () => unknown): ArenaLotStateRefusalName => {
	try {
		parse()
	} catch (error) {
		if (error instanceof ArenaLotStateError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a parsed fact')
}

// ==========================================================================
// The 1449 parser
// ==========================================================================

describe('parseArenaLotStateEvent — the committed end', () => {
	test('parses a signed, anchored committed end and exposes every field', () => {
		const parsed = parseArenaLotStateEvent(lotStateEvent())
		expect(parsed.auctionId).toBe(AUCTION)
		expect(parsed.endTime).toBe(1_795_021_627)
		expect(parsed.originalEndTime).toBe(1_795_021_615)
		expect(parsed.extensionOrdinal).toBe(1)
		expect(parsed.height).toBe(1734)
		expect(parsed.blockHash).toBe('a8e25d2044c0be17413f822a4e867af5b4332f599c760dc6da180f604cb9542f')
		expect(isVerifiedArenaLotStateEvent(lotStateEvent())).toBe(true)
	})

	test('a committed end carrying no original_end_time exposes null, never a default', () => {
		const parsed = parseArenaLotStateEvent(lotStateEvent({ content: { original_end_time: undefined, extensions: 0 } }))
		expect(parsed.originalEndTime).toBeNull()
		expect(parsed.extensionOrdinal).toBe(0)
	})

	test('the extensions ordinal is read as an ordinal, not a count', () => {
		// A late joiner reads a lot already extended twice: the event names the
		// ordinal of the end it carries, and reads as 2 — not "extended twice".
		const parsed = parseArenaLotStateEvent(lotStateEvent({ content: { extensions: 2 } }))
		expect(parsed.extensionOrdinal).toBe(2)
	})
})

// ==========================================================================
// Each failure is refused by name
// ==========================================================================

describe('each 1449 failure is refused by name', () => {
	test('a tampered signature is refused as arena.lot_state.bad_signature', () => {
		const good = lotStateEvent()
		const tampered = { ...good, sig: `${good.sig.slice(0, -2)}${good.sig.endsWith('00') ? '11' : '00'}` }
		expect(refusalOf(() => parseArenaLotStateEvent(tampered))).toBe(ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE)
	})

	test('a wrong kind is refused as arena.lot_state.bad_kind', () => {
		expect(refusalOf(() => parseArenaLotStateEvent(lotStateEvent({ kind: 1447 })))).toBe(ARENA_LOT_STATE_REFUSAL_BAD_KIND)
	})

	test('a wrong schema is refused as arena.lot_state.bad_schema', () => {
		expect(refusalOf(() => parseArenaLotStateEvent(lotStateEvent({ content: { schema: 'arena.refused.v1' } })))).toBe(
			ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA,
		)
	})

	test('a missing anchor is refused as arena.lot_state.unanchored', () => {
		const content = lotStateContent()
		delete content.height
		delete content.block_hash
		expect(refusalOf(() => parseArenaLotStateEvent(signed(ARENA_LOT_STATE_KIND, content, { tags: [['auction', AUCTION]] })))).toBe(
			ARENA_LOT_STATE_REFUSAL_UNANCHORED,
		)
	})

	test('a tag anchor that disagrees with the content anchor is refused as arena.lot_state.anchor_mismatch', () => {
		const canonical = lotStateContent()
		expect(
			refusalOf(() =>
				parseArenaLotStateEvent(signed(ARENA_LOT_STATE_KIND, lotStateContent({ height: 9999 }), { tags: lotStateTags(canonical) })),
			),
		).toBe(ARENA_LOT_STATE_REFUSAL_ANCHOR_MISMATCH)
	})

	test('a malformed hash anchor is refused as arena.lot_state.bad_anchor', () => {
		const content = lotStateContent({ block_hash: 'nothex' })
		expect(refusalOf(() => parseArenaLotStateEvent(signed(ARENA_LOT_STATE_KIND, content, { tags: lotStateTags(content) })))).toBe(
			ARENA_LOT_STATE_REFUSAL_BAD_ANCHOR,
		)
	})

	test('an auction tag that disagrees with the content auction_id is refused as bad_content', () => {
		expect(
			refusalOf(() =>
				parseArenaLotStateEvent(
					signed(ARENA_LOT_STATE_KIND, lotStateContent(), {
						tags: [
							['auction', '1440:other:lot'],
							['height', '1734'],
							['hash', String(lotStateContent().block_hash)],
						],
					}),
				),
			),
		).toBe(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT)
	})

	test('a lot-state with no readable end_time is refused as bad_content', () => {
		const content = lotStateContent({ end_time: undefined })
		expect(refusalOf(() => parseArenaLotStateEvent(signed(ARENA_LOT_STATE_KIND, content, { tags: lotStateTags(content) })))).toBe(
			ARENA_LOT_STATE_REFUSAL_BAD_CONTENT,
		)
	})

	test('a non-roster signer is refused as signer_not_in_roster only when a roster is known', () => {
		expect(refusalOf(() => parseArenaLotStateEvent(lotStateEvent(), { roster: [OTHER] }))).toBe(
			ARENA_LOT_STATE_REFUSAL_SIGNER_NOT_IN_ROSTER,
		)
		// No roster: a fact carries no validator set, so the gate is the kind, the
		// signature, the schema and the anchor.
		expect(parseArenaLotStateEvent(lotStateEvent()).signerPubkey).toBe(PUB)
		expect(parseArenaLotStateEvent(lotStateEvent(), { roster: [PUB] }).signerPubkey).toBe(PUB)
	})
})

// ==========================================================================
// The 1450 parser
// ==========================================================================

describe('parseArenaRefusalEvent — a create the chain refused', () => {
	test('parses a signed, anchored refusal and carries the chain reason verbatim', () => {
		const parsed = parseArenaRefusalEvent(refusalEvent())
		expect(parsed.refusedEventId).toBe(CREATE_ID)
		expect(parsed.refusedKind).toBe(1440)
		expect(parsed.reason).toBe('title required (max 120 chars)')
		expect(parsed.height).toBe(1749)
		expect(parsed.blockHash).toBe('0210e491ea9750bc2673d5d5ab3cfad2adabab56dff0bf095ff2bc5fa9ba8fb6')
		expect(isVerifiedArenaRefusalEvent(refusalEvent())).toBe(true)
	})

	test('an e tag that disagrees with event_id is refused as bad_content', () => {
		expect(
			refusalOf(() =>
				parseArenaRefusalEvent(
					signed(ARENA_REFUSED_KIND, refusalContent(), {
						tags: [
							['e', 'ff'.repeat(32)],
							['height', '1749'],
							['hash', String(refusalContent().block_hash)],
						],
					}),
				),
			),
		).toBe(ARENA_LOT_STATE_REFUSAL_BAD_CONTENT)
	})

	test('a refusal with no reason is refused as bad_content', () => {
		const content = refusalContent({ reason: '' })
		expect(refusalOf(() => parseArenaRefusalEvent(signed(ARENA_REFUSED_KIND, content, { tags: refusalTags(content) })))).toBe(
			ARENA_LOT_STATE_REFUSAL_BAD_CONTENT,
		)
	})

	test('a wrong schema is refused as bad_schema', () => {
		expect(refusalOf(() => parseArenaRefusalEvent(refusalEvent({ content: { schema: 'arena.lot.v1' } })))).toBe(
			ARENA_LOT_STATE_REFUSAL_BAD_SCHEMA,
		)
	})

	test('a tampered signature is refused as bad_signature', () => {
		const good = refusalEvent()
		const tampered = { ...good, sig: `${good.sig.slice(0, -2)}${good.sig.endsWith('00') ? '11' : '00'}` }
		expect(refusalOf(() => parseArenaRefusalEvent(tampered))).toBe(ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE)
	})
})

// ==========================================================================
// Dedupe
// ==========================================================================

describe('dedupe', () => {
	test('the same (auction_id, end_time) at heights 1730 and 1734 resolves to 1730', () => {
		const early = lotStateEvent({ content: { height: 1730 } })
		const late = lotStateEvent({ content: { height: 1734 } })
		const parsedEarly = parseArenaLotStateEvent(early)
		const parsedLate = parseArenaLotStateEvent(late)
		expect(lotStateKey(parsedEarly)).toBe(lotStateKey(parsedLate))

		const deduped = dedupeArenaLotStates([parsedLate, parsedEarly])
		expect(deduped).toHaveLength(1)
		expect(deduped[0].height).toBe(1730)
		expect(deduped[0].eventId).toBe(early.id)
	})

	test('a later end_time for the same auction is a different committed end', () => {
		const first = parseArenaLotStateEvent(lotStateEvent({ content: { end_time: 1000, original_end_time: 1000, extensions: 0 } }))
		const second = parseArenaLotStateEvent(lotStateEvent({ content: { end_time: 1012, original_end_time: 1000, extensions: 1 } }))
		expect(dedupeArenaLotStates([first, second])).toHaveLength(2)
	})

	test('the same (event_id, reason) at heights 1745 and 1749 resolves to 1745', () => {
		const early = refusalEvent({ content: { height: 1745 } })
		const late = refusalEvent({ content: { height: 1749 } })
		const parsedEarly = parseArenaRefusalEvent(early)
		const parsedLate = parseArenaRefusalEvent(late)
		expect(refusalKey(parsedEarly)).toBe(refusalKey(parsedLate))
		const deduped = dedupeArenaRefusals([parsedLate, parsedEarly])
		expect(deduped).toHaveLength(1)
		expect(deduped[0].height).toBe(1745)
	})

	test('readArenaLotState dedupes survivors and records refusals by name', () => {
		const tampered = { ...lotStateEvent(), id: 'ff'.repeat(32), sig: `${lotStateEvent().sig.slice(0, -2)}11` }
		const selection = readArenaLotState([
			lotStateEvent({ content: { height: 1730 } }),
			lotStateEvent({ content: { height: 1734 } }),
			tampered,
		])
		expect(selection.lotStates).toHaveLength(1)
		expect(selection.lotStates[0].height).toBe(1730)
		expect(selection.eventRefusals).toEqual([
			{ eventId: tampered.id, refusal: ARENA_LOT_STATE_REFUSAL_BAD_SIGNATURE, detail: expect.any(String) },
		])
	})

	test('readArenaLotState separates the two kinds into their own lists', () => {
		const selection = readArenaLotState([lotStateEvent(), refusalEvent()])
		expect(selection.lotStates).toHaveLength(1)
		expect(selection.refusals).toHaveLength(1)
		expect(selection.refusals[0].reason).toBe('title required (max 120 chars)')
	})
})

// ==========================================================================
// The per-lot view — committed end and the create's refusal
// ==========================================================================

describe('lotStateForLot', () => {
	test('the committed end is the one at the highest anchored height', () => {
		const selection = readArenaLotState([
			lotStateEvent({ content: { end_time: 1000, original_end_time: 1000, extensions: 0, height: 690 } }),
			lotStateEvent({ content: { end_time: 1012, original_end_time: 1000, extensions: 1, height: 720 } }),
		])
		const forLot = lotStateForLot(selection, AUCTION, null)
		expect(forLot.committedEnd?.endTime).toBe(1012)
		expect(forLot.committedEnd?.extensionOrdinal).toBe(1)
		expect(forLot.committedEnds.map((state) => state.extensionOrdinal)).toEqual([0, 1])
	})

	test('no 1449 for the lot is a null committed end, never the create-derived end', () => {
		const selection = readArenaLotState([])
		const forLot = lotStateForLot(selection, AUCTION, null)
		expect(forLot.committedEnd).toBeNull()
		expect(forLot.committedEnds).toEqual([])
	})

	test('the refusal of the lot create is found by the create event id', () => {
		const selection = readArenaLotState([refusalEvent()])
		const forLot = lotStateForLot(selection, AUCTION, CREATE_ID)
		expect(forLot.createRefusal?.reason).toBe('title required (max 120 chars)')
		expect(lotStateForLot(selection, AUCTION, null).createRefusal).toBeNull()
	})
})
