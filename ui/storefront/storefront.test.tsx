import { describe, expect, test } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getProductId, getProductTitle, type ProductReadEvent } from '@sdk/commerce/discovery'
import { STOREFRONT_TUNE_DEFAULTS, type StorefrontBlock, type StorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { StorefrontProvider } from './StorefrontContext'
import { StorefrontLink } from './StorefrontLink'
import { MiniMarkdown } from './MiniMarkdown'
import { StorefrontBlockView, StorefrontRenderer, type StorefrontDataSlots } from './StorefrontRenderer'
import { HeroBlock } from './blocks/HeroBlock'
import { TextBlock } from './blocks/TextBlock'
import { ImageBlock } from './blocks/ImageBlock'
import { LinkListBlock } from './blocks/LinkListBlock'
import { DividerBlock, SpacerBlock } from './blocks/SpacingBlocks'
import { ProductGridBlock } from './blocks/ProductGridBlock'
import { FeaturedProductBlock } from './blocks/FeaturedProductBlock'
import { ProfileHeaderBlock } from './blocks/ProfileHeaderBlock'

const AUTHOR = 'a'.repeat(64)

const product: ProductReadEvent = {
	pubkey: AUTHOR,
	created_at: 1729500000,
	content: 'A handmade mug',
	tags: [
		['d', 'mug'],
		['title', 'Handmade Mug'],
		['price', '1200', 'SATS'],
	],
}

const secondProduct: ProductReadEvent = {
	pubkey: AUTHOR,
	tags: [
		['d', 'plate'],
		['title', 'Stoneware Plate'],
		['collection', '30405:otherpubkey:summer'],
	],
}

/** Host-style card renderer, kept literal so the view stays the thing under test. */
function renderProduct(p: ProductReadEvent): ReactElement {
	return createElement('div', { 'data-testid': `card-${getProductId(p)}` }, getProductTitle(p))
}

const gridProps = {
	title: 'From the workshop',
	source: 'all' as const,
	collectionDTag: '',
	limit: 12,
	columns: 3 as const,
	emptyMessage: 'Nothing listed here yet.',
}

const profileData = {
	displayName: 'Satoshi Nakamoto',
	picture: 'https://images.example/avatar.png',
	banner: 'https://images.example/banner.png',
	about: 'Building bitcoin things.',
	nip05: 'satoshi@nakamoto.org',
	nip05State: 'verified' as const,
}

function pageWith(...blocks: StorefrontBlock[]): StorefrontPage {
	return {
		version: 1,
		enabled: true,
		root: { props: { title: 'My shop', theme: 'default', palette: '', tune: STOREFRONT_TUNE_DEFAULTS } },
		content: blocks,
	}
}

describe('StorefrontRenderer', () => {
	test('renders every data-free block directly from the page document', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontRenderer, {
				page: pageWith(
					{
						type: 'Hero',
						props: { id: 'h', title: 'Welcome', subtitle: '', imageUrl: '', ctaLabel: '', ctaHref: '', align: 'center', minHeight: 360 },
					},
					{ type: 'Text', props: { id: 't', markdown: '# Hello', align: 'left', width: 'normal' } },
					{ type: 'Image', props: { id: 'i', url: 'https://images.example/x.png', alt: 'X', width: 'normal', rounded: true, href: '' } },
					{
						type: 'LinkList',
						props: { id: 'l', title: 'Links', links: [{ label: 'Docs', href: 'https://docs.example' }], layout: 'row' },
					},
					{ type: 'Divider', props: { id: 'd' } },
					{ type: 'Spacer', props: { id: 's', size: 'md' } },
				),
				pubkey: AUTHOR,
			}),
		)

		expect(markup).toContain('data-testid="storefront-page"')
		expect(markup).toContain('data-storefront-theme="default"')
		expect(markup).toContain('Welcome')
		expect(markup).toContain('<h1')
		expect(markup).toContain('>Hello</span>')
		expect(markup).toContain('alt="X"')
		expect(markup).toContain('Docs')
		expect(markup).toContain('<hr')
	})

	test('data-bound blocks render through the slots the host supplies', () => {
		const slots: StorefrontDataSlots = {
			ProductGrid: (props) =>
				createElement(ProductGridBlock, {
					...props,
					products: [product, secondProduct],
					isLoading: false,
					isError: false,
					renderProduct,
				}),
			FeaturedProduct: (props) =>
				createElement(FeaturedProductBlock, { ...props, products: [product], isLoading: false, isError: false, renderProduct }),
			ProfileHeader: (props) => createElement(ProfileHeaderBlock, { ...props, profile: profileData, isLoading: false }),
		}

		const markup = renderToStaticMarkup(
			createElement(StorefrontRenderer, {
				page: pageWith(
					{
						type: 'ProfileHeader',
						props: { id: 'p', showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
					},
					{ type: 'ProductGrid', props: { id: 'g', ...gridProps } },
					{ type: 'FeaturedProduct', props: { id: 'f', productDTag: 'mug' } },
				),
				pubkey: AUTHOR,
				slots,
			}),
		)

		expect(markup).toContain('Satoshi Nakamoto')
		expect(markup).toContain('Handmade Mug')
		expect(markup).toContain('Stoneware Plate')
		expect(markup).toContain('card-mug')
	})

	test('a missing slot degrades to the view&#39;s empty state instead of throwing', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontRenderer, {
				page: pageWith({ type: 'ProductGrid', props: { id: 'g', ...gridProps, emptyMessage: 'No products yet.' } }),
				pubkey: AUTHOR,
			}),
		)

		expect(markup).toContain('No products yet.')
	})

	test('the block switch is exhaustive: every schema block type renders', () => {
		const blocks: StorefrontBlock[] = [
			{
				type: 'ProfileHeader',
				props: { id: 'b1', showBanner: false, fullScreen: false, showAbout: false, showNip05: false, align: 'left' },
			},
			{
				type: 'Hero',
				props: { id: 'b2', title: '', subtitle: '', imageUrl: '', ctaLabel: '', ctaHref: '', align: 'left', minHeight: 120 },
			},
			{ type: 'Text', props: { id: 'b3', markdown: 'x', align: 'left', width: 'narrow' } },
			{ type: 'ProductGrid', props: { id: 'b4', ...gridProps } },
			{ type: 'FeaturedProduct', props: { id: 'b5', productDTag: '' } },
			{ type: 'LinkList', props: { id: 'b6', title: '', links: [], layout: 'column' } },
			{ type: 'Image', props: { id: 'b7', url: '', alt: '', width: 'narrow', rounded: false, href: '' } },
			{ type: 'Divider', props: { id: 'b8' } },
			{ type: 'Spacer', props: { id: 'b9', size: 'sm' } },
			// The live blocks: the switch must have a case for each schema member,
			// and with no slot they must degrade to their own empty state, not throw.
			{ type: 'ProductStrips', props: { id: 'b10', title: '', limit: 16, reverse: false } },
			{ type: 'BrowseStats', props: { id: 'b11', align: 'center' } },
			{ type: 'BrowseFeed', props: { id: 'b12', title: '', limit: 24, columns: 3, emptyMessage: 'Nothing yet.' } },
		]
		for (const block of blocks) {
			const markup = renderToStaticMarkup(createElement(StorefrontBlockView, { block }))
			expect(typeof markup).toBe('string')
		}
	})
})

