import { describe, expect, test } from 'bun:test'
import { isPriceDisplayLoading } from './PriceDisplayHost'

describe('isPriceDisplayLoading', () => {
	test('is loading while the rate query is loading', () => {
		expect(isPriceDisplayLoading('USD', true, false)).toBe(true)
	})
	test('ignores the sats lane for bitcoin-denominated prices', () => {
		expect(isPriceDisplayLoading('SATS', false, true)).toBe(false)
		expect(isPriceDisplayLoading('BTC', false, true)).toBe(false)
	})
	test('counts the sats lane for fiat prices', () => {
		expect(isPriceDisplayLoading('USD', false, true)).toBe(true)
	})
})
