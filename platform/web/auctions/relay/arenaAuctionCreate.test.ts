/**
 * `platform/web/auctions/relay/arenaAuctionCreate.test.ts` — the 1440 create path.
 *
 * No network, no mint, no relay: the signer is a real `finalizeEvent` over a fixed secret
 * key, and the publisher is a double that records what it was handed. Two kinds of proof:
 *
 * 1. **The event is right.** The signed create is fed to the **real** read gate
 *    (`decodeArenaEvent`) and the **real** projection (`projectArenaEvents`), so the event
 *    this path publishes is proven to be the event the CMS storefront's auction block
 *    lists — the exact mismatch this slice exists to close.
 * 2. **The refusals are named and distinct.** Every rule the settled protocol has answers
 *    with its own `ArenaCreateRefusal`, so nothing has to be told apart by message text.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { Event } from '@sdk/core/nostr-io'
import type { NostrEventLike } from '@sdk/core'
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import type { ArenaCreateValidationInput } from '@sdk/commerce/auctions/auctionPublishValidation'
import { decodeArenaEvent, projectArenaEvents, type ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'
import type { ArenaCreateAcceptanceState } from '@ui/auction/arena/create-stepper'
import {
	ArenaCreateRefusalError,
	buildArenaCreateDraft,
	nextCreateAcceptanceState,
	publishArenaCreate,
	type ArenaCreateContent,
	type ArenaCreatePublisher,
	type ArenaCreateSigner,
} from './arenaAuctionCreate'
import { TEST_CREATE_ADMIT_HEIGHT, makeCreateAdmitEvent, makeCreateRefusalEvent } from './arenaCreateAdmitFixture'

// ---------- Fixtures -------------------------------------------------------

const SELLER_SK = hexToBytes('11'.repeat(32))
const SELLER = getPublicKey(SELLER_SK)
/** A compressed wallet key, as the wallet seam reports it (`02` + x-only). */
const SELLER_WALLET = '02' + 'ab'.repeat(32)
const RELAY_A = 'wss://relay-a.test'
const RELAY_B = 'wss://relay-b.test'
const NOW = 1_800_000_000
const D = 'lot-1'
const VALIDATOR = 'cd'.repeat(32)

const signer: ArenaCreateSigner = {
	pubkey: SELLER,
	sign: async (template) => finalizeEvent(template, SELLER_SK) as unknown as Event,
}

function publisher(acks: { url: string; accepted: boolean; message?: string }[]): ArenaCreatePublisher & { sent: Event[] } {
	const sent: Event[] = []
	return {
		sent,
		publish: async (event) => {
			sent.push(event)
			return { id: event.id, acks }
		},
	}
}

function form(over: Partial<ArenaCreateValidationInput> = {}): ArenaCreateValidationInput {
	return {
		auctionId: D,
		title: 'A handmade mug',
		description: 'Wheel-thrown stoneware.',
		imageUrl: 'https://img.example/mug.png',
		category: 'Collectibles',
		name: 'Studio Nord',
		startPrice: '1000',
		minIncrement: '100',
		mode: 'fixed',
		windowSec: '',
		durationSec: 3600,
		v4vSplit: [],
		...over,
	}
}

const build = (over: Partial<ArenaCreateValidationInput> = {}, wallet: string | null = SELLER_WALLET) =>
	buildArenaCreateDraft(form(over), { sellerPubkey: SELLER, sellerWallet: wallet })

