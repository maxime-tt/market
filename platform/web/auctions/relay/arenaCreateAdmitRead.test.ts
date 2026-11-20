/**
 * `arenaCreateAdmitRead.test.ts` — the chain's create-admission fact (kind 1449,
 * schema `arena.createadmit.v1`), verified the way the app verifies a
 * bid-admission, a committed end, a receipt and a params event.
 *
 * The fixtures are **signed with a deterministic key** with `nostr-tools`, so a
 * tampered signature, a wrong kind, a wrong schema, a missing anchor, a
 * disagreeing anchor, a `p` tag naming a different validator and a non-roster
 * signer each reach their own named refusal.
 *
 * The anchor rule is the chain's (`~/work/wt-validator` `chain/lotevents.go`):
 * `BuildCreateAdmitEvent` builds the `height`/`hash` tags from the content's own
 * `accepted_height`/`block_hash`, and `ParseCreateAdmitEvent` refuses the event
 * unless the two copies are **equal** — so a re-framed anchor cannot hide behind
 * a second copy.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { ARENA_CREATE_ADMIT_SCHEMA, ARENA_LOT_STATE_KIND } from '@sdk/commerce/auctions/constants'
import {
	ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH,
	ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR,
	ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT,
	ARENA_CREATE_ADMIT_REFUSAL_BAD_KIND,
	ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA,
	ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE,
	ARENA_CREATE_ADMIT_REFUSAL_P_TAG_MISMATCH,
	ARENA_CREATE_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER,
	ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED,
	ArenaCreateAdmitError,
	createAdmitForLot,
	createAdmitKey,
	dedupeArenaCreateAdmits,
	isArenaCreateAdmitSchema,
	isVerifiedArenaCreateAdmitEvent,
	parseArenaCreateAdmitEvent,
	readArenaCreateAdmits,
	type ArenaCreateAdmitEventLike,
	type ArenaCreateAdmitRefusalName,
} from './arenaCreateAdmitRead'

// ---------- The deterministic signer --------------------------------------

const SK = new Uint8Array(32).fill(9)
const PUB = getPublicKey(SK)
const OTHER_SK = new Uint8Array(32).fill(11)
const OTHER = getPublicKey(OTHER_SK)

const AUCTION = '1440:3e936db1aad4706d79b20a486c1f2a73aaadf0f3af4b909e7835464ec9b441dd:lot1449-1795021494772'
const AUCTION_B = '1440:3e936db1aad4706d79b20a486c1f2a73aaadf0f3af4b909e7835464ec9b441dd:lot1449-1795021494773'
const ROOT = 'a5fe7c6b27eff87d88d23f79b94e6f73cca8762c03db7e0e080b462839a778fe'
const ROOT_B = '50b13a5c47715c3f42ebc3fad3c4a9b5f78e5f48e4bd5f43f3c168d5216abe59'
const SELLER = '72e53882afc932d3cc34b67d4bc686d59d20bdea36f6a916fcf6eea2974d4ed5'
const BLOCK_HASH = '7bc7495aa6e679d003d495f934287dfde352b6552dc2960bac77cbdac8636edf'
const OTHER_HASH = 'aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233'

// ---------- Fixtures built from the contract ------------------------------

function admitContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: ARENA_CREATE_ADMIT_SCHEMA,
		auction_id: AUCTION,
		seller: SELLER,
		root_event_id: ROOT,
		accepted_height: 4241,
		block_hash: BLOCK_HASH,
		end_time: 1_795_022_400,
		original_end_time: 1_795_022_400,
		mode: 'fixed',
		...over,
	}
}

/** The tags the chain's builder makes: `height`/`hash` from the content's own anchor. */
const admitTags = (content: Record<string, unknown>, over: { p?: string } = {}): string[][] => [
	['e', String(content.root_event_id)],
	['auction', String(content.auction_id)],
	['height', String(content.accepted_height)],
	['hash', String(content.block_hash)],
	['p', over.p ?? PUB],
]

function signed(
	kind: number,
	content: Record<string, unknown>,
	over: { tags?: string[][]; sk?: Uint8Array; created_at?: number } = {},
): ArenaCreateAdmitEventLike {
	const sk = over.sk ?? SK
	const tags = over.tags ?? admitTags(content, { p: getPublicKey(sk) })
	return finalizeEvent(
		{ kind, created_at: over.created_at ?? 1_795_021_527, tags, content: JSON.stringify(content) },
		sk,
	) as unknown as ArenaCreateAdmitEventLike
}

const admitEvent = (
	over: {
		content?: Record<string, unknown>
		tags?: string[][]
		sk?: Uint8Array
		kind?: number
		created_at?: number
	} = {},
): ArenaCreateAdmitEventLike => signed(over.kind ?? ARENA_LOT_STATE_KIND, admitContent(over.content), over)

