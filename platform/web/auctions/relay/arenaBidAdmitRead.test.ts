/**
 * `arenaBidAdmitRead.test.ts` — the chain's bid-admission fact (kind 1449,
 * schema `arena.bidadmit.v1`), verified the way the app verifies a kind-1449
 * committed end, a kind-1443/1444 receipt and a kind-1448 params event.
 *
 * The fixtures are **signed with a deterministic key** with `nostr-tools`, so a
 * tampered signature, a wrong kind, a wrong schema, a missing anchor, a
 * disagreeing anchor, a `p` tag naming a different validator, and a non-roster
 * signer each reach their own named refusal. The shapes are taken from the live
 * events on `wss://relay.playday.it` and from the chain's own builder
 * (`~/work/wt-validator` `chain/lotevents.go` `BuildBidAdmitEvent`).
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { ARENA_BID_ADMIT_SCHEMA, ARENA_LOT_STATE_KIND } from '@sdk/commerce/auctions/constants'
import {
	ARENA_BID_ADMIT_REFUSAL_ANCHOR_MISMATCH,
	ARENA_BID_ADMIT_REFUSAL_BAD_ANCHOR,
	ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT,
	ARENA_BID_ADMIT_REFUSAL_BAD_KIND,
	ARENA_BID_ADMIT_REFUSAL_BAD_SCHEMA,
	ARENA_BID_ADMIT_REFUSAL_BAD_SIGNATURE,
	ARENA_BID_ADMIT_REFUSAL_P_TAG_MISMATCH,
	ARENA_BID_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER,
	ARENA_BID_ADMIT_REFUSAL_UNANCHORED,
	ArenaBidAdmitError,
	admissionForBid,
	admitsForLot,
	bidAdmitKey,
	dedupeArenaBidAdmits,
	isArenaBidAdmitSchema,
	isVerifiedArenaBidAdmitEvent,
	parseArenaBidAdmitEvent,
	readArenaBidAdmits,
	type ArenaBidAdmitEventLike,
	type ArenaBidAdmitRefusalName,
} from './arenaBidAdmitRead'

// ---------- The deterministic signer --------------------------------------

const SK = new Uint8Array(32).fill(9)
const PUB = getPublicKey(SK)
const OTHER_SK = new Uint8Array(32).fill(11)
const OTHER = getPublicKey(OTHER_SK)

const AUCTION = '1440:3e936db1aad4706d79b20a486c1f2a73aaadf0f3af4b909e7835464ec9b441dd:lot1449-1795021494772'
const BID_ID = 'a5fe7c6b27eff87d88d23f79b94e6f73cca8762c03db7e0e080b462839a778fe'
const HIGH_BID = '50b13a5c47715c3f42ebc3fad3c4a9b5f78e5f48e4bd5f43f3c168d5216abe59'
const BIDDER = '72e53882afc932d3cc34b67d4bc686d59d20bdea36f6a916fcf6eea2974d4ed5'
const BLOCK_HASH = '7bc7495aa6e679d003d495f934287dfde352b6552dc2960bac77cbdac8636edf'

// ---------- Fixtures built from the contract ------------------------------

function admitContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: ARENA_BID_ADMIT_SCHEMA,
		auction_id: AUCTION,
		bid_id: BID_ID,
		bidder: BIDDER,
		amount: 100,
		position: 105,
		high_bid: HIGH_BID,
		height: 3437,
		block_hash: BLOCK_HASH.toUpperCase(),
		...over,
	}
}

const admitTags = (content: Record<string, unknown>, over: { p?: string } = {}): string[][] => [
	['e', String(content.bid_id)],
	['auction', String(content.auction_id)],
	['height', String(content.height)],
	['hash', String(content.block_hash)],
	['p', over.p ?? PUB],
]

function signed(
	kind: number,
	content: Record<string, unknown>,
	over: { tags?: string[][]; sk?: Uint8Array; created_at?: number } = {},
): ArenaBidAdmitEventLike {
	const sk = over.sk ?? SK
	const tags = over.tags ?? admitTags(content, { p: getPublicKey(sk) })
	return finalizeEvent(
		{ kind, created_at: over.created_at ?? 1_795_021_527, tags, content: JSON.stringify(content) },
		sk,
	) as unknown as ArenaBidAdmitEventLike
}

const admitEvent = (
	over: {
		content?: Record<string, unknown>
		tags?: string[][]
		sk?: Uint8Array
		kind?: number
		created_at?: number
	} = {},
): ArenaBidAdmitEventLike => signed(over.kind ?? ARENA_LOT_STATE_KIND, admitContent(over.content), over)

const refusalOf = (parse: () => unknown): ArenaBidAdmitRefusalName => {
	try {
		parse()
	} catch (error) {
		if (error instanceof ArenaBidAdmitError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a parsed fact')
}

// ==========================================================================
// The parser
// ==========================================================================

describe('parseArenaBidAdmitEvent — the admission fact', () => {
	test('parses a signed, anchored admission and exposes every field', () => {
		const parsed = parseArenaBidAdmitEvent(admitEvent())
		expect(parsed.auctionId).toBe(AUCTION)
		expect(parsed.bidId).toBe(BID_ID)
		expect(parsed.bidder).toBe(BIDDER)
		expect(parsed.amount).toBe(100)
		expect(parsed.position).toBe(105)
		expect(parsed.highBid).toBe(HIGH_BID)
		expect(parsed.height).toBe(3437)
		// The anchor hash is lower-cased, the way the lot-state reader normalizes it.
		expect(parsed.blockHash).toBe(BLOCK_HASH)
		expect(parsed.signerPubkey).toBe(PUB)
		expect(isVerifiedArenaBidAdmitEvent(admitEvent())).toBe(true)
	})

	test('an admission whose position equals its own amount reads as it stands', () => {
		const parsed = parseArenaBidAdmitEvent(admitEvent({ content: { amount: 80, position: 80, high_bid: BID_ID } }))
		expect(parsed.position).toBe(80)
		expect(parsed.highBid).toBe(BID_ID)
	})
})

// ==========================================================================
// Each failure is refused by name
// ==========================================================================

describe('each admission failure is refused by name', () => {
	test('a tampered signature is refused as arena.bid_admit.bad_signature', () => {
		const good = admitEvent()
		const tampered = { ...good, sig: `${good.sig.slice(0, -2)}${good.sig.endsWith('00') ? '11' : '00'}` }
		expect(refusalOf(() => parseArenaBidAdmitEvent(tampered))).toBe(ARENA_BID_ADMIT_REFUSAL_BAD_SIGNATURE)
	})

	test('a wrong kind is refused as arena.bid_admit.bad_kind', () => {
		expect(refusalOf(() => parseArenaBidAdmitEvent(admitEvent({ kind: 1447 })))).toBe(ARENA_BID_ADMIT_REFUSAL_BAD_KIND)
	})

	test('an arena.lot.v1 event is refused as arena.bid_admit.bad_schema, never read as an admission', () => {
		const lotContent = { schema: 'arena.lot.v1', auction_id: AUCTION, end_time: 1, height: 3437, block_hash: BLOCK_HASH }
		const event = signed(ARENA_LOT_STATE_KIND, lotContent)
		expect(refusalOf(() => parseArenaBidAdmitEvent(event))).toBe(ARENA_BID_ADMIT_REFUSAL_BAD_SCHEMA)
	})

	test('a missing anchor is refused as arena.bid_admit.unanchored', () => {
		const content = admitContent({ height: undefined, block_hash: undefined })
		const tags = [['e', BID_ID], ['auction', AUCTION], ['p', PUB]]
		expect(refusalOf(() => parseArenaBidAdmitEvent(signed(ARENA_LOT_STATE_KIND, content, { tags })))).toBe(
			ARENA_BID_ADMIT_REFUSAL_UNANCHORED,
		)
	})

	test('a non-integer height is refused as arena.bid_admit.bad_anchor', () => {
		const tags = admitTags(admitContent({ height: 'not-a-number' }))
		const event = signed(ARENA_LOT_STATE_KIND, admitContent({ height: 'not-a-number' }), { tags })
		expect(refusalOf(() => parseArenaBidAdmitEvent(event))).toBe(ARENA_BID_ADMIT_REFUSAL_BAD_ANCHOR)
	})

	test('a tag height that disagrees with the content is refused as arena.bid_admit.anchor_mismatch', () => {
		const content = admitContent()
		const tags = admitTags(content)
		tags[2] = ['height', '3438']
		expect(refusalOf(() => parseArenaBidAdmitEvent(signed(ARENA_LOT_STATE_KIND, content, { tags })))).toBe(
			ARENA_BID_ADMIT_REFUSAL_ANCHOR_MISMATCH,
		)
	})

	test('an e tag naming a different bid than the content is refused as arena.bid_admit.bad_content', () => {
		const content = admitContent()
		const tags = admitTags(content)
		tags[0] = ['e', HIGH_BID]
		expect(refusalOf(() => parseArenaBidAdmitEvent(signed(ARENA_LOT_STATE_KIND, content, { tags })))).toBe(
			ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT,
		)
	})

	test('an auction tag naming a different lot than the content is refused as arena.bid_admit.bad_content', () => {
		const content = admitContent()
		const tags = admitTags(content)
		tags[1] = ['auction', '1440:someone-else:lot']
		expect(refusalOf(() => parseArenaBidAdmitEvent(signed(ARENA_LOT_STATE_KIND, content, { tags })))).toBe(
			ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT,
		)
	})

	test('a p tag naming a validator other than the signer is refused as arena.bid_admit.p_tag_mismatch', () => {
		const event = admitEvent({ tags: admitTags(admitContent(), { p: OTHER }) })
		expect(refusalOf(() => parseArenaBidAdmitEvent(event))).toBe(ARENA_BID_ADMIT_REFUSAL_P_TAG_MISMATCH)
	})

	test('an unreadable position is refused, never exposed as null', () => {
		expect(refusalOf(() => parseArenaBidAdmitEvent(admitEvent({ content: { position: undefined } })))).toBe(
			ARENA_BID_ADMIT_REFUSAL_BAD_CONTENT,
		)
	})

	test('a non-roster signer is refused where a roster is known, and skipped where none is', () => {
		const event = admitEvent({ sk: OTHER_SK })
		expect(refusalOf(() => parseArenaBidAdmitEvent(event, { roster: [PUB] }))).toBe(ARENA_BID_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER)
		// An absent or empty roster cannot refuse a fact (it carries no validator set).
		expect(parseArenaBidAdmitEvent(event, { roster: null }).signerPubkey).toBe(OTHER)
		expect(parseArenaBidAdmitEvent(event, { roster: [] }).signerPubkey).toBe(OTHER)
		expect(parseArenaBidAdmitEvent(event, { roster: [OTHER] }).signerPubkey).toBe(OTHER)
	})
})

// ==========================================================================
// Dedupe and the batch selection
// ==========================================================================

describe('dedupe — one fact, however many heights a validator re-published it at', () => {
	test('keeps one admission per bid id, at the earliest anchored height', () => {
		const early = parseArenaBidAdmitEvent(admitEvent({ content: { height: 3437 }, created_at: 1 }))
		const late = parseArenaBidAdmitEvent(admitEvent({ content: { height: 3490 }, created_at: 2 }))
		const deduped = dedupeArenaBidAdmits([late, early])
		expect(deduped).toHaveLength(1)
		expect(deduped[0].height).toBe(3437)
		expect(bidAdmitKey(deduped[0])).toBe(BID_ID)
	})

	test('two different bids stay two admissions', () => {
		const one = parseArenaBidAdmitEvent(admitEvent())
		const other = parseArenaBidAdmitEvent(admitEvent({ content: { bid_id: HIGH_BID }, tags: admitTags(admitContent({ bid_id: HIGH_BID })) }))
		expect(dedupeArenaBidAdmits([one, other])).toHaveLength(2)
	})

	test('readArenaBidAdmits keeps the verified ones and records every refusal by name', () => {
		const good = admitEvent()
		const lotShaped = signed(ARENA_LOT_STATE_KIND, { schema: 'arena.lot.v1', auction_id: AUCTION, end_time: 1, height: 3437, block_hash: BLOCK_HASH })
		const selection = readArenaBidAdmits([good, lotShaped])
		expect(selection.admits).toHaveLength(1)
		expect(selection.admits[0].bidId).toBe(BID_ID)
		expect(selection.eventRefusals.map((refusal) => refusal.refusal)).toEqual([ARENA_BID_ADMIT_REFUSAL_BAD_SCHEMA])
	})
})

describe('the lot lookup', () => {
	test('admitsForLot filters by coordinate and admissionForBid names one bid', () => {
		const one = parseArenaBidAdmitEvent(admitEvent())
		const otherLot = parseArenaBidAdmitEvent(
			admitEvent({
				content: { auction_id: '1440:someone-else:lot', bid_id: HIGH_BID },
				tags: admitTags(admitContent({ auction_id: '1440:someone-else:lot', bid_id: HIGH_BID })),
			}),
		)
		const forLot = admitsForLot({ admits: [one, otherLot] }, AUCTION)
		expect(forLot).toHaveLength(1)
		expect(admissionForBid(forLot, BID_ID)?.height).toBe(3437)
		expect(admissionForBid(forLot, HIGH_BID)).toBeNull()
	})

	test('isArenaBidAdmitSchema dispatches on the schema, not the kind', () => {
		expect(isArenaBidAdmitSchema(JSON.stringify({ schema: ARENA_BID_ADMIT_SCHEMA }))).toBe(true)
		expect(isArenaBidAdmitSchema(JSON.stringify({ schema: 'arena.lot.v1' }))).toBe(false)
		expect(isArenaBidAdmitSchema('not json')).toBe(false)
	})
})
