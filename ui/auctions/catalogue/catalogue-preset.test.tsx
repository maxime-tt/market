import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CATALOGUE_DARK, CATALOGUE_EASE, CATALOGUE_FONTS, CATALOGUE_LIGHT, CATALOGUE_RADIUS, catalogueCssVars } from './catalogue-preset'
import { CatalogueView } from './catalogue-view'
import type { ArenaAuctionCardModel } from '@ui/auction/arena/model'

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
	// The Layout A list is fed the arena read-model now, not the demo state
	// document: the two flat fields the demo carried (`fundingMode`, `status`)
	// have no arena source and the countdown reads the read's `now`.
	const card: ArenaAuctionCardModel = {
		coordinate: '1440:abc:lot-1',
		seller: 'abc',
		d: 'lot-1',
		title: 'A lot',
		imageUrl: null,
		startingBid: 10,
		topBidTotal: null,
		bidCount: 0,
		bidsWithoutAmount: 0,
		endsAt: 1_060,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 1,
	}
	const relayHealth = { answered: 1, total: 1 }
	const hrefFor = (view: ArenaAuctionCardModel) => `/auctions/${view.d}`

	test('states the escrow — the arena read has no funding mode to assert', () => {
		const html = renderToStaticMarkup(createElement(CatalogueView, { cards: [card], status: 'settled', relayHealth, now: 1_000, hrefFor }))
		expect(html).toContain('catalogue-escrow-notice')
		expect(html).toContain('escrow')
	})

	test('counts down against the read’s now, not the browser clock', () => {
		const html = renderToStaticMarkup(createElement(CatalogueView, { cards: [card], status: 'settled', relayHealth, now: 1_000, hrefFor }))
		expect(html).toContain('1m 00s')
	})

	test('renders one card per lot', () => {
		const withLots = renderToStaticMarkup(
			createElement(CatalogueView, {
				cards: [card, { ...card, coordinate: '1440:abc:lot-2', d: 'lot-2' }],
				status: 'settled',
				relayHealth,
				now: 1_000,
				hrefFor,
			}),
		)
		expect(withLots).toContain('2 lots')
	})

	test('a lot with no stated end says so in words, never a 0', () => {
		const html = renderToStaticMarkup(
			createElement(CatalogueView, {
				cards: [{ ...card, endsAt: null, phase: 'unknown' }],
				status: 'settled',
				relayHealth,
				now: 1_000,
				hrefFor,
			}),
		)
		expect(html).toContain('End time unknown')
	})
})
