import { parseStorefrontPage, STOREFRONT_PAGE_VERSION, type StorefrontPage } from '@sdk/commerce/storefront/storefrontPage'

/**
 * The authored home-page document for `/` — the composition the owner ruled the
 * home must show: a `Search` hero, a hand-picked `ProductRow` and the flat
 * `Categories` list.
 *
 * Why a *document* and not hand-written JSX: it is the builder's own format, so
 * the very same `StorefrontRenderer` + `storefrontBlockSlots` that draw a
 * published kind-30024 page draw the home. There is no second home layout to
 * keep in sync with the CMS.
 *
 * The document is authored in the app rather than published from the app key
 * because the app key is not a signing identity a client holds, and a staging
 * instance suppresses external publishing (ADR-016). When the app key's own
 * `home` page later becomes readable, the route can prefer it over this constant
 * and nothing else here changes.
 *
 * Authoring rules that are load-bearing, each one a trap paid for once already:
 *
 *  - `version` must equal `STOREFRONT_PAGE_VERSION`. `parseStorefrontPage`
 *    rejects any document whose version differs *before* it reads a single
 *    block, so a missing/again-bumped version makes the whole page parse to
 *    `null` and the renderer draws an empty root.
 *  - `root.props.palette` must be a real id from `STOREFRONT_PALETTE_KEYS`. The
 *    empty string means "the layout's default" only where the theme registry
 *    resolves it; here the registry is bypassed, so an unknown or empty value
 *    renders the blocks with no colour tokens — present in the DOM but
 *    invisible on screen.
 *  - Every entry in `ProductRow.productDTags` must be the real `d` tag of a
 *    published kind-30402 listing. A placeholder id is a fabricated row that
 *    resolves to nothing; the row then renders no card, which is worse than an
 *    honest empty row because a visitor is told a product exists that does not.
 *  - Every `Categories` entry resolves to `/?q=<key>` at the host, so `key` is a
 *    browse keyword, not a taxonomy node. The front end does no parent/child
 *    reasoning (owner ruling): the flat list is the whole authority.
 *
 * The block shape is Puck's own (`{ type, props: { id, ... } }`), unchanged, so
 * this file and the editor's published output are the same format.
 */
export const HOME_PAGE_DOCUMENT = {
	version: STOREFRONT_PAGE_VERSION,
	enabled: true,
	root: { props: { title: '', theme: 'default', palette: 'concrete' } },
	content: [
		{ type: 'Search', props: { id: 'home-search', placeholder: 'Search the marketplace', size: 'lg' } },
		{
			type: 'ProductRow',
			props: { id: 'home-row', productDTags: ['orange-flock-black-orange-edition-high-top-sneakers-ma5ond'] },
		},
		{
			type: 'Categories',
			props: {
				id: 'home-cats',
				title: 'Browse by category',
				categories: [
					{ label: 'Art', key: 'art' },
					{ label: 'Clothing', key: 'clothing' },
					{ label: 'Bitcoin', key: 'bitcoin' },
				],
			},
		},
	],
} as const

/**
 * The parsed home page, through the *same* parser a published page goes through
 * (`parseStorefrontPage`), so the home cannot render a document the CMS would
 * have rejected.
 *
 * Parsed once at module load and thrown on failure rather than degraded to an
 * empty page: an invalid authored constant is an authoring bug, and a loud
 * error at import is findable, whereas a silently empty home hides the bug
 * behind a blank screen. `homePage.test.ts` asserts this parse succeeds with
 * zero dropped blocks so the throw can never reach production unnoticed.
 */
export const HOME_PAGE: StorefrontPage = (() => {
	const result = parseStorefrontPage(JSON.stringify(HOME_PAGE_DOCUMENT))
	if (!result.page) throw new Error(`The authored home page document is invalid: ${result.error ?? 'unknown error'}`)
	return result.page
})()
