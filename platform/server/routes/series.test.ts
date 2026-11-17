import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyStorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { createPageStore, type SeriesMember, type StoredPage } from './pageStore'
import { resolveSeries, type SeriesIndex } from './series'
import type { SeriesTarget } from './routeFile'

const AUTHOR = 'a'.repeat(64)
const OUTSIDER = 'b'.repeat(64)
const NOW = 1_800_000_000

const directories: string[] = []
const root = (): string => {
	const directory = mkdtempSync(join(tmpdir(), 'ar-series-'))
	directories.push(directory)
	return directory
}

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const stored = (overrides: Partial<StoredPage> = {}): StoredPage => ({
	document: createEmptyStorefrontPage(),
	html: '<div>page</div>',
	meta: { title: 'T', description: '', ogImage: null, canonical: null },
	eventId: 'f'.repeat(64),
	createdAt: NOW,
	author: AUTHOR,
	d: 'home',
	series: ['featured'],
	...overrides,
})

const target = (author = AUTHOR): SeriesTarget => ({ type: 'series', series: 'featured', author })

describe('resolveSeries — the newest present member', () => {
	// T13
	test('the newest member wins', () => {
		const store = createPageStore({ root: root() })
		store.put(stored({ d: 'oldest', createdAt: NOW - 20, eventId: '1'.repeat(64) }))
		store.put(stored({ d: 'newest', createdAt: NOW, eventId: '2'.repeat(64) }))
		store.put(stored({ d: 'middle', createdAt: NOW - 10, eventId: '3'.repeat(64) }))

		expect(resolveSeries(target(), store, store)).toEqual({ outcome: 'found', author: AUTHOR, d: 'newest' })
	})

	// T14
	test('a newest member whose page file is gone is skipped for the next present member', () => {
		const directory = root()
		const store = createPageStore({ root: directory })
		store.put(stored({ d: 'present', createdAt: NOW - 10, eventId: '1'.repeat(64) }))
		store.put(stored({ d: 'vanished', createdAt: NOW, eventId: '2'.repeat(64) }))

		// The page file is removed; the index entry remains. This is the state the
		// walk must survive without reading a directory.
		rmSync(join(directory, AUTHOR, `${encodeURIComponent('vanished')}.json`))
		expect(store.has(AUTHOR, 'vanished')).toBe(false)

		expect(resolveSeries(target(), store, store)).toEqual({ outcome: 'found', author: AUTHOR, d: 'present' })
	})

	// T15
	test('an empty index is empty, not an error, and not a scan of the author directory', () => {
		const asked: Array<[string, string]> = []
		const index: SeriesIndex = {
			seriesMembers(series, author) {
				asked.push([series, author])
				return [] as SeriesMember[]
			},
		}
		let hasCalls = 0
		const store = {
			has: () => {
				hasCalls += 1
				return true
			},
		}

		expect(resolveSeries(target(), index, store)).toEqual({ outcome: 'empty' })
		// It asked the index for exactly this author's series, and — with nothing
		// to walk — never probed the store.
		expect(asked).toEqual([['featured', AUTHOR]])
		expect(hasCalls).toBe(0)
	})

	// T16
	test("[GUARD] an outsider's membership never wins: the walk reads only (series, target.author)", () => {
		const store = createPageStore({ root: root() })
		store.put(stored({ d: 'owner', createdAt: NOW - 10, eventId: '1'.repeat(64) }))
		// A page by someone else, tagged into the same series and *newer* — it must
		// not become /featured, because the series is keyed (series, owner).
		store.put(stored({ d: 'outsider', author: OUTSIDER, createdAt: NOW + 100, eventId: '2'.repeat(64) }))

		expect(resolveSeries(target(AUTHOR), store, store)).toEqual({ outcome: 'found', author: AUTHOR, d: 'owner' })
		// And the outsider can only ever answer their *own* series, which no path
		// is bound to.
		expect(resolveSeries(target(OUTSIDER), store, store)).toEqual({ outcome: 'found', author: OUTSIDER, d: 'outsider' })
	})
})
