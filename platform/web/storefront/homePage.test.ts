import { describe, expect, test } from 'bun:test'
import { STOREFRONT_PALETTE_KEYS, STOREFRONT_PAGE_VERSION, parseStorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { HOME_PAGE, HOME_PAGE_DOCUMENT } from './homePage'

/**
 * Guards the authored home document against the two traps that made `/` render
 * an empty root before: a `version` the parser rejects outright, and a `palette`
 * the theme registry cannot resolve. A future edit that trips either must fail
 * here, not on the live home page.
 */
describe('the home page document', () => {
	test('parses through the published-page parser with nothing dropped', () => {
		const parsed = parseStorefrontPage(JSON.stringify(HOME_PAGE_DOCUMENT))
		expect(parsed.error).toBeNull()
		expect(parsed.droppedBlocks).toBe(0)
		expect(parsed.page?.version).toBe(STOREFRONT_PAGE_VERSION)
	})

	test('carries the block set the home must show, in order', () => {
		expect(HOME_PAGE.content.map((block) => block.type)).toEqual(['Search', 'ProductRow', 'Categories'])
	})

	test('names a real palette, not an empty or invented one', () => {
		expect((STOREFRONT_PALETTE_KEYS as readonly string[]).includes(HOME_PAGE.root.props.palette)).toBe(true)
	})

	test('every product row entry is a non-empty d-tag', () => {
		const row = HOME_PAGE.content.find((block) => block.type === 'ProductRow')
		expect(row?.type).toBe('ProductRow')
		if (row?.type === 'ProductRow') {
			expect(row.props.productDTags.length).toBeGreaterThan(0)
			for (const dTag of row.props.productDTags) expect(dTag.trim().length).toBeGreaterThan(0)
		}
	})
})
