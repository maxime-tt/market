import { afterEach, describe, expect, test } from 'bun:test'
import { createNotification } from '@sdk/core'
import type { Notification } from '@sdk/core'
import { createAppNotifications, NOTIFICATIONS_STORAGE_KEY } from './instance'
import type { AppNotificationPayload, AppNotificationType } from './types'

/** A minimal `Storage` backed by a Map — the same shape `localStorageKeyValue.test.ts` uses. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
	const entries = new Map<string, string>(Object.entries(initial))
	return {
		get length() {
			return entries.size
		},
		clear: () => entries.clear(),
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => {
			entries.delete(key)
		},
		setItem: (key, value) => {
			entries.set(key, value)
		},
	}
}

const original = globalThis.localStorage

afterEach(() => {
	if (original === undefined) {
		;(globalThis as { localStorage?: Storage }).localStorage = undefined
	} else {
		;(globalThis as { localStorage?: Storage }).localStorage = original
	}
})

const notice = (overrides: Partial<Notification<AppNotificationType, AppNotificationPayload>> = {}) =>
	createNotification<AppNotificationType, AppNotificationPayload>({
		id: 'n1',
		type: 'order',
		payload: {},
		scope: 'orders',
		createdAt: 100,
		...overrides,
	})

describe('the app instance — persistence through the localStorage port', () => {
	test('a queue entry and a ledger count round-trip under the legacy key', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage()
		const a = createAppNotifications({ now: () => 100 })
		a.queue.enqueue(notice({ id: 'a', type: 'message', scope: 'messages:alice', payload: { pubkey: 'alice' } }))
		a.ledger.increment('messages:alice', 2)
		a.ledger.markSeen('orders', 100)
		await a.persist()

		const b = createAppNotifications()
		await b.restore()
		expect(b.queue.active().map((x) => x.id)).toEqual(['a'])
		expect(b.ledger.unseenCount('messages:alice')).toBe(2)
		expect(b.ledger.lastSeen('orders')).toBe(100)
	})

	test('writes under the legacy storage key', async () => {
		const storage = fakeStorage()
		;(globalThis as { localStorage?: Storage }).localStorage = storage
		const a = createAppNotifications({ now: () => 100 })
		a.ledger.increment('orders')
		await a.persist()
		expect(storage.getItem(NOTIFICATIONS_STORAGE_KEY)).not.toBeNull()
	})

	test('a legacy payload under the key is ignored, not mis-read', async () => {
		const legacy = JSON.stringify({ lastSeenTimestamps: { orders: 42 } })
		;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage({ [NOTIFICATIONS_STORAGE_KEY]: legacy })
		const a = createAppNotifications()
		await a.restore()
		expect(a.queue.active()).toEqual([])
		expect(a.ledger.totalUnseen()).toBe(0)
		expect(a.ledger.lastSeen('orders')).toBe(0)
	})

	test('a corrupt payload under the key is ignored', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage({ [NOTIFICATIONS_STORAGE_KEY]: '{not json' })
		const a = createAppNotifications()
		await a.restore()
		expect(a.queue.active()).toEqual([])
	})

	test('with no localStorage, persist and restore are no-ops that never throw', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = undefined
		const a = createAppNotifications()
		a.ledger.increment('orders')
		await expect(a.persist()).resolves.toBeUndefined()
		await expect(a.restore()).resolves.toBeUndefined()
		expect(a.ledger.unseenCount('orders')).toBe(1)
	})
})

describe('the app instance — ledger scoping', () => {
	test('marking one scope seen leaves another scope intact', () => {
		const a = createAppNotifications({ now: () => 500 })
		a.ledger.increment('auction-bids:auction-a', 3)
		a.ledger.increment('auction-bids:auction-b', 2)
		a.ledger.markSeen('auction-bids:auction-a')

		expect(a.ledger.unseenCount('auction-bids:auction-a')).toBe(0)
		expect(a.ledger.unseenCount('auction-bids:auction-b')).toBe(2)
		expect(a.ledger.totalUnseen()).toBe(2)
		expect(a.ledger.lastSeen('auction-bids:auction-a')).toBe(500)
	})

	test('two instances do not share state', () => {
		const a = createAppNotifications()
		const b = createAppNotifications()
		a.ledger.increment('orders')
		expect(b.ledger.unseenCount('orders')).toBe(0)
	})
})
