/**
 * `ui/storefront/auction-list-block.test.tsx` — the auction block is honest
 * about what it does and does not know.
 *
 * The view is rendered to static markup; every data input is a literal, because
 * the point under test is the *state mapping*, not a read. `ui/` may not touch
 * a relay (ui/AGENTS.md hard boundary), so there is nothing to stub.
 *
 * The honesty cases mirror `platform/web/browse/BrowseIndexHost.test.tsx`'s
 * streaming suite: a count is a verdict, and a verdict is only stated once the
 * read has one.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StorefrontProvider } from './StorefrontContext'
import {
	AuctionListBlock,
	type AuctionListItem,
	type AuctionListBlockViewProps,
} from './blocks/AuctionListBlock'

const SELLER = 'a'.repeat(64)
const COORD = `1440:${SELLER}:lot-1`
const HREF = (coordinate: string) => `/auctions/${coordinate.split(':').slice(2).join(':')}`

const blockProps = {
	title: 'Live auctions',
	source: 'mine' as const,
	auctionCoordinates: [] as string[],
	limit: 6,
	emptyMessage: 'Nothing on the block yet.',
}

function auction(over: Partial<AuctionListItem> = {}): AuctionListItem {
	return {
		coordinate: COORD,
		seller: SELLER,
		d: 'lot-1',
		title: 'A handmade mug',
		startingBid: 1000,
		topBidTotal: null,
		bidCount: 0,
		endsAt: 2000,
		phase: 'open',
		verdict: null,
		...over,
	}
}

function render(over: Partial<AuctionListBlockViewProps> = {}, editing = false): string {
	const props: AuctionListBlockViewProps = {
		...blockProps,
		auctions: null,
		missing: [],
		status: 'loading',
		relayHealth: { answered: 0, total: 1 },
		auctionHref: HREF,
		...over,
	}
	return renderToStaticMarkup(
		createElement(StorefrontProvider, {
			value: { pubkey: SELLER, isEditing: editing },
			children: createElement(AuctionListBlock, props),
		}),
	)
}

describe('AuctionListBlock — read states', () => {
	test('loading with nothing delivered states the read, never a count', () => {
		const markup = render({ status: 'loading', auctions: [] })
		expect(markup).toContain('data-state="loading"')
		expect(markup).toContain('Reading auctions from relays')
		// A zero verdict about a read that is still running.
		expect(markup).not.toContain('No auctions')
		expect(markup).not.toContain('0 auctions')
	})

	test('loading with items shows them and says they are "so far"', () => {
		const markup = render({ status: 'loading', auctions: [auction()] })
		expect(markup).toContain('storefront-auction-lot-1')
		expect(markup).toContain('so far')
		expect(markup).not.toContain('Nothing on the block yet.')
	})

	test('an incomplete read keeps what arrived and says it is partial', () => {
		const markup = render({ status: 'incomplete', auctions: [auction()] })
		expect(markup).toContain('data-testid="storefront-auction-list-incomplete"')
		expect(markup).toContain('not the whole picture')
		expect(markup).not.toContain('Nothing on the block yet.')
	})

	test('no relay answered is not an empty result', () => {
		const markup = render({ status: 'no-relays', auctions: [] })
		expect(markup).toContain('No relay answered')
		expect(markup).toContain('This is not the same as there being none')
		expect(markup).not.toContain('Nothing on the block yet.')
	})

	test('a missing host is an error state, not "no auctions"', () => {
		const markup = render({ status: 'error', auctions: null })
		expect(markup).toContain('Auctions could not be loaded right now')
		expect(markup).not.toContain('Nothing on the block yet.')
	})

	test('"no auctions" is reachable only from a settled read', () => {
		const settled = render({ status: 'settled', auctions: [] })
		expect(settled).toContain('Nothing on the block yet.')

		// The same empty list in every other state must not say it.
		for (const status of ['loading', 'incomplete', 'no-relays', 'error'] as const) {
			expect(render({ status, auctions: [] })).not.toContain('Nothing on the block yet.')
		}
	})
})

describe('AuctionListBlock — what an auction card says', () => {
	test('an open auction shows its phase and starting bid', () => {
		const markup = render({ status: 'settled', auctions: [auction()] })
		expect(markup).toContain('A handmade mug')
		expect(markup).toContain('data-phase="open"')
		expect(markup).toContain('Open')
		expect(markup).toContain('Starting bid 1000 sats')
		expect(markup).toContain(`href="/auctions/lot-1"`)
	})

	test('a card names its own seller, so a picked auction is not claimed as the author\'s', () => {
		const markup = render({ status: 'settled', auctions: [auction({ seller: 'b'.repeat(64) })] })
		expect(markup).toContain('by bbbbbb…bbbb')
	})

	test('an ended auction with no verdict says the outcome is unverified', () => {
		const markup = render({ status: 'settled', auctions: [auction({ phase: 'ended', verdict: null })] })
		expect(markup).toContain('data-testid="storefront-auction-lot-1-unverified"')
		expect(markup).toContain('Outcome not verified yet.')
		// It does not invent an outcome, and it does not say "no bids".
		expect(markup).not.toContain('Outcome:')
	})

	test('a verdict is labelled relay-reported, behind the chain', () => {
		const markup = render({ status: 'settled', auctions: [auction({ phase: 'ended', verdict: 'winner' })] })
		expect(markup).toContain('data-verdict="winner"')
		expect(markup).toContain('Outcome: winner (relay-reported)')
		expect(markup).not.toContain('unverified')
	})

	test('an auction with no stated duration says the end is unknown', () => {
		const markup = render({ status: 'settled', auctions: [auction({ phase: 'unknown', endsAt: null })] })
		expect(markup).toContain('data-phase="unknown"')
		expect(markup).toContain('End time unknown')
	})

	test('bids are counted and the top position shown when there is one', () => {
		const markup = render({ status: 'settled', auctions: [auction({ bidCount: 3, topBidTotal: 1300 })] })
		expect(markup).toContain('3 bids')
		expect(markup).toContain('top 1300 sats')
	})

	test('limit truncates the rendered list', () => {
		const markup = render({
			status: 'settled',
			limit: 1,
			auctions: [auction(), auction({ d: 'lot-2', coordinate: `1440:${SELLER}:lot-2` })],
		})
		expect(markup).toContain('storefront-auction-lot-1')
		expect(markup).not.toContain('storefront-auction-lot-2')
	})
})

describe('AuctionListBlock — picked references', () => {
	const picked = { ...blockProps, source: 'picked' as const, auctionCoordinates: [COORD] }

	test('a picked reference that has not arrived is "not arrived yet", and a settled one is "not found"', () => {
		const loading = render({ ...picked, status: 'loading', auctions: [], missing: [COORD] })
		expect(loading).toContain('not arrived yet')
		expect(loading).not.toContain('not found')

		const settled = render({ ...picked, status: 'settled', auctions: [], missing: [COORD] })
		expect(settled).toContain('not found')
		expect(settled).not.toContain('not arrived yet')
	})

	test('picked with nothing picked is an editor-only hint', () => {
		const editing = render({ ...picked, auctionCoordinates: [] }, true)
		expect(editing).toContain('Pick the auctions this section should show.')

		const published = render({ ...picked, auctionCoordinates: [] }, false)
		expect(published).toBe('')
	})

	test('cards stay inert inside the editor canvas', () => {
		const editing = render({ status: 'settled', auctions: [auction()] }, true)
		expect(editing).toContain('pointer-events-none')
	})
})