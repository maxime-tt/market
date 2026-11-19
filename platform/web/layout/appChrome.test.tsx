/**
 * platform/web/layout/appChrome.test.tsx — the app frame's chrome decisions:
 * the one bar every route gets, and which paths render in the arena scope.
 *
 * The frame used to be a two-bar arrangement: the legacy `Header` on most
 * routes, and a Browse-local `BrowseNav` on `/`, which opted out of the header
 * through route metadata. The opt-out and the second bar are gone; the bar is
 * mounted once by the frame, so this file now pins the opposite — one bar on
 * *every* route, including `/`.
 */

import { afterAll, describe, expect, mock, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { usesArenaChrome } from './appChrome'

/** The marker the stubbed app bar renders with, and nothing else does. */
const APP_BAR_MARKER = 'data-testid="app-bar-stub"'

// Registered before `../routes/__root` is imported, so the frame pulls in the
// stubs rather than the browser-bound originals. The bar stub renders a
// `<header>`, exactly as the real bar's root element does, so the "one header"
// assertion below is about the frame's mount and not the stub's markup.
mock.module('@platform/web/layout/AppBar', () => ({
	AppBar: () => createElement('header', { 'data-slot': 'app-bar', 'data-testid': 'app-bar-stub' }),
}))
mock.module('@platform/web/app/useRootRedirects', () => ({ useRootRedirects: () => {} }))
mock.module('@platform/web/app/useDocumentIdentity', () => ({ useDocumentIdentity: () => {} }))
mock.module('@platform/web/layout/FooterHost', () => ({ FooterHost: () => null }))
mock.module('@platform/web/auctions/AuctionWonModal', () => ({ AuctionWonModal: () => null }))

/**
 * The app-chrome page seam, stubbed at its two module boundaries so the frame's
 * bound-page guard is what is under test: `appChromePageForPath` is what the
 * frame consults (its own reading of `#__AR_ROUTE__` is covered by
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

/** Mounts the real root frame around one `/` child carrying `content`. */
async function renderRouteFrame(content: ReactElement): Promise<string> {
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
		}),
	])
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
	await router.load()

	return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(RouterProvider, { router })))
}

describe('root frame chrome', () => {
	test('the browse route gets the one app bar, and declares no chrome opt-out', async () => {
		const { Route: browseRoute } = await import('../routes/index')

		// There is no per-route chrome metadata any more: the bar is the frame's.
		expect(browseRoute.options.staticData).toBeUndefined()

		const markup = await renderRouteFrame(createElement('div', null, 'browse-content'))

		expect(markup).toContain(APP_BAR_MARKER)
		expect(markup.split('<header').length - 1).toBe(1)
		expect(markup).toContain('browse-content')
	})

	test('a non-browse route gets the same one app bar', async () => {
		const { Route: productsRoute } = await import('../routes/products.index')

		// A legacy page declares nothing; the frame mounts the bar regardless.
		expect(productsRoute.options.staticData).toBeUndefined()

		const markup = await renderRouteFrame(createElement('div', null, 'routed-content'))

		expect(markup).toContain(APP_BAR_MARKER)
		expect(markup.split('<header').length - 1).toBe(1)
		expect(markup).toContain('routed-content')
	})

	test('the chrome module carries no header opt-out to re-enable', async () => {
		const chrome = await import('./appChrome')
		// The header opt-out and its match type are deleted, not merely unused:
		// the module's whole surface is the arena decision.
		expect(Object.keys(chrome)).toEqual(['usesArenaChrome'])
	})
})

describe('a page bound to this path', () => {
	/** A payload for `path`, as the server would send for this document load. */
	function boundTo(path: string) {
		boundPage = { author: 'a'.repeat(64), d: 'home', path }
	}

	test('renders the page instead of the route, under the frame bar', async () => {
		boundTo('/')
		try {
			const markup = await renderRouteFrame(createElement('div', null, 'routed-content'))

			expect(markup).toContain('data-testid="bound-path-page"')
			expect(markup).toContain(APP_BAR_MARKER)
			expect(markup).not.toContain('routed-content')
		} finally {
			boundPage = null
		}
	})

	test('a payload for another path does not take over the route', async () => {
		boundTo('/elsewhere')
		try {
			const markup = await renderRouteFrame(createElement('div', null, 'routed-content'))

			expect(markup).not.toContain('data-testid="bound-path-page"')
			expect(markup).toContain('routed-content')
		} finally {
			boundPage = null
		}
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
