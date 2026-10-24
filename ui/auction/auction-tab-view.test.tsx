import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import { AuctionTabView } from './auction-tab-view'

/**
 * `AuctionTabView` (was `AuctionTabContent`) moved out of the `auction-editor`
 * monolith in T6.3 S5a. Asserted through server-rendered markup: the timing
 * controls, the duration block, the starting-bid card, the per-field validation
 * messages, and the collapsed Advanced block. The Advanced block's contents are
 * behind a Radix `Collapsible` that is closed at rest, so the click-driven
 * reveal is proven in the widget-book spec instead of asserted vacuously here.
 *
 * Palette strings are guard-counted in `*.test.*` files, so the suite pins
 * structure and copy only.
 */
const noop = () => {}

const formData: AuctionFormData = {
	title: 'Vintage Leica',
	summary: '',
	description: '',
	startingBid: '1000',
	bidIncrement: '100',
	startAt: '',
	endAt: '',
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h',
	mainCategory: '',
	categories: [],
	imageUrls: [],
	specs: [],
	shippings: [],
	trustedMints: ['https://mint.one'],
	isNSFW: false,
	enableLiveChat: true,
	auditorPubkey: '',
}

const base = {
	formData,
	setFormData: noop,
	availableMints: ['https://mint.one', 'https://mint.two'],
	setStartMode: noop,
	setEndMode: noop,
	setDurationSeconds: noop,
	validationMessages: {},
	userRemovedMints: new Set<string>(),
	onUserRemovedMintsChange: noop,
}

describe('AuctionTabView', () => {
	test('renders the timing controls in immediate + duration mode', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, { ...base, startMode: 'immediate', endMode: 'duration', durationSeconds: 7 * 86400 }),
		)
		expect(markup).toContain('flex flex-col gap-4')
		expect(markup).toContain('Start Time')
		expect(markup).toContain('Immediate')
		expect(markup).toContain('Schedule')
		expect(markup).toContain('The auction goes live the moment you publish.')
		expect(markup).toContain('End Time')
		expect(markup).toContain('Duration')
		expect(markup).toContain('End date')
		// The one-tap shortcut chips above the slider.
		for (const label of ['1h', '12h', '1d', '7d', '14d', '30d']) expect(markup).toContain(label)
		expect(markup).toContain('Runs for:')
		expect(markup).toContain('Ends:')
		expect(markup).toContain('Starting Bid (sats)')
	})

	test('switches to the date pickers in scheduled + absolute mode', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, { ...base, startMode: 'scheduled', endMode: 'absolute', durationSeconds: 3600 }),
		)
		// Both DateTimePicker triggers render their placeholder ("&" HTML-escaped).
		expect(markup).toContain('Pick a start date')
		expect(markup).toContain('Pick an end date')
		expect(markup).not.toContain('The auction goes live the moment you publish.')
		expect(markup).not.toContain('Runs for:')
	})

	test('surfaces per-field validation messages', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, {
				...base,
				startMode: 'immediate',
				endMode: 'duration',
				durationSeconds: 60,
				validationMessages: { startingBid: 'Starting bid is too low', endAt: 'End must be in the future' },
			}),
		)
		expect(markup).toContain('Starting bid is too low')
		// `endTimeError` resolves endAt → duration → startAt; endAt wins.
		expect(markup).toContain('End must be in the future')
	})

	test('renders the Advanced trigger with its contents collapsed at rest', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, { ...base, startMode: 'immediate', endMode: 'duration', durationSeconds: 3600 }),
		)
		expect(markup).toContain('Advanced')
		expect(markup).toContain('data-slot="collapsible-trigger"')
		// Closed at rest: the bid-increment/reserve inputs and the mint rows are not mounted.
		expect(markup).not.toContain('Reserve (sats)')
		expect(markup).not.toContain('Bid Increment (sats)')
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionTabView, { ...base, startMode: 'immediate', endMode: 'duration', durationSeconds: 3600, className: 'mt-2' }),
		)
		expect(markup).toContain('flex flex-col gap-4 mt-2')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		const withRef = renderToStaticMarkup(
			createElement(AuctionTabView, { ...base, startMode: 'immediate', endMode: 'duration', durationSeconds: 3600, ref: null }),
		)
		expect(withRef).toContain('flex flex-col gap-4')
		expect(withRef).toContain('Start Time')
	})
})
