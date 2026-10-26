import { afterEach, describe, expect, test } from 'bun:test'
import { createMemoryReadMarkPort, createNotifications } from '@sdk/core'
import type { ReadMarkPort } from '@sdk/core'
import { createReadMarks, expandLegacyMarks, readMarkFamilies, scopedLastSeenOf } from './readMarks'
import { notificationScopes } from './types'
import type { AppNotificationPayload, AppNotificationType } from './types'

const appNotifications = () => createNotifications<AppNotificationType, AppNotificationPayload>()

/** A port that records every write and can be told to fail. */
function recordingPort(): ReadMarkPort & { writes: [string, number][]; failWith?: Error } {
	const marks = new Map<string, number>()
	const port = {
		writes: [] as [string, number][],
		failWith: undefined as Error | undefined,
		get: async (stream: string) => marks.get(stream) ?? null,
		set: async (stream: string, at: number) => {
			if (port.failWith) throw port.failWith
			port.writes.push([stream, at])
			const current = marks.get(stream)
			if (current !== undefined && at <= current) return
			marks.set(stream, at)
		},
	}
	return port
}

/** A layer with no ambient storage: the port and the legacy blob are the only inputs. */
function layer(overrides: Partial<Parameters<typeof createReadMarks>[1]> = {}) {
	const instance = appNotifications()
	const readMarks = createReadMarks(instance, {
		port: createMemoryReadMarkPort(),
		now: () => 1000,
		syncRead: () => null,
		syncListStreams: () => [],
		legacyRead: () => null,
		...overrides,
	})
	return { instance, readMarks }
}

const original = globalThis.localStorage
afterEach(() => {
	if (original === undefined) {
		;(globalThis as { localStorage?: Storage }).localStorage = undefined
	} else {
		;(globalThis as { localStorage?: Storage }).localStorage = original
	}
})

describe('readMarks — the legacy relation, reproduced', () => {
	test('a keyed read is the max of the family mark and the subject mark', () => {
		const { instance, readMarks } = layer()
		readMarks.markAuctionBidsSeen(undefined, 500)
		readMarks.markAuctionBidsSeen('auction-a', 400)
		expect(readMarks.getLastSeenAuctionBids('auction-a')).toBe(500)
		expect(readMarks.getLastSeenAuctionBids('auction-b')).toBe(500)
		expect(readMarks.getLastSeenAuctionBids()).toBe(500)
		// The subject mark never lowers the family mark, and the badge read agrees with the ledger.
		expect(scopedLastSeenOf(instance.snapshot().ledger, readMarkFamilies.auctionBids, notificationScopes.auctionBids('auction-a'))).toBe(
			500,
		)
	})

	test('a keyed mark advances only its subject and leaves the family global alone', () => {
		const { readMarks } = layer()
		readMarks.markAuctionBidsSeen('auction-a', 700)
		expect(readMarks.getLastSeenAuctionBids('auction-a')).toBe(700)
		expect(readMarks.getLastSeenAuctionBids('auction-b')).toBe(0)
		expect(readMarks.getLastSeenAuctionBids()).toBe(0)
	})

	test('a no-key mark raises the family global and clears every subject in that family', () => {
		const { instance, readMarks } = layer()
		readMarks.markAuctionBidsSeen('auction-a', 300)
		readMarks.markAuctionBidsSeen('auction-b', 350)
		readMarks.markAuctionBidsSeen(undefined, 900)
		expect(readMarks.getLastSeenAuctionBids()).toBe(900)
		expect(readMarks.getLastSeenAuctionBids('auction-a')).toBe(900)
		expect(readMarks.getLastSeenAuctionBids('auction-b')).toBe(900)
		// Every subject count in the family was zeroed, and no other family was touched.
		const ledger = instance.snapshot().ledger
		expect(ledger.counts[notificationScopes.auctionBids('auction-a')] ?? 0).toBe(0)
		expect(ledger.counts[notificationScopes.auctionBids('auction-b')] ?? 0).toBe(0)
		expect(ledger.counts[notificationScopes.orders] ?? 0).toBe(0)
	})

	test('the messages family has no global mark: a no-key mark clears every conversation', () => {
		const { instance, readMarks } = layer()
		instance.ledger.increment(notificationScopes.messages('alice'))
		instance.ledger.increment(notificationScopes.messages('bob'))
		readMarks.markMessagesSeen(undefined, 800)
		expect(readMarks.getLastSeenForConversation('alice')).toBe(800)
		expect(readMarks.getLastSeenForConversation('bob')).toBe(800)
		expect(instance.snapshot().ledger.counts[notificationScopes.messages('alice')] ?? 0).toBe(0)
	})

	test('every family read agrees with the ledger after a keyed mark', () => {
		const { readMarks } = layer()
		readMarks.markOrdersSeen(10)
		readMarks.markPurchasesSeen(11)
		readMarks.markBidUpdatesSeen(12)
		readMarks.markConversationSeen('alice', 13)
		readMarks.markAuctionCommentsSeen('auction-a', 14)
		readMarks.markAuctionEventCommentsSeen('auction-a', 15)
		readMarks.markProductCommentsSeen('product-a', 16)
		readMarks.markAuctionLiveSeen('auction-a', 17)
		readMarks.markAuctionSettlementBeginsSeen('auction-a', 18)
		expect(readMarks.getLastSeenOrders()).toBe(10)
		expect(readMarks.getLastSeenPurchases()).toBe(11)
		expect(readMarks.getLastSeenBidUpdates()).toBe(12)
		expect(readMarks.getLastSeenForConversation('alice')).toBe(13)
		expect(readMarks.getLastSeenAuctionComments('auction-a')).toBe(14)
		expect(readMarks.getLastSeenAuctionEventComments('auction-a')).toBe(15)
		expect(readMarks.getLastSeenProductComments('product-a')).toBe(16)
		expect(readMarks.getLastSeenAuctionLive('auction-a')).toBe(17)
		expect(readMarks.getLastSeenAuctionSettlementBegins('auction-a')).toBe(18)
	})
})

