/**
 * `arenaReceiptsRead.test.ts` — the money-receipt read (kinds 1443/1444),
 * verified the way the app verifies a kind-1448 params event.
 *
 * The fixtures are **signed with a deterministic key** with `nostr-tools`, so a
 * tampered signature, a wrong schema, a 1443 that claims to be a settle, a
 * disagreeing anchor and a non-roster signer each reach their own named refusal.
 * The contract they are built from is §3 of the chain handoff, verbatim.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND } from '@sdk/commerce/auctions/constants'
import {
	ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH,
	ARENA_RECEIPT_REFUSAL_BAD_ANCHOR,
	ARENA_RECEIPT_REFUSAL_BAD_CONTENT,
	ARENA_RECEIPT_REFUSAL_BAD_KIND,
	ARENA_RECEIPT_REFUSAL_BAD_SCHEMA,
	ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE,
	ARENA_RECEIPT_REFUSAL_SIGNER_NOT_IN_ROSTER,
	ARENA_RECEIPT_REFUSAL_UNANCHORED,
	ArenaReceiptError,
	dedupeArenaReceipts,
	isVerifiedArenaReceiptEvent,
	parseArenaReceiptEvent,
	readArenaReceipts,
	receiptMoveKey,
	receiptParamsVersionMismatch,
	type ArenaReceiptEventLike,
	type ArenaReceiptRefusalName,
} from './arenaReceiptsRead'

// ---------- The deterministic signer --------------------------------------

const SK = new Uint8Array(32).fill(9)
const PUB = getPublicKey(SK)
const OTHER_SK = new Uint8Array(32).fill(11)
const OTHER = getPublicKey(OTHER_SK)

// ---------- Fixtures built from the contract ------------------------------

function refundContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: 'arena.refund.v1',
		auction_id: '1440:seller:d1',
		bid_id: 'bid-1',
		outcome: 'refund',
		height: 400,
		block_hash: 'a'.repeat(64),
		settled_at: 1_794_999_999,
		params_version: 'pv-1',
		out: [{ recipient: 'recip', amount: 1_234, id: 'keyset', secret: 'sec', C: 'Cpoint', dleq: { e: 'e', s: 's', r: 'r' } }],
		...over,
	}
}

function settleContent(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: 'arena.settle.v1',
		auction_id: '1440:seller:d1',
		bid_id: 'bid-1',
		outcome: 'settle',
		height: 500,
		block_hash: 'b'.repeat(64),
		settled_at: 1_794_999_999,
		params_version: 'pv-1',
		out: [
			{ recipient: 'seller', amount: 1_000, id: 'keyset' },
			{ recipient: 'v4v-1', amount: 250, id: 'keyset' },
			{ recipient: 'v4v-2', amount: 250, id: 'keyset' },
		],
		...over,
	}
}

const canonicalTags = (content: Record<string, unknown>): string[][] => [
	['auction', String(content.auction_id)],
	['bid', String(content.bid_id)],
	['height', String(content.height)],
	['hash', String(content.block_hash)],
]

function signed(
	kind: number,
	content: Record<string, unknown>,
	over: { tags?: string[][]; sk?: Uint8Array; pubkey?: string; created_at?: number } = {},
): ArenaReceiptEventLike {
	const sk = over.sk ?? SK
	const tags = over.tags ?? canonicalTags(content)
	return finalizeEvent(
		{ kind, created_at: over.created_at ?? 1_794_999_999, tags, content: JSON.stringify(content) },
		sk,
	) as unknown as ArenaReceiptEventLike
}

const refundEvent = (
	over: { content?: Record<string, unknown>; tags?: string[][]; sk?: Uint8Array; kind?: number } = {},
): ArenaReceiptEventLike => signed(over.kind ?? ARENA_AUCTION_REFUND_KIND, refundContent(over.content), over)

const settleEvent = (
	over: { content?: Record<string, unknown>; tags?: string[][]; sk?: Uint8Array; kind?: number } = {},
): ArenaReceiptEventLike => signed(over.kind ?? ARENA_AUCTION_SETTLE_KIND, settleContent(over.content), over)

const refusalOf = (event: ArenaReceiptEventLike, roster?: readonly string[]): ArenaReceiptRefusalName => {
	try {
		parseArenaReceiptEvent(event, roster === undefined ? {} : { roster })
	} catch (error) {
		if (error instanceof ArenaReceiptError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a parsed receipt')
}

// ==========================================================================
// The parser
// ==========================================================================

describe('parseArenaReceiptEvent — a refund receipt', () => {
	test('parses a signed, anchored refund and exposes every field', () => {
		const parsed = parseArenaReceiptEvent(refundEvent())
		expect(parsed.auctionId).toBe('1440:seller:d1')
		expect(parsed.bidId).toBe('bid-1')
		expect(parsed.outcome).toBe('refund')
		expect(parsed.kind).toBe(ARENA_AUCTION_REFUND_KIND)
		expect(parsed.height).toBe(400)
		expect(parsed.blockHash).toBe('a'.repeat(64))
		expect(parsed.settledAt).toBe(1_794_999_999)
		expect(parsed.paramsVersion).toBe('pv-1')
		expect(parsed.total).toBe(1_234)
		expect(parsed.outputs).toHaveLength(1)
		expect(parsed.outputs[0]).toMatchObject({ recipient: 'recip', amount: 1_234, id: 'keyset' })
		// The proof is carried through for the claim work.
		expect(parsed.outputs[0].secret).toBe('sec')
		expect(parsed.outputs[0].C).toBe('Cpoint')
		expect(parsed.outputs[0].dleq).toEqual({ e: 'e', s: 's', r: 'r' })
		expect(isVerifiedArenaReceiptEvent(refundEvent())).toBe(true)
	})

	test('a settle with three destinations totals correctly and lists three recipients', () => {
		const parsed = parseArenaReceiptEvent(settleEvent())
		expect(parsed.outcome).toBe('settle')
		expect(parsed.total).toBe(1_500)
		expect(parsed.outputs.map((output) => output.recipient)).toEqual(['seller', 'v4v-1', 'v4v-2'])
		expect(parsed.outputsWithoutAmount).toBe(0)
	})

	test('an unreadable amount is null and makes the total a partial sum', () => {
		const parsed = parseArenaReceiptEvent(
			settleEvent({
				content: {
					out: [
						{ recipient: 'seller', amount: 1_000, id: 'k' },
						{ recipient: 'v4v', id: 'k' },
					],
				},
			}),
		)
		expect(parsed.outputs[1].amount).toBeNull()
		expect(parsed.total).toBe(1_000)
		expect(parsed.outputsWithoutAmount).toBe(1)
	})

	test('no readable amount makes the total null, never a 0', () => {
		const parsed = parseArenaReceiptEvent(settleEvent({ content: { out: [{ recipient: 'seller', id: 'k' }] } }))
		expect(parsed.total).toBeNull()
	})
})

describe('each failure is refused by name', () => {
	test('a tampered signature is refused as arena.receipt.bad_signature', () => {
		const good = refundEvent()
		const tampered = { ...good, sig: `${good.sig.slice(0, -2)}${good.sig.endsWith('00') ? '11' : '00'}` }
		expect(refusalOf(tampered)).toBe(ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE)
	})

	test('an unsigned event is refused as arena.receipt.bad_signature', () => {
		expect(refusalOf({ ...refundEvent(), sig: '' })).toBe(ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE)
	})

	test('a wrong kind is refused as arena.receipt.bad_kind', () => {
		expect(refusalOf(refundEvent({ kind: 1447 }))).toBe(ARENA_RECEIPT_REFUSAL_BAD_KIND)
	})

	test('a wrong schema is refused as arena.receipt.bad_schema', () => {
		expect(refusalOf(refundEvent({ content: { schema: 'arena.settle.v1' } }))).toBe(ARENA_RECEIPT_REFUSAL_BAD_SCHEMA)
	})

	test('a 1443 whose content says settle is refused as arena.receipt.bad_content', () => {
		// Signed and anchored correctly, but the outcome names the wrong kind.
		expect(refusalOf(refundEvent({ content: { outcome: 'settle' } }))).toBe(ARENA_RECEIPT_REFUSAL_BAD_CONTENT)
	})

	test('a missing anchor is refused as arena.receipt.unanchored', () => {
		const content = refundContent()
		delete content.height
		delete content.block_hash
		expect(
			refusalOf(
				signed(ARENA_AUCTION_REFUND_KIND, content, {
					tags: [
						['auction', '1440:seller:d1'],
						['bid', 'bid-1'],
					],
				}),
			),
		).toBe(ARENA_RECEIPT_REFUSAL_UNANCHORED)
	})

	test('a tag anchor that disagrees with the content anchor is refused as arena.receipt.anchor_mismatch', () => {
		// The content height moved; the tags left at the canonical anchor.
		const canonical = refundContent()
		expect(refusalOf(signed(ARENA_AUCTION_REFUND_KIND, refundContent({ height: 999 }), { tags: canonicalTags(canonical) }))).toBe(
			ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH,
		)
		// The tag height moved; the content left at the canonical anchor.
		expect(
			refusalOf(
				signed(ARENA_AUCTION_REFUND_KIND, canonical, {
					tags: [
						['auction', '1440:seller:d1'],
						['bid', 'bid-1'],
						['height', '999'],
						['hash', String(canonical.block_hash)],
					],
				}),
			),
		).toBe(ARENA_RECEIPT_REFUSAL_ANCHOR_MISMATCH)
	})

	test('a malformed hash anchor is refused as arena.receipt.bad_anchor', () => {
		const content = refundContent({ block_hash: 'nothex' })
		expect(
			refusalOf(
				signed(ARENA_AUCTION_REFUND_KIND, content, {
					tags: [
						['auction', '1440:seller:d1'],
						['bid', 'bid-1'],
						['height', '400'],
						['hash', 'nothex'],
					],
				}),
			),
		).toBe(ARENA_RECEIPT_REFUSAL_BAD_ANCHOR)
	})

	test('content with no out entries is refused as arena.receipt.bad_content', () => {
		expect(refusalOf(refundEvent({ content: { out: [] } }))).toBe(ARENA_RECEIPT_REFUSAL_BAD_CONTENT)
	})

	test('a non-roster signer is refused as arena.receipt.signer_not_in_roster when a roster is known', () => {
		expect(refusalOf(refundEvent(), [OTHER])).toBe(ARENA_RECEIPT_REFUSAL_SIGNER_NOT_IN_ROSTER)
		// The same event passes when the caller holds no roster: the gate is the
		// signature, the schema and the anchor — a receipt carries no roster.
		expect(parseArenaReceiptEvent(refundEvent()).signerPubkey).toBe(PUB)
		expect(parseArenaReceiptEvent(refundEvent(), { roster: [PUB] }).signerPubkey).toBe(PUB)
	})
})

// ==========================================================================
// Dedupe
// ==========================================================================

describe('dedupe by (bid_id, outcome), preferring the earliest anchored height', () => {
	test('the same move at heights 400 and 407 resolves to the 400 reading', () => {
		const early = refundEvent({ content: { height: 400 } })
		const late = refundEvent({ content: { height: 407 } })
		const parsedEarly = parseArenaReceiptEvent(early)
		const parsedLate = parseArenaReceiptEvent(late)
		expect(receiptMoveKey(parsedEarly)).toBe(receiptMoveKey(parsedLate))

		const deduped = dedupeArenaReceipts([parsedLate, parsedEarly])
		expect(deduped).toHaveLength(1)
		expect(deduped[0].height).toBe(400)
		expect(deduped[0].eventId).toBe(early.id)
	})

	test('a different outcome for the same bid is a different move', () => {
		const refund = parseArenaReceiptEvent(refundEvent())
		const settle = parseArenaReceiptEvent(settleEvent())
		expect(dedupeArenaReceipts([refund, settle])).toHaveLength(2)
	})

	test('readArenaReceipts dedupes survivors and records refusals by name', () => {
		const tampered = { ...refundEvent(), id: 'ff'.repeat(32), sig: `${refundEvent().sig.slice(0, -2)}11` }
		const selection = readArenaReceipts([refundEvent({ content: { height: 400 } }), refundEvent({ content: { height: 407 } }), tampered])
		expect(selection.receipts).toHaveLength(1)
		expect(selection.receipts[0].height).toBe(400)
		expect(selection.refusals).toEqual([{ eventId: tampered.id, refusal: ARENA_RECEIPT_REFUSAL_BAD_SIGNATURE, detail: expect.any(String) }])
	})
})

// ==========================================================================
// params_version is an opaque token
// ==========================================================================

describe('params_version is recorded and flagged, never refused on', () => {
	test('a mismatching held version sets the flag but the receipt still parses', () => {
		const parsed = parseArenaReceiptEvent(refundEvent({ content: { params_version: 'pv-2' } }))
		expect(parsed.paramsVersion).toBe('pv-2')
		expect(receiptParamsVersionMismatch(parsed, 'pv-1')).toBe(true)
		expect(receiptParamsVersionMismatch(parsed, 'pv-2')).toBe(false)
	})

	test('an unheld or absent version is null — an unknown stays unknown', () => {
		const parsed = parseArenaReceiptEvent(refundEvent())
		expect(receiptParamsVersionMismatch(parsed, null)).toBeNull()
		expect(receiptParamsVersionMismatch(parsed, undefined)).toBeNull()
		expect(receiptParamsVersionMismatch(parseArenaReceiptEvent(refundEvent({ content: { params_version: undefined } })), 'pv-1')).toBeNull()
	})
})