describe('StorefrontLink', () => {
	test('renders safe https links with rel="noopener noreferrer nofollow"', () => {
		const markup = renderToStaticMarkup(createElement(StorefrontLink, { href: 'https://example.com', children: 'External' }))
		expect(markup).toContain('<a href="https://example.com"')
		expect(markup).toContain('noopener noreferrer nofollow')
		expect(markup).toContain('target="_blank"')
	})

	test('internal links keep the same document target and unsafe hrefs render inert', () => {
		const internal = renderToStaticMarkup(createElement(StorefrontLink, { href: '/products', children: 'In app' }))
		expect(internal).toContain('href="/products"')
		expect(internal).not.toContain('target=')

		const unsafe = renderToStaticMarkup(createElement(StorefrontLink, { href: 'javascript:alert(1)', children: 'Bad' }))
		expect(unsafe).not.toContain('<a')
		expect(unsafe).toContain('Bad')
	})

	test('in the editor canvas a click must not navigate', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(StorefrontLink, { href: 'https://example.com', children: 'Canvas' }),
			}),
		)
		expect(markup).not.toContain('<a')
		expect(markup).toContain('data-storefront-href="https://example.com"')
	})
})

describe('MiniMarkdown', () => {
	test('renders headings, emphasis, lists, quotes, code and links as React elements', () => {
		const markup = renderToStaticMarkup(
			createElement(MiniMarkdown, {
				source: '# Title\n\nA **bold** and *soft* [link](https://example.com) and `code`.\n\n- one\n- two\n\n> quoted',
			}),
		)

		expect(markup).toContain('<h1')
		expect(markup).toContain('<strong><span>bold</span></strong>')
		expect(markup).toContain('<em><span>soft</span></em>')
		expect(markup).toContain('<a href="https://example.com"')
		expect(markup).toContain('>code</code>')
		expect(markup).toContain('<ul')
		expect(markup).toContain('<li><span>one</span></li>')
		expect(markup).toContain('<blockquote')
	})

	test('an unsafe link target renders as characters, never as an anchor', () => {
		const markup = renderToStaticMarkup(createElement(MiniMarkdown, { source: '[x](javascript:alert(1))' }))
		expect(markup).not.toContain('<a')
		expect(markup).not.toContain('javascript:')
	})

	test('empty source renders nothing', () => {
		expect(renderToStaticMarkup(createElement(MiniMarkdown, { source: '   \n' }))).toBe('')
	})
})

