/**
 * platform/web/layout/SearchPreview.test.tsx — the header field's results
 * preview.
 *
 * Two layers, both structural:
 *
 * - `SearchPreviewPanel` is props-only and stated as a union, so its four states
 *   (loading, error, empty, results) are pinned with a server render — no
 *   popover, no relay read. Its links need a router, so the panel renders inside
 *   a memory router with the one destination it links to.
 * - `useSearchPreviewTerm` is the debounce, and a debounce needs a real commit
 *   and wall-clock time, so that section installs happy-dom (the pattern
 *   `platform/web/browse/browseIndexFeed.render.test.tsx` uses). The typing case
 *   mounts the real popover, so it also proves the panel never takes focus.
 *
 * The browse read and the price profile hosts are stubbed at their module
 * boundaries: this file is about the dropdown's own rendering and timing, not
 * about re-testing the search stream or the price resolution.
 *
 * **Run this file isolated** (the repository's own runner does:
 * `test:unit` = `bun test --isolate`). In a shared process, a preceding file
 * that mounts the app shell (`platform/web/layout/AppBar.test.tsx`,
 * `appChrome.test.tsx`) leaves Radix's popover unable to mount its content at
 * all — reproduced with a standalone `<Popover open>` content, no component of
 * this file involved — so the panel assertions fail for a harness reason.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createElement, useState } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BrowseProduct } from '@platform/web/browse/browseQuery'
import type { SearchPreviewState } from './SearchPreview'

// ---------------------------------------------------------------------------
// A DOM for the debounce section — installed before `react-dom` is imported
// ---------------------------------------------------------------------------

/**
 * The slice of happy-dom's `Window` this file uses. Named structurally rather
 * than imported from the package: happy-dom's own declarations add errors to
 * `tsc`'s program that the repository's baseline does not carry.
 */
interface HappyWindow {
	document: Document
	Event: typeof globalThis.Event
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []
const overriddenGlobals = new Map<string, unknown>()

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

/*
 * `Event` and `CustomEvent` are the exception to the rule above. Bun already
 * defines both, so the loop skips them — but happy-dom's `EventTarget.dispatchEvent`
 * rejects an event that is not one of its own, and Radix's dismissable layer
 * dispatches a `CustomEvent` when the popover mounts. Without happy-dom's
 * classes installed, that dispatch throws and the panel never settles. They are
 * restored in `afterAll`, since the rest of the process must keep Bun's.
 */
for (const key of ['Event', 'CustomEvent'] as const) {
	const value = Reflect.get(win, key)
	if (typeof value !== 'function') continue
	overriddenGlobals.set(key, globals[key])
	Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

const doc = globals.document as Document

afterAll(() => {
	for (const key of installedGlobals) delete globals[key]
	for (const [key, value] of overriddenGlobals) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
	delete globals.IS_REACT_ACT_ENVIRONMENT
})

// ---------------------------------------------------------------------------
// Module boundaries — the read and the two per-row hosts
// ---------------------------------------------------------------------------

/**
 * What the stubbed browse read reports. It is a function of the term, because
 * the real read is: with no term the query is disabled and reports nothing, and
 * the field's own value drives that.
 */
const EMPTY_READ = { data: undefined, isLoading: false, isError: false, progress: null }
let previewHits: BrowseProduct[] = []

mock.module('@platform/web/browse/browseQuery', () => ({
	useBrowseSearch: (term: string) =>
		term ? { data: { products: previewHits }, isLoading: false, isError: false, progress: null } : EMPTY_READ,
}))

mock.module('@platform/web/products/PriceDisplayHost', () => ({
	PriceDisplayHost: ({ priceValue, originalCurrency }: { priceValue: number; originalCurrency: string }) =>
		createElement('span', { 'data-testid': 'preview-price' }, `${priceValue} ${originalCurrency}`),
}))

mock.module('@platform/web/profiles/profileQuery', () => ({
	useProfile: () => ({ data: undefined }),
	getNormalizedProfileDisplayName: () => null,
}))

afterAll(() => {
	mock.restore()
})

// Dynamic on purpose: the DOM globals must exist before `react-dom`, and the
// `mock.module` registrations above must be in place before the module under
// test resolves. Static imports are hoisted above both.
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { SearchPreview, SearchPreviewPanel, useSearchPreviewTerm } = await import('./SearchPreview')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PRODUCT: BrowseProduct = {
	id: 'ceramic-bowl',
	eventId: 'e'.repeat(64),
	pubkey: 'a'.repeat(64),
	title: 'Ceramic Bowl',
	price: 21000,
	currency: 'SATS',
	categories: [],
}

const SECOND_PRODUCT: BrowseProduct = { ...PRODUCT, id: 'blue-mug', eventId: 'f'.repeat(64), title: 'Blue Mug' }

/** Renders one props-only panel state inside the one router destination it links to. */
async function renderPanel(state: SearchPreviewState): Promise<string> {
	const rootRoute = createRootRoute({
		component: () => createElement(SearchPreviewPanel, { state }),
	})
	rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/',
			validateSearch: (search: Record<string, unknown>) => search as { q: string; p?: string },
			component: () => null,
		}),
	])
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
	await router.load()

	return renderToStaticMarkup(createElement(RouterProvider, { router }))
}

