import { describe, expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionCardView, type AuctionCardBidderStatus, type AuctionCardViewProps } from './auction-card-view'

/** Host stand-in for the router link (the host injects `Link to={`/auctions/${id}`}`). */
const renderLink = (children: ReactNode, className?: string) => (
	<a href="#auction" className={className} data-slot="card-link">
		{children}
	</a>
)

const card = (overrides: Partial<AuctionCardViewProps>): string => {
	const props: AuctionCardViewProps = {
		title: 'Handmade mug',
		imageUrl: 'https://cdn.example/mug.png',
		currentPrice: 21_000,
		bidsCount: 3,
		bidderStatus: null,
		ended: false,
		notStarted: false,
		renderLink,
		...overrides,
	}
	return renderToStaticMarkup(<AuctionCardView {...props} />)
}

describe('AuctionCardView', () => {
	test('renders the image, the price and the bids-count fallback through the injected link', () => {
		const markup = card({ countdown: <span>2d 3h left</span>, bidder: <div data-testid="auction-bidder" /> })
		expect(markup).toContain('21,000 sats')
		expect(markup).toContain('3 Bids')
		expect(markup).toContain('LIVE')
		expect(markup).toContain('Handmade mug')
		// The link factory wraps both the image area and the title.
		expect(markup).toContain('src="https://cdn.example/mug.png"')
		const links = markup.match(/data-slot="card-link"/g) ?? []
		expect(links.length).toBe(2)
		// Host-owned slots render inside the card.
		expect(markup).toContain('2d 3h left')
		expect(markup).toContain('data-testid="auction-bidder"')
	})

	test('renders the one-bid singular copy', () => {
		expect(card({ bidsCount: 1 })).toContain('1 Bid')
	})

	test('renders the injected bidder-status pill instead of the bids count', () => {
		const status: AuctionCardBidderStatus = { status: 'winning', label: "You're winning" }
		const markup = card({ bidderStatus: status })
		expect(markup).toContain('You&#x27;re winning')
		expect(markup).toContain('bg-success-muted')
		expect(markup).not.toContain('3 Bids')

		const outbid = card({ bidderStatus: { status: 'was_outbid', label: 'You were outbid' } })
		expect(outbid).toContain('You were outbid')
		expect(outbid).toContain('bg-warning-muted')
	})

	test('the status tone maps won/outbid onto the same family as winning/was_outbid', () => {
		expect(card({ bidderStatus: { status: 'won', label: 'You had the top bid' } })).toContain('bg-success-muted')
		expect(card({ bidderStatus: { status: 'outbid', label: "You've been outbid" } })).toContain('bg-warning-muted')
	})

	test('the ENDED and SCHEDULED badges replace LIVE by gating state', () => {
		expect(card({ ended: true })).toContain('ENDED')
		expect(card({ notStarted: true })).toContain('SCHEDULED')
	})

	test('renders the no-image placeholder when the auction carries no image', () => {
		const markup = card({ imageUrl: null })
		expect(markup).toContain('No image')
		expect(markup).not.toContain('src="https://cdn.example/mug.png"')
	})

	test('renders the injected test-label notice inside the image link area', () => {
		const markup = card({ testLabelNotice: <span data-slot="test-label-notice">TEST</span> })
		expect(markup).toContain('data-slot="test-label-notice"')
	})
})
