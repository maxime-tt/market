import { describe, expect, test } from 'bun:test'
import { createNotification } from '@sdk/core'
import { createAppNotifications } from './instance'
import { createNotificationsBinding } from './binding'
import type { AppNotificationPayload, AppNotificationType } from './types'

const notice = (id: string) =>
	createNotification<AppNotificationType, AppNotificationPayload>({
		id,
		type: 'order',
		payload: {},
		scope: 'orders',
		createdAt: 1,
	})

describe('createNotificationsBinding — mirroring the instance into a reactive store', () => {
	test('the store starts at the instance snapshot', () => {
		const instance = createAppNotifications()
		instance.ledger.increment('orders')
		const binding = createNotificationsBinding(instance)
		// The snapshot's `ledger` is durable data (a LedgerSnapshot), not the ledger's API.
		expect(binding.snapshot().ledger.counts.orders).toBe(1)
		binding.dispose()
	})

	test('the store mirrors every change and stops after dispose', () => {
		const instance = createAppNotifications()
		const binding = createNotificationsBinding(instance)
		const seen: number[] = []
		const subscription = binding.store.subscribe((snapshot) => seen.push(snapshot.active.length))

		instance.queue.enqueue(notice('a'))
		instance.ledger.increment('orders') // a second change

		binding.dispose()
		instance.queue.enqueue(notice('b')) // must not reach the store

		subscription.unsubscribe()
		expect(seen).toEqual([1, 1])
		expect(binding.snapshot().active.map((x) => x.id)).toEqual(['a'])
	})

	test('the store state is referentially stable until a change', () => {
		const instance = createAppNotifications()
		const binding = createNotificationsBinding(instance)
		const before = binding.snapshot()
		expect(binding.snapshot()).toBe(before)
		instance.queue.enqueue(notice('a'))
		expect(binding.snapshot()).not.toBe(before)
		binding.dispose()
	})

	test('dispose is idempotent-safe: a second dispose does not throw', () => {
		const instance = createAppNotifications()
		const binding = createNotificationsBinding(instance)
		binding.dispose()
		expect(() => binding.dispose()).not.toThrow()
	})

	test('the binding exposes the instance for imperative writes', () => {
		const instance = createAppNotifications()
		const binding = createNotificationsBinding(instance)
		binding.notifications.ledger.increment('orders', 2)
		expect(binding.snapshot().ledger.counts.orders).toBe(2)
		binding.dispose()
	})
})
