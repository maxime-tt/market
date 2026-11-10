/**
 * platform/web/browse/BrowseIndexHost.search-focus.test.tsx — typing survives
 * the state change.
 *
 * The blocker this file answers: the first character typed into the idle hero's
 * search field flipped the host to its results state, the hero — and the input
 * with it — unmounted, and focus fell to `<body>`, so exactly one character
 * landed per click. The fix is structural (the nav band's field is rendered by
 * the host, outside every state branch, so it is the same element in the idle
 * and results trees) plus one handoff (the commit that leaves the idle state
 * moves the caret into that field).
 *
 * It is asserted against a real DOM rather than by reading markup: "the element
 * still has focus" is not visible in a string. `happy-dom` is the renderer (it
 * is in the lockfile as the `@tiptap/html` peer; this file installs its globals
 * itself and removes them afterwards), driven by React's own `act`.
 *
 * The *host* is what renders here, not a stand-in: the focus loss lived in which
 * branch owned the input, and only the host's tree has that branch.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act, createElement, useState } from 'react'
import type { Root } from 'react-dom/client'
import type { BrowseProduct, BrowseSearchResult } from './browseProductMap'

// ---------------------------------------------------------------------------
// The reads — stubbed, so the tree under test is the host's own
// ---------------------------------------------------------------------------

const PRODUCT: BrowseProduct = {
	id: 'ceramic-ball',
	eventId: 'evt-ceramic-ball',
	pubkey: 'a'.repeat(64),
	title: 'Handcrafted Ceramic Ball',
	price: 21000,
	stock: '76 in stock',
	categories: ['pottery'],
}

const RESULTS: BrowseSearchResult = { products: [PRODUCT], eose: ['wss://local'], pending: [] }

mock.module('@platform/web/browse/browseQuery', () => ({
	useBrowseSearch: () => ({ data: RESULTS, isLoading: false, isError: false }),
	useBrowseProductDetail: () => ({ data: null, isLoading: false, isError: false, refetch: () => {} }),
	useBrowseFamilyChildren: () => ({ data: null, isLoading: false, isError: false }),
	useBrowseFacets: () => ({ data: null, isLoading: false, isError: false }),
}))

mock.module('@platform/web/browse/browseIndexFeed', () => ({
	useBrowseIndexFeed: () => ({ data: null, isLoading: false, isError: false }),
	feedStrips: () => [],
}))

mock.module('@platform/web/auth/authStore', () => ({
	useAuth: () => ({ user: null, isAuthenticated: false }),
}))

mock.module('@platform/web/utils/clipboard', () => ({ copyToClipboard: async () => {} }))

mock.module('@platform/web/profiles/profileQuery', () => ({
	useProfile: () => ({ data: null }),
	// The host reads the idle wall's seller names unconditionally — a hook
	// cannot live inside the state branch — so the stub answers it empty.
	useProfileNames: () => new Map<string, string>(),
	getNormalizedProfileDisplayName: () => null,
	getNormalizedProfilePicture: () => '',
}))

mock.module('@platform/web/products/PriceDisplayHost', () => ({
	usePriceDisplay: () => ({
		price: { isBitcoinCurrency: false, satsValue: null, fiatValue: null },
		isLoading: false,
		selectedCurrency: 'USD',
	}),
}))

// ---------------------------------------------------------------------------
// A DOM for this file — installed before any DOM-touching module is imported
// ---------------------------------------------------------------------------

/**
 * The slice of happy-dom's `Window` this file uses.
 *
 * Named here rather than imported from the package on purpose: happy-dom's own
 * `.d.ts` files add two errors to `tsc`'s program that the repository's error
 * baseline does not carry (`NodeJS.NonSharedUint8Array`, `node:stream/web`),
 * and this is a test-only renderer — nothing in the shipped tree may depend on
 * its types. A specifier held in a variable also keeps the compiler from
 * loading that declaration tree.
 */
interface HappyWindow {
	Event: typeof globalThis.Event
	HTMLInputElement: new () => object
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

/**
 * Dynamic on purpose, and the only place in this file it is: the DOM globals
 * below must exist *before* `react-dom` is evaluated, and the `mock.module`
 * registrations above must be in place before the host's own imports resolve.
 * Static imports are hoisted above both requirements.
 */
const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []

// React's act() refuses to run without this flag.
globals.IS_REACT_ACT_ENVIRONMENT = true

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
		// A window property Bun already owns (timers, fetch, …) stays Bun's.
	}
}

/** happy-dom's document, installed above. */
const doc = globals.document as Document

const { createRoot } = await import('react-dom/client')
const { BrowseIndexHost } = await import('./BrowseIndexHost')

afterAll(() => {
	for (const key of installedGlobals) delete globals[key]
	delete globals.IS_REACT_ACT_ENVIRONMENT
})