const refusalOf = (parse: () => unknown): ArenaCreateAdmitRefusalName => {
	try {
		parse()
	} catch (error) {
		if (error instanceof ArenaCreateAdmitError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a parsed fact')
}

/** Replace a tag's value, or append it when the tag is absent. */
function withTag(tags: string[][], name: string, value: string): string[][] {
	const next = tags.map((tag) => (tag[0] === name ? [tag[0], value, ...tag.slice(2)] : tag.slice()))
	if (!next.some((tag) => tag[0] === name)) next.push([name, value])
	return next
}

const withoutTag = (tags: string[][], name: string): string[][] => tags.filter((tag) => tag[0] !== name).map((tag) => tag.slice())

// ==========================================================================
// The parser
// ==========================================================================

describe('parseArenaCreateAdmitEvent — the acceptance fact', () => {
	test('parses a signed, anchored acceptance and exposes every field', () => {
		const parsed = parseArenaCreateAdmitEvent(admitEvent())
		expect(parsed.auctionId).toBe(AUCTION)
		expect(parsed.rootEventId).toBe(ROOT)
		expect(parsed.seller).toBe(SELLER)
		expect(parsed.acceptedHeight).toBe(4241)
		// The anchor's height is the accepted height — the chain builds it from it.
		expect(parsed.height).toBe(4241)
		expect(parsed.blockHash).toBe(BLOCK_HASH)
		expect(parsed.endTime).toBe(1_795_022_400)
		expect(parsed.originalEndTime).toBe(1_795_022_400)
		expect(parsed.mode).toBe('fixed')
		expect(parsed.signerPubkey).toBe(PUB)
		expect(parsed.eventId.length).toBeGreaterThan(0)
	})

	test('a fact whose signature does not verify is refused', () => {
		const event = admitEvent()
		expect(refusalOf(() => parseArenaCreateAdmitEvent({ ...event, sig: '0'.repeat(128) }))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE,
		)
		// The content moved under the original's signature is the same refusal.
		expect(
			refusalOf(() => parseArenaCreateAdmitEvent({ ...event, content: JSON.stringify(admitContent({ mode: 'antisnipe' })) })),
		).toBe(ARENA_CREATE_ADMIT_REFUSAL_BAD_SIGNATURE)
	})

	test('a wrong kind is refused by name', () => {
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ kind: 1440 })))).toBe(ARENA_CREATE_ADMIT_REFUSAL_BAD_KIND)
	})

	test('a wrong schema is refused by name — the other kind-1449 shapes are never mis-read', () => {
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content: { schema: 'arena.lot.v1' } })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA,
		)
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content: { schema: 'arena.bidadmit.v1' } })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA,
		)
	})

	test('a content that is not a JSON object is bad_content', () => {
		// Signed over the non-JSON body, so the schema check — not the signature — is
		// what refuses it.
		const event = finalizeEvent(
			{ kind: ARENA_LOT_STATE_KIND, created_at: 1_795_021_527, tags: admitTags(admitContent()), content: 'not json' },
			SK,
		) as unknown as ArenaCreateAdmitEventLike
		expect(refusalOf(() => parseArenaCreateAdmitEvent(event))).toBe(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT)
	})

	test('a missing or zero accepted_height is refused — an acceptance that cannot say where it accepted', () => {
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: undefined } })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT,
		)
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 0 } })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT,
		)
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 'later' } })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT,
		)
	})

	test('a missing tag anchor is unanchored — the anchor is mandatory', () => {
		const content = admitContent()
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withoutTag(admitTags(content), 'height') })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED,
		)
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withoutTag(admitTags(content), 'hash') })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED,
		)
	})

	test('a content that carries no hash anchor is unanchored', () => {
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content: { block_hash: undefined } })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_UNANCHORED,
		)
	})

	test('a malformed anchor is bad_anchor', () => {
		const content = admitContent()
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withTag(admitTags(content), 'height', '0') })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR,
		)
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withTag(admitTags(content), 'hash', 'zz') })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_BAD_ANCHOR,
		)
	})

	test('the `e` tag disagreeing with the content root names two creates — bad_content', () => {
		const content = admitContent()
		expect(
			refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withTag(admitTags(content), 'e', ROOT_B) }))),
		).toBe(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT)
	})

	test('the `auction` tag disagreeing with the content coordinate names two lots — bad_content', () => {
		const content = admitContent()
		expect(
			refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withTag(admitTags(content), 'auction', AUCTION_B) }))),
		).toBe(ARENA_CREATE_ADMIT_REFUSAL_BAD_CONTENT)
	})

	test('the height tag disagreeing with accepted_height is anchor_mismatch', () => {
		const content = admitContent({ accepted_height: 100 })
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ content, tags: withTag(admitTags(content), 'height', '101') })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH,
		)
	})

	test('the hash tag disagreeing with block_hash is anchor_mismatch', () => {
		const content = admitContent()
		expect(
			refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withTag(admitTags(content), 'hash', OTHER_HASH) }))),
		).toBe(ARENA_CREATE_ADMIT_REFUSAL_ANCHOR_MISMATCH)
	})

	test('the anchor hash is case-insensitive between tag and content', () => {
		const content = admitContent({ block_hash: BLOCK_HASH.toUpperCase() })
		const parsed = parseArenaCreateAdmitEvent(admitEvent({ content, tags: withTag(admitTags(content), 'hash', BLOCK_HASH) }))
		expect(parsed.blockHash).toBe(BLOCK_HASH)
	})

	test('a `p` tag naming a different validator is refused', () => {
		const content = admitContent()
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent({ tags: withTag(admitTags(content), 'p', OTHER) })))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_P_TAG_MISMATCH,
		)
	})

	test('a signer the roster does not name is refused; a known roster that names it is not', () => {
		expect(refusalOf(() => parseArenaCreateAdmitEvent(admitEvent(), { roster: [OTHER] }))).toBe(
			ARENA_CREATE_ADMIT_REFUSAL_SIGNER_NOT_IN_ROSTER,
		)
		expect(parseArenaCreateAdmitEvent(admitEvent(), { roster: [PUB, OTHER] }).signerPubkey).toBe(PUB)
		// An absent roster is not a refusal — the fact does not carry its own set.
		expect(parseArenaCreateAdmitEvent(admitEvent(), { roster: null }).acceptedHeight).toBe(4241)
	})

	test('isVerifiedArenaCreateAdmitEvent is the parse, as a predicate', () => {
		expect(isVerifiedArenaCreateAdmitEvent(admitEvent())).toBe(true)
		expect(isVerifiedArenaCreateAdmitEvent(admitEvent({ content: { schema: 'arena.lot.v1' } }))).toBe(false)
	})

	test('isArenaCreateAdmitSchema names exactly the acceptance schema', () => {
		expect(isArenaCreateAdmitSchema(JSON.stringify(admitContent()))).toBe(true)
		expect(isArenaCreateAdmitSchema(JSON.stringify({ schema: 'arena.lot.v1' }))).toBe(false)
		expect(isArenaCreateAdmitSchema('not json')).toBe(false)
	})
})