const refusalOf = (run: () => unknown): string => {
	try {
		run()
	} catch (error) {
		if (error instanceof ArenaCreateRefusalError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a value')
}

// ---------- The wire shape -------------------------------------------------

describe('the create content and tags', () => {
	test('carries exactly the settled protocol fields, and only the d tag', () => {
		const draft = build()

		expect(Object.keys(draft.content).sort()).toEqual(
			[
				'auction_id',
				'category',
				'description',
				'durationSec',
				'image',
				'minIncrement',
				'mode',
				'name',
				'sellerWallet',
				'startPrice',
				'title',
				'v4vSplit',
				'windowSec',
			].sort(),
		)
		expect(draft.content.startPrice).toBe(1000)
		expect(draft.content.minIncrement).toBe(100)
		expect(draft.content.mode).toBe('fixed')
		expect(draft.content.windowSec).toBe(0) // fixed time carries no window
		expect(draft.content.durationSec).toBe(3600)
		expect(draft.content.sellerWallet).toBe(SELLER_WALLET)
		expect(draft.content.v4vSplit).toEqual([])
		expect(draft.tags).toEqual([['d', D]])
		expect(draft.coordinate).toBe(`1440:${SELLER}:${D}`)
	})

	test('nothing snake_case is written except the identity key', () => {
		const json = build({ mode: 'antisnipe', windowSec: '300' }).contentJson
		const snakeKeys = [...json.matchAll(/"([A-Za-z0-9_]*_[A-Za-z0-9_]*)":/g)].map((match) => match[1])
		expect(snakeKeys).toEqual(['auction_id'])

		// And none of the retired tag protocol's field names appear anywhere in the content.
		for (const retired of [
			'starting_bid',
			'bid_increment',
			'reserve',
			'auditors',
			'p2pk_xpub',
			'min_bid_curve',
			'settlement_grace',
			'settlement_policy',
			'schema',
			'shipping_option',
			'spec',
			'price',
			'start_at',
			'end_at',
		]) {
			expect(json).not.toContain(retired)
		}
	})

	test('the antisnipe mode carries its window', () => {
		const draft = build({ mode: 'antisnipe', windowSec: '300' })
		expect(draft.content.mode).toBe('antisnipe')
		expect(draft.content.windowSec).toBe(300)
	})

	test('the split rows are parsed into basis points', () => {
		const draft = build({
			v4vSplit: [
				{ role: 'validator', recipientPubkey: VALIDATOR, allocationBps: '250' },
				{ role: 'v4v', recipientPubkey: 'ef'.repeat(32), allocationBps: '750' },
			],
		})
		expect(draft.content.v4vSplit).toEqual([
			{ role: 'validator', recipientPubkey: VALIDATOR, allocationBps: 250 },
			{ role: 'v4v', recipientPubkey: 'ef'.repeat(32), allocationBps: 750 },
		])
	})

	test('the d/auction_id identity is written twice and agrees', () => {
		const draft = build()
		expect(draft.content.auction_id).toBe(draft.d)
		expect(draft.tags).toContainEqual(['d', draft.d])
	})

	test('the signed event round-trips through the real read gate and projection', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		const result = await publishArenaCreate(form(), {
			sellerPubkey: SELLER,
			sellerWallet: SELLER_WALLET,
			signer,
			publisher: pub,
			relays: [RELAY_A, RELAY_B],
			now: NOW,
		})

		const sent = pub.sent[0]
		expect(sent.kind).toBe(ARENA_AUCTION_CREATE_KIND)
		expect(sent.pubkey).toBe(SELLER)
		expect(result.eventId).toBe(sent.id)
		expect(result.rootId).toBe(sent.id)
		expect(result.coordinate).toBe(`1440:${SELLER}:${D}`)

		const decoded = decodeArenaEvent(
			{ id: sent.id, pubkey: sent.pubkey, kind: sent.kind, created_at: sent.created_at, tags: sent.tags, content: sent.content },
			RELAY_A,
		)
		expect(decoded.ok).toBe(true)
		if (!decoded.ok) throw new Error('the read gate refused the create')

		const snapshot = projectArenaEvents([decoded.event])
		expect(snapshot.refusals).toEqual([])
		expect(snapshot.rejectedCreates).toEqual([])
		expect(snapshot.auctions).toHaveLength(1)
		const auction = snapshot.auctions[0]
		expect(auction.d).toBe(D)
		expect(auction.seller).toBe(SELLER)
		expect(auction.coordinate).toBe(`1440:${SELLER}:${D}`)
		expect(auction.content.startPrice).toBe(1000)
		expect(auction.content.minIncrement).toBe(100)
		expect(auction.content.sellerWallet).toBe(SELLER_WALLET)
		expect(auction.content.mode).toBe('fixed')
		expect(auction.content.durationSec).toBe(3600)
		expect(auction.content.title).toBe('A handmade mug')
	})
})

// ---------- Editing --------------------------------------------------------

describe('an edit', () => {
	const ROOT_ID = 'ab'.repeat(32)

	function rootContent(): ArenaCreateContent {
		return build().content
	}

	test('carries e = the root event id', () => {
		const draft = buildArenaCreateDraft(form({ title: 'A better title' }), {
			sellerPubkey: SELLER,
			sellerWallet: SELLER_WALLET,
			editOf: { eventId: ROOT_ID, content: rootContent() },
		})
		expect(draft.tags).toEqual([
			['d', D],
			['e', ROOT_ID],
		])
		expect(draft.content.title).toBe('A better title')
	})

	test('takes every immutable field from the root, not from the form', () => {
		const root = rootContent()
		const draft = buildArenaCreateDraft(
			// The form says different money and time; an edit may not move them.
			form({ startPrice: '99999', minIncrement: '7777', durationSec: 60, mode: 'antisnipe', windowSec: '600' }),
			{ sellerPubkey: SELLER, sellerWallet: SELLER_WALLET, editOf: { eventId: ROOT_ID, content: root } },
		)
		expect(draft.content.startPrice).toBe(root.startPrice)
		expect(draft.content.minIncrement).toBe(root.minIncrement)
		expect(draft.content.durationSec).toBe(root.durationSec)
		expect(draft.content.mode).toBe(root.mode)
		expect(draft.content.windowSec).toBe(root.windowSec)
		expect(draft.content.sellerWallet).toBe(root.sellerWallet)
	})

	test('reports the root as its rootId', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		const result = await publishArenaCreate(form(), {
			sellerPubkey: SELLER,
			sellerWallet: SELLER_WALLET,
			signer,
			publisher: pub,
			relays: [RELAY_A],
			now: NOW,
			editOf: { eventId: ROOT_ID, content: rootContent() },
		})
		expect(result.rootId).toBe(ROOT_ID)
		expect(result.eventId).not.toBe(ROOT_ID)
	})
})

