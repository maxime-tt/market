import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { writeAtomic } from './routeFile'

/**
 * The local page store — the only source of a served page's bytes.
 *
 * `IMPLEMENTATION-PLAN.md` §1.4.1. One directory per page, keyed by the
 * coordinate the routing file names:
 *
 *   data/pages/<author-hex>/<d>.json            { document, html, meta, … }
 *   data/pages/series/<key>/<author>.json       [{ d, createdAt, eventId }]
 *
 * The path is derived from `(author, d)`; `get` is one file read and never a
 * scan or an index lookup. Writes use the same `writeAtomic` device as the
 * routing file, so a failed write leaves the previous page intact and `.bak`
 * holds the previous bytes.
 */

export interface PageMeta {
	title: string
	description: string
	ogImage: string | null
	/** Null at ingest: the canonical URL is the path the request arrived on. */
	canonical: string | null
}

export interface StoredPage {
	document: StorefrontPage
	html: string
	meta: PageMeta
	eventId: string
	createdAt: number
	author: string
	d: string
	series: string[]
}

export interface SeriesMember {
	d: string
	createdAt: number
	eventId: string
}

export interface PageStore {
	put(page: StoredPage): void
	get(author: string, d: string): StoredPage | null
	seriesMembers(series: string, author: string): SeriesMember[]
	root: string
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * One path segment derived from an untrusted tag value. `encodeURIComponent`
 * makes `/`, `..` and NUL inert; the length cap keeps a hostile `d` from
 * producing an unusable filename.
 */
function segment(value: string): string | null {
	if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null
	const encoded = encodeURIComponent(value)
	if (encoded === '.' || encoded === '..' || encoded.length > 768) return null
	return encoded
}

export interface PageStoreOptions {
	/** Defaults to `$AR_PAGES_DIR` or `./data/pages`. */
	root?: string
}

export function createPageStore(options: PageStoreOptions = {}): PageStore {
	const root = options.root ?? process.env.AR_PAGES_DIR ?? './data/pages'

	const pagePath = (author: string, d: string): string | null => {
		if (!HEX64.test(author)) return null
		const leaf = segment(d)
		return leaf ? join(root, author, `${leaf}.json`) : null
	}

	const seriesPath = (series: string, author: string): string | null => {
		if (!HEX64.test(author)) return null
		const key = segment(series)
		return key ? join(root, 'series', key, `${author}.json`) : null
	}

	const readJson = (path: string): unknown => {
		try {
			if (!existsSync(path)) return null
			return JSON.parse(readFileSync(path, 'utf8'))
		} catch {
			return null
		}
	}

	return {
		root,

		put(page: StoredPage): void {
			const path = pagePath(page.author, page.d)
			if (!path) throw new Error(`invalid-page-coordinate: cannot store (${page.author}, ${page.d})`)
			writeAtomic(path, `${JSON.stringify(page, null, 2)}\n`)

			// The series index is rebuilt on each store, newest-first. It is a
			// local read-modify-write of one small file, never a scan of the store.
			for (const series of page.series) {
				const indexPath = seriesPath(series, page.author)
				if (!indexPath) continue
				const existing = readJson(indexPath)
				const members: SeriesMember[] = Array.isArray(existing) ? (existing as SeriesMember[]).filter((member) => member?.d !== page.d) : []
				members.push({ d: page.d, createdAt: page.createdAt, eventId: page.eventId })
				members.sort((a, b) => b.createdAt - a.createdAt || b.eventId.localeCompare(a.eventId))
				writeAtomic(indexPath, `${JSON.stringify(members, null, 2)}\n`)
			}
		},

		get(author: string, d: string): StoredPage | null {
			const path = pagePath(author, d)
			if (!path) return null
			const stored = readJson(path)
			if (typeof stored !== 'object' || stored === null) return null
			const candidate = stored as StoredPage
			if (typeof candidate.html !== 'string' || typeof candidate.document !== 'object') return null
			return candidate
		},

		seriesMembers(series: string, author: string): SeriesMember[] {
			const path = seriesPath(series, author)
			if (!path) return []
			const members = readJson(path)
			return Array.isArray(members) ? (members as SeriesMember[]) : []
		},
	}
}
