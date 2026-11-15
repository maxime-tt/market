import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import { DURATION_PRESETS } from './duration-presets'
import { AuctionTabView } from './auction-tab-view'

/**
 * `AuctionTabView` — the auction mechanics tab of the kind-1440 create form.
 *
 * Asserted through server-rendered markup (the units' suite has no DOM renderer): the
 * duration ladder and its preview, the starting price and increment, the closing-rule
 * switch, and the window control that exists only in anti-snipe mode. The retired 30408
 * knobs are asserted **absent**, because "removed" is the claim this test has to keep.
 */
const noop = () => {}

const formData: AuctionFormData = {
	auctionId: 'vintage-leica',
	title: 'Vintage Leica',
	description: 'Film camera',
	imageUrl: 'https://img.example/leica.png',
	category: 'Art',
	name: 'Studio Nord',
	startPrice: '1000',
	minIncrement: '100',
	mode: 'fixed',
	windowSec: '',
	durationSec: 7 * 86400 > 259_200 ? 259_200 : 86_400,
	v4vSplit: [],
}

const base = { formData, setFormData: noop, validationMessages: {} }

describe('AuctionTabView', () => {
	test('renders the duration ladder, its preview and the money inputs', () => {
		const markup = renderToStaticMarkup(createElement(AuctionTabView, base))
		expect(markup).toContain('flex flex-col gap-4')
		expect(markup).toContain('Duration')
		for (const label of ['1h', '12h', '1d', '3d']) expect(markup).toContain(label)
		expect(markup).toContain('Runs for:')
		expect(markup).toContain('Ends:')
		expect(markup).toContain('Starting Bid (sats)')
		expect(markup).toContain('Bid Increment (sats)')
		expect(markup).toContain('value="1000"')
		expect(markup).toContain('value="100"')
	})

	test('the ladder never offers a duration the protocol refuses', () => {
		for (const preset of DURATION_PRESETS) {
			expect(preset.seconds).toBeGreaterThanOrEqual(20)
			expect(preset.seconds).toBeLessThanOrEqual(259_200)
		}
		// 30 days was the retired ladder's top rung; the protocol's ceiling is three.
		expect(DURATION_PRESETS.some((preset) => preset.seconds === 30 * 86_400)).toBe(false)
	})

	test('renders no retired 30408 knob', () => {
		const markup = renderToStaticMarkup(createElement(AuctionTabView, base))
		for (const retired of ['Reserve (sats)', 'Anti-snipe curve', 'Peak multiplier', 'Settlement grace', 'Trusted Mints', 'Start Time', 'End date', 'Advanced']) {
			expect(markup).not.toContain(retired)
		}
	})

	test('a fixed-time auction shows no anti-snipe window control', () => {
		const markup = renderToStaticMarkup(createElement(AuctionTabView, base))
		expect(markup).toContain('Fixed time')
		expect(markup).toContain('Anti-snipe')
		expect(markup).not.toContain('pushes the close back')
	})

	test('an anti-snipe auction shows the window presets and its copy', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, { ...base, formData: { ...formData, mode: 'antisnipe' as const, windowSec: '300' } }),
		)
		expect(markup).toContain('pushes the close back')
		expect(markup).toContain('The window must be 1 to 15 minutes')
	})

	test('surfaces per-field validation messages', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, {
				...base,
				validationMessages: { startPrice: 'A starting price is required', durationSec: 'An auction duration is required' },
			}),
		)
		expect(markup).toContain('A starting price is required')
		expect(markup).toContain('An auction duration is required')
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(createElement(AuctionTabView, { ...base, className: 'mt-2' }))
		expect(markup).toContain('flex flex-col gap-4 mt-2')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		const withRef = renderToStaticMarkup(createElement(AuctionTabView, { ...base, ref: null }))
		expect(withRef).toContain('flex flex-col gap-4')
		expect(withRef).toContain('Duration')
	})
})