// ---------- Refusals, each named ------------------------------------------

describe('refusals', () => {
	test('no duration', () => {
		expect(refusalOf(() => build({ durationSec: undefined }))).toBe('create.no-duration')
	})

	test('a duration outside 20..259200', () => {
		expect(refusalOf(() => build({ durationSec: 19 }))).toBe('create.duration-out-of-range')
		expect(refusalOf(() => build({ durationSec: 259_201 }))).toBe('create.duration-out-of-range')
	})

	test('no start price', () => {
		expect(refusalOf(() => build({ startPrice: '' }))).toBe('create.no-start-price')
	})

	test('a start price that is not positive', () => {
		expect(refusalOf(() => build({ startPrice: '0' }))).toBe('create.start-price-not-positive')
	})

	test('a non-positive increment', () => {
		expect(refusalOf(() => build({ minIncrement: '0' }))).toBe('create.increment-not-positive')
		expect(refusalOf(() => build({ minIncrement: '-1' }))).toBe('create.increment-not-positive')
	})

	test('an unknown mode', () => {
		expect(refusalOf(() => build({ mode: 'dutch' }))).toBe('create.unknown-mode')
	})

	test('antisnipe with a window outside 60..900', () => {
		expect(refusalOf(() => build({ mode: 'antisnipe', windowSec: '59' }))).toBe('create.window-out-of-range')
		expect(refusalOf(() => build({ mode: 'antisnipe', windowSec: '901' }))).toBe('create.window-out-of-range')
		expect(refusalOf(() => build({ mode: 'antisnipe', windowSec: '' }))).toBe('create.window-out-of-range')
	})

	test('a split that allocates more than 10000 bps', () => {
		expect(
			refusalOf(() =>
				build({
					v4vSplit: [
						{ role: 'validator', recipientPubkey: VALIDATOR, allocationBps: '6000' },
						{ role: 'v4v', recipientPubkey: 'ef'.repeat(32), allocationBps: '5000' },
					],
				}),
			),
		).toBe('create.split-exceeds-total')
	})

	test('a split that repeats a recipient', () => {
		expect(
			refusalOf(() =>
				build({
					v4vSplit: [
						{ role: 'validator', recipientPubkey: VALIDATOR, allocationBps: '100' },
						{ role: 'v4v', recipientPubkey: VALIDATOR, allocationBps: '200' },
					],
				}),
			),
		).toBe('create.duplicate-split-recipient')
	})

	test('no seller wallet', () => {
		expect(refusalOf(() => build({}, null))).toBe('create.no-seller-wallet')
	})

	test('every refusal is a distinct name', () => {
		const names = [
			refusalOf(() => build({ durationSec: undefined })),
			refusalOf(() => build({ durationSec: 19 })),
			refusalOf(() => build({ startPrice: '' })),
			refusalOf(() => build({ minIncrement: '0' })),
			refusalOf(() => build({ mode: 'dutch' })),
			refusalOf(() => build({ mode: 'antisnipe', windowSec: '10' })),
			refusalOf(() => build({}, null)),
		]
		expect(new Set(names).size).toBe(names.length)
	})
})

