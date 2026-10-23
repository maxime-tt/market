import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionActivityRow } from './auction-overview-views'

describe('AuctionActivityRow', () => {
	test('renders the header and a pluralised count', () => {
		const markup = renderToStaticMarkup(<AuctionActivityRow header="Bids" unit="Bid" count={3} newCount={0} />)
		expect(markup).toContain('data-slot="auction-activity-row"')
		expect(markup).toContain('Bids')
		expect(markup).toContain('3 Bids')
		expect(markup).not.toContain('New')
	})

	test('keeps the singular unit at one', () => {
		expect(renderToStaticMarkup(<AuctionActivityRow header="Bids" unit="Bid" count={1} newCount={0} />)).toContain('1 Bid')
	})

	test('renders the new-items highlight only when positive', () => {
		const markup = renderToStaticMarkup(<AuctionActivityRow header="Comments" unit="Comment" count={5} newCount={2} />)
		expect(markup).toContain('2 New')
		expect(markup).toContain('text-primary')
	})

	test('merges host className', () => {
		expect(
			renderToStaticMarkup(<AuctionActivityRow header="Live Chat" unit="Message" count={0} newCount={0} className="mt-2" />),
		).toContain('mt-2')
	})
})
