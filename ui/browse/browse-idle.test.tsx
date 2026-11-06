/**
 * browse/browse-idle.test.tsx — the idle hero's facts.
 *
 * The regression this file guards: the hero must render **no number** it was
 * not handed. The frame's copy ("3,418 items live from 611 sellers … 38 relays
 * mirrored, live") is placeholder text, and shipping it as a measurement is the
 * defect class this hero was corrected for.
 */

import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrowseIdle, describeIdleStats, formatIdleCount, type BrowseIdleProps } from './browse-idle'

const BASE: BrowseIdleProps = {}

function motdText(markup: string): string {
	// Start at the band's own `<div` (not at its attribute), then read only the
	// rendered text: attributes and their px values are not measurements.
	const attr = markup.indexOf('data-testid="widget-browse-idle-motd"')
	const start = markup.lastIndexOf('<', attr)
	const end = markup.indexOf('data-testid="widget-browse-idle-ctas"')
	return markup.slice(start, end).replace(/<[^>]*>/g, '')
}

describe('describeIdleStats', () => {
	test('no stats → no fragments at all', () => {
		expect(describeIdleStats(undefined)).toEqual({ headline: [] })
		expect(describeIdleStats({})).toEqual({ headline: [] })
	})

	test('states only the fields it was given', () => {
		expect(describeIdleStats({ products: 12 })).toEqual({ headline: ['12 items loaded'] })
		expect(describeIdleStats({ sellers: 3 })).toEqual({ headline: ['3 sellers in this view'] })
		expect(describeIdleStats({ relays: 9 })).toEqual({ headline: [], relays: '9 relays queried' })
	})

	test('counts are labelled as loaded, never as a market total', () => {
		const described = describeIdleStats({ products: 1208, sellers: 38, postedLast24h: 412, relays: 38 })
		expect(described.headline).toEqual(['1,208 items loaded from 38 sellers', '412 posted in the last 24 hours'])
		expect(described.relays).toBe('38 relays queried')
		expect(described.headline.join(' ')).not.toContain('live from')
	})

	test('singular counts read as English', () => {
		expect(describeIdleStats({ products: 1, sellers: 1, relays: 1 })).toEqual({
			headline: ['1 item loaded from 1 seller'],
			relays: '1 relay queried',
		})
	})

	test('pins the thousands separator', () => {
		expect(formatIdleCount(1208)).toBe('1,208')
	})
})

describe('BrowseIdle hero', () => {
	test('renders the title and CTAs with no stats, and no digits in the hero line', () => {
		const markup = renderToStaticMarkup(createElement(BrowseIdle, BASE))
		expect(markup).toContain('The whole market')
		expect(markup).toContain('widget-browse-idle-ctas')
		expect(motdText(markup)).not.toMatch(/\d/)
	})

	test('draws one full-bleed strip above the title block and one below it', () => {
		const strip = (id: string) => ({ id, title: `Product ${id}`, seller: 'atelier-norte', material: 'm1' as const })
		const markup = renderToStaticMarkup(
			createElement(BrowseIdle, { ...BASE, stripsAbove: [strip('above')], stripsBelow: [strip('below')] }),
		)

		const above = markup.indexOf('data-slot="browse-strip-above"')
		const title = markup.indexOf('<h1')
		const below = markup.indexOf('data-slot="browse-strip-below"')

		// The owner's order: a row of products above the title block, one below.
		expect(above).toBeGreaterThan(-1)
		expect(title).toBeGreaterThan(above)
		expect(below).toBeGreaterThan(title)

		// Both strips are the same full-bleed band, drifting opposite ways.
		expect(markup).toContain('widget-strip-item-above')
		expect(markup).toContain('widget-strip-item-below')
		expect(markup).toContain('animate-[strip-drift_58s_linear_infinite]')
		expect(markup).toContain('animate-[strip-drift_72s_linear_infinite_reverse]')
	})

	test('the band is full-bleed while the hero keeps its centred column', () => {
		const markup = renderToStaticMarkup(createElement(BrowseIdle, BASE))
		// The band's container carries no max-width of its own…
		expect(markup).toContain('<main class="w-full py-4">')
		// …and the hero inside it is the frame's ~800px column.
		expect(markup).toContain('max-w-[800px]')
	})

	test('renders the measured facts when stats are passed', () => {
		const markup = renderToStaticMarkup(
			createElement(BrowseIdle, { ...BASE, stats: { products: 5, sellers: 2, postedLast24h: 1, relays: 3 } }),
		)
		expect(motdText(markup)).toContain('5 items loaded from 2 sellers')
		expect(motdText(markup)).toContain('1 posted in the last 24 hours')
		expect(motdText(markup)).toContain('3 relays queried')
	})
})