// ---------------------------------------------------------------------------
// Harness — the host wired the way the route wires it
// ---------------------------------------------------------------------------

/**
 * The route's own contract: `onNavigate` writes the URL state back, and the
 * host re-renders from it. Typing is exactly that round trip, per keystroke.
 */
function Harness() {
	const [q, setQ] = useState('')
	return createElement(BrowseIndexHost, {
		q,
		p: undefined,
		onNavigate: (next: { q: string }) => setQ(next.q),
		onNavigateFeatured: () => {},
	})
}

/**
 * happy-dom's `Event` class is structurally narrower than the DOM lib's, which
 * is what this file annotates its elements with; the object dispatched is still
 * happy-dom's own, which is what its `dispatchEvent` requires at runtime.
 */
const DomEvent = win.Event as unknown as typeof globalThis.Event

/**
 * One keystroke: set the input's value through its *prototype* setter (which
 * bypasses React's value tracker, as a browser keystroke would) and fire the
 * `input` event React listens for.
 */
function typeInto(input: HTMLInputElement, value: string) {
	const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, 'value')?.set
	if (!setValue) throw new Error('no value setter on this input')
	setValue.call(input, value)
	input.dispatchEvent(new DomEvent('input', { bubbles: true }))
}

const heroInput = () => doc.querySelector<HTMLInputElement>('[data-testid="widget-browse-idle-search"] input')
const activeInput = () => {
	const active = doc.activeElement
	if (!(active instanceof win.HTMLInputElement)) throw new Error(`focus is on ${active?.tagName ?? 'nothing'}, not an input`)
	return active as HTMLInputElement
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
	doc.body.innerHTML = ''
	container = doc.createElement('div')
	doc.body.appendChild(container)
	root = createRoot(container)
	await act(async () => {
		root.render(createElement(Harness))
	})
})

// ---------------------------------------------------------------------------
// The blocker
// ---------------------------------------------------------------------------

describe('BrowseIndexHost search focus', () => {
	test('the idle hero field is focused before typing', () => {
		const hero = heroInput()
		expect(hero).not.toBeNull()
		hero?.focus()
		expect(doc.activeElement).toBe(hero)
	})

	test('the first character keeps a live, focused field — and the idle screen is gone', async () => {
		const hero = heroInput()
		if (!hero) throw new Error('the idle hero rendered no search field')
		hero.focus()

		await act(async () => {
			typeInto(hero, 'c')
		})

		// The state change happened: the hero (and its field) unmounted.
		expect(doc.querySelector('[data-testid="widget-browse-idle-search"]')).toBeNull()

		// …but the caret is in an input that is still mounted, in the nav band,
		// holding the character that was typed.
		const live = activeInput()
		expect(live.value).toBe('c')
		expect(live.isConnected).toBe(true)
		expect(live.closest('[data-slot="search-field"]')?.getAttribute('data-size')).toBe('nav')
	})

	test('every later character lands in the same field — no re-click', async () => {
		const hero = heroInput()
		if (!hero) throw new Error('the idle hero rendered no search field')
		hero.focus()

		await act(async () => {
			typeInto(hero, 'c')
		})
		const live = activeInput()

		await act(async () => {
			typeInto(live, 'ce')
		})

		expect(activeInput()).toBe(live)
		expect(live.value).toBe('ce')

		await act(async () => {
			typeInto(live, 'cer')
		})

		expect(activeInput()).toBe(live)
		expect(live.value).toBe('cer')
	})

	test('the nav field keeps the caret while the results update', async () => {
		const hero = heroInput()
		if (!hero) throw new Error('the idle hero rendered no search field')
		hero.focus()

		await act(async () => {
			typeInto(hero, 'c')
		})
		const nav = activeInput()
		expect(nav.value).toBe('c')

		// Each keystroke re-renders with a fresh results array (the stub returns
		// the same read, but the host rebuilds its cards) — focus must survive it.
		for (const value of ['ce', 'cer', 'cera']) {
			await act(async () => {
				typeInto(nav, value)
			})
			expect(doc.activeElement).toBe(nav)
		}
		expect(nav.value).toBe('cera')
	})

	test('emptying the nav field returns to the idle screen with the caret back in the hero field', async () => {
		const hero = heroInput()
		if (!hero) throw new Error('the idle hero rendered no search field')
		hero.focus()

		await act(async () => {
			typeInto(hero, 'c')
		})
		const nav = activeInput()

		// Backspacing to empty goes back to idle, where the nav field hides —
		// the same handoff, in reverse.
		await act(async () => {
			typeInto(nav, '')
		})

		const back = heroInput()
		expect(back).not.toBeNull()
		expect(doc.activeElement).toBe(back)
		expect(nav.value).toBe('')
	})
})
