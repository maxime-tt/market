/**
 * platform/web/layout/AppBar.test.tsx — the frame's bar.
 *
 * What the host owns, and therefore what is asserted here: the identity read
 * (instance name + `config.picture`), the one nav list, one search field at the
 * nav size, and the account slot. The layout itself is covered by
 * `ui/appbar/app-bar-view.test.tsx`.
 *
 * The bar reads the router (`useLocation`, `useNavigate`, `Link`), so it is
 * mounted inside a real memory router here rather than stubbed: a fake router
 * would let the one thing that can break — a destination the tree does not have
 * — pass.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** The instance config the bar reads; each case may change the gated settings. */
let configData: { displayName?: string; name?: string; picture?: string; appSettings: { showNostrLink: boolean } } = {
	displayName: 'Test Market',
	name: 'test-market',
	picture: '/logo.svg',
	appSettings: { showNostrLink: false },
}

// Registered before `./AppBar` is imported below, so the host pulls in the
// stubs rather than the browser-bound originals.
mock.module('@platform/web/config/publicConfigQuery', () => ({ useConfigQuery: () => ({ data: configData }) }))
mock.module('@platform/web/config/instanceName', () => ({ useInstanceName: () => 'Test Market' }))

afterAll(() => {
	mock.restore()
})

// Dynamic on purpose: the `mock.module` registrations above must be in place
// before the host's own imports resolve, and static imports are hoisted above
// them. This is the repository's established module-boundary test pattern (see
// `appChrome.test.tsx`).
const { AppBar } = await import('./AppBar')

/** Renders the bar inside a router that has every destination it links to. */
async function renderBar(path = '/'): Promise<string> {
	const rootRoute = createRootRoute({ component: () => createElement(AppBar) })
	rootRoute.addChildren([
		createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/products', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/auctions', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/community', component: () => null }),
		createRoute({ getParentRoute: () => rootRoute, path: '/nostr', component: () => null }),
	])
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [path] }) })
	await router.load()

	return renderToStaticMarkup(createElement(RouterProvider, { router }))
}

beforeEach(() => {
	configData = { displayName: 'Test Market', name: 'test-market', picture: '/logo.svg', appSettings: { showNostrLink: false } }
})

describe('AppBar identity', () => {
	test('renders the instance name as the wordmark and links it home', async () => {
		const markup = await renderBar('/products')

		expect(markup).toContain('data-testid="home-link"')
		expect(markup).toContain('href="/"')
		expect(markup).toContain('Test Market')
	})

	test('renders the logo from config.picture', async () => {
		const markup = await renderBar('/products')

		expect(markup).toContain('<img src="/logo.svg"')
		expect(markup).toContain('alt="Test Market"')
	})

	test('falls back to the title alone when the instance has no logo', async () => {
		configData = { displayName: 'Test Market', name: 'test-market', appSettings: { showNostrLink: false } }
		const markup = await renderBar('/products')

		expect(markup).not.toContain('<img')
		expect(markup).toContain('Test Market')
	})
})

describe('AppBar nav', () => {
	test('renders the built-in destinations', async () => {
		const markup = await renderBar('/products')

		expect(markup).toContain('href="/products"')
		expect(markup).toContain('href="/auctions"')
		expect(markup).toContain('href="/community"')
		// `Nostr` is instance-gated and this instance turned it off.
		expect(markup).not.toContain('href="/nostr"')
	})

	test('adds Nostr when the instance enables the link', async () => {
		configData = { displayName: 'Test Market', name: 'test-market', appSettings: { showNostrLink: true } }
		const markup = await renderBar('/products')

		expect(markup).toContain('href="/nostr"')
	})

	test('marks the current destination and only it', async () => {
		const markup = await renderBar('/products')

		expect(markup).toContain('aria-current="page"')
		expect(markup.split('aria-current="page"').length - 1).toBe(1)
	})
})

describe('AppBar search', () => {
	test('mounts exactly one search field, at the nav size', async () => {
		const markup = await renderBar('/products')

		expect(markup.split('data-testid="widget-search-field"').length - 1).toBe(1)
		expect(markup).toContain('data-size="nav"')
		expect(markup).toContain('data-slot="search-slot"')
	})

	test('mirrors the ?q= the page is showing', async () => {
		// The bar and the page are one search: arriving at a results URL must not
		// leave the field claiming nothing is being searched.
		const markup = await renderBar('/?q=ceramic')

		expect(markup).toContain('value="ceramic"')
	})

	test('starts empty off the browse route', async () => {
		const markup = await renderBar('/products?q=ceramic')

		expect(markup).not.toContain('value="ceramic"')
	})
})

describe('AppBar account slot', () => {
	test('renders the real account menu on the right', async () => {
		// Not stubbed: the slot's contract is that the bar alone mounts the account surface, so the
		// assertion is about the components meeting, not about a marker.
		const markup = await renderBar('/products')

		expect(markup).toContain('data-slot="account-slot"')
		expect(markup).toContain('data-testid="account-menu-trigger"')
	})
})
