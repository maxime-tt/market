import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuctionDisplayComponent } from './AuctionDisplayHost'

/**
 * Renderless host test: with a fresh cache the by-a-tag query has no data, so
 * the host's baseline derivations (title/summary/end label) must fall back to
 * the legacy leaf's copy and hand them to the view.
 */
describe('AuctionDisplayComponent host derivations', () => {
	test('renders the no-data derivations through the view', () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const markup = renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(AuctionDisplayComponent, {
					auctionCoords: '30408:'.concat('a'.repeat(64), ':handmade-mug'),
					index: 0,
					onRemove: () => {},
					canMoveUp: false,
					canMoveDown: false,
					isReordering: false,
					isRemoving: false,
				}),
			),
		)

		expect(markup).toContain('Loading...')
		expect(markup).toContain('No summary available')
		expect(markup).toContain('No end date')
		expect(markup).toContain('ID: handmade-mug')
	})
})
