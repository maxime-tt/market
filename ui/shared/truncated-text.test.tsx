import { describe, expect, test } from 'bun:test'
import { truncateMiddle } from './truncated-text'

/**
 * The unit suite has no DOM renderer, so the truncation helper is tested
 * directly; `TruncatedText` is the thin binding around it.
 */

const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

describe('truncateMiddle', () => {
	test('keeps the head and tail around a single ellipsis', () => {
		expect(truncateMiddle('abcdefghijklmnop', 4, 3)).toBe('abcd…nop')
	})

	test('leaves a string that already fits unchanged', () => {
		expect(truncateMiddle('short', 8, 6)).toBe('short')
		expect(truncateMiddle('abcdefg', 3, 3)).toBe('abcdefg')
	})

	test('truncates a realistic npub to its identifying head and tail', () => {
		const result = truncateMiddle(NPUB, 8, 6)
		expect(result.startsWith('npub1qqq')).toBe(true)
		expect(result.endsWith(NPUB.slice(-6))).toBe(true)
		expect(result.length).toBeLessThan(NPUB.length)
		expect(result).toContain('…')
	})

	test('is identity-safe for empty and short input', () => {
		expect(truncateMiddle('')).toBe('')
	})

	test('never truncates when a bound is negative', () => {
		expect(truncateMiddle('abcdefghijklmnop', -1, 3)).toBe('abcdefghijklmnop')
		expect(truncateMiddle('abcdefghijklmnop', 3, -1)).toBe('abcdefghijklmnop')
	})

	test('truncates head-only when end is zero', () => {
		// `slice(-0)` would return the whole string, so this case is explicit.
		expect(truncateMiddle('abcdefghijklmnop', 4, 0)).toBe('abcd…')
		expect(truncateMiddle('abc', 4, 0)).toBe('abc')
	})

	test('honours a multi-character separator, including a trailing space', () => {
		expect(truncateMiddle('abcdefghijklmnop', 4, 3, '... ')).toBe('abcd... nop')
	})
})
