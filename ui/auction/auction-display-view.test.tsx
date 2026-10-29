import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionDisplayView } from './auction-display-view'

describe('AuctionDisplayView', () => {
	test('renders the auction summary and host-injected countdown', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionDisplayView, {
				title: 'Handmade mug',
				summary: 'One-of-a-kind stoneware mug',
				imageUrl: 'https://images.example/mug.jpg',
				endAtLabel: '1/1/2027, 12:00:00 PM',
				coordsIdentifier: 'handmade-mug',
				countdownSlot: createElement('span', { 'data-slot': 'demo-countdown' }, '2d 4h left'),
				onMoveUp: () => {},
				onMoveDown: () => {},
				onRemove: () => {},
				canMoveUp: false,
				canMoveDown: true,
				isReordering: false,
				isRemoving: false,
			}),
		)

		expect(markup).toContain('Handmade mug')
		expect(markup).toContain('One-of-a-kind stoneware mug')
		expect(markup).toContain('https://images.example/mug.jpg')
		expect(markup).toContain('data-slot="demo-countdown"')
		expect(markup).toContain('Closes: 1/1/2027, 12:00:00 PM')
		expect(markup).toContain('ID: handmade-mug')
		expect(markup).toContain('disabled')
	})

	test('renders the no-image placeholder and omits an absent countdown slot', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionDisplayView, {
				title: 'Loading...',
				summary: 'No summary available',
				imageUrl: null,
				endAtLabel: 'No end date',
				coordsIdentifier: 'unknown',
				onRemove: () => {},
				isRemoving: true,
			}),
		)

		expect(markup).toContain('No Image')
		expect(markup).toContain('Closes: No end date')
		expect(markup).not.toContain('demo-countdown')
	})
})
