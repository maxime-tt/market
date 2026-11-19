/**
 * `platform/web/auctions/relay/arenaBidPublish.test.ts` — the 1441 publish path.
 *
 * No network. Two kinds of proof here:
 *
 * 1. **The event is right.** A signed 1441 built by the real
 *    `publishArenaBid` is fed to the **real** read gate (`decodeArenaEvent`)
 *    and the **real** projection (`projectArenaEvents`), so the bid the app
 *    publishes is proven to be the bid the 31-test read adapter binds, counts
 *    and attributes — not merely a JSON object that looks right.
 * 2. **The reporting is honest.** Every ACK shape the SDK seam can answer
 *    (all accepted, some refused, none at all, an ACK for another event) has a
 *    distinct outcome, and zero ACKs fails closed.
 *
 * `getEventHash` in the publish path means the stub signer must sign
 * canonically; `getEventHash` is used here for the same reason rather than a
 * hand-written hash, so a test signature and a production signature are
 * hashed by one function.
 */
import { describe, expect, test } from 'bun:test'
import { getEventHash } from 'nostr-tools/pure'
import type { Event } from '@sdk/core/nostr-io'
import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import { ARENA_AUCTION_BID_KIND } from '@sdk/commerce/auctions/constants'
import {
	createArenaAuctionRead,
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionReadInit,
	type ArenaRelayOpen,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import type { ArenaAuctionDetailModel } from '@ui/auction/arena/model'
import type { ArenaBidderState } from '@ui/auction/arena/bid-rules'
import type { ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'
import {
	ARENA_BID_SETTLE_POLL_MS,
	ARENA_CHAIN_STALLED_AFTER_SEC,
	ArenaBidPublishError,
	arenaChainAdvancing,
	buildArenaBidContent,
	diagnosePublishedBid,
	nextPublishedBidState,
	publishArenaBid,
	submissionFromError,
	type ArenaBidPublishOptions,
	type ArenaBidPublisher,
	type ArenaBidSigner,
} from './arenaBidPublish'
import { OutputData, schnorrSignDigest } from '@cashu/cashu-ts'
import { toAuctionDetailModel } from './auctionSurfacesRead'
import {
	arenaWalletPubkey,
	buildArenaBidFunding,
	buildArenaEscrowLockOptions,
	type ArenaBidFunding,
	type ArenaBidFundingTerms,
	type ArenaEscrowProof,
	type ArenaWalletSpendSigner,
} from './arenaBidFunding'

// ---------- Fixtures -------------------------------------------------------

const SELLER = 'seller-alice'
// A canonical pubkey on purpose: the publish path hashes a signed event, and
// `getEventHash` refuses a non-hex key — a real signer always yields hex.
const BIDDER = 'be'.repeat(32)
const SIGNED_IN: ArenaBidderState = { pubkey: BIDDER, wallet: 'ready' }
const NOW = 2000
const ROOT = 'ab'.repeat(32)
const RELAY_A = 'wss://relay-a.test'
const RELAY_B = 'wss://relay-b.test'
const RELAY_C = 'wss://relay-c.test'

function detail(over: Partial<ArenaAuctionDetailModel> = {}): ArenaAuctionDetailModel {
	return {
		coordinate: `1440:${SELLER}:lot-1`,
		seller: SELLER,
		d: 'lot-1',
		title: 'A handmade mug',
		imageUrl: null,
		startingBid: 1000,
		topBidTotal: null,
		bidCount: 0,
		bidsWithoutAmount: 0,
		endsAt: 4600,
		endSource: 'create-derived',
		createDerivedEndsAt: 4600,
		committedEndHeight: null,
		committedEndOrdinal: null,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		description: null,
		media: [],
		minIncrement: 100,
		mode: 'fixed',
		windowSec: null,
		durationSec: 3600,
		sellerWallet: null,
		v4vSplit: null,
		versions: 1,
		rootEventId: ROOT,
		canonicalEventId: ROOT,
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
		receipts: [],
		refundsByBidder: {},
		settleReceipt: null,
		createRefusal: null,
		bidRefusals: {},
		...over,
	}
}

/** A canonical signer: the hash the publish path computes is the hash this signs. */
const signer: ArenaBidSigner = {
	pubkey: BIDDER,
	sign: async (template) => ({ ...template, pubkey: BIDDER, id: getEventHash({ ...template, pubkey: BIDDER }), sig: 's'.repeat(128) }),
}

function publisher(acks: { url: string; accepted: boolean; message?: string }[]): ArenaBidPublisher & { sent: Event[] } {
	const sent: Event[] = []
	return {
		sent,
		publish: async (event) => {
			sent.push(event)
			return { id: event.id, acks }
		},
	}
}

function options(over: Partial<ArenaBidPublishOptions> = {}): ArenaBidPublishOptions {
	// `funding`/`fundingTerms` default to null — an unfunded bid — so a test that
	// wants a publishable bid says so by passing the escrow it built.
	return {
		funding: null,
		fundingTerms: null,
		signer,
		publisher: publisher([
			{ url: RELAY_A, accepted: true },
			{ url: RELAY_B, accepted: true },
		]),
		relays: [RELAY_A, RELAY_B],
		now: NOW,
		...over,
	}
}

// ---------- Funding fixtures -----------------------------------------------
//
// A bid that can be published now needs a real escrow: the lock is produced by
// the pinned cashu-ts output builder and the two outcome templates are signed
// by the **wallet spend key** — which is not the bidder's Nostr identity. The
// identity authorises the event; the wallet owns the money and signs the two
// spends. `publishArenaBid` refuses an unfunded bid, so every publishing test
// below funds the amount it bids.

const WALLET_SK = '11'.repeat(32)
const WALLET = arenaWalletPubkey(WALLET_SK)
const COMMITTEE = arenaWalletPubkey('22'.repeat(32))
const ESCROW_SELLER = arenaWalletPubkey('33'.repeat(32))
const KEYSET = '009a1f293253e41e'
/** The pinned keyset's keys: the standard power-of-two denominations, 1 … 2048. */
const KEYSET_KEYS = Object.fromEntries(Array.from({ length: 12 }, (_, bit) => [String(1 << bit), `02${'0'.repeat(64)}`]))
const LOCKTIME = 1_800_000_000
const FIXTURE_C = `02${'ab'.repeat(32)}`

const walletSigner: ArenaWalletSpendSigner = {
	pubkey: WALLET,
	signDigest: (digest) => schnorrSignDigest(digest, WALLET_SK),
}

/** One proof per denomination, each under the identical five-tag escrow lock. */
function escrowProofs(amount: number): ArenaEscrowProof[] {
	const options = buildArenaEscrowLockOptions({ bidderWallet: WALLET, committeeKey: COMMITTEE, locktime: LOCKTIME })
	const proofs: ArenaEscrowProof[] = []
	for (let bit = 1 << 30; bit >= 1; bit >>= 1) {
		if (amount & bit) {
			const output = OutputData.createSingleP2PKData(options, bit, KEYSET)
			proofs.push({ id: KEYSET, amount: bit, secret: new TextDecoder().decode(output.secret), C: FIXTURE_C })
		}
	}
	return proofs
}

/** The auction's own terms, which the publish path re-checks the escrow against. */
const fundingTerms: ArenaBidFundingTerms = {
	bidderWallet: WALLET,
	sellerWallet: ESCROW_SELLER,
	committeeKey: COMMITTEE,
	keysetId: KEYSET,
	keys: KEYSET_KEYS,
	minLocktime: LOCKTIME,
}

const fundingPromises = new Map<number, Promise<ArenaBidFunding>>()

/** The escrow for `amount`, built once per amount. */
function funded(amount: number): Promise<ArenaBidFunding> {
	let promise = fundingPromises.get(amount)
	if (promise === undefined) {
		promise = buildArenaBidFunding({
			proofs: escrowProofs(amount),
			sellerWallet: ESCROW_SELLER,
			bidderWallet: WALLET,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		fundingPromises.set(amount, promise)
	}
	return promise
}

function bid(
	over: {
		model?: ArenaAuctionDetailModel | null
		raw?: string
		bidder?: ArenaBidderState
		status?: 'settled' | 'loading' | 'incomplete' | 'no-relays' | 'error'
	} = {},
) {
	return {
		model: over.model === undefined ? detail() : over.model,
		status: over.status ?? ('settled' as const),
		bidder: over.bidder ?? SIGNED_IN,
		raw: over.raw ?? '1000',
	}
}

// ---------- The event ------------------------------------------------------

describe('buildArenaBidContent — the 1441 binds to the ROOT, not the latest version', () => {
	test('e is the root event id even when the canonical version has moved on', async () => {
		const canonical = 'cd'.repeat(32)
		const built = buildArenaBidContent(detail({ rootEventId: ROOT, canonicalEventId: canonical }), 1000, await funded(1000))
		expect(built.tags).toContainEqual(['e', ROOT])
		expect(built.tags).not.toContainEqual(['e', canonical])
	})

	test('a is the coordinate, content carries the d and an integer amount', async () => {
		const built = buildArenaBidContent(detail(), 1500, await funded(1500))
		expect(built.tags).toContainEqual(['a', `1440:${SELLER}:lot-1`])
		expect(built.content).toMatchObject({
			auction: `1440:${SELLER}:lot-1`,
			auction_id: 'lot-1',
			amount: 1500,
			// The wallet key, NOT the bidder's Nostr identity.
			wallet: WALLET,
		})
		expect(built.content.wallet).not.toBe(BIDDER)
		expect(built.content.proofs.length).toBeGreaterThan(0)
		expect(built.content.outcome_templates.settle.bidder_signature).toMatch(/^[0-9a-f]{128}$/)
		expect(built.content.outcome_templates.refund.bidder_signature).toMatch(/^[0-9a-f]{128}$/)
	})

	test('a root that is not a 64-hex event id is refused before signing', async () => {
		const funding = await funded(1000)
		expect(() => buildArenaBidContent(detail({ rootEventId: 'short' }), 1000, funding)).toThrow(ArenaBidPublishError)
	})

	test('a non-integer amount is refused, not rounded', async () => {
		const funding = await funded(1000)
		expect(() => buildArenaBidContent(detail(), 1000.5, funding)).toThrow(ArenaBidPublishError)
		expect(() => buildArenaBidContent(detail(), 0, funding)).toThrow(ArenaBidPublishError)
	})
})

// ---------- Publishing -----------------------------------------------------

describe('publishArenaBid — what reaches the wire', () => {
	test('publishes kind 1441, signed, with the root binding, and reports one ACK per relay', async () => {
		const pub = publisher([
			{ url: RELAY_A, accepted: true },
			{ url: RELAY_B, accepted: true },
		])
		const result = await publishArenaBid(bid(), options({ publisher: pub, funding: await funded(1000), fundingTerms }))
		expect(pub.sent).toHaveLength(1)
		const event = pub.sent[0]
		expect(event.kind).toBe(ARENA_AUCTION_BID_KIND)
		expect(event.kind).toBe(1441)
		// The event is signed by the Nostr identity…
		expect(event.pubkey).toBe(BIDDER)
		expect(event.tags).toContainEqual(['e', ROOT])
		// …and the content carries the escrow the wallet key owns.
		const content = JSON.parse(event.content)
		expect(content).toMatchObject({
			auction: `1440:${SELLER}:lot-1`,
			auction_id: 'lot-1',
			amount: 1000,
			wallet: WALLET,
		})
		// Six denominations for 1,000 sats (512+256+128+64+32+8), each under the
		// same lock, and together exactly the amount the bid names.
		expect(content.proofs).toHaveLength(6)
		expect(content.proofs.reduce((sum: number, proof: { amount: number }) => sum + proof.amount, 0)).toBe(1000)
		// The settle pays the seller and the refund pays the bidder's wallet — the
		// only two destinations the committee can ever move this money to — and
		// both are decomposed into the mint's single-denomination outputs
		// (1,000 sats = 512+256+128+64+32+8). A non-denomination output could
		// never be signed by the mint, so the escrow could never settle or refund.
		expect(content.outcome_templates.settle.outputs.map((output: { amount: number }) => output.amount)).toEqual([512, 256, 128, 64, 32, 8])
		expect(content.outcome_templates.settle.bidder_signature).toMatch(/^[0-9a-f]{128}$/)
		expect(content.outcome_templates.refund.outputs.map((output: { amount: number }) => output.amount)).toEqual([512, 256, 128, 64, 32, 8])
		expect(content.outcome_templates.refund.bidder_signature).toMatch(/^[0-9a-f]{128}$/)
		expect(result).toMatchObject({ outcome: 'accepted', acceptedBy: [RELAY_A, RELAY_B], totalRelays: 2 })
		expect(result.state).toMatchObject({ phase: 'presumed', amount: 1000, acceptedBy: [RELAY_A, RELAY_B] })
	})

	test('presumed, not placed: the submission state names relays, never an outcome', async () => {
		const result = await publishArenaBid(bid({ raw: '1200' }), options({ funding: await funded(1200), fundingTerms }))
		expect(result.state.phase).toBe('presumed')
		const serialised = JSON.stringify(result.state)
		expect(serialised).not.toContain('won')
		expect(serialised).not.toContain('settled')
	})

	test('a subset of relays accepting still counts as accepted, and the count is stated', async () => {
		const result = await publishArenaBid(
			bid(),
			options({
				funding: await funded(1000),
				fundingTerms,
				relays: [RELAY_A, RELAY_B, RELAY_C],
				publisher: publisher([
					{ url: RELAY_A, accepted: true },
					{ url: RELAY_B, accepted: false, message: 'blocked: rate-limited' },
					{ url: RELAY_C, accepted: false, message: 'connection refused' },
				]),
			}),
		)
		expect(result.outcome).toBe('accepted')
		expect(result.acceptedBy).toEqual([RELAY_A])
		expect(result.rejected).toEqual([
			{ url: RELAY_B, message: 'blocked: rate-limited' },
			{ url: RELAY_C, message: 'connection refused' },
		])
		expect(result.state).toMatchObject({ phase: 'presumed', acceptedBy: [RELAY_A], totalRelays: 3 })
	})

	test('ZERO ACKs fails closed: signed, offered, published nowhere', async () => {
		const pub = publisher([
			{ url: RELAY_A, accepted: false, message: 'blocked: not admitted' },
			{ url: RELAY_B, accepted: false },
		])
		let caught: unknown
		try {
			await publishArenaBid(bid({ raw: '1300' }), options({ publisher: pub, funding: await funded(1300), fundingTerms }))
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(ArenaBidPublishError)
		const error = caught as ArenaBidPublishError
		// \(the event WAS signed and sent — that is the dangerous case\)
		expect(pub.sent).toHaveLength(1)
		expect(error.state).toMatchObject({ phase: 'unpublished', amount: 1300, eventId: pub.sent[0].id })
		const reason = (error.state as { reason: string }).reason
		expect(reason).toContain('No relay accepted it')
		expect(reason).toContain('not admitted')
	})

	test('an empty ACK list is also zero ACKs', async () => {
		await expect(
			publishArenaBid(bid(), options({ publisher: publisher([]), funding: await funded(1000), fundingTerms })),
		).rejects.toBeInstanceOf(ArenaBidPublishError)
	})

	test('a transport that throws is a publish failure with nothing published', async () => {
		const throwing: ArenaBidPublisher = {
			publish: async () => {
				throw new Error('socket closed')
			},
		}
		let caught: unknown
		try {
			await publishArenaBid(bid(), options({ publisher: throwing, funding: await funded(1000), fundingTerms }))
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(ArenaBidPublishError)
		expect((caught as ArenaBidPublishError).state).toMatchObject({ phase: 'unpublished' })
	})

	test('an ACK for a different event id is refused', async () => {
		const wrong: ArenaBidPublisher = { publish: async (event) => ({ id: `${event.id}-other`, acks: [{ url: RELAY_A, accepted: true }] }) }
		await expect(publishArenaBid(bid(), options({ publisher: wrong, funding: await funded(1000), fundingTerms }))).rejects.toBeInstanceOf(
			ArenaBidPublishError,
		)
	})
})

// ---------- Refusals before the wire --------------------------------------

describe('publishArenaBid — the publish path re-checks even when the button was enabled', () => {
	async function refusalOf(input: ReturnType<typeof bid>, over: Partial<ArenaBidPublishOptions> = {}) {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		let caught: unknown
		try {
			await publishArenaBid(input, options({ publisher: pub, ...over }))
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(ArenaBidPublishError)
		expect(pub.sent).toHaveLength(0)
		return caught as ArenaBidPublishError
	}

	test('a bid with no funding at all is refused by name, and nothing is published', async () => {
		const error = await refusalOf(bid())
		expect(error.refusal).toBe('bid.unfunded')
	})

	test('an escrow that does not match the amount this bid names is refused', async () => {
		const error = await refusalOf(bid(), { funding: await funded(2000), fundingTerms })
		expect(error.refusal).toBe('bid.funding-invalid')
	})

	test('funding checked against different terms is refused', async () => {
		const error = await refusalOf(bid(), {
			funding: await funded(1000),
			fundingTerms: { ...fundingTerms, committeeKey: arenaWalletPubkey('44'.repeat(32)) },
		})
		expect(error.refusal).toBe('bid.funding-invalid')
	})

	test('an amount below the floor never reaches the signer', async () => {
		const error = await refusalOf(bid({ raw: '999' }))
		expect(error.refusal).toBe('bid.not-allowed')
		expect(error.state.phase).toBe('failed')
		expect((error.state as { reason: string }).reason).toContain('1,000 sats')
	})

	test('an ended auction is refused even with a valid amount', async () => {
		await refusalOf(bid({ model: detail({ phase: 'ended' }) }))
	})

	test('a partial read is refused: the floor may be stale', async () => {
		await refusalOf(bid({ model: detail({ bidCount: 2, topBidTotal: null, bidsWithoutAmount: 1 }) }))
	})

	test('the seller is refused', async () => {
		await refusalOf(bid({ bidder: { pubkey: SELLER, wallet: 'ready' } }))
	})

	test('a signer that returns a different event is caught, and nothing is published', async () => {
		const sneaky: ArenaBidSigner = {
			pubkey: BIDDER,
			// Signs a DIFFERENT amount — the classic signer race.
			sign: async (template) => {
				const other = { ...template, content: JSON.stringify({ auction_id: 'lot-1', amount: 1 }), pubkey: BIDDER }
				return { ...other, id: getEventHash(other), sig: 's'.repeat(128) }
			},
		}
		const error = await refusalOf(bid(), { signer: sneaky, funding: await funded(1000), fundingTerms })
		expect(error.refusal).toBe('bid.signature-mismatch')
	})

	test('a signer that throws is a failure with nothing published', async () => {
		const throwing: ArenaBidSigner = {
			pubkey: BIDDER,
			sign: async () => {
				throw new Error('user rejected')
			},
		}
		const error = await refusalOf(bid(), { signer: throwing, funding: await funded(1000), fundingTerms })
		expect((error.state as { reason: string }).reason).toContain('user rejected')
	})
})

// ---------- Round-trip through the REAL gate ------------------------------

describe('round-trip: a published 1441 is what the read adapter binds', () => {
	/** Drive the real read over one fake relay that serves the given events. */
	async function readBack(events: NostrEventLike[]) {
		const openRelay: ArenaRelayOpen = (
			_filters: readonly EventFilter[],
			_options: ArenaAuctionReadInit extends never ? never : { signal?: AbortSignal },
		) =>
			(async function* () {
				for (const event of events) yield { type: 'event', event } as EventStreamItem<NostrEventLike>
				yield { type: 'caught-up', info: { eose: [RELAY_A], pending: [], complete: true } } as EventStreamItem<NostrEventLike>
			})()
		const read = createArenaAuctionRead({ relays: [RELAY_A], openRelay: () => openRelay, deadlineMs: 50 })
		const result = await read.snapshot()
		return result
	}

	/** Decode through the real gate; a fixture that fails it would silently test nothing. */
	function gated(event: NostrEventLike, relay = RELAY_A) {
		const result = decodeArenaEvent(event, relay)
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} — ${result.refusal.detail}`)
		return result.event
	}

	function createEvent(d = 'lot-1'): NostrEventLike {
		return {
			id: 'cf'.repeat(32),
			pubkey: SELLER,
			created_at: 1000,
			kind: 1440,
			tags: [['d', d]],
			content: JSON.stringify({ auction_id: d, title: 'Mug', starting_bid: 1000, min_increment: 100, duration_seconds: 3600 }),
		}
	}

	test('the signed bid passes the read gate and is counted against its auction', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		const result = await publishArenaBid(bid({ raw: '1100' }), options({ publisher: pub, funding: await funded(1100), fundingTerms }))
		const signed = pub.sent[0] as unknown as NostrEventLike

		// The gate: the same function a relay's events go through.
		const decoded = decodeArenaEvent(signed, RELAY_A)
		expect(decoded.ok).toBe(true)

		// The projection: the same function a snapshot is built with.
		const snapshot = projectArenaEvents([gated(createEvent()), gated(signed)])
		expect(snapshot.auctions).toHaveLength(1)
		const auction = snapshot.auctions[0]
		expect(auction.bids).toHaveLength(1)
		expect(auction.bids[0]).toMatchObject({ bidder: BIDDER, amount: 1100 })
		expect(auction.topBid).toEqual({ bidder: BIDDER, total: 1100 })
		expect(snapshot.refusals).toHaveLength(0)

		// And the bid id the surface holds is the id the read delivered.
		expect(auction.bids[0].eventId).toBe(result.eventId)
	})

	test('a bid that names no auction at all is refused by the real projection, and counted', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		await publishArenaBid(bid(), options({ publisher: pub, funding: await funded(1000), fundingTerms }))
		const signed = { ...(pub.sent[0] as unknown as NostrEventLike) }
		// Break every binding the projection can resolve a bid by.
		signed.tags = []
		signed.content = JSON.stringify({ auction_id: 'some-other-lot', amount: 1000 })
		const snapshot = projectArenaEvents([gated(createEvent()), gated(signed)])
		expect(snapshot.auctions[0].bids).toHaveLength(0)
		expect(snapshot.refusals.map((refusal) => refusal.reason)).toContain('arena.unbound_bid')
	})

	test('presumed becomes seen only when the read serves the bid back', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		const result = await publishArenaBid(bid({ raw: '1100' }), options({ publisher: pub, funding: await funded(1100), fundingTerms }))

		// Before the read has settled: nothing may be concluded, so it stays
		// presumed however the calls below would eventually land.
		const before = toAuctionDetailModel(projectArenaEvents([gated(createEvent())]).auctions[0], { now: NOW, status: 'settled' })
		expect(
			nextPublishedBidState({ previous: result.state, model: before, readStatus: 'loading', chainAdvancing: null, escrowLocktime: null, now: NOW }),
		).toMatchObject({ phase: 'presumed' })

		// After the read: the model carries the bid → seen, from the ACKs the
		// submission has carried since the publish.
		const after = projectArenaEvents([gated(createEvent()), gated(pub.sent[0] as unknown as NostrEventLike)])
		const model = toAuctionDetailModel(after.auctions[0], { now: NOW, status: 'settled' })
		const seen = nextPublishedBidState({
			previous: result.state,
			model,
			readStatus: 'settled',
			chainAdvancing: true,
			escrowLocktime: null,
			now: NOW,
		})
		// The ACK facts the submission carried since the publish are the ones the
		// panel then states — not re-derived from this read.
		if (result.state.phase !== 'presumed') throw new Error('the publish path did not answer presumed')
		expect(seen).toMatchObject({
			phase: 'seen',
			eventId: result.eventId,
			amount: 1100,
			acceptedBy: result.state.acceptedBy,
			totalRelays: result.state.totalRelays,
		})
	})

	test('a zero-ACK bid never becomes seen, because it was never published', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: false }])
		let state
		try {
			await publishArenaBid(bid({ raw: '1100' }), options({ publisher: pub, funding: await funded(1100), fundingTerms }))
		} catch (error) {
			state = submissionFromError(error, 1100)
		}
		expect(state).toMatchObject({ phase: 'unpublished' })
		// The relay refused it, so a read that somehow served it would still not
		// turn a failed publish into a placed bid: the state is `unpublished`, and
		// `nextPublishedBidState` only moves a published bid.
		const before = toAuctionDetailModel(projectArenaEvents([gated(createEvent())]).auctions[0], { now: NOW, status: 'settled' })
		expect(nextPublishedBidState({ previous: state!, model: before, readStatus: 'settled', chainAdvancing: true, escrowLocktime: null, now: NOW }).phase).toBe(
			'unpublished',
		)
	})
})

// ---------- Read-back over a live relay stream (still local) --------------

describe('readBack — fixtures used by the round-trip', () => {
	test('the fake relay seam drives the real read to caught-up', async () => {
		const read = createArenaAuctionRead({
			relays: [RELAY_A],
			openRelay: () =>
				async function* () {
					yield {
						type: 'event',
						event: {
							id: 'cf'.repeat(32),
							pubkey: SELLER,
							created_at: 1000,
							kind: 1440,
							tags: [['d', 'lot-1']],
							content: JSON.stringify({ auction_id: 'lot-1', starting_bid: 1000 }),
						},
					} as EventStreamItem<NostrEventLike>
					yield { type: 'caught-up', info: { eose: [RELAY_A], pending: [], complete: true } } as EventStreamItem<NostrEventLike>
				},
			deadlineMs: 50,
		})
		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.health.answered).toEqual([RELAY_A])
	})
})

// =========================================================================
// The three-state diagnosis — never invents a reason
// =========================================================================

describe('arenaChainAdvancing', () => {
	test('two distinct heights, the newest fresh, is advancing', () => {
		expect(arenaChainAdvancing({ heights: [120, 130], newestTime: 1_000, now: 1_030 })).toBe(true)
	})

	test('one height is not "several blocks"', () => {
		expect(arenaChainAdvancing({ heights: [120], newestTime: 1_000, now: 1_030 })).toBe(false)
	})

	test('a stale newest time is not advancing — the honest answer when the chain is stuck', () => {
		expect(arenaChainAdvancing({ heights: [120, 130], newestTime: 1_000, now: 1_500 })).toBe(false)
	})

	test('no time at all is not advancing, never assumed', () => {
		expect(arenaChainAdvancing({ heights: [120, 130], newestTime: null, now: 1_030 })).toBe(false)
	})

	test('a future newest time is refused rather than trusted', () => {
		expect(arenaChainAdvancing({ heights: [120, 130], newestTime: 2_000, now: 1_000 })).toBe(false)
	})
})

describe('diagnosePublishedBid — five states, and never an invented reason', () => {
	test('a refusal the chain recorded is stated with the chain’s own words', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: true,
			escrowLocktime: 2_000,
			refusalReason: 'locktime below the floor for this lot: 1794924019 is under 1794924021',
		})
		expect(diagnosis.state).toBe('refused')
		expect(diagnosis.reason).toBe('locktime below the floor for this lot: 1794924019 is under 1794924021')
		expect(diagnosis.reclaimable).toBe(true)
	})

	test('a refusal always outranks the absence states — the chain put it in committed state', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: false,
			escrowLocktime: null,
			refusalReason: 'bid already recorded',
		})
		expect(diagnosis.state).toBe('refused')
		expect(diagnosis.reclaimable).toBe(false)
	})

	test('no reason is invented when no refusal was read — and an empty one is no reason', () => {
		for (const refusalReason of [null, undefined, '   ']) {
			const diagnosis = diagnosePublishedBid({
				eventId: 'b1',
				seenInRead: false,
				namedByReceipt: false,
				chainAdvancing: true,
				escrowLocktime: 2_000,
				refusalReason,
			})
			expect(diagnosis.state).toBe('not-accepted')
			expect(diagnosis.reason).toBeNull()
		}
	})

	test('seen in the read is committed: say nothing', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: true,
			namedByReceipt: false,
			chainAdvancing: true,
			escrowLocktime: 2_000,
		})
		expect(diagnosis.state).toBe('committed')
		expect(diagnosis.reclaimable).toBe(false)
	})

	test('a receipt naming the bid is committed too', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: true,
			chainAdvancing: true,
			escrowLocktime: 2_000,
		})
		expect(diagnosis.state).toBe('committed')
	})

	test('published, not committed, chain advancing → not-accepted, with the locktime and reclaim', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: true,
			escrowLocktime: 2_000,
		})
		expect(diagnosis.state).toBe('not-accepted')
		expect(diagnosis.escrowLocktime).toBe(2_000)
		expect(diagnosis.reclaimable).toBe(true)
	})

	test('not-accepted with an unknown locktime is not reclaimable — no affordance the app cannot honour', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: true,
			escrowLocktime: null,
		})
		expect(diagnosis.state).toBe('not-accepted')
		expect(diagnosis.escrowLocktime).toBeNull()
		expect(diagnosis.reclaimable).toBe(false)
	})

	test('published, not committed, chain not advancing → unconfirmed, never a claim about the chain or the bid', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: false,
			escrowLocktime: 2_000,
		})
		expect(diagnosis.state).toBe('unconfirmed')
		expect(diagnosis.reason).toBeNull()
		expect(diagnosis.reclaimable).toBe(false)
	})

	test('a window shorter than the stall horizon is still unconfirmed — the horizon is the claim', () => {
		for (const observedStallSec of [0, 1, 60, 899, null]) {
			const diagnosis = diagnosePublishedBid({
				eventId: 'b1',
				seenInRead: false,
				namedByReceipt: false,
				chainAdvancing: false,
				escrowLocktime: 2_000,
				observedStallSec,
			})
			expect(diagnosis.state).toBe('unconfirmed')
		}
	})

	test('a chain watched standing still for the full stall horizon is infrastructure, and makes no claim about the bid', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: false,
			escrowLocktime: 2_000,
			observedStallSec: ARENA_CHAIN_STALLED_AFTER_SEC,
		})
		expect(diagnosis.state).toBe('infrastructure')
		expect(diagnosis.reason).toBeNull()
		expect(diagnosis.reclaimable).toBe(false)
	})

	test('the stall horizon is the protocol’s own 900 s safety scale', () => {
		// `ARENA_CHAIN_CLOCK_STALE_AFTER_SEC` (`arenaClock.ts:44`) is 900 s, pinned
		// on `SettlementSafetySec = 900 s` and the 60…900 s anti-snipe window
		// (`sdk/commerce/auctions/auctionPublishValidation.ts:38`). A stall claim
		// below that horizon is not demonstrable, so the two must not drift apart.
		expect(ARENA_CHAIN_STALLED_AFTER_SEC).toBe(900)
	})

	test('a refusal outranks the stall claim — the chain put it in committed state and said why', () => {
		const diagnosis = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: false,
			escrowLocktime: null,
			refusalReason: 'bid already recorded',
			observedStallSec: ARENA_CHAIN_STALLED_AFTER_SEC * 10,
		})
		expect(diagnosis.state).toBe('refused')
		expect(diagnosis.reason).toBe('bid already recorded')
	})

	test('the only reason a diagnosis carries is the chain’s, verbatim', () => {
		// The shape gained `reason` when the chain's *recorded* refusals were
		// read (a 1450 naming the bid). It is `null` in every state the app
		// diagnoses itself — the app still invents nothing, and this pins that.
		for (const chainAdvancing of [true, false]) {
			const diagnosis = diagnosePublishedBid({
				eventId: 'b1',
				seenInRead: false,
				namedByReceipt: false,
				chainAdvancing,
				escrowLocktime: null,
			})
			expect(Object.keys(diagnosis).sort()).toEqual(['escrowLocktime', 'eventId', 'reason', 'reclaimable', 'state'])
			expect(diagnosis.reason).toBeNull()
		}
		const refused = diagnosePublishedBid({
			eventId: 'b1',
			seenInRead: false,
			namedByReceipt: false,
			chainAdvancing: true,
			escrowLocktime: null,
			refusalReason: 'bid already recorded',
		})
		expect(refused.reason).toBe('bid already recorded')
	})
})

// =========================================================================
// The panel's state machine over successive reads
//
// The defect this pins, measured live 2026-11-19: the read is one-shot, so a
// snapshot's freshness decays with the wall clock, and the panel used to turn
// that decay into "The chain is not advancing" while the chain was in fact
// advancing and the bid **was** admitted. A missed freshness window must stay an
// honest "waiting", keep reading, and resolve to the chain's own outcome.
// =========================================================================

describe('nextPublishedBidState — what one read says about a published bid', () => {
	const published: ArenaBidSubmissionState = { phase: 'presumed', amount: 1_100, eventId: 'bid-1', acceptedBy: [RELAY_A], totalRelays: 2 }
	/** One settled read, as the host would hand it to the state machine. */
	const read = (over: Partial<Parameters<typeof nextPublishedBidState>[0]> = {}) =>
		nextPublishedBidState({
			previous: published,
			model: detail(),
			readStatus: 'settled',
			chainAdvancing: false,
			escrowLocktime: 5_000,
			now: NOW,
			...over,
		})

	test('a settled read with no bid and no advance is a waiting state, never an alarm', () => {
		const state = read()
		expect(state).toMatchObject({ phase: 'unconfirmed', eventId: 'bid-1', amount: 1_100, watchingSince: NOW })
		// It carries the ACK facts on, so the bid can still be shown as served.
		expect(state).toMatchObject({ acceptedBy: [RELAY_A], totalRelays: 2 })
	})

	test('an unsettled read says nothing at all — the state stands, as the same object', () => {
		expect(read({ readStatus: 'loading', chainAdvancing: null, model: null })).toBe(published)
		expect(read({ readStatus: 'incomplete' })).toBe(published)
		expect(read({ chainAdvancing: null })).toBe(published)
		expect(read({ model: null })).toBe(published)
	})

	test('a state that is not a published bid is returned untouched', () => {
		const idle: ArenaBidSubmissionState = { phase: 'idle' }
		expect(read({ previous: idle })).toBe(idle)
	})

	test('the alarm needs the watched horizon — one second short is still waiting, at the horizon it is a stall', () => {
		const waiting = read()
		const short = read({ previous: waiting, now: NOW + ARENA_CHAIN_STALLED_AFTER_SEC - 1 })
		expect(short).toBe(waiting)
		const stalled = read({ previous: waiting, now: NOW + ARENA_CHAIN_STALLED_AFTER_SEC })
		expect(stalled).toMatchObject({ phase: 'infrastructure', eventId: 'bid-1', stalledForSec: ARENA_CHAIN_STALLED_AFTER_SEC })
	})

	test('a clock that steps backwards cannot shorten a window already watched', () => {
		const waiting = read()
		const backwards = read({ previous: waiting, now: NOW - 500 })
		expect(backwards).toBe(waiting)
	})

	test('a chain that advances later resolves the panel to the chain’s own outcome, not the alarm', () => {
		// First read: the chain's committed state has not moved at all.
		const waiting = read()
		expect(waiting.phase).toBe('unconfirmed')
		// A later polled read — three horizons later, so the alarm would be
		// allowed — serves the bid: the panel is `seen` (the bid is counted), and
		// the infrastructure claim is never reached.
		const served = read({
			previous: waiting,
			model: detail({ bids: [{ eventId: 'bid-1', bidder: BIDDER, createdAt: NOW, amount: 1_100, relays: [RELAY_A] }] }),
			now: NOW + ARENA_CHAIN_STALLED_AFTER_SEC * 3,
		})
		expect(served).toMatchObject({ phase: 'seen', eventId: 'bid-1', amount: 1_100, acceptedBy: [RELAY_A], totalRelays: 2 })
	})

	test('a chain that advances without taking the bid is the chain’s decision, not an infrastructure problem', () => {
		const decided = read({ previous: read(), chainAdvancing: true, now: NOW + 30 })
		expect(decided).toMatchObject({ phase: 'not-accepted', eventId: 'bid-1', locktime: 5_000, reclaimable: true })
	})

	test('a refusal the read delivers is stated in the chain’s own words, from any waiting state', () => {
		const model = detail({ bidRefusals: { 'bid-1': { reason: 'locktime below the floor for this lot', height: 900, refusalEventId: 'ev-refusal' } } })
		const refused = read({ previous: read(), model, chainAdvancing: true })
		expect(refused).toMatchObject({ phase: 'refused', reason: 'locktime below the floor for this lot', locktime: 5_000, reclaimable: true })
	})

	test('the poll interval is a cadence, not a hammer', () => {
		expect(ARENA_BID_SETTLE_POLL_MS).toBeGreaterThanOrEqual(10_000)
		expect(ARENA_BID_SETTLE_POLL_MS).toBeLessThanOrEqual(60_000)
	})
})