// ---------- Publishing honesty --------------------------------------------

describe('publishing', () => {
	test('refuses to publish at all when the wallet seam has no key', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		await expect(
			publishArenaCreate(form(), {
				sellerPubkey: SELLER,
				sellerWallet: null,
				signer,
				publisher: pub,
				relays: [RELAY_A],
				now: NOW,
			}),
		).rejects.toBeInstanceOf(ArenaCreateRefusalError)
		expect(pub.sent).toHaveLength(0)
	})

	test('reports the relays that accepted it', async () => {
		const pub = publisher([
			{ url: RELAY_A, accepted: true },
			{ url: RELAY_B, accepted: false, message: 'blocked: rate limited' },
		])
		const result = await publishArenaCreate(form(), {
			sellerPubkey: SELLER,
			sellerWallet: SELLER_WALLET,
			signer,
			publisher: pub,
			relays: [RELAY_A, RELAY_B],
			now: NOW,
		})
		expect(result.outcome).toBe('accepted')
		expect(result.acceptedBy).toEqual([RELAY_A])
		expect(result.rejected).toEqual([{ url: RELAY_B, message: 'blocked: rate limited' }])
		expect(result.totalRelays).toBe(2)
	})

	test('fails closed when no relay accepted it', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: false, message: 'blocked: no' }])
		await expect(
			publishArenaCreate(form(), {
				sellerPubkey: SELLER,
				sellerWallet: SELLER_WALLET,
				signer,
				publisher: pub,
				relays: [RELAY_A],
				now: NOW,
			}),
		).rejects.toThrow(/No relay accepted the auction create/)
	})

	test('refuses a publish whose signer is not the seller', async () => {
		await expect(
			publishArenaCreate(form(), {
				sellerPubkey: SELLER,
				sellerWallet: SELLER_WALLET,
				signer: { ...signer, pubkey: 'ff'.repeat(32) },
				publisher: publisher([{ url: RELAY_A, accepted: true }]),
				relays: [RELAY_A],
				now: NOW,
			}),
		).rejects.toThrow(/not the seller/)
	})

	test('one clock reading stamps the event', async () => {
		const pub = publisher([{ url: RELAY_A, accepted: true }])
		await publishArenaCreate(form(), {
			sellerPubkey: SELLER,
			sellerWallet: SELLER_WALLET,
			signer,
			publisher: pub,
			relays: [RELAY_A],
			now: NOW,
		})
		expect(pub.sent[0].created_at).toBe(NOW)
	})
})