describe('readMarks — persistence and ordering', () => {
	test('a mark written through the port is restored by a fresh layer', async () => {
		// The port has no enumeration of its own, so the fresh layer discovers streams through the same
		// synchronous storage scan the app uses in the browser. A Map-backed port exposes its keys here.
		const marks = new Map<string, number>()
		const port: ReadMarkPort = {
			get: async (stream) => marks.get(stream) ?? null,
			set: async (stream, at) => {
				const current = marks.get(stream)
				if (current !== undefined && at <= current) return
				marks.set(stream, at)
			},
		}
		const storageView = {
			syncListStreams: () => [...marks.keys()],
			syncRead: (stream: string) => marks.get(stream) ?? null,
		}
		const first = layer({ port, ...storageView })
		first.readMarks.markAuctionBidsSeen('auction-a', 4242)
		await first.readMarks.whenHydrated()
		await first.readMarks.whenPersisted()

		const second = layer({ port, ...storageView })
		await second.readMarks.hydrate()
		expect(second.readMarks.getLastSeenAuctionBids('auction-a')).toBe(4242)
		expect(second.readMarks.getLastSeenAuctionBids()).toBe(0)
	})

	test('the port is monotonic: a lower write is ignored, in memory and on disk', async () => {
		const port = createMemoryReadMarkPort()
		const { readMarks } = layer({ port })
		readMarks.markOrdersSeen(900)
		readMarks.markOrdersSeen(100)
		await readMarks.whenHydrated()
		expect(readMarks.getLastSeenOrders()).toBe(900)
		expect(await port.get(readMarkFamilies.orders)).toBe(900)
	})

	test('writes are serialised per stream: the final stored mark is the highest', async () => {
		const port = recordingPort()
		const { readMarks } = layer({ port })
		readMarks.markOrdersSeen(100)
		readMarks.markOrdersSeen(200)
		readMarks.markOrdersSeen(150)
		await readMarks.whenHydrated()
		await readMarks.whenPersisted()
		expect(await port.get(readMarkFamilies.orders)).toBe(200)
	})

	test('a port rejection leaves the in-memory mark applied and never escapes', async () => {
		const port = recordingPort()
		port.failWith = new Error('quota exceeded')
		const { readMarks } = layer({ port })
		expect(() => readMarks.markOrdersSeen(77)).not.toThrow()
		expect(readMarks.getLastSeenOrders()).toBe(77)
	})
})

