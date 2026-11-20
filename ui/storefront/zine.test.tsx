/**
 * Zine home blocks (ADR-0029): the template survives the schema, old pages keep
 * their styles, and each block draws real figures or an honest empty state.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseStorefrontPage, type StorefrontBlock } from '@sdk/commerce/storefront/storefrontPage'
import { STOREFRONT_TEMPLATES, ZINE_HOME_BLOCKS, getStorefrontTemplate } from '@sdk/config/storefront/storefrontTemplates'
import { StorefrontBlockView } from './StorefrontRenderer'
import { StorefrontProvider } from './StorefrontContext'
import { AuctionBentoBlock, ClosingPicksBlock } from './blocks/ZineBlocks'
import { CategorySectionBlock, CollectionRowBlock } from './blocks/MagazineBlocks'
import type { AuctionListItem } from './blocks/AuctionListBlock'

const lot = (d: string, over: Partial<AuctionListItem> = {}): AuctionListItem => ({
	coordinate: `1440:s:${d}`,
	seller: 's',
	d,
	title: `Lot ${d}`,
	imageUrl: 'https://example.com/a.jpg',
	startingBid: 1000,
	topBidTotal: 312000,
	bidCount: 7,
	endsAt: 1451,
	startsAt: 0,
	phase: 'open',
	verdict: null,
	...over,
})

describe('zine template', () => {
	test('every block survives the schema', () => {
		const page = { version: 1, enabled: true, root: { props: { theme: 'arena' } }, content: ZINE_HOME_BLOCKS }
		const parsed = parseStorefrontPage(JSON.stringify(page))
		expect(parsed.droppedBlocks).toBe(0)
		expect(parsed.page?.content.map((block) => block.type)).toEqual(ZINE_HOME_BLOCKS.map((block) => block.type))
	})

	test('both home layouts are offered, the zine opens in Arena with the bento first', () => {
		const ids = STOREFRONT_TEMPLATES.map((template) => template.id)
		expect(ids).toContain('magazine')
		expect(ids).toContain('zine')
		const zine = getStorefrontTemplate('zine')
		expect(zine.defaultThemeId).toBe('arena')
		expect(zine.blocks[0].type).toBe('AuctionBento')
	})

	test('blocks published before styles existed keep their old look', () => {
		const old = {
			version: 1,
			content: [
				{ type: 'Ticker', props: { id: 'a', messages: [] } },
				{ type: 'CollectionRow', props: { id: 'b' } },
				{ type: 'CategorySection', props: { id: 'c', tags: 'art' } },
			],
		}
		const content = parseStorefrontPage(JSON.stringify(old)).page?.content as StorefrontBlock[]
		expect((content[0].props as { style: string }).style).toBe('strip')
		expect((content[1].props as { style: string }).style).toBe('cards')
		expect((content[2].props as { style: string }).style).toBe('row')
	})

	test('each template block renders without a host, published and in the editor', () => {
		for (const isEditing of [false, true]) {
			for (const block of ZINE_HOME_BLOCKS) {
				const markup = renderToStaticMarkup(
					createElement(StorefrontProvider, { value: { pubkey: 'p', isEditing }, children: createElement(StorefrontBlockView, { block }) }),
				)
				expect(typeof markup).toBe('string')
			}
		}
	})
})

describe('zine blocks', () => {
	const bentoBase = {
		title: 'On the *block*',
		intro: 'Bid in sats.',
		showLiveCount: true,
		source: 'auto' as const,
		auctionCoordinates: [],
		sticker: 'Top bid',
		now: 1000,
		auctionHref: (coordinate: string) => `/auctions/${coordinate.split(':')[2]}`,
	}

	test('the bento draws the headline, the live count, the top bid and countdowns', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionBentoBlock, { ...bentoBase, items: [lot('a'), lot('b'), lot('c'), lot('d')], liveCount: 4, status: 'settled' }),
		)
		expect(markup).toContain('<em>block</em>')
		expect(markup).toContain('4 live')
		expect(markup).toContain('Top bid')
		expect(markup).toContain('312,000')
		expect(markup).toContain('07:31')
		expect(markup).toContain('href="/auctions/d"')
	})

	test('a lot with no bids says where it starts, not a top bid', () => {
		const markup = renderToStaticMarkup(
			createElement(AuctionBentoBlock, { ...bentoBase, items: [lot('a', { topBidTotal: null, bidCount: 0 })], liveCount: 1, status: 'settled' }),
		)
		expect(markup).toContain('Starts at')
		expect(markup).not.toContain('Top bid')
	})

	test('closing soon numbers the lots and an ended lot says closed', () => {
		const markup = renderToStaticMarkup(
			createElement(ClosingPicksBlock, {
				closingTitle: 'Closing soon',
				closingChip: 'Next hour',
				closingLimit: 5,
				picksTitle: 'Featured products',
				picksChip: 'Fresh picks',
				source: 'featured',
				productDTags: [],
				picksLimit: 6,
				buttonLabel: 'View',
				closing: [lot('a'), lot('b', { phase: 'ended' })],
				closingStatus: 'settled',
				picks: [{ key: 'p', title: 'Hoodie', imageUrl: null, href: '/products/p', price: '21,000 sats' }],
				picksLoading: false,
				now: 1000,
				auctionHref: () => '/auctions/x',
			}),
		)
		expect(markup).toContain('Next hour')
		expect(markup).toContain('07:31')
		expect(markup).toContain('closed')
		expect(markup).toContain('Hoodie')
		expect(markup).toContain('21,000 sats')
	})

	test('tiles and bento styles draw their own markup', () => {
		const tiles = renderToStaticMarkup(
			createElement(CollectionRowBlock, {
				title: '',
				source: 'featured',
				style: 'tiles',
				limit: 4,
				linkLabel: '',
				linkHref: '',
				isLoading: false,
				collections: [{ key: 'c', title: 'The orange wardrobe', href: '/collection/c', images: ['https://example.com/a.jpg'], itemCount: 6 }],
			}),
		)
		expect(tiles).toContain('zn-tiles')
		expect(tiles).toContain('6 items')
		const bento = renderToStaticMarkup(
			createElement(CategorySectionBlock, {
				label: '',
				title: 'Wear',
				subtitle: '',
				tags: 'hoodie',
				style: 'bento',
				badge: 'New in',
				limit: 5,
				linkLabel: 'See all',
				products: null,
				items: [{ key: 'p', title: 'Hoodie', imageUrl: null, href: '/products/p', price: '21,000 sats' }],
				isLoading: false,
				browseHref: '/?q=hoodie',
			}),
		)
		expect(bento).toContain('zn-cg')
		expect(bento).toContain('New in')
		expect(bento).toContain('See all')
	})
})
