import { describe, expect, test } from 'bun:test'
import { STOREFRONT_PAGE_D_TAG } from '@sdk/commerce/storefront/storefrontPage'
import { describePage, pageIsStorefront, pageLabel, pageNameNotice, validatePageName } from './pageIdentity'

const AUTHOR = 'a'.repeat(64)

describe('page identity', () => {
	test('the reserved default is the storefront page and nothing else', () => {
		expect(pageIsStorefront(STOREFRONT_PAGE_D_TAG)).toBe(true)
		expect(pageIsStorefront('featured-13-11-2026')).toBe(false)
		expect(pageIsStorefront('')).toBe(false)
	})

	test('the reserved default is shown as "Storefront", a custom page by its own name', () => {
		expect(pageLabel(STOREFRONT_PAGE_D_TAG)).toBe('Storefront')
		expect(pageLabel('featured-13-11-2026')).toBe('featured-13-11-2026')
	})

	test('a described page carries its name, author, switch and default flag', () => {
		expect(describePage({ author: AUTHOR, d: STOREFRONT_PAGE_D_TAG }, true)).toEqual({
			name: 'Storefront',
			authorLabel: `${AUTHOR.slice(0, 8)}…${AUTHOR.slice(-4)}`,
			enabled: true,
			isDefault: true,
		})
		expect(describePage({ author: AUTHOR, d: 'featured' }, false)).toEqual({
			name: 'featured',
			authorLabel: `${AUTHOR.slice(0, 8)}…${AUTHOR.slice(-4)}`,
			enabled: false,
			isDefault: false,
		})
	})
})

describe('validatePageName', () => {
	test('accepts a name the path layer would accept', () => {
		expect(validatePageName('featured-13-11-2026')).toBeNull()
		expect(validatePageName('shop_2')).toBeNull()
	})

	test('refuses the reserved default: it already exists', () => {
		const error = validatePageName(STOREFRONT_PAGE_D_TAG)
		expect(error).toContain(STOREFRONT_PAGE_D_TAG)
		expect(error).toContain('cannot be used for a new page')
	})

	test('refuses empty, too short, uppercase and multi-segment names', () => {
		expect(validatePageName('')).toContain('Enter a name')
		expect(validatePageName('ab')).toContain('3–30 characters')
		expect(validatePageName('Featured')).toContain('3–30 characters')
		expect(validatePageName('shop/featured')).toContain('3–30 characters')
		expect(validatePageName('-shop')).toContain('3–30 characters')
	})
})

describe('pageNameNotice', () => {
	test('is silent for a name the author does not have', () => {
		expect(pageNameNotice('featured', [])).toBeNull()
		expect(pageNameNotice('featured', ['shop'])).toBeNull()
	})

	test('says what creating an existing name does, without calling it an error', () => {
		expect(pageNameNotice('featured', ['featured'])).toContain('opens the existing one')
	})
})
