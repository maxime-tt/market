import { describe, expect, test } from 'bun:test'
import { pad2, parseDatetimeLocalSeconds, toDatetimeLocal } from './datetime'

/**
 * `parseDatetimeLocalSeconds` / `toDatetimeLocal` are the `datetime-local`
 * string helpers lifted out of the `auction-editor` monolith in T6.3 S1.
 *
 * They were previously exercised only indirectly: the retired
 * `ui/components/auction-editor/AuctionEditorTabs.test.tsx` shim owned the one
 * round-trip assertion, and `ui/shared/datetime-picker.test.tsx` covers the
 * picker component, never the helpers. S6 retires the shim, so this suite ports
 * that round-trip (`utils` is a leaf layer, so the spec sits beside the module,
 * matching `ui/utils/format.test.ts`).
 */
describe('datetime-local helpers', () => {
	test('round-trips a Date through toDatetimeLocal and back to unix seconds', () => {
		const date = new Date(2026, 0, 2, 3, 4, 5)
		expect(parseDatetimeLocalSeconds(toDatetimeLocal(date))).toBe(Math.floor(date.getTime() / 1000))
	})

	test('zero-pads every component to its fixed width', () => {
		expect(pad2(3)).toBe('03')
		expect(pad2(12)).toBe('12')
		expect(toDatetimeLocal(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05')
	})

	test('parses an empty value to null', () => {
		expect(parseDatetimeLocalSeconds('')).toBeNull()
	})

	test('parses an unparseable value to null', () => {
		expect(parseDatetimeLocalSeconds('not-a-date')).toBeNull()
	})

	test('parses a valid datetime-local string to floor(unix seconds)', () => {
		const value = '2026-10-24T15:30'
		expect(parseDatetimeLocalSeconds(value)).toBe(Math.floor(new Date(value).getTime() / 1000))
	})
})