describe('HeroBlock', () => {
	const hero = {
		title: 'Handmade Goods',
		subtitle: 'Mugs and plates',
		imageUrl: '',
		ctaLabel: '',
		ctaHref: '',
		align: 'center' as const,
		minHeight: 360,
	}

	test('renders title, subtitle and CTA', () => {
		const markup = renderToStaticMarkup(
			createElement(HeroBlock, {
				...hero,
				imageUrl: 'https://images.example/hero.jpg',
				ctaLabel: 'Shop now',
				ctaHref: 'https://example.com',
			}),
		)
		expect(markup).toContain('Handmade Goods')
		expect(markup).toContain('Shop now')
		expect(markup).toContain('background-image')
	})

	test('an empty hero renders nothing for visitors and a hint in the canvas', () => {
		expect(renderToStaticMarkup(createElement(HeroBlock, { ...hero, title: '', subtitle: '' }))).toBe('')

		const editing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(HeroBlock, { ...hero, title: '', subtitle: '' }),
			}),
		)
		expect(editing).toContain('Give this hero a title')
	})
})

describe('TextBlock', () => {
	test('renders markdown prose; empty text renders nothing for visitors', () => {
		const markup = renderToStaticMarkup(createElement(TextBlock, { markdown: '## About', align: 'left', width: 'normal' }))
		expect(markup).toContain('<h2')

		const empty = renderToStaticMarkup(createElement(TextBlock, { markdown: '  ', align: 'left', width: 'normal' }))
		expect(empty).toBe('')

		const editing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(TextBlock, { markdown: '', align: 'left', width: 'normal' }),
			}),
		)
		expect(editing).toContain('Write something')
	})
})

