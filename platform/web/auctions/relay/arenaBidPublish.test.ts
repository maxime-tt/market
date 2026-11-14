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
import {
	ArenaBidPublishError,
	buildArenaBidContent,
	publishArenaBid,
	settleSubmissionFromRead,
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
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		description: null,
		minIncrement: 100,
		reserve: null,
		durationSeconds: 3600,
		lateBidWindowSeconds: null,
		lateBidExtensionSeconds: null,
		maxTotalExtensionSeconds: null,
		locktimeSeconds: null,
		fundingMode: null,
		versions: 1,
		rootEventId: ROOT,
		canonicalEventId: ROOT,
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
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
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		fundingPromises.set(amount, promise)
	}
	return promise
}

function bid(over: { model?: ArenaAuctionDetailModel | null; raw?: string; bidder?: ArenaBidderState; status?: 'settled' | 'loading' | 'incomplete' | 'no-relays' | 'error' } = {}) {
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
		// The settle pays the seller, the refund pays the bidder's wallet — the
		// only two destinations the committee can ever move this money to.
		expect(content.outcome_templates.settle.outputs).toMatchObject([{ amount: 1000 }])
		expect(content.outcome_templates.settle.bidder_signature).toMatch(/^[0-9a-f]{128}$/)
		expect(content.outcome_templates.refund.outputs).toMatchObject([{ amount: 1000 }])
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
		await expect(
			publishArenaBid(bid(), options({ publisher: wrong, funding: await funded(1000), fundingTerms })),
		).rejects.toBeInstanceOf(ArenaBidPublishError)
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
		const openRelay: ArenaRelayOpen = (_filters: readonly EventFilter[], _options: ArenaAuctionReadInit extends never ? never : { signal?: AbortSignal }) =>
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

		// Before the read: the model has no bids → still presumed.
		const before = toAuctionDetailModel(projectArenaEvents([gated(createEvent())]).auctions[0], { now: NOW, status: 'settled' })
		expect(settleSubmissionFromRead(result.state, before).phase).toBe('presumed')

		// After the read: the model carries the bid → seen.
		const after = projectArenaEvents([gated(createEvent()), gated(pub.sent[0] as unknown as NostrEventLike)])
		const model = toAuctionDetailModel(after.auctions[0], { now: NOW, status: 'settled' })
		const seen = settleSubmissionFromRead(result.state, model)
		expect(seen).toMatchObject({ phase: 'seen', eventId: result.eventId, amount: 1100 })
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
		// turn a failed publish into a placed bid: the state is `unpublished` and
		// `settleSubmissionFromRead` only upgrades `presumed`.
		const before = toAuctionDetailModel(projectArenaEvents([gated(createEvent())]).auctions[0], { now: NOW, status: 'settled' })
		expect(settleSubmissionFromRead(state!, before).phase).toBe('unpublished')
	})
})

// ---------- Read-back over a live relay stream (still local) --------------

describe('readBack — fixtures used by the round-trip', () => {
	test('the fake relay seam drives the real read to caught-up', async () => {
		const read = createArenaAuctionRead({
			relays: [RELAY_A],
			openRelay: () => async function* () {
				yield { type: 'event', event: { id: 'cf'.repeat(32), pubkey: SELLER, created_at: 1000, kind: 1440, tags: [['d', 'lot-1']], content: JSON.stringify({ auction_id: 'lot-1', starting_bid: 1000 }) } } as EventStreamItem<NostrEventLike>
				yield { type: 'caught-up', info: { eose: [RELAY_A], pending: [], complete: true } } as EventStreamItem<NostrEventLike>
			},
			deadlineMs: 50,
		})
		const snapshot = await read.snapshot()
		expect(snapshot.auctions).toHaveLength(1)
		expect(snapshot.health.answered).toEqual([RELAY_A])
	})
})