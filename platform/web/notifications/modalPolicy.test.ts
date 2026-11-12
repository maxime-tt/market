import { describe, expect, test } from 'bun:test'
import { MODAL_NOTIFICATION_TYPES, NOTIFICATION_PRESENTATION, isPassive, opensModal } from './modalPolicy'
import type { AppNotificationType } from './types'

// The full union, restated here so the test fails if a type is added to types.ts without a presentation.
const ALL_TYPES: AppNotificationType[] = [
	'order',
	'message',
	'order-update',
	'auction-bid',
	'auction-comment',
	'auction-thread-comment',
	'product-comment',
	'auction-live',
	'auction-settlement',
	'bid-update',
	'auction-won',
]

describe('the modal policy', () => {
	test('every type has a presentation', () => {
		for (const type of ALL_TYPES) {
			expect(['modal', 'passive']).toContain(NOTIFICATION_PRESENTATION[type])
		}
		expect(Object.keys(NOTIFICATION_PRESENTATION).sort()).toEqual([...ALL_TYPES].sort())
	})

	test('auction-won is the only type that opens a modal', () => {
		expect(MODAL_NOTIFICATION_TYPES).toEqual(['auction-won'])
		expect(opensModal('auction-won')).toBe(true)
		expect(isPassive('auction-won')).toBe(false)
	})

	test('every other type is a passive counter', () => {
		for (const type of ALL_TYPES) {
			if (type === 'auction-won') continue
			expect(isPassive(type)).toBe(true)
			expect(opensModal(type)).toBe(false)
		}
	})
})