describe('SearchPreviewPanel states', () => {
	test('loading is stated as loading, not as an empty result', async () => {
		const markup = await renderPanel({ kind: 'loading' })

		expect(markup).toContain('data-testid="search-preview-loading"')
		expect(markup).toContain('Searching…')
		expect(markup).not.toContain('search-preview-empty')
	})

	test('an error is stated honestly, and points at the full results page', async () => {
		const markup = await renderPanel({ kind: 'error', query: 'bowl' })

		expect(markup).toContain('data-testid="search-preview-error"')
		expect(markup).not.toContain('search-preview-results')
	})

	test('an empty result set names the term', async () => {
		const markup = await renderPanel({ kind: 'empty', query: 'zzz' })

		expect(markup).toContain('data-testid="search-preview-empty"')
		expect(markup).toContain('Nothing found for “zzz”')
	})

	test('a hit carries the title, the price host and the seller, and links to the product', async () => {
		const markup = await renderPanel({ kind: 'results', query: 'bowl', products: [PRODUCT, SECOND_PRODUCT] })

		expect(markup).toContain('data-testid="search-preview-results"')
		expect(markup).toContain('Ceramic Bowl')
		expect(markup).toContain('Blue Mug')
		// The price comes from the app's own price host, never a second format.
		expect(markup).toContain('data-testid="preview-price"')
		expect(markup).toContain('21000 SATS')
		// The seller falls back to the pubkey-derived label here (no profile stub).
		expect(markup).toContain('aaaaaaaa')
		// The hit is the product's browse deep link.
		expect(markup).toContain('ceramic-bowl')
		expect(markup).toContain('q=bowl')
		// Two hits + the one row to the full results page.
		expect(markup.split('data-testid="search-preview-hit"').length - 1).toBe(2)
	})

	test('the last row is the way to the full results page', async () => {
		const markup = await renderPanel({ kind: 'results', query: 'bowl', products: [PRODUCT] })

		expect(markup).toContain('data-testid="search-preview-all"')
		expect(markup).toContain('See all results for “bowl”')
	})
})

// ---------------------------------------------------------------------------
// The host — its anchor, and the debounce that opens it
// ---------------------------------------------------------------------------

describe('SearchPreview structure', () => {
	test('renders the bar field at the nav size, with no ⌘K chip, and no panel while closed', () => {
		// A closed popover renders only its anchor on the server, which is where
		// this structural read happens. The assertions stay on markup this module
		// owns (the field, its size, its value) so the case does not depend on the
		// popover primitive's internals — a sibling test file that stubs the
		// primitive must not be able to change what this one proves.
		const markup = renderToStaticMarkup(createElement(SearchPreview, { query: 'ceramic', onChange: () => {}, onGo: () => {} }))

		expect(markup).toContain('data-slot="search-field"')
		expect(markup).toContain('data-size="nav"')
		expect(markup).toContain('value="ceramic"')
		expect(markup).toContain('flex w-full min-w-0 items-center justify-center')
		// The bar's field carries no `⌘K` chip (that is the idle hero's affordance).
		expect(markup).not.toContain('widget-search-field-kbd')
		// Nothing has been typed: the panel is the popover's content, and it is not
		// in the tree.
		expect(markup).not.toContain('data-testid="search-preview-panel"')
	})
})

