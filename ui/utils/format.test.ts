import { describe, expect, test } from 'bun:test'
import { formatSats, formatSatsWithUnit } from './format'

describe('formatSats', () => {
	test('rounds to the nearest integer', () => {
		expect(formatSats(1234.4)).toBe('1,234')
		expect(formatSats(1234.5)).toBe('1,235')
		expect(formatSats(1234.56)).toBe('1,235')
		expect(formatSats(-1234.56)).toBe('-1,235')
	})

	test('groups thousands with a comma', () => {
		expect(formatSats(0)).toBe('0')
		expect(formatSats(999)).toBe('999')
		expect(formatSats(1000)).toBe('1,000')
		expect(formatSats(1_000_000)).toBe('1,000,000')
	})

	test('preserves the existing non-finite behaviour', () => {
		expect(formatSats(Number.NaN)).toBe('NaN')
		expect(formatSats(Number.POSITIVE_INFINITY)).toBe('∞')
		expect(formatSats(Number.NEGATIVE_INFINITY)).toBe('-∞')
	})
})

describe('formatSatsWithUnit', () => {
	test('appends the unit to the canonical number', () => {
		expect(formatSatsWithUnit(1234.5)).toBe('1,235 sats')
		expect(formatSatsWithUnit(0)).toBe('0 sats')
	})

	test('delegates the number to formatSats', () => {
		for (const value of [0, 1, 999, 1000, 1_234_567, Number.NaN]) {
			expect(formatSatsWithUnit(value)).toBe(`${formatSats(value)} sats`)
		}
	})
})
