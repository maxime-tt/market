/**
 * platform/web/layout/appChrome.test.tsx — the app frame's chrome decisions:
 * the legacy header stands down on the routes that draw their own nav, and a
 * page the server bound to the path (`#__AR_ROUTE__`) renders inside that frame
 * instead of the route's own content.
 *
 * Shape chosen: a route-level render test. The real root frame
 * (`routes/__root.tsx`) is mounted in a memory router around a single child, and
 * the assertion is whether the legacy `Header` is in the rendered markup. The
 * Browse child's `staticData` is taken from the real `/` route module, so the
 * test proves the declaration on the route rather than a synthetic flag; the
 * non-browse child's comes from a real legacy route (`/products`).
 *
 * The unit suite has no DOM renderer (no jsdom/happy-dom, see
 * `ui/shared/use-copy-to-clipboard.test.tsx`), so this renders to static markup.
 * `Header` is replaced with a marker because the frame's decision is what is
 * under test here: the real header needs a browser (nano-css writes to
 * `document`) and app providers. The other frame members are stubbed for the
 * same reason — `useRootRedirects` reads `window.location`, the footer and the
 * overlay read app config and query state.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import type { StaticDataRouteOption } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrowseNav } from '@ui/browse/browse-nav'
import { hidesAppHeader, usesArenaChrome } from './appChrome'

/** The marker the stubbed legacy header renders with, and nothing else does. */
const LEGACY_HEADER_MARKER = 'data-testid="legacy-app-header"'

// Registered before `../routes/__root` is imported, so the frame pulls in the
// stubs rather than the browser-bound originals.
mock.module('@platform/web/layout/Header', () => ({
	Header: () => createElement('header', { 'data-testid': 'legacy-app-header' }),
	// `routes/index` imports this alongside `Header` for the Browse nav's account
	// slot; a factory missing it makes the ESM link fail before the test runs.
	HeaderAccountControls: () => null,
}))
mock.module('@platform/web/app/useRootRedirects', () => ({ useRootRedirects: () => {} }))
mock.module('@platform/web/app/useDocumentIdentity', () => ({ useDocumentIdentity: () => {} }))
mock.module('@platform/web/layout/FooterHost', () => ({ FooterHost: () => null }))
mock.module('@platform/web/auctions/AuctionWonModal', () => ({ AuctionWonModal: () => null }))

/**
 * The app-chrome seam, stubbed at its two module boundaries so the frame's
 * decision is what is under test: `appChromePageForPath` is what the frame
 * consults (its own reading of `#__AR_ROUTE__` is covered by
 * `storefront/appChromePage.test.ts`), and `BoundPathPage` renders a marker
 * instead of dragging the page renderer and its relay reads in here.
 */
let boundPage: { author: string; d: string; path: string } | null = null

mock.module('@platform/web/storefront/appChromePage', () => ({
	appChromePageForPath: (pathname: string) => (boundPage && boundPage.path === pathname ? boundPage : null),
}))
mock.module('@platform/web/storefront/BoundPathPage', () => ({
	BoundPathPage: ({ payload }: { payload: { author: string; d: string } }) =>
		createElement('div', { 'data-testid': 'bound-path-page' }, `${payload.author}/${payload.d}`),
}))

afterAll(() => {
	mock.restore()
})

/** Mounts the real root frame around one `/` child carrying `staticData`. */
async function renderRouteFrame(staticData: StaticDataRouteOption | undefined, content: ReactElement): Promise<string> {
	const { Route: importedRootRoute } = await import('../routes/__root')
	// A fresh root route per render, carrying the real frame component: a route
	// instance keeps the match tree it was first initialized with, so reusing one
	// would make the second render assert against the first render's matches.
	const rootRoute = createRootRoute({ component: importedRootRoute.options.component })
	rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/',
			component: () => content,
			staticData,
		}),
	])
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
	await router.load()

	return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(RouterProvider, { router })))
}

