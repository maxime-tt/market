import { describe, expect, test } from 'bun:test'
import { navFits } from './use-nav-fit'

describe('navFits', () => {
	test('reckless at 1440px: the public wordmark fits, the dashboard one does not', () => {
		expect(navFits(451, 178, 20, 247)).toBe(true)
		expect(navFits(451, 211, 20, 247)).toBe(false)
	})
	test('an exact fit counts as fitting', () => {
		expect(navFits(400, 200, 20, 180)).toBe(true)
	})
	test('an unmeasured or empty list always fits', () => {
		expect(navFits(100, 300, 20, 0)).toBe(true)
	})
})
