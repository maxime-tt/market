import { describe, expect, test } from 'bun:test'
import { zapDialogVisibility } from './ZapButtonHost'

describe('zapDialogVisibility', () => {
	test('opening keeps the zapping flag and opens the dialog', () => {
		expect(zapDialogVisibility(true, true)).toEqual({ isZapping: true, dialogOpen: true })
	})
	test('closing clears the zapping flag and closes the dialog', () => {
		expect(zapDialogVisibility(false, true)).toEqual({ isZapping: false, dialogOpen: false })
	})
	test('reopening an already-idle button leaves the flag idle', () => {
		expect(zapDialogVisibility(true, false)).toEqual({ isZapping: false, dialogOpen: true })
	})
})
