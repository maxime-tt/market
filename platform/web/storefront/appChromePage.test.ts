/**
 * platform/web/storefront/appChromePage.test.ts — the client's half of the
 * `#__AR_ROUTE__` seam.
 *
 * The reader is deliberately narrow: a document either carries a well-formed
 * payload naming an author, a `d` tag and the path the server answered for, or
 * it is not an app-chrome page at all. Everything here is about that boundary —
 * a payload that does not say which path it was served for cannot be matched,
 * and `#__AR_PAGE__` is the *other* seam's id, not this reader's business.
 *
 * The DOM is `happy-dom`, installed before the module under test is imported,
 * the same shape `platform/web/browse/browseIndexFeed.render.test.tsx` uses (the
 * unit suite has no renderer of its own).
 */

import { afterAll, describe, expect, test } from 'bun:test'

/**
 * The slice of happy-dom's `Window` this file uses. Named structurally rather
 * than imported from the package: happy-dom's own declarations add errors to
 * `tsc`'s program that the repository's baseline does not carry.
 */
interface HappyWindow {
	document: Document
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []

for (const key of Object.getOwnPropertyNames(win)) {
	if (key in globalThis) continue
	try {
		Object.defineProperty(globalThis, key, {
			value: Reflect.get(win, key),
			configurable: true,
			writable: true,
		})
		installedGlobals.push(key)
	} catch {
		// A window property Bun already owns stays Bun's.
	}
}

const doc = globals.document as Document

// Dynamic on purpose: the DOM globals must exist before the module is evaluated.
const { appChromePageForPath, readAppChromePage } = await import('./appChromePage')

afterAll(() => {
	for (const key of installedGlobals) delete globals[key]
})

const SHELL = '<div id="root"></div>'

/** The shell the server sends, plus whatever scripts the case needs. */
function writeDocument(...scripts: string[]): void {
	doc.body.innerHTML = SHELL + scripts.join('')
}

function routeScript(body: string): string {
	return `<script id="__AR_ROUTE__" type="application/json">${body}</script>`
}

describe('readAppChromePage', () => {
	test('reads the payload out of a shell that names a page', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })))

		expect(readAppChromePage()).toEqual({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })
	})

	test('tolerates extra fields the server may add later', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/shop', version: 1 })))

		expect(readAppChromePage()).toEqual({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })
	})

	test('is a memo: the same body yields the same payload object', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })))

		const first = readAppChromePage()
		expect(first).not.toBeNull()
		expect(readAppChromePage()).toBe(first)
	})

	test('a malformed body is null, never a throw', () => {
		writeDocument(routeScript('not json'))

		expect(readAppChromePage()).toBeNull()
	})

	test('a payload without a path is null — it cannot be matched to a URL', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop' })))

		expect(readAppChromePage()).toBeNull()
	})

	test('a payload with a mistyped field is null', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 7, path: '/shop' })))

		expect(readAppChromePage()).toBeNull()
	})

	test('a document with no payload script is null', () => {
		writeDocument()

		expect(readAppChromePage()).toBeNull()
	})

	test('a served document is not this reader’s business', () => {
		// `#__AR_PAGE__` is the standalone seam's id (`servedPage.tsx`): that
		// document hydrates outside the router, and reading it here would render
		// the page twice.
		writeDocument('<script id="__AR_PAGE__" type="application/json">{"author":"a","d":"shop","version":1}</script>')

		expect(readAppChromePage()).toBeNull()
	})
})

describe('appChromePageForPath', () => {
	test('matches the path the payload was served for', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })))

		expect(appChromePageForPath('/shop')).toEqual({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })
	})

	test('matches through the server’s normalisation (case and trailing slash)', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/Shop/' })))

		expect(appChromePageForPath('/shop')).not.toBeNull()
	})

	test('does not match a different path — the payload is about one URL', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })))

		expect(appChromePageForPath('/dashboard')).toBeNull()
	})

	test('does not match a path that only shares a prefix', () => {
		writeDocument(routeScript(JSON.stringify({ author: 'a'.repeat(64), d: 'shop', path: '/shop' })))

		expect(appChromePageForPath('/shop/checkout')).toBeNull()
	})

	test('no payload in the document means no page for any path', () => {
		writeDocument()

		expect(appChromePageForPath('/shop')).toBeNull()
	})
})