describe('the lot gallery', () => {
	test('a one-photo lot writes no media key', () => {
		expect('media' in build().content).toBe(false)
	})

	test('gallery items land in content.media in order, blank rows dropped', () => {
		const draft = build({
			media: [
				{ type: 'image', url: 'https://img.example/side.jpg' },
				{ type: 'image', url: '  ' },
				{ type: 'video', url: 'https://img.example/demo.mp4' },
			],
		})
		expect(draft.content.media).toEqual([
			{ type: 'image', url: 'https://img.example/side.jpg' },
			{ type: 'video', url: 'https://img.example/demo.mp4' },
		])
		expect(JSON.parse(draft.contentJson).media).toHaveLength(2)
	})

	test('an unsafe gallery URL is refused by name', () => {
		expect(refusalOf(() => build({ media: [{ type: 'image', url: 'http://img.example/x.jpg' }] }))).toBe('create.bad-media')
		expect(refusalOf(() => build({ media: [{ type: 'gif', url: 'https://img.example/x.gif' }] }))).toBe('create.bad-media')
	})

	test('too many gallery items is refused by name', () => {
		const media = Array.from({ length: 13 }, (_, i) => ({ type: 'image', url: `https://img.example/${i}.jpg` }))
		expect(refusalOf(() => build({ media }))).toBe('create.too-much-media')
	})
})

// ---------- The form's acceptance transition -------------------------------

describe('nextCreateAcceptanceState — one transition, never a guess', () => {
	const createdEvent = (): NostrEventLike => {
		const draft = build()
		return finalizeEvent(
			{ kind: ARENA_AUCTION_CREATE_KIND, created_at: NOW, tags: draft.tags, content: JSON.stringify(draft.content) },
			SELLER_SK,
		) as unknown as NostrEventLike
	}

	const auctionView = (events: readonly NostrEventLike[]): ArenaAuctionView | null => {
		const decoded = events.map((event) => {
			const result = decodeArenaEvent(event, RELAY_A)
			if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} ${result.refusal.detail}`)
			return result.event
		})
		return projectArenaEvents(decoded).auctions[0] ?? null
	}

	const published = (create: NostrEventLike): ArenaCreateAcceptanceState => ({
		phase: 'published',
		eventId: create.id,
		coordinate: `1440:${SELLER}:${D}`,
		acceptedBy: [RELAY_A],
		totalRelays: 2,
	})

	test('the chain’s acceptance moves it to accepted, with the height it states', () => {
		const create = createdEvent()
		const view = auctionView([create, makeCreateAdmitEvent(create)])
		const next = nextCreateAcceptanceState({ previous: published(create), view, createEventId: create.id })
		expect(next.phase).toBe('accepted')
		if (next.phase === 'accepted') expect(next.acceptedHeight).toBe(TEST_CREATE_ADMIT_HEIGHT)
	})

	test('neither fact: still reading — the same state back, never accepted and never refused', () => {
		const create = createdEvent()
		const previous = published(create)

		// The read delivered the create but no acceptance and no refusal.
		expect(nextCreateAcceptanceState({ previous, view: auctionView([create]), createEventId: create.id })).toBe(previous)
		// The read has not delivered the lot at all: that is not an answer either way.
		expect(nextCreateAcceptanceState({ previous, view: null, createEventId: create.id })).toBe(previous)
	})

	test('a kind-1450 naming this create refuses it, in the chain’s words verbatim', () => {
		const create = createdEvent()
		const view = auctionView([create, makeCreateRefusalEvent(create, { reason: 'startPrice out of range (1..10000000)' })])
		const next = nextCreateAcceptanceState({ previous: published(create), view, createEventId: create.id })
		expect(next.phase).toBe('refused')
		if (next.phase === 'refused') expect(next.reason).toBe('startPrice out of range (1..10000000)')
	})

	test('a 1450 naming a different create does not refuse this one', () => {
		const create = createdEvent()
		const view = auctionView([create, makeCreateRefusalEvent(create)])
		const previous = published(create)
		// The caller's create id is not the one the refusal names: not our refusal.
		expect(nextCreateAcceptanceState({ previous, view, createEventId: 'a-different-create' })).toBe(previous)
	})

	test('a concluded state is returned unchanged — the chain is not re-litigated tick over tick', () => {
		const create = createdEvent()
		const accepted: ArenaCreateAcceptanceState = {
			phase: 'accepted',
			acceptedHeight: 9,
			eventId: create.id,
			coordinate: `1440:${SELLER}:${D}`,
			acceptedBy: [RELAY_A],
			totalRelays: 2,
		}
		expect(nextCreateAcceptanceState({ previous: accepted, view: auctionView([create]), createEventId: create.id })).toBe(accepted)
	})
})
