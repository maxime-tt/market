import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StorefrontBlock, StorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { StorefrontBlockView, StorefrontRenderer, type StorefrontDataSlots } from '@ui/storefront/StorefrontRenderer'
import type { PageMeta } from './pageStore'

/**
 * Document → HTML fragment, rendered ONCE at ingest inside the Bun server
 * process (`IMPLEMENTATION-PLAN.md` §1.4.2, §R4.4).
 *
 * The 7/5 split, and why it is the binding shape rather than a convenience:
 *
 *   - static blocks (ProfileHeader, Hero, Text, LinkList, Image, Divider,
 *     Spacer) are rendered to HTML and served as-is;
 *   - data-bound blocks (ProductGrid, FeaturedProduct, ProductRow, Search,
 *     Categories) are emitted as a placeholder region carrying the block's
 *     `type` and the block's own "no data yet" view. The existing client slot
 *     map (`platform/web/storefront/StorefrontBlockSlots.tsx`) fills them
 *     after hydration — this module never resolves live data and never dips
 *     into a relay.
 *
 * `renderToStaticMarkup`, not a browser render: measured to work under Bun
 * with no `window`/`document` (probe: 1829 characters for a 3-block page).
 */

export interface RenderedPage {
	html: string
	meta: PageMeta
}

export class PageRenderError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'PageRenderError'
	}
}

/** Blocks whose live content is the client's job; the server emits their empty state. */
export const DATA_BOUND_BLOCK_TYPES = ['ProductGrid', 'FeaturedProduct', 'ProductRow', 'Search', 'Categories'] as const

function placeholder(block: StorefrontBlock): ReactElement {
	return createElement(
		'div',
		{
			'data-ar-block': block.type,
			'data-ar-block-id': block.props.id,
			'data-ar-block-placeholder': 'true',
		},
		// No slot map: the renderer's props-only view is the documented
		// "no data yet" state (StorefrontRenderer.tsx:105-166).
		createElement(StorefrontBlockView, { block }),
	)
}

/**
 * The placeholder regions.
 *
 * The renderer's slot signature (`StorefrontDataSlots`) types each slot's
 * argument as the block's document-facing props **without** `id` — `ui/` treats
 * `id` as the block's own key rather than a view prop (`StorefrontRenderer.tsx`,
 * the `Categories` case) — while it is passed `block.props`, which carries it
 * (`slots.ProductGrid(block.props)`). So the block is found by the **identity of
 * the props object** the renderer hands over, not by re-deriving a key: no cast,
 * and no second reading of the document.
 */
function buildSlots(page: StorefrontPage): StorefrontDataSlots {
	const regions = new WeakMap<object, StorefrontBlock>()
	for (const block of page.content) regions.set(block.props, block)

	const slot =
		(type: StorefrontBlock['type']) =>
		(props: object): ReactElement => {
			const block = regions.get(props)
			return block ? placeholder(block) : createElement('div', { 'data-ar-block': type, 'data-ar-block-missing': 'true' })
		}

	return {
		ProductGrid: slot('ProductGrid'),
		FeaturedProduct: slot('FeaturedProduct'),
		ProductRow: slot('ProductRow'),
		Search: slot('Search'),
		Categories: slot('Categories'),
	}
}

function plainText(markdown: string): string {
	return markdown
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#*_`>~-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/** Derived once at ingest, so a request does no derivation at all. */
export function derivePageMeta(page: StorefrontPage): PageMeta {
	const hero = page.content.find((block) => block.type === 'Hero')
	const text = page.content.find((block) => block.type === 'Text')
	const image = page.content.find((block) => block.type === 'Image')

	const title = page.root.props.title.trim() || (hero && hero.type === 'Hero' ? hero.props.title.trim() : '') || 'Storefront'
	const description =
		(text && text.type === 'Text' ? plainText(text.props.markdown) : '') ||
		(hero && hero.type === 'Hero' ? plainText(hero.props.subtitle) : '')

	const ogImage =
		image && image.type === 'Image' && image.props.url
			? image.props.url
			: hero && hero.type === 'Hero' && hero.props.imageUrl
				? hero.props.imageUrl
				: null

	return { title, description: description.slice(0, 300), ogImage, canonical: null }
}

/**
 * Renders the page. Throws `PageRenderError` — the ingest endpoint turns that
 * into a refusal, because a page that cannot render is not stored (§1.5).
 */
export function renderPage(page: StorefrontPage, options: { author: string }): RenderedPage {
	let html: string
	try {
		html = renderToStaticMarkup(
			createElement(StorefrontRenderer, {
				page,
				pubkey: options.author,
				slots: buildSlots(page),
			}),
		)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new PageRenderError(detail)
	}

	if (html.length === 0) throw new PageRenderError('renderer produced an empty fragment')
	return { html, meta: derivePageMeta(page) }
}
