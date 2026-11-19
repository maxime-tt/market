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
 *   `platform/web/browse/browseIndexFeed.render.test.tsx` uses).
 *
 * The browse read and the price profile hosts are stubbed at their module
 * boundaries: this file is about the dropdown's own rendering and timing, not
 * about re-testing the search stream or the price resolution.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createElement } from 'react'
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
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []

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

const doc = globals.document as Document

afterAll(() => {
	for (const key of installedGlobals) delete globals[key]
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
