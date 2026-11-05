/**
 * Regression: a product row read through the applesauce store comes back from
 * IndexedDB as a plain protocol object ({id,pubkey,kind,created_at,content,sig,tags})
 * with no `author` wrapper and no relay-client methods. The card must render such a row
 * without throwing; the seller-identity read belongs on `product.pubkey`, which
 * is byte-identical on the plain shape and on the wrapped relay-client event (whose
 * `pubkey` getter forwards to the wrapped event).
 *
 * The throw was `product.author.pubkey` under `isAuthenticated && ...`, so this
 * test authenticates with a non-matching user: with a seller account signed in,
 * the old expression evaluated `product.author.pubkey` and threw
 * `Cannot read properties of undefined (reading 'pubkey')`.
 */
import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'

// Mock the platform bindings before importing the host so the render path never
// touches the NDK store, IndexedDB, or a live router context.
const realReactQuery = await import('@tanstack/react-query')

mock.module('@tanstack/react-router', () => ({
	Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
	useLocation: () => ({ pathname: '/' }),
}))

mock.module('@tanstack/react-query', () => ({
	...realReactQuery,
	useQueryClient: () => ({ setQueryData: () => {} }),
}))

mock.module('@platform/web/auth/authStore', () => {
	// Signed-in, non-seller viewer: forces the card to evaluate the ownership
	// comparison against the row's pubkey.
	const useAuth = () => ({ user: { pubkey: SIGNED_IN_OTHER_USER }, isAuthenticated: true })
	return {
		useAuth,
		// Named symbols `ndkReadContext` re-exports from this module.
		authStore: { state: { user: null } },
		getCurrentPubkey: () => SIGNED_IN_OTHER_USER,
		getActiveSignerCapability: () => null,
	}
})

mock.module('@platform/web/app/uiStore', () => ({
	uiActions: { setProductSourcePath: () => {} },
}))

mock.module('@platform/web/cart/cartStore', () => ({
	useCart: () => ({ cart: { products: {} } }),
	cartActions: { addProduct: async () => {} },
}))

mock.module('./productQuery', () => ({
	productQueryOptions: (id: string) => ({ queryKey: ['product', id] }),
}))

mock.module('./PriceDisplayHost', () => ({
	PriceDisplayHost: () => null,
}))

mock.module('@platform/web/payments/ZapButtonHost', () => ({
	ZapButtonHost: () => null,
}))

mock.module('@platform/web/config/testListingNoticeHost', () => ({
	TestListingNoticeHost: () => null,
}))

// The exact shape applesauce returns from IndexedDB: plain protocol fields,
// no `author`, no methods.
const PLAIN_ROW = {
	id: 'c'.repeat(64),
	pubkey: 'a'.repeat(64),
	kind: 30402,
	created_at: 1_700_000_000,
	content: 'A plain IndexedDB row',
	sig: 'd'.repeat(128),
	tags: [
		['d', 'plain-row'],
		['title', 'Plain Row'],
		['price', 'price', '1000', 'SATS'],
		['stock', '3'],
		['visibility', 'on-sale'],
	],
} as const

const SIGNED_IN_OTHER_USER = 'b'.repeat(64)

describe('ProductCardHost with a DB-sourced plain row', () => {
	test('renders without throwing when the row has no author wrapper', async () => {
		// Dynamic import on purpose: Bun `mock.module` must register before the
		// host module (and its binding deps) load — a static import would defeat
		// the mocks. Same pattern as `LiveChatPanel.test.ts`.
		const { ProductCardHost } = await import('./ProductCardHost')

		const html = renderToString(React.createElement(ProductCardHost, { product: PLAIN_ROW as never }))

		expect(html).toContain('Plain Row')
		expect(html).toContain('data-testid="product-card"')
	})

	test('treats the row as foreign for a signed-in viewer with a different pubkey', async () => {
		// Dynamic import on purpose: the mocks above must register first.
		const { ProductCardHost } = await import('./ProductCardHost')

		// The "Your Product" disabled state is only rendered for the seller;
		// a signed-in non-seller gets the enabled "Add to Cart" affordance.
		const html = renderToString(React.createElement(ProductCardHost, { product: PLAIN_ROW as never }))

		expect(html).not.toContain('Your Product')
		expect(html).toContain('Add to Cart')
		expect(SIGNED_IN_OTHER_USER).not.toBe(PLAIN_ROW.pubkey)
	})
})