describe('ImageBlock', () => {
	test('renders a linked image and refuses unsafe sources', () => {
		const markup = renderToStaticMarkup(
			createElement(ImageBlock, {
				url: 'https://images.example/x.png',
				alt: 'A mug',
				width: 'normal',
				rounded: true,
				href: 'https://example.com',
			}),
		)
		expect(markup).toContain('alt="A mug"')
		expect(markup).toContain('<a')

		const unsafe = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(ImageBlock, { url: 'http://images.example/x.png', alt: 'A mug', width: 'normal', rounded: true, href: '' }),
			}),
		)
		expect(unsafe).toContain('Add an image URL')
	})
})

describe('LinkListBlock', () => {
	test('renders safe links in both layouts and drops hostile hrefs', () => {
		const markup = renderToStaticMarkup(
			createElement(LinkListBlock, {
				title: 'Elsewhere',
				links: [
					{ label: 'Docs', href: 'https://docs.example' },
					{ label: 'Evil', href: 'javascript:alert(1)' },
				],
				layout: 'row',
			}),
		)
		expect(markup).toContain('Docs')
		expect(markup).not.toContain('Evil')

		const column = renderToStaticMarkup(
			createElement(LinkListBlock, { title: 'Elsewhere', links: [{ label: 'Docs', href: '/docs' }], layout: 'column' }),
		)
		expect(column).toContain('flex-col')
	})

	test('no links renders nothing for visitors and a hint in the canvas', () => {
		expect(renderToStaticMarkup(createElement(LinkListBlock, { title: 'Elsewhere', links: [], layout: 'row' }))).toBe('')

		const editing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(LinkListBlock, { title: '', links: [], layout: 'row' }),
			}),
		)
		expect(editing).toContain('Add links')
	})
})

describe('SpacingBlocks', () => {
	test('divider renders an hr and spacer maps size to height', () => {
		expect(renderToStaticMarkup(createElement(DividerBlock, null))).toContain('<hr')
		expect(renderToStaticMarkup(createElement(SpacerBlock, { size: 'lg' }))).toContain('h-20')
	})
})

describe('ProductGridBlock (props-only view)', () => {
	test('loading state renders the loading message', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductGridBlock, { ...gridProps, products: null, isLoading: true, isError: false, renderProduct }),
		)
		expect(markup).toContain('Loading products…')
	})

	test('error state is reported, not flattened into "no products"', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductGridBlock, { ...gridProps, products: null, isLoading: false, isError: true, renderProduct }),
		)
		expect(markup).toContain('Products could not be loaded right now')
		expect(markup).not.toContain('Nothing listed here yet.')
	})

	test('empty state renders the author&#39;s message', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductGridBlock, { ...gridProps, products: [], isLoading: false, isError: false, renderProduct }),
		)
		expect(markup).toContain('Nothing listed here yet.')
	})

	test('filled state renders one card per product up to the limit', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductGridBlock, {
				...gridProps,
				limit: 1,
				products: [product, secondProduct],
				isLoading: false,
				isError: false,
				renderProduct,
			}),
		)
		expect(markup).toContain('Handmade Mug')
		expect(markup).not.toContain('Stoneware Plate')
	})

	test('collection source filters by collection tag, accepting bare and coordinate forms', () => {
		const markup = renderToStaticMarkup(
			createElement(ProductGridBlock, {
				...gridProps,
				source: 'collection',
				collectionDTag: 'summer',
				products: [product, secondProduct],
				isLoading: false,
				isError: false,
				renderProduct,
			}),
		)
		expect(markup).toContain('Stoneware Plate')
		expect(markup).not.toContain('Handmade Mug')
	})

	test('collection source with no collection picked is an editor-only hint', () => {
		const visitor = renderToStaticMarkup(
			createElement(ProductGridBlock, {
				...gridProps,
				source: 'collection',
				collectionDTag: '',
				products: [product],
				isLoading: false,
				isError: false,
				renderProduct,
			}),
		)
		expect(visitor).toBe('')

		const editing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(ProductGridBlock, {
					...gridProps,
					source: 'collection',
					collectionDTag: '',
					products: [product],
					isLoading: false,
					isError: false,
					renderProduct,
				}),
			}),
		)
		expect(editing).toContain('Pick a collection')
	})
})

