import { describe, expect, test } from 'bun:test'
import { createNotification, createNotifications, deriveFromRules, NotificationsError } from './index'
import type { Notification, NotificationRule } from './index'

/**
 * The host's own policy, declared here and never in core: a fixed type union and a payload shape. The core
 * takes them as generics and knows nothing of them.
 */
type NoticeType = 'order' | 'message' | 'order-update'
interface NoticePayload {
	orderId?: string
	conversation?: string
}

const notice = (overrides: Partial<Notification<NoticeType, NoticePayload>> = {}): Notification<NoticeType, NoticePayload> =>
	createNotification<NoticeType, NoticePayload>({
		id: 'n1',
		type: 'order',
		payload: { orderId: 'o1' },
		scope: 'orders',
		createdAt: 1000,
		...overrides,
	})

describe('createNotifications — the active queue', () => {
	test('enqueue de-duplicates by id', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		expect(n.queue.enqueue(notice({ id: 'a' }))).toBe(true)
		expect(n.queue.enqueue(notice({ id: 'a', type: 'message' }))).toBe(false)
		expect(n.queue.enqueue(notice({ id: 'b' }))).toBe(true)
		expect(n.queue.active().map((x) => x.id)).toEqual(['a', 'b'])
	})

	test('enqueue stores a copy of the record, so later mutation of the input record does not leak in', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		const input = notice({ id: 'a' })
		n.queue.enqueue(input)
		;(input as { read: boolean }).read = true
		expect(n.queue.active()[0].read).toBe(false)
	})

	test('dismissActive removes and returns the head, then undefined when empty', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a' }))
		n.queue.enqueue(notice({ id: 'b' }))
		expect(n.queue.dismissActive()?.id).toBe('a')
		expect(n.queue.active().map((x) => x.id)).toEqual(['b'])
		expect(n.queue.dismissActive()?.id).toBe('b')
		expect(n.queue.dismissActive()).toBeUndefined()
	})

	test('remove drops every match and reports how many', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a', scope: 'conv:1' }))
		n.queue.enqueue(notice({ id: 'b', scope: 'conv:2' }))
		n.queue.enqueue(notice({ id: 'c', scope: 'conv:1' }))
		expect(n.queue.remove((x) => x.scope === 'conv:1')).toBe(2)
		expect(n.queue.active().map((x) => x.id)).toEqual(['b'])
		expect(n.queue.remove((x) => x.scope === 'conv:9')).toBe(0)
	})

	test('retain keeps only matches and reports how many were dropped', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a', type: 'order' }))
		n.queue.enqueue(notice({ id: 'b', type: 'message' }))
		n.queue.enqueue(notice({ id: 'c', type: 'message' }))
		expect(n.queue.retain((x) => x.type === 'message')).toBe(1)
		expect(n.queue.active().map((x) => x.id)).toEqual(['b', 'c'])
	})

	test('clear empties the queue', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a' }))
		n.queue.enqueue(notice({ id: 'b' }))
		n.queue.clear()
		expect(n.queue.active()).toEqual([])
	})

	test('markRead flips only the named record', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a' }))
		n.queue.enqueue(notice({ id: 'b' }))
		expect(n.queue.markRead('a')).toBe(true)
		expect(n.queue.markRead('missing')).toBe(false)
		expect(n.queue.active().map((x) => x.read)).toEqual([true, false])
	})
})

