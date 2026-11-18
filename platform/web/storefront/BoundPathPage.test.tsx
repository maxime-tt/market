import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as realReadContext from '@platform/web/readContext'
import type { NostrEventLike } from '@sdk/core'
import type { EventTemplate } from '@platform/web/ndkPublishContext'
import type { EventFilter } from '@sdk/core/event-store'
import { STOREFRONT_PAGE_D_TAG, STOREFRONT_PAGE_KIND, STOREFRONT_PAGE_VERSION } from '@sdk/commerce/storefront/storefrontPage'

/**
 * `BoundPathPage` — the seam between the server's `#__AR_ROUTE__` payload and
 * the app's real chrome.
 *
 * The component is thin on purpose: it hands `(author, d)` to
 * `StorefrontAddressPage` with `variant="embedded"` and reads nothing else, so
 * the only things worth pinning are that a payload reaches the page renderer,
 * that the embedded variant does not claim a full viewport, and that a caller
 * with no payload renders the outlet instead (the guard lives in `__root.tsx`;
 * there is no 404 to assert here).
 *
 * The three mocked seams and the pre-seeded query cache mirror
 * `StorefrontAddressPage.test.tsx`: they are first-party platform modules, the
 * repo's test rules allow mocking those (never third-party packages
 * process-wide), and seeding lets `renderToStaticMarkup` see a settled query
 * synchronously.
 */

const AUTHOR = 'a'.repeat(64)

type ConfigQueryResult = { data?: { appPublicKey: string } | undefined; isLoading: boolean }
let configState: ConfigQueryResult = { data: { appPublicKey: AUTHOR }, isLoading: false }
let fetchResult: NostrEventLike[] = []

mock.module('@platform/web/config/publicConfigQuery', () => ({
	useConfigQuery: () => configState,
	getConfig: () => configState.data ?? null,
}))

mock.module('@platform/web/readContext', () => ({
	// Partial mock: the slot chain's modules import other names from this
	// composition root (`createNdkReadContext`, …), so only `getReadContext` is
	// overridden and the real exports stay in place.
	...realReadContext,
	getReadContext: () => ({
		fetch: async (filters: readonly EventFilter[]) => {
			void filters
			return fetchResult
		},
		store: {},
	}),
}))

mock.module('@platform/web/ndkPublishContext', () => ({
	getUser: async () => ({ pubkey: AUTHOR }),
	signNostrEvent: async (template: EventTemplate): Promise<NostrEventLike> => ({
		...template,
		id: 'signed-id',
		pubkey: AUTHOR,
		sig: 'sig',
	}),
	publishNostrEvent: async () => ({ publishedRelays: new Set(['wss://relay.example']) }),
}))

// Imported inside beforeAll, after the seams above are mocked — a static import
// would be hoisted past `mock.module` and bind the real platform modules.
let BoundPathPage: (typeof import('./BoundPathPage'))['BoundPathPage']
let fetchStorefrontPage: (typeof import('./storefrontQuery'))['fetchStorefrontPage']
let storefrontAddressPageQueryOptions: (typeof import('./storefrontQuery'))['storefrontAddressPageQueryOptions']

beforeAll(async () => {
	;({ BoundPathPage } = await import('./BoundPathPage'))
	;({ fetchStorefrontPage, storefrontAddressPageQueryOptions } = await import('./storefrontQuery'))
})

function pageEvent(overrides: Partial<NostrEventLike> & { content?: string } = {}): NostrEventLike {
	return {
		id: 'e1',
		pubkey: AUTHOR,
		kind: STOREFRONT_PAGE_KIND,
		created_at: 1000,
		tags: [['d', STOREFRONT_PAGE_D_TAG]],
		content: JSON.stringify({
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			root: { props: {} },
			content: [{ type: 'Divider', props: { id: 'd1' } }],
		}),
		sig: 'sig',
		...overrides,
	}
}

const PAYLOAD = { author: AUTHOR, d: 'featured' }

function renderBoundPathPage(seed?: Awaited<ReturnType<typeof fetchStorefrontPage>>): string {
	const queryClient = new QueryClient()
	if (seed) {
		queryClient.setQueryData(storefrontAddressPageQueryOptions(PAYLOAD.author, PAYLOAD.d).queryKey, seed)
	}
	return renderToStaticMarkup(
		createElement(QueryClientProvider, { client: queryClient }, createElement(BoundPathPage, { payload: PAYLOAD })),
	)
}

/**
 * The root guard's precedence, as `routes/__root.tsx` spells it:
 * `appPage ? <BoundPathPage/> : <Outlet/>`. A caller with no payload must fall
 * through — the page guard never invents a 404 of its own.
 */
function FrameStandIn({ payload, outlet }: { payload: typeof PAYLOAD | null; outlet: ReactElement }): ReactElement {
	return payload ? createElement(BoundPathPage, { payload }) : outlet
}

describe('BoundPathPage', () => {
	test('a payload renders the page the server bound to the path', async () => {
		fetchResult = [pageEvent({ tags: [['d', 'featured']] })]
		const seed = await fetchStorefrontPage(AUTHOR, 'featured')

		const markup = renderBoundPathPage(seed)

		expect(markup).toContain('data-testid="storefront-page"')
		expect(markup).not.toContain('storefront-address-empty')
	})

	test('the embedded variant does not claim a full viewport while the read settles', () => {
		// No seed: the address query is pending, which is the loading branch.
		const markup = renderBoundPathPage()

		expect(markup).toContain('data-slot="loading-state"')
		expect(markup).toContain('min-h-[40vh]')
		expect(markup).not.toContain('min-h-screen')
	})

	test('no payload renders the outlet, not a page', () => {
		const markup = renderToStaticMarkup(
			createElement(FrameStandIn, {
				payload: null,
				outlet: createElement('div', { 'data-testid': 'frame-outlet' }, 'routed-content'),
			}),
		)

		expect(markup).toContain('data-testid="frame-outlet"')
		expect(markup).not.toContain('data-testid="storefront-page"')
	})
})
