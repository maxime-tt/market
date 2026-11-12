import { describe, expect, test } from 'bun:test'
import { createMemoryStorage, createNotification, createNotifications, restoreNotifications, serializeNotifications } from './index'
import type { Notification, PersistedNotifications } from './index'

type NoticeType = 'order' | 'message'
interface NoticePayload {
	orderId?: string
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

describe('persistence — serialise and restore', () => {
	test('round-trips the queue and the ledger through a storage port', async () => {
		const storage = createMemoryStorage()
		const a = createNotifications<NoticeType, NoticePayload>({ storage, storageKey: 'notifications' })
		a.queue.enqueue(notice({ id: 'n1' }))
		a.queue.enqueue(notice({ id: 'n2', type: 'message', scope: 'conv:1' }))
		a.ledger.increment('conv:1', 2)
		a.ledger.markSeen('conv:2', 250)
		await a.persist()

		const b = createNotifications<NoticeType, NoticePayload>({ storage, storageKey: 'notifications' })
		await b.restore()

		expect(b.queue.active().map((x) => x.id)).toEqual(['n1', 'n2'])
		expect(b.queue.active()[1].type).toBe('message')
		expect(b.ledger.unseenCount('conv:1')).toBe(2)
		expect(b.ledger.lastSeen('conv:2')).toBe(250)
	})

	test('restore with no port is a no-op', async () => {
		const n = createNotifications<NoticeType, NoticePayload>()
		n.queue.enqueue(notice({ id: 'n1' }))
		await n.restore()
		expect(n.queue.active().map((x) => x.id)).toEqual(['n1'])
	})

	test('restore ignores an absent or corrupt payload, keeping in-memory state', async () => {
		const storage = createMemoryStorage()
		await storage.set('k', 'not json at all')
		const n = createNotifications<NoticeType, NoticePayload>({ storage, storageKey: 'k' })
		n.queue.enqueue(notice({ id: 'n1' }))
		await n.restore()
		expect(n.queue.active().map((x) => x.id)).toEqual(['n1'])
	})

	test('serializeNotifications / restoreNotifications round-trip a state directly', () => {
		const state: PersistedNotifications<NoticeType, NoticePayload> = {
			active: [notice({ id: 'n1' })],
			globalLastSeen: 10,
			counts: { 'conv:1': 3 },
			lastSeenByScope: { 'conv:2': 5 },
		}
		const restored = restoreNotifications<NoticeType, NoticePayload>(serializeNotifications(state))
		expect(restored).toEqual(state)
		expect(restoreNotifications(null)).toBeNull()
		expect(restoreNotifications('{"active": "no"}')).toBeNull()
	})
})