describe('createNotifications — the passive ledger', () => {
	test('marking one scope seen leaves every other scope intact', () => {
		const n = createNotifications<NoticeType, NoticePayload>({ now: () => 5000 })
		n.ledger.increment('conv:1')
		n.ledger.increment('conv:1')
		n.ledger.increment('conv:2', 3)
		expect(n.ledger.unseenCount('conv:1')).toBe(2)
		expect(n.ledger.unseenCount('conv:2')).toBe(3)
		expect(n.ledger.totalUnseen()).toBe(5)

		n.ledger.markSeen('conv:1')
		expect(n.ledger.unseenCount('conv:1')).toBe(0)
		expect(n.ledger.unseenCount('conv:2')).toBe(3)
		expect(n.ledger.totalUnseen()).toBe(3)
		expect(n.ledger.lastSeen('conv:1')).toBe(5000)
		expect(n.ledger.lastSeen('conv:2')).toBe(0)
	})

	test('increment ignores a non-positive amount', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.ledger.increment('conv:1', 0)
		n.ledger.increment('conv:1', -4)
		expect(n.ledger.unseenCount('conv:1')).toBe(0)
	})

	test('markAllSeen clears every count and advances the global floor', () => {
		const n = createNotifications<NoticeType, NoticePayload>({ now: () => 7000 })
		n.ledger.increment('conv:1')
		n.ledger.increment('conv:2')
		n.ledger.markSeen('conv:2', 100)
		n.ledger.markAllSeen()
		expect(n.ledger.totalUnseen()).toBe(0)
		expect(n.ledger.lastSeen('conv:1')).toBe(7000)
		// the per-scope mark survives, but the global floor is higher, so lastSeen is the max
		expect(n.ledger.lastSeen('conv:2')).toBe(7000)
	})

	test('scopes lists every scope that carries a count or a mark', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.ledger.increment('conv:1')
		n.ledger.markSeen('conv:2', 1)
		expect([...n.ledger.scopes()].sort()).toEqual(['conv:1', 'conv:2'])
	})
})

describe('createNotifications — subscription', () => {
	test('subscribers fire on every change and stop after unsubscribe', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		const seen: number[] = []
		const unsubscribe = n.subscribe((snapshot) => seen.push(snapshot.active.length))

		n.queue.enqueue(notice({ id: 'a' }))
		n.ledger.increment('conv:1')
		n.queue.enqueue(notice({ id: 'a' })) // duplicate: no change, no fire
		unsubscribe()
		n.queue.enqueue(notice({ id: 'b' }))

		expect(seen).toEqual([1, 1])
	})

	test('a snapshot is a copy, so a subscriber cannot mutate the queue through it', () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a' }))
		const snapshot = n.snapshot()
		expect(Object.isFrozen(snapshot.active)).toBe(false)
		;(snapshot.active as Notification<NoticeType, NoticePayload>[]).push(notice({ id: 'b' }))
		expect(n.queue.active().map((x) => x.id)).toEqual(['a'])
	})
})

describe('createNotifications — configuration and in-memory default', () => {
	test('works with no storage port, keeping everything in memory', async () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'a' }))
		n.ledger.increment('conv:1')
		await n.persist() // a no-op, and must not throw
		await n.restore() // likewise
		expect(n.queue.active().map((x) => x.id)).toEqual(['a'])
		expect(n.ledger.unseenCount('conv:1')).toBe(1)
	})

	test('refuses a storage port with no key, fail-closed', () => {
		const storage = { get: async () => null, set: async () => {}, remove: async () => {} }
		expect(() => createNotifications<NoticeType, NoticePayload>({ storage })).toThrow(NotificationsError)
	})
})

describe('the rule seam', () => {
	test('deriveFromRules runs every rule over the input, in order', () => {
		interface BidInput {
			auctionId: string
			amount: number
		}
		const sellerRule: NotificationRule<BidInput, NoticeType, NoticePayload> = {
			id: 'seller-bid',
			derive: (input) => [notice({ id: `seller:${input.auctionId}`, type: 'order-update' })],
		}
		const noopRule: NotificationRule<BidInput, NoticeType, NoticePayload> = { id: 'noop', derive: () => [] }

		const derived = deriveFromRules([sellerRule, noopRule], { auctionId: 'x', amount: 10 })
		expect(derived.map((x) => x.id)).toEqual(['seller:x'])
	})
})
