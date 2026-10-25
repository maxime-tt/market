import { describe, expect, test } from 'bun:test'
import type { KeyValueStoragePort } from '@sdk/core'
import { createAppNotifications } from './instance'
import { applyAppNotification, applyAppNotificationEvent, deriveAppNotifications, reconcileAppNotificationCounts } from './producers'

/** An in-memory port so the producer seam can be exercised without a DOM. */
function memoryPort(): KeyValueStoragePort {
	const map = new Map<string, string>()
	return {
		get: async (key) => (map.has(key) ? (map.get(key) as string) : null),
		set: async (key, value) => {
			map.set(key, value)
		},
		remove: async (key) => {
			map.delete(key)
		},
	}
}

const instance = () => createAppNotifications({ storage: memoryPort(), now: () => 1000 })

describe('the producer seam — derive and apply', () => {
	test('deriveAppNotifications returns the notification(s) the rules produce for an event', () => {
		const derived = deriveAppNotifications({ kind: 'order', createdAt: 5 })
		expect(derived).toHaveLength(1)
		expect(derived[0]).toMatchObject({ type: 'order', scope: 'orders', createdAt: 5 })
	})

	test('a passive event raises its ledger scope by one', () => {
		const notifications = instance()
		const derived = applyAppNotificationEvent(notifications, { kind: 'message', createdAt: 6, pubkey: 'alice' })
		expect(derived).toHaveLength(1)
		expect(notifications.ledger.unseenCount('messages:alice')).toBe(1)
		expect(notifications.snapshot().active).toHaveLength(0)
	})

	test('an auction win goes to the queue, not the ledger', () => {
		const notifications = instance()
		const event = {
			kind: 'auction-won',
			createdAt: 7,
			bidderPubkey: 'me',
			auctionRootEventId: 'root-1',
			bidEventId: 'bid-1',
			bidAmount: 42,
		} as const
		applyAppNotificationEvent(notifications, event)
		expect(notifications.queue.active().map((n) => n.id)).toEqual(['auction-won:root-1:me'])
		expect(notifications.ledger.totalUnseen()).toBe(0)
	})

	test('applyAppNotification routes by type, and a second identical win is de-duplicated', () => {
		const notifications = instance()
		const win = deriveAppNotifications({
			kind: 'auction-won',
			createdAt: 7,
			bidderPubkey: 'me',
			auctionRootEventId: 'root-1',
			bidEventId: 'bid-1',
			bidAmount: 42,
		})[0]
		applyAppNotification(notifications, win)
		applyAppNotification(notifications, win)
		expect(notifications.queue.active()).toHaveLength(1)
	})

	test('a non-matching kind derives nothing', () => {
		// @ts-expect-error — an unknown kind is a caller error; the rules simply derive nothing.
		expect(deriveAppNotifications({ kind: 'unknown', createdAt: 1 })).toEqual([])
	})
})

describe('the bulk reconciliation — an overwrite, not an accumulation', () => {
	test('overwrites the derived counts so a re-sync does not double them', () => {
		const notifications = instance()
		const events = [
			{ kind: 'order', createdAt: 1 } as const,
			{ kind: 'message', createdAt: 2, pubkey: 'alice' } as const,
			{ kind: 'message', createdAt: 3, pubkey: 'alice' } as const,
		]
		reconcileAppNotificationCounts(notifications, events)
		expect(notifications.ledger.unseenCount('orders')).toBe(1)
		expect(notifications.ledger.unseenCount('messages:alice')).toBe(2)

		// a second init over the same fetched set must leave the same counts, not 2 and 4
		reconcileAppNotificationCounts(notifications, events)
		expect(notifications.ledger.unseenCount('orders')).toBe(1)
		expect(notifications.ledger.unseenCount('messages:alice')).toBe(2)
	})

	test('a scope absent from the second sync drops to zero', () => {
		const notifications = instance()
		reconcileAppNotificationCounts(notifications, [{ kind: 'message', createdAt: 1, pubkey: 'alice' }])
		expect(notifications.ledger.unseenCount('messages:alice')).toBe(1)

		reconcileAppNotificationCounts(notifications, [{ kind: 'message', createdAt: 5, pubkey: 'bob' }])
		expect(notifications.ledger.unseenCount('messages:alice')).toBe(0)
		expect(notifications.ledger.unseenCount('messages:bob')).toBe(1)
	})

	test('the active auction-win never enters the ledger', () => {
		const notifications = instance()
		reconcileAppNotificationCounts(notifications, [
			{
				kind: 'auction-won',
				createdAt: 1,
				bidderPubkey: 'me',
				auctionRootEventId: 'root-1',
				bidEventId: 'bid-1',
				bidAmount: 9,
			},
		])
		expect(notifications.ledger.totalUnseen()).toBe(0)
		expect(notifications.queue.active()).toHaveLength(0)
	})

	test('the product-comment aggregate matches the legacy global counter', () => {
		// three comments, two products — the legacy global said 3, the per-product grain is 2 and 1
		const notifications = instance()
		reconcileAppNotificationCounts(notifications, [
			{ kind: 'product-comment', createdAt: 1, productKey: 'p1' },
			{ kind: 'product-comment', createdAt: 2, productKey: 'p1' },
			{ kind: 'product-comment', createdAt: 3, productKey: 'p2' },
		])
		expect(notifications.ledger.unseenCount('product-comments:p1')).toBe(2)
		expect(notifications.ledger.unseenCount('product-comments:p2')).toBe(1)
		expect(notifications.ledger.totalUnseen()).toBe(3)
	})
})