describe('FeaturedProductBlock (props-only view)', () => {
	const featured = { productDTag: 'mug' }

	test('loading renders Loading, filled renders the referenced product card', () => {
		const loading = renderToStaticMarkup(
			createElement(FeaturedProductBlock, { ...featured, products: null, isLoading: true, isError: false, renderProduct }),
		)
		expect(loading).toContain('Loading…')

		const filled = renderToStaticMarkup(
			createElement(FeaturedProductBlock, { ...featured, products: [product], isLoading: false, isError: false, renderProduct }),
		)
		expect(filled).toContain('card-mug')
	})

	test('a missing product renders nothing for visitors and a hint in the canvas', () => {
		const visitor = renderToStaticMarkup(
			createElement(FeaturedProductBlock, { ...featured, products: [], isLoading: false, isError: false, renderProduct }),
		)
		expect(visitor).toBe('')

		const editing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(FeaturedProductBlock, { ...featured, products: [], isLoading: false, isError: false, renderProduct }),
			}),
		)
		expect(editing).toContain('No published product matches &quot;mug&quot;')

		const errorEditing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: true },
				children: createElement(FeaturedProductBlock, { ...featured, products: null, isLoading: false, isError: true, renderProduct }),
			}),
		)
		expect(errorEditing).toContain('could not be loaded')
	})

	test('no featured product chosen renders an editor hint only', () => {
		const visitor = renderToStaticMarkup(
			createElement(FeaturedProductBlock, { productDTag: '', products: [product], isLoading: false, isError: false, renderProduct }),
		)
		expect(visitor).toBe('')
	})
})

describe('ProfileHeaderBlock (props-only view)', () => {
	const header = { showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' as const }

	test('loading renders the Loading name fallback', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: false },
				children: createElement(ProfileHeaderBlock, { ...header, profile: null, isLoading: true }),
			}),
		)
		expect(markup).toContain('Loading…')
		expect(markup).toContain('data-testid="storefront-profile-header"')
	})

	test('filled renders the normalized display name, avatar picture, about and verified badge', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: false },
				children: createElement(ProfileHeaderBlock, { ...header, profile: profileData, isLoading: false }),
			}),
		)
		expect(markup).toContain('Satoshi Nakamoto')
		expect(markup).toContain('https://images.example/banner.png')
		expect(markup).toContain('Building bitcoin things.')
		expect(markup).toContain('data-testid="storefront-nip05-badge"')
		expect(markup).toContain('satoshi@nakamoto.org')
		expect(markup).toContain('aria-label="NIP-05 verified"')
	})

	test('about and nip05 respect their show flags', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: false },
				children: createElement(ProfileHeaderBlock, {
					...header,
					showAbout: false,
					showNip05: false,
					profile: profileData,
					isLoading: false,
				}),
			}),
		)
		expect(markup).not.toContain('Building bitcoin things.')
		expect(markup).not.toContain('storefront-nip05-badge')
	})

	test('an unsafe banner is dropped and the header falls back to the gradient', () => {
		const markup = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: AUTHOR, isEditing: false },
				children: createElement(ProfileHeaderBlock, {
					...header,
					profile: { ...profileData, banner: 'javascript:alert(1)' },
					isLoading: false,
				}),
			}),
		)
		expect(markup).not.toContain('background-image')
		expect(markup).not.toContain('javascript:alert(1)')
	})

	test('no pubkey renders an editor hint in the canvas and nothing for visitors', () => {
		const visitor = renderToStaticMarkup(createElement(ProfileHeaderBlock, { ...header, profile: null, isLoading: false }))
		expect(visitor).toBe('')

		const editing = renderToStaticMarkup(
			createElement(StorefrontProvider, {
				value: { pubkey: '', isEditing: true },
				children: createElement(ProfileHeaderBlock, { ...header, profile: null, isLoading: false }),
			}),
		)
		expect(editing).toContain('Your profile appears here')
	})
})
