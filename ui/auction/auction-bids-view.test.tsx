import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionBidsView } from './auction-bids-view'

const BIDDER_PUBKEY = 'a'.repeat(64)

const renderUserCard = (pubkey: string, size: 'md' | 'sm') => <span data-slot="test-user-card">{`${pubkey.slice(0, 4)}:${size}`}</span>

const bidFixture = (overrides: Partial<NostrEventLike> = {}): NostrEventLike => ({
	id: 'bid-1',
	pubkey: BIDDER_PUBKEY,
	kind: 1024,
	created_at: 1_760_000_000,
	content: '',
	tags: [
		['amount', '15000'],
		['mint', 'https://mint.example.com'],
	],
	...overrides,
})

describe('AuctionBidsView', () => {
	test('renders the legacy empty copy when there are no bids', () => {
		const markup = renderToStaticMarkup(<AuctionBidsView bids={[]} renderUserCard={renderUserCard} />)
		expect(markup).toContain('data-slot="auction-bids-view"')
		expect(markup).toContain('No bids yet. The latest bids will appear here once bidders lock funds.')
		expect(markup).not.toContain('Highest visible bid')
	})

	test('renders a bid amount, mint hostname and the injected identity', () => {
		const markup = renderToStaticMarkup(<AuctionBidsView bids={[bidFixture()]} renderUserCard={renderUserCard} />)
		expect(markup).toContain('Highest visible bid')
		expect(markup).toContain('15,000 sats')
		expect(markup).toContain('Mint: mint.example.com')
		expect(markup).toContain('Bid event details')
		expect(markup).toContain('data-slot="test-user-card"')
		expect(markup).toContain('aaaa:md')
	})

	test('merges the host className', () => {
		const markup = renderToStaticMarkup(<AuctionBidsView bids={[]} renderUserCard={renderUserCard} className="mt-4" />)
		expect(markup).toContain('mt-4')
	})
})
