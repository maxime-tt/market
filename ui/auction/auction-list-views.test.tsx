import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionListItemView, AuctionTopBidBox } from './auction-list-views'

describe('AuctionTopBidBox', () => {
	test('renders the empty state when there is no top bid', () => {
		const markup = renderToStaticMarkup(<AuctionTopBidBox topBidSats={null} />)
		expect(markup).toContain('data-slot="auction-top-bid-box"')
		expect(markup).toContain('No bids yet. Winning bid will appear here.')
	})

	test('renders the amount, the host-supplied bidder name and the injected identity node', () => {
		const markup = renderToStaticMarkup(
			<AuctionTopBidBox
				topBidSats={12345}
				topBidCreatedAt={Math.floor(Date.now() / 1000) - 120}
				bidderName="alice"
				bidderIdentity={<span data-testid="avatar">A</span>}
			/>,
		)
		expect(markup).toContain('12,345 sats')
		expect(markup).toContain('Top bid:')
		expect(markup).toContain('2 mins ago')
		expect(markup).toContain('alice')
		expect(markup).toContain('data-testid="avatar"')
		expect(markup).toContain('Current top bid')
	})

	test('switches label, tone and border treatment in the settlement phase', () => {
		const markup = renderToStaticMarkup(<AuctionTopBidBox topBidSats={100} isSettlementPhase />)
		expect(markup).toContain('Winning bid')
		expect(markup).toContain('border-emerald-300')
		expect(markup).not.toContain('Current top bid')
	})

	test('shows the settlement-details disclosure only when the flag is set', () => {
		expect(renderToStaticMarkup(<AuctionTopBidBox topBidSats={100} />)).not.toContain('Settlement details')
		const markup = renderToStaticMarkup(<AuctionTopBidBox topBidSats={100} showReleasePathDetails showWaitingForReleasePath />)
		expect(markup).toContain('Settlement details')
	})

	test('merges host className and stays renderable with no bidder name yet', () => {
		const markup = renderToStaticMarkup(<AuctionTopBidBox topBidSats={0} className="flex-1" />)
		expect(markup).toContain('flex-1')
		expect(markup).toContain('0 sats')
	})
})

describe('AuctionListItemView', () => {
	test('renders the identity block and the injected action nodes', () => {
		const markup = renderToStaticMarkup(
			<AuctionListItemView
				title="Vintage guitar"
				summary="A description"
				createdAt={1_700_000_000}
				thumbnailUrl="https://example.test/t.jpg"
				status="Live"
				openAuctionAction={<button type="button">Open Auction</button>}
				countdown={<span data-testid="countdown" />}
				topBidBox={<div data-testid="top-bid" />}
				settlementAction={<button type="button">Publish Settlement</button>}
			/>,
		)
		expect(markup).toContain('data-slot="auction-list-item"')
		expect(markup).toContain('Vintage guitar')
		expect(markup).toContain('Created:')
		expect(markup).toContain('Open Auction')
		expect(markup).toContain('data-testid="countdown"')
		expect(markup).toContain('data-testid="top-bid"')
		expect(markup).toContain('Publish Settlement')
		expect(markup).toContain('Live')
	})

	test('falls back to the placeholder when there is no thumbnail', () => {
		const markup = renderToStaticMarkup(<AuctionListItemView title="t" summary="s" status="Live" />)
		expect(markup).not.toContain('<img')
		expect(markup).toContain('lucide-gavel')
	})

	test('omits host actions that were not injected', () => {
		const markup = renderToStaticMarkup(<AuctionListItemView title="t" summary="s" status="Ended" />)
		expect(markup).not.toContain('Publish Settlement')
		expect(markup).not.toContain('Go to Order Page')
		expect(markup).not.toContain('Waiting for shipping method')
	})

	test('pluralises the activity counts and highlights only positive new counts', () => {
		const markup = renderToStaticMarkup(
			<AuctionListItemView
				title="t"
				summary="s"
				status="Live"
				activity={{ bids: 1, newBids: 0, comments: 5, newComments: 2, liveChat: 0, newChat: 0 }}
			/>,
		)
		expect(markup).toContain('1 Bid')
		expect(markup).toContain('5 Comments')
		expect(markup).toContain('0 Messages')
		expect(markup).toContain('2 New')
		expect(markup).toContain('text-fill-accent')
	})

	test('disables "Mark as seen" until there is new activity', () => {
		const idle = renderToStaticMarkup(<AuctionListItemView title="t" summary="s" status="Live" hasNewActivity={false} />)
		expect(idle).toContain('disabled')
		const busy = renderToStaticMarkup(<AuctionListItemView title="t" summary="s" status="Live" hasNewActivity />)
		expect(busy).toContain('Mark as seen')
	})
})
