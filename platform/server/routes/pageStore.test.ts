import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPageStore, type StoredPage } from './pageStore'
import { createEmptyStorefrontPage } from '@sdk/commerce/storefront/storefrontPage'

const AUTHOR = 'a'.repeat(64)
const NOW = 1_800_000_000

const directories: string[] = []
const root = (): string => {
	const directory = mkdtempSync(join(tmpdir(), 'ar-pages-'))
	directories.push(directory)
	return directory
}

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const stored = (overrides: Partial<StoredPage> = {}): StoredPage => ({
	document: createEmptyStorefrontPage(),
	html: '<div data-testid="storefront-page">page</div>',
	meta: { title: 'T', description: '', ogImage: null, canonical: null },
	eventId: 'f'.repeat(64),
	createdAt: NOW,
	author: AUTHOR,
	d: 'home',
	series: [],
	...overrides,
})

describe('pageStore — put and get', () => {
	test('a page round-trips from one derived path', () => {
		const store = createPageStore({ root: root() })
		store.put(stored())
		const page = store.get(AUTHOR, 'home')
		expect(page?.html).toContain('storefront-page')
		expect(page?.eventId).toBe('f'.repeat(64))
	})

	test('a missing page is null, not an error and not a scan', () => {
		const store = createPageStore({ root: root() })
		expect(store.get(AUTHOR, 'absent')).toBeNull()
		expect(store.get('not-hex', 'home')).toBeNull()
	})

	test('the second write leaves the previous bytes in .bak', () => {
		const directory = root()
		const store = createPageStore({ root: directory })
		store.put(stored({ html: 'first' }))
		store.put(stored({ html: 'second' }))

		const path = join(directory, AUTHOR, 'home.json')
		expect(readFileSync(path, 'utf8')).toContain('second')
		expect(existsSync(`${path}.bak`)).toBe(true)
		expect(readFileSync(`${path}.bak`, 'utf8')).toContain('first')
	})

	test('a `d` with slashes or traversal is encoded, never used as a path', () => {
		const directory = root()
		const store = createPageStore({ root: directory })
		store.put(stored({ d: '../escape' }))
		expect(store.get(AUTHOR, '../escape')?.d).toBe('../escape')
		expect(existsSync(join(directory, 'escape.json'))).toBe(false)
		// The file lives under the author directory with an encoded name.
		const encoded = encodeURIComponent('../escape')
		expect(existsSync(join(directory, AUTHOR, `${encoded}.json`))).toBe(true)
	})
})

describe('pageStore — the series index', () => {
	test('members are newest-first and a re-store of one member does not duplicate it', () => {
		const store = createPageStore({ root: root() })
		store.put(stored({ d: 'oldest', createdAt: NOW - 20, eventId: '1'.repeat(64), series: ['featured'] }))
		store.put(stored({ d: 'newest', createdAt: NOW, eventId: '2'.repeat(64), series: ['featured'] }))
		store.put(stored({ d: 'middle', createdAt: NOW - 10, eventId: '3'.repeat(64), series: ['featured'] }))
		// Re-store the oldest page: it must move to its own slot, not be duplicated.
		store.put(stored({ d: 'oldest', createdAt: NOW + 5, eventId: '1'.repeat(64), series: ['featured'] }))

		expect(store.seriesMembers('featured', AUTHOR).map((member) => member.d)).toEqual(['oldest', 'newest', 'middle'])
	})

	test('the index is per author and per series key', () => {
		const store = createPageStore({ root: root() })
		store.put(stored({ d: 'a', series: ['featured'] }))
		store.put(stored({ d: 'b', author: 'b'.repeat(64), series: ['featured'] }))
		expect(store.seriesMembers('featured', AUTHOR)).toHaveLength(1)
		expect(store.seriesMembers('featured', AUTHOR)[0].d).toBe('a')
	})
})