// ==========================================================================
// Dedupe and the batch selection
// ==========================================================================

describe('dedupeArenaCreateAdmits — one acceptance per coordinate, earliest anchored', () => {
	test('two anchored copies at different heights keep the earliest', () => {
		const late = parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 5000 } }))
		const early = parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 4241 } }))
		expect(createAdmitKey(early)).toBe(AUCTION)
		const [kept, ...rest] = dedupeArenaCreateAdmits([late, early])
		expect(rest).toEqual([])
		expect(kept.acceptedHeight).toBe(4241)
	})

	test('different coordinates are both kept, ordered by height', () => {
		const a = parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 5000 } }))
		const b = parseArenaCreateAdmitEvent(admitEvent({ content: { auction_id: AUCTION_B, accepted_height: 4241 } }))
		const deduped = dedupeArenaCreateAdmits([a, b])
		expect(deduped.map((admit) => admit.auctionId)).toEqual([AUCTION_B, AUCTION])
	})

	test('createAdmitForLot names the earliest-anchored acceptance for one coordinate, or null', () => {
		const early = parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 4241 } }))
		const late = parseArenaCreateAdmitEvent(admitEvent({ content: { accepted_height: 9 } }))
		expect(createAdmitForLot({ admits: [early, late] }, AUCTION)?.acceptedHeight).toBe(9)
		expect(createAdmitForLot({ admits: [early] }, AUCTION_B)).toBeNull()
	})
})

describe('readArenaCreateAdmits — parse a batch, refuse by name', () => {
	test('keeps the verifiable, records every refusal', () => {
		const good = admitEvent()
		const badSchema = admitEvent({ content: { schema: 'arena.lot.v1' } })
		const selection = readArenaCreateAdmits([good, badSchema])
		expect(selection.admits.map((admit) => admit.auctionId)).toEqual([AUCTION])
		expect(selection.eventRefusals.map((refusal) => refusal.refusal)).toEqual([ARENA_CREATE_ADMIT_REFUSAL_BAD_SCHEMA])
	})

	test('dedupes by event id first — two relays agree on an id', () => {
		const good = admitEvent()
		const selection = readArenaCreateAdmits([good, good])
		expect(selection.admits).toHaveLength(1)
		expect(selection.eventRefusals).toEqual([])
	})
})