describe('root frame chrome', () => {
	test('the browse route keeps its own nav and drops the legacy header', async () => {
		const { Route: browseRoute } = await import('../routes/index')

		// The route declares the opt-out; the frame then honours it.
		expect(browseRoute.options.staticData).toEqual({ hidesAppHeader: true })

		// The surface's own chrome, as Browse draws it.
		const markup = await renderRouteFrame(
			browseRoute.options.staticData,
			createElement(BrowseNav, { wordmarkLabel: 'Test Market', active: true }),
		)

		expect(markup).toContain('widget-browse-nav')
		expect(markup.split('<nav').length - 1).toBe(1)
		expect(markup.split('<header').length - 1).toBe(0)
		expect(markup).not.toContain(LEGACY_HEADER_MARKER)
	})

	test('a non-browse route still renders the legacy header', async () => {
		const { Route: productsRoute } = await import('../routes/products.index')

		// A legacy page declares nothing, so the default (header shown) applies.
		expect(productsRoute.options.staticData).toBeUndefined()

		const markup = await renderRouteFrame(productsRoute.options.staticData, createElement('div', null, 'routed-content'))

		expect(markup).toContain(LEGACY_HEADER_MARKER)
		expect(markup.split('<header').length - 1).toBe(1)
		expect(markup).toContain('routed-content')
	})
})

describe('a page bound to this path', () => {
	/**
	 * The fix this block pins: a payload supersedes `<Outlet/>`, and it also
	 * overrides `hidesAppHeader`'s effect on the header — a page rendering inside
	 * the app's frame must have that frame's nav. (`/` is the case that matters:
	 * the browse route is the one route that hides the header, and it is also
	 * where a `default` binding lands.)
	 */
	function boundTo(path: string) {
		boundPage = { author: 'a'.repeat(64), d: 'home', path }
	}

	test('renders the page instead of the route, and keeps the header a hiding route dropped', async () => {
		const { Route: browseRoute } = await import('../routes/index')
		expect(browseRoute.options.staticData).toEqual({ hidesAppHeader: true })
		boundTo('/')
		try {
			const markup = await renderRouteFrame(browseRoute.options.staticData, createElement('div', null, 'routed-content'))

			expect(markup).toContain('data-testid="bound-path-page"')
			expect(markup).toContain(LEGACY_HEADER_MARKER)
			expect(markup).not.toContain('routed-content')
		} finally {
			boundPage = null
		}
	})

	test('renders the page instead of a non-hiding route’s content, header unchanged', async () => {
		const { Route: productsRoute } = await import('../routes/products.index')
		boundTo('/')
		try {
			const markup = await renderRouteFrame(productsRoute.options.staticData, createElement('div', null, 'routed-content'))

			expect(markup).toContain('data-testid="bound-path-page"')
			expect(markup).toContain(LEGACY_HEADER_MARKER)
			expect(markup).not.toContain('routed-content')
		} finally {
			boundPage = null
		}
	})

	test('a payload for another path does not take over the route', async () => {
		const { Route: productsRoute } = await import('../routes/products.index')
		boundTo('/elsewhere')
		try {
			const markup = await renderRouteFrame(productsRoute.options.staticData, createElement('div', null, 'routed-content'))

			expect(markup).not.toContain('data-testid="bound-path-page"')
			expect(markup).toContain('routed-content')
		} finally {
			boundPage = null
		}
	})
})

describe('hidesAppHeader', () => {
	test('reads the flag off the matched chain, defaulting to visible', () => {
		// No declaration anywhere: the legacy header stays.
		expect(hidesAppHeader([{}])).toBe(false)
		expect(hidesAppHeader([{ staticData: {} }])).toBe(false)
		expect(hidesAppHeader([{}, { staticData: { hidesAppHeader: false } }])).toBe(false)
		// One opting-out match anywhere in the chain hides it.
		expect(hidesAppHeader([{ staticData: { hidesAppHeader: true } }])).toBe(true)
		expect(hidesAppHeader([{}, { staticData: { hidesAppHeader: true } }, {}])).toBe(true)
	})
})

describe('usesArenaChrome', () => {
	test('the auction routes and the home / Browse surface use the Arena chrome', () => {
		expect(usesArenaChrome('/')).toBe(true)
		expect(usesArenaChrome('/auctions')).toBe(true)
		expect(usesArenaChrome('/auctions/live-arena-1')).toBe(true)
	})

	test('every other page keeps the default chrome', () => {
		for (const path of ['/products', '/products/x', '/dashboard', '/auctionsx', '/community', '/profile/abc']) {
			expect(usesArenaChrome(path)).toBe(false)
		}
	})
})
