import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	CATALOGUE_DARK,
	CATALOGUE_EASE,
	CATALOGUE_FONTS,
	CATALOGUE_LIGHT,
	CATALOGUE_RADIUS,
	catalogueCssVars,
} from './catalogue-preset'
import { CatalogueView } from './catalogue-view'

describe('Catalogue preset', () => {
	test('carries the extraction’s light token values', () => {
		// Values transcribed from EXTRACTION-STRUCTURE.md:260-274. Pinned so a
		// well-meaning "make it prettier" edit has to argue with the source.
		expect(CATALOGUE_LIGHT.bg).toBe('#F4ECE3')
		expect(CATALOGUE_LIGHT.surface).toBe('#FFFCF8')
		expect(CATALOGUE_LIGHT.surface2).toBe('#F0E2D5')
		expect(CATALOGUE_LIGHT.ink).toBe('#1B1718')
		expect(CATALOGUE_LIGHT.muted).toBe('#6E625A')
		expect(CATALOGUE_LIGHT.line).toBe('#E2D3C4')
		expect(CATALOGUE_LIGHT.pink).toBe('#FF3EB5')
		expect(CATALOGUE_LIGHT.accent).toBe('#C8157F')
	})

	test('carries the dark set for the layouts that need it', () => {
		expect(CATALOGUE_DARK.bg).toBe('#0E0D0E')
		expect(CATALOGUE_DARK.ink).toBe('#F6EFEA')
		expect(CATALOGUE_DARK.accent).toBe('#FF3EB5')
	})

	test('fonts, radius and easing match the extraction', () => {
		expect(CATALOGUE_FONTS.serif).toContain('Instrument Serif')
		expect(CATALOGUE_FONTS.sans).toContain('DM Sans')
		expect(CATALOGUE_FONTS.mono).toContain('JetBrains Mono')
		expect(CATALOGUE_RADIUS).toBe('14px')
		expect(CATALOGUE_EASE).toBe('cubic-bezier(.2, .8, .2, 1)')
	})

	test('every token reaches the stylesheet as a --cat-* variable', () => {
		const vars = catalogueCssVars('light')
		for (const key of ['--cat-bg', '--cat-surface', '--cat-ink', '--cat-line', '--cat-accent', '--cat-radius']) {
			expect(vars[key]).toBeDefined()
		}
		// The prefix must not collide with the app's own tokens.
		for (const key of Object.keys(vars)) expect(key.startsWith('--cat-')).toBe(true)
		expect(Object.keys(catalogueCssVars('dark')).sort()).toEqual(Object.keys(vars).sort())
	})
})

describe('CatalogueView', () => {
	const auction = {
		id: 'lot-1',
		title: 'A lot',
		seller: 'abc',
		startingBid: 10,
		endTime: 1_060,
		status: 'open',
		fundingMode: 'custodial_reservation_v1',
	}

	test('states the money is fake — not optional', () => {
		const html = renderToStaticMarkup(
			createElement(CatalogueView, { auctions: [auction], isLoading: false, isError: false, now: 1_000 }),
		)
		expect(html).toContain('FAKE_MONEY_ONLY')
		expect(html).toContain('catalogue-fake-money')
	})

	test('counts down against the committed time, not the browser clock', () => {
		const html = renderToStaticMarkup(
			createElement(CatalogueView, { auctions: [auction], isLoading: false, isError: false, now: 1_000 }),
		)
		expect(html).toContain('1m 00s')
	})

	test('renders one card per lot, and an honest empty state', () => {
		const withLots = renderToStaticMarkup(
			createElement(CatalogueView, { auctions: [auction, { ...auction, id: 'lot-2' }], isLoading: false, isError: false, now: 1_000 }),
		)
		expect(withLots).toContain('2 lots')
		const empty = renderToStaticMarkup(
			createElement(CatalogueView, { auctions: [], isLoading: false, isError: false, now: 1_000 }),
		)
		expect(empty).toContain('catalogue-empty')
	})
})