describe('readMarks — seeding from the legacy blob', () => {
	test('expandLegacyMarks maps the legacy families onto the mechanism scopes', () => {
		const marks = expandLegacyMarks({
			orders: 1,
			purchases: 2,
			auctionBids: 3,
			auctionBidsByAuction: { 'auction-a': 4 },
			auctionComments: 5,
			auctionCommentsByAuction: { 'auction-a': 6 },
			auctionEventComments: 7,
			auctionEventCommentsByAuction: { 'auction-a': 8 },
			productComments: 9,
			productCommentsByProduct: { 'product-a': 10 },
			auctionLive: 11,
			auctionLiveByAuction: { 'auction-a': 12 },
			auctionSettlementBegins: 13,
			auctionSettlementBeginsByAuction: { 'auction-a': 14 },
			bidUpdates: 15,
			messages: { alice: 16 },
		})
		expect(marks.get(readMarkFamilies.orders)).toBe(1)
		expect(marks.get(readMarkFamilies.purchases)).toBe(2)
		expect(marks.get(readMarkFamilies.auctionBids)).toBe(3)
		expect(marks.get(notificationScopes.auctionBids('auction-a'))).toBe(4)
		expect(marks.get(readMarkFamilies.auctionComments)).toBe(5)
		expect(marks.get(notificationScopes.auctionComments('auction-a'))).toBe(6)
		expect(marks.get(readMarkFamilies.auctionThreadComments)).toBe(7)
		expect(marks.get(notificationScopes.auctionThreadComments('auction-a'))).toBe(8)
		expect(marks.get(readMarkFamilies.productComments)).toBe(9)
		expect(marks.get(notificationScopes.productComments('product-a'))).toBe(10)
		expect(marks.get(readMarkFamilies.auctionLive)).toBe(11)
		expect(marks.get(notificationScopes.auctionLive('auction-a'))).toBe(12)
		expect(marks.get(readMarkFamilies.auctionSettlement)).toBe(13)
		expect(marks.get(notificationScopes.auctionSettlement('auction-a'))).toBe(14)
		expect(marks.get(readMarkFamilies.bidUpdates)).toBe(15)
		expect(marks.get(notificationScopes.messages('alice'))).toBe(16)
	})

	test('a corrupt legacy blob degrades to no marks rather than throwing', () => {
		const { readMarks } = layer({ legacyRead: () => 'not json' })
		expect(readMarks.getLastSeenOrders()).toBe(0)
	})

	test('the legacy blob seeds a read on the very first synchronous read, before hydration resolves', () => {
		const { readMarks } = layer({
			legacyRead: () => JSON.stringify({ lastSeenTimestamps: { orders: 42, auctionBidsByAuction: { 'auction-a': 43 } } }),
		})
		expect(readMarks.getLastSeenOrders()).toBe(42)
		expect(readMarks.getLastSeenAuctionBids('auction-a')).toBe(43)
	})

	test('seeding a mark does NOT clear an unseen count (hydration is not a user action)', () => {
		const { instance, readMarks } = layer({
			legacyRead: () => JSON.stringify({ lastSeenTimestamps: { orders: 42 } }),
		})
		instance.ledger.increment(notificationScopes.orders)
		expect(instance.snapshot().ledger.counts[notificationScopes.orders] ?? 0).toBe(1)
		expect(readMarks.getLastSeenOrders()).toBe(42)
	})

	test('hydration heals a port that is behind the legacy blob, monotonically', async () => {
		const port = createMemoryReadMarkPort()
		await port.set(readMarkFamilies.orders, 10)
		const { readMarks } = layer({
			port,
			legacyRead: () => JSON.stringify({ lastSeenTimestamps: { orders: 50 } }),
		})
		await readMarks.hydrate()
		expect(readMarks.getLastSeenOrders()).toBe(50)
		expect(await port.get(readMarkFamilies.orders)).toBe(50)
	})

	test('hydration does not lower a port mark above the legacy blob', async () => {
		const port = createMemoryReadMarkPort()
		await port.set(readMarkFamilies.orders, 90)
		const { readMarks } = layer({
			port,
			legacyRead: () => JSON.stringify({ lastSeenTimestamps: { orders: 50 } }),
		})
		await readMarks.hydrate()
		expect(readMarks.getLastSeenOrders()).toBe(90)
		expect(await port.get(readMarkFamilies.orders)).toBe(90)
	})
})
