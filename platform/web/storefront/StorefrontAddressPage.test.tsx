import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as realReadContext from '@platform/web/readContext'
import type { NostrEventLike } from '@sdk/core'
import type { EventTemplate } from '@platform/web/ndkPublishContext'
import type { EventFilter } from '@sdk/core/event-store'
import { STOREFRONT_PAGE_D_TAG, STOREFRONT_PAGE_KIND, STOREFRONT_PAGE_VERSION } from '@sdk/commerce/storefront/storefrontPage'

/**
 * The generic address page's states (HANDOVER §6.1): the resolved coordinate
 * renders through the ported renderer, and everything that is not a renderable
 * page — an absent coordinate, a misconfigured app key, an unparseable
 * document — degrades to the deliberate empty state rather than an error or a
 * blank page.
 *
 * The three seams mocked here are first-party platform modules (the public
 * config read, the read composition root, the publish bridge), which is what
 * makes mocking them acceptable: the repo's test rules forbid mocking
 * third-party packages process-wide, and unit files run under `--isolate`.
 * The query cache is pre-seeded so `renderToStaticMarkup` sees a settled
 * query synchronously instead of the pending first paint.
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
let StorefrontAddressPage: (typeof import('./StorefrontAddressPage'))['StorefrontAddressPage']
let fetchStorefrontPage: (typeof import('./storefrontQuery'))['fetchStorefrontPage']
let storefrontAddressPageQueryOptions: (typeof import('./storefrontQuery'))['storefrontAddressPageQueryOptions']

beforeAll(async () => {
	;({ StorefrontAddressPage } = await import('./StorefrontAddressPage'))
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

function renderAddressPage(dTag: string, seed?: Awaited<ReturnType<typeof fetchStorefrontPage>>): string {
	const queryClient = new QueryClient()
	if (seed) {
		queryClient.setQueryData(storefrontAddressPageQueryOptions(AUTHOR, dTag).queryKey, seed)
	}
	return renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(StorefrontAddressPage, { dTag })))
}

describe('StorefrontAddressPage', () => {
	test('renders a resolved page through the ported renderer', async () => {
		fetchResult = [pageEvent({ tags: [['d', 'featured']] })]
		const seed = await fetchStorefrontPage(AUTHOR, 'featured')
		const markup = renderAddressPage('featured', seed)
		expect(markup).toContain('data-testid="storefront-page"')
		expect(markup).not.toContain('storefront-address-empty')
	})

	test('renders the deliberate empty state when the coordinate is absent', async () => {
		fetchResult = []
		const seed = await fetchStorefrontPage(AUTHOR, 'featured')
		const markup = renderAddressPage('featured', seed)
		expect(markup).toContain('data-testid="storefront-address-empty"')
		expect(markup).toContain('Nothing published yet')
		expect(markup).not.toContain('data-testid="storefront-page"')
	})

	test('an unparseable document degrades to the same empty state', async () => {
		fetchResult = [pageEvent({ content: 'not json' })]
		const seed = await fetchStorefrontPage(AUTHOR, 'featured')
		const markup = renderAddressPage('featured', seed)
		expect(markup).toContain('data-testid="storefront-address-empty"')
		expect(markup).not.toContain('data-testid="storefront-page"')
	})

	test('a missing app key renders the empty state, not a spinner or an error', () => {
		configState = { data: undefined, isLoading: false }
		try {
			const markup = renderAddressPage('featured')
			expect(markup).toContain('data-testid="storefront-address-empty"')
		} finally {
			configState = { data: { appPublicKey: AUTHOR }, isLoading: false }
		}
	})

	test('a loading config shows the loading state and no page', () => {
		configState = { data: undefined, isLoading: true }
		try {
			const markup = renderAddressPage('featured')
			expect(markup).toContain('data-slot="loading-state"')
			expect(markup).not.toContain('data-testid="storefront-page"')
		} finally {
			configState = { data: { appPublicKey: AUTHOR }, isLoading: false }
		}
	})
})
