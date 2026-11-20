/**
 * Magazine home blocks (ADR-0028): formatting helpers, the accent title, and
 * that every block renders its honest no-data state without a host.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseStorefrontPage, type StorefrontBlock } from '@sdk/commerce/storefront/storefrontPage'
import { MAGAZINE_HOME_BLOCKS, getStorefrontTemplate } from '@sdk/config/storefront/storefrontTemplates'
import { StorefrontBlockView } from './StorefrontRenderer'
import { StorefrontProvider } from './StorefrontContext'
import { AccentTitle, CoverAuctionBlock, formatCountdown, formatSats, parseCategoryTags } from './blocks/MagazineBlocks'
import { AuctionListBlock } from './blocks/AuctionListBlock'

describe('magazine helpers', () => {
	test('countdown formats under an hour, under a day and over a day', () => {
		expect(formatCountdown(1000 + 451, 1000)).toBe('07:31')
		expect(formatCountdown(1000 + 3600 + 451, 1000)).toBe('01:07:31')
		expect(formatCountdown(1000 + 2 * 86_400 + 4 * 3600, 1000)).toBe('2d 04h')
		expect(formatCountdown(900, 1000)).toBe('Ended')
		expect(formatCountdown(null, 1000)).toBe('—')
	})

	test('sats get thousands separators', () => {
		expect(formatSats(540000)).toBe('540,000')
		expect(formatSats(null)).toBe('—')
	})

	test('one *word* becomes the italic accent and nothing else becomes markup', () => {
		const markup = renderToStaticMarkup(createElement(AccentTitle, { text: 'Closing *soon* <b>' }))
		expect(markup).toBe('Closing <em>soon</em> &lt;b&gt;')
	})

	test('category tags are trimmed and de-duplicated', () => {
		expect(parseCategoryTags(' bitcoin, node ,bitcoin,, ')).toEqual(['bitcoin', 'node'])
	})
})

describe('magazine template', () => {
	test('every block survives the schema, so publishing it loses nothing', () => {
		const page = { version: 1, enabled: true, root: { props: { theme: 'arena' } }, content: MAGAZINE_HOME_BLOCKS }
		const parsed = parseStorefrontPage(JSON.stringify(page))
		expect(parsed.droppedBlocks).toBe(0)
		expect(parsed.page?.content.map((block) => block.type)).toEqual(MAGAZINE_HOME_BLOCKS.map((block) => block.type))
	})

	test('the template opens in Arena and leads with the cover, not a welcome banner', () => {
		const template = getStorefrontTemplate('magazine')
		expect(template.defaultThemeId).toBe('arena')
		expect(template.blocks.some((block) => block.type === 'Hero')).toBe(false)
		expect(template.blocks[1].type).toBe('CoverAuction')
	})

	test('an AuctionList published before layouts existed reads as the classic grid', () => {
		const old = { version: 1, content: [{ type: 'AuctionList', props: { id: 'x', title: 'Live', source: 'all' } }] }
		const block = parseStorefrontPage(JSON.stringify(old)).page?.content[0] as Extract<StorefrontBlock, { type: 'AuctionList' }>
		expect(block.props.layout).toBe('grid')
		expect(block.props.sort).toBe('ending')
	})
})

describe('magazine blocks render without a host', () => {
	test('each template block renders on a published page and in the editor', () => {
		for (const isEditing of [false, true]) {
			for (const block of MAGAZINE_HOME_BLOCKS) {
				const markup = renderToStaticMarkup(
					createElement(StorefrontProvider, { value: { pubkey: 'p', isEditing }, children: createElement(StorefrontBlockView, { block }) }),
				)
				expect(typeof markup).toBe('string')
			}
		}
	})

	test('the cover draws the lot, its bid in sats and a live countdown', () => {
		const markup = renderToStaticMarkup(
			createElement(CoverAuctionBlock, {
				source: 'auto',
				auctionCoordinates: [],
				kicker: 'Featured auction',
				deck: '',
				sticker: 'Lot of the week',
				ctaLabel: 'Open the arena',
				footnote: '',
				summary: 'A walnut block clock.',
				status: 'settled',
				now: 1000,
				auctionHref: () => '/auctions/clock',
				item: {
					coordinate: '1440:s:clock',
					seller: 's',
					d: 'clock',
					title: 'Block clock',
					imageUrl: 'https://example.com/a.jpg',
					startingBid: 1000,
					topBidTotal: 540000,
					bidCount: 12,
					endsAt: 1451,
					startsAt: 0,
					phase: 'open',
					verdict: null,
				},
			}),
		)
		expect(markup).toContain('Block clock')
		expect(markup).toContain('540,000')
		expect(markup).toContain('07:31')
		expect(markup).toContain('A walnut block clock.')
		expect(markup).toContain('href="/auctions/clock"')
	})

	test('the closing layout draws countdown cards, and never claims empty while loading', () => {
		const base = {
			title: 'Closing *soon*',
			source: 'all' as const,
			auctionCoordinates: [],
			limit: 6,
			emptyMessage: 'Nothing closing.',
			layout: 'closing' as const,
			missing: [],
			relayHealth: { answered: 0, total: 1 },
			auctionHref: () => '/auctions/x',
			now: 1000,
		}
		const loading = renderToStaticMarkup(createElement(AuctionListBlock, { ...base, auctions: [], status: 'loading' }))
		expect(loading).not.toContain('Nothing closing.')
		expect(loading).toContain('<em>soon</em>')
		const settled = renderToStaticMarkup(createElement(AuctionListBlock, { ...base, auctions: [], status: 'settled' }))
		expect(settled).toContain('Nothing closing.')
	})
})
