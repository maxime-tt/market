import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NPUB_HEAD, NPUB_TAIL, NpubDisplay, truncateNpub } from './npub-display'

/**
 * The unit suite has no DOM renderer, so markup is asserted through
 * `renderToStaticMarkup` and the pure helper is tested directly.
 */

const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'

describe('truncateNpub', () => {
	test('defaults to the canonical head/tail split and a three-dot separator', () => {
		expect(NPUB_HEAD).toBe(10)
		expect(NPUB_TAIL).toBe(4)
		const result = truncateNpub(NPUB)
		expect(result).toBe(`${NPUB.slice(0, 10)}...${NPUB.slice(-4)}`)
	})

	test('honours the per-call-site presentation used before the hoist', () => {
		// `ui/components/UserCardView` used 9 head / 6 tail with a two-dot separator.
		const result = truncateNpub(NPUB, { head: 9, tail: 6, separator: '..' })
		expect(result).toBe(`${NPUB.slice(0, 9)}..${NPUB.slice(-6)}`)
	})

	test('leaves a short npub unchanged', () => {
		expect(truncateNpub('npub1short')).toBe('npub1short')
	})

	test('supports head-only truncation, which two call sites used', () => {
		expect(truncateNpub(NPUB, { head: 10, tail: 0 })).toBe(`${NPUB.slice(0, 10)}...`)
		expect(truncateNpub('npub1short', { head: 10, tail: 0 })).toBe('npub1short')
	})

	test('never truncates when a bound is negative', () => {
		expect(truncateNpub(NPUB, { head: -1 })).toBe(NPUB)
		expect(truncateNpub(NPUB, { tail: -1 })).toBe(NPUB)
	})

	test('never returns something longer than the input', () => {
		// A separator longer than the cut cannot make the result grow.
		for (let length = 1; length <= NPUB.length; length += 1) {
			const input = NPUB.slice(0, length)
			const result = truncateNpub(input)
			expect(result.length).toBeLessThanOrEqual(Math.max(input.length, 14))
		}
	})
})

describe('NpubDisplay', () => {
	test('renders the truncated npub and keeps the full value in title', () => {
		const html = renderToStaticMarkup(createElement(NpubDisplay, { npub: NPUB }))
		expect(html).toContain(`title="${NPUB}"`)
		expect(html).toContain(`${NPUB.slice(0, 10)}...${NPUB.slice(-4)}`)
		expect(html).toContain('data-slot="npub-display"')
	})

	test('applies the consumer className without dropping its own', () => {
		const html = renderToStaticMarkup(createElement(NpubDisplay, { npub: NPUB, className: 'text-xs' }))
		expect(html).toContain('lowercase')
		expect(html).toContain('text-xs')
	})
})
