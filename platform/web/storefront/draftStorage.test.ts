import { beforeEach, describe, expect, test } from 'bun:test'
import { STOREFRONT_PAGE_D_TAG, createEmptyStorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { clearStorefrontDraft, hasStorefrontDraft, loadStorefrontDraft, saveStorefrontDraft } from './draftStorage'

/**
 * The draft key gained a page-address segment. These tests pin the two things
 * that can silently cost an author work: an unsaved draft written before the
 * split must still load, and two pages must never share one draft.
 *
 * `draftStorage` guards every localStorage access, so a fake store is enough —
 * there is no browser here, and the module under test never reaches the network.
 */

const PUBKEY = 'a'.repeat(64)

const store = new Map<string, string>()
const fakeLocalStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => void store.set(key, value),
	removeItem: (key: string) => void store.delete(key),
}

beforeEach(() => {
	store.clear()
	;(globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage
})

const page = (title: string) => ({ ...createEmptyStorefrontPage(), root: { props: { title } } })

describe('the storefront draft key', () => {
	test('a draft written under the pre-address key still loads, once', () => {
		// The legacy key had no `d` segment: `plebeian-storefront-draft:<pubkey>`.
		store.set(`plebeian-storefront-draft:${PUBKEY}`, JSON.stringify(page('Yesterday’s work')))

		const loaded = loadStorefrontDraft(PUBKEY)
		expect(loaded?.root.props.title).toBe('Yesterday’s work')

		// It was re-saved under the new key, so the second read needs no fallback.
		expect(store.has(`plebeian-storefront-draft:${PUBKEY}:${STOREFRONT_PAGE_D_TAG}`)).toBe(true)
		expect(store.get(`plebeian-storefront-draft:${PUBKEY}:${STOREFRONT_PAGE_D_TAG}`)).toContain('Yesterday’s work')
	})

	test('the legacy key is not consulted for a custom page address', () => {
		store.set(`plebeian-storefront-draft:${PUBKEY}`, JSON.stringify(page('Storefront only')))
		expect(loadStorefrontDraft(PUBKEY, 'featured-13-11-2026')).toBeNull()
	})

	test('two page addresses do not share a draft', () => {
		saveStorefrontDraft(PUBKEY, STOREFRONT_PAGE_D_TAG, page('Default page'))
		saveStorefrontDraft(PUBKEY, 'featured-13-11-2026', page('Featured page'))

		expect(loadStorefrontDraft(PUBKEY)?.root.props.title).toBe('Default page')
		expect(loadStorefrontDraft(PUBKEY, 'featured-13-11-2026')?.root.props.title).toBe('Featured page')
	})

	test('clearing one address leaves the other draft alone', () => {
		saveStorefrontDraft(PUBKEY, STOREFRONT_PAGE_D_TAG, page('Default page'))
		saveStorefrontDraft(PUBKEY, 'featured', page('Featured page'))

		clearStorefrontDraft(PUBKEY, 'featured')

		expect(hasStorefrontDraft(PUBKEY, 'featured')).toBe(false)
		expect(hasStorefrontDraft(PUBKEY, STOREFRONT_PAGE_D_TAG)).toBe(true)
	})

	test('an address with no draft is null, not the default page’s draft', () => {
		saveStorefrontDraft(PUBKEY, STOREFRONT_PAGE_D_TAG, page('Default page'))
		expect(loadStorefrontDraft(PUBKEY, 'about-us')).toBeNull()
	})
})