describe('useSearchPreviewTerm', () => {
	let container: HTMLDivElement
	let root: Root

	/** The hook's latest return, written on every render. */
	const latest: {
		current: { term: string; open: boolean; typed: (value: string) => void; dismiss: () => void }
	} = {
		current: { term: '', open: false, typed: () => {}, dismiss: () => {} },
	}

	function Probe() {
		latest.current = useSearchPreviewTerm()
		return null
	}

	beforeEach(() => {
		doc.body.innerHTML = ''
		container = doc.createElement('div')
		doc.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
	})

	/** Waits past the debounce window under `act`. */
	async function pastDebounce(): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>()
		setTimeout(resolve, 300)
		await act(async () => {
			await promise
		})
	}

	test('opens on the keystroke, and the term lands only after the debounce', async () => {
		await act(async () => {
			root.render(createElement(Probe))
		})
		expect(latest.current.open).toBe(false)
		expect(latest.current.term).toBe('')

		await act(async () => {
			latest.current.typed('bowl')
		})
		// Open at once — the panel is honest about being early — but the read is
		// not fired for the partial term.
		expect(latest.current.open).toBe(true)
		expect(latest.current.term).toBe('')

		await pastDebounce()
		expect(latest.current.term).toBe('bowl')
	})

	test('an emptied field withdraws the preview immediately', async () => {
		await act(async () => {
			root.render(createElement(Probe))
		})
		await act(async () => {
			latest.current.typed('bowl')
		})
		await pastDebounce()
		expect(latest.current.term).toBe('bowl')

		await act(async () => {
			latest.current.typed('')
		})
		expect(latest.current.open).toBe(false)
		expect(latest.current.term).toBe('')
	})

	test('dismiss closes the preview (a submit, or an outside dismissal)', async () => {
		await act(async () => {
			root.render(createElement(Probe))
		})
		await act(async () => {
			latest.current.typed('bowl')
		})
		expect(latest.current.open).toBe(true)

		await act(async () => {
			latest.current.dismiss()
		})
		expect(latest.current.open).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// Typing must keep the keyboard in the field while the panel opens
//
// The regression this pins: Radix's `FocusScope` focuses the panel container as
// soon as the popover mounts unless the open-auto-focus is prevented, so the
// term stopped after the first key or two and the caret left the field. The
// panel mounts on the *first* keystroke (`open` is set at once; only the read is
// debounced), which is why the loss showed up mid-word.
// ---------------------------------------------------------------------------

describe('SearchPreview keeps focus in the field', () => {
	let container: HTMLDivElement
	let root: Root
	/** Every element any code asked the browser to focus, in order. */
	let focusRequests: Element[]
	/** The unpatched method, captured per test so the prototype is left as it was. */
	let originalFocus: typeof HTMLElement.prototype.focus

	/** A preview whose query state is owned here, so the field's value tracks typing. */
	function ControlledSearchPreview() {
		const [query, setQuery] = useState('')
		return createElement(SearchPreview, { query, onChange: setQuery, onGo: () => {} })
	}

	/** The preview inside the one router destination its rows link to. */
	function routerFor(component: () => unknown) {
		const rootRoute = createRootRoute({ component: () => component() as ReactElement })
		rootRoute.addChildren([
			createRoute({
				getParentRoute: () => rootRoute,
				path: '/',
				validateSearch: (search: Record<string, unknown>) => search as { q: string; p?: string },
				component: () => null,
			}),
		])
		return createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
	}

	beforeEach(() => {
		previewHits = [PRODUCT]
		doc.body.innerHTML = ''
		container = doc.createElement('div')
		doc.body.appendChild(container)
		root = createRoot(container)
		focusRequests = []
		// Record the *request* as well as the outcome: happy-dom's `focus()` on a
		// non-focusable container is not the same as a browser's, and the
		// regression is about the request.
		originalFocus = HTMLElement.prototype.focus
		HTMLElement.prototype.focus = function focusRecording(this: HTMLElement, options?: FocusOptions) {
			focusRequests.push(this)
			return originalFocus.call(this, options)
		}
	})

	afterEach(() => {
		HTMLElement.prototype.focus = originalFocus
		act(() => root.unmount())
	})

	/** Types a cumulative term the way a browser does (see the setter note below). */
	async function type(input: HTMLInputElement, term: string): Promise<void> {
		// The write must go through the prototype's own setter, not the instance
		// one: React installs a per-node value tracker whose setter records what
		// was written, so a plain `input.value = …` is invisible to its change
		// detection (the browser's own updates bypass that setter). This is the
		// `setNativeValue` dance the DOM testing libraries document.
		const prototypeValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
		await act(async () => {
			prototypeValue?.call(input, term)
			input.dispatchEvent(new win.Event('input', { bubbles: true }))
		})
	}

	/** The slot of whatever the document says is focused (a compact failure diff). */
	function activeSlot(): string | null {
		return (doc.activeElement as Element | null)?.getAttribute('data-slot') ?? null
	}

	/** Every focus request aimed at something other than the field, by tag. */
	function strayFocusRequests(input: HTMLInputElement): string[] {
		return focusRequests.filter((element) => element !== input).map((element) => (element as Element).tagName)
	}

	/** Waits past the debounce window under `act`. */
	async function pastDebounce(): Promise<void> {
		const { promise, resolve } = Promise.withResolvers<void>()
		setTimeout(resolve, 300)
		await act(async () => {
			await promise
		})
	}

	test('a typed term lands whole, with the panel open and the caret still in the field', async () => {
		const router = routerFor(ControlledSearchPreview)
		await router.load()
		await act(async () => {
			root.render(createElement(RouterProvider, { router }))
		})

		const input = container.querySelector('input')
		if (!input) throw new Error('no field input')
		await act(async () => {
			input.focus()
		})
		expect(activeSlot()).toBe('search-field-input')

		// Key by key: the panel opens on the first one (the read is debounced, the
		// panel is not) — the moment focus used to be taken out of the field. The
		// term must land whole, and nothing but the field may be asked to focus.
		for (const term of ['b', 'bi', 'bit', 'bitc', 'bitco', 'bitcoin']) {
			await type(input, term)
			expect(activeSlot()).toBe('search-field-input')
			expect(strayFocusRequests(input)).toEqual([])
		}

		// The term is intact while the read is still debouncing…
		expect(input.value).toBe('bitcoin')

		await pastDebounce()

		// …and after it lands and the panel re-renders with the rows.
		expect(activeSlot()).toBe('search-field-input')
		expect(input.value).toBe('bitcoin')
		expect(doc.body.textContent ?? '').toContain('See all results for “bitcoin”')
		expect(doc.body.textContent ?? '').toContain('Ceramic Bowl')
		expect(strayFocusRequests(input)).toEqual([])
	})
})
