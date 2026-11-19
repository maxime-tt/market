/**
 * platform/web/layout/navItems.ts — the one nav list.
 *
 * Every destination the app puts in its nav is composed here: the frame-level
 * `AppBar` renders this list, and the small-screen `MobileMenu` reads the same
 * call, so the two surfaces cannot disagree about what the nav holds or in what
 * order. Before this module the destinations existed twice — once in the legacy
 * header's desktop list and once in `MobileMenu`'s `menuItems` — so adding one
 * meant editing two files and remembering the second.
 *
 * Two kinds of entry, and the difference is load-bearing:
 *
 *   - `route` — a destination compiled into the router (`products`, `auctions`,
 *     `community`, and the instance-gated `nostr`). Rendered with the router's
 *     `Link`, so navigation is client-side and the route decides the page.
 *   - `pinned` — a page the operator bound to a path in the routing file and
 *     tagged with a `nav` label (`data/routes.json`; `BindingNav` in
 *     `platform/server/routes/routeFile.ts`). These are runtime data: the bar
 *     renders them as document-load anchors, because the router has no route
 *     object for an operator's path and a client-side navigation to a bound
 *     path cannot render it (the server's `#__AR_ROUTE__` payload is a fact
 *     about the current document load — see
 *     `platform/web/storefront/appChromePage.ts`).
 *
 * Pinned entries are instance state read over the wire (`GET /api/routes`), and
 * `fetchRouteTable` does not validate binding shapes, so the filter below is the
 * gate: a binding whose `nav` is not `{ label: string, order: finite number }`
 * is ignored rather than rendered.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A destination the app itself compiles in. */
export type NavRoute = '/products' | '/auctions' | '/community' | '/nostr'

/**
 * One nav entry, in the shape its renderer needs. `kind` is what tells a
 * rendered entry whether the router can navigate to it.
 */
export type NavEntry = { kind: 'route'; label: string; to: NavRoute } | { kind: 'pinned'; label: string; href: string }

/**
 * The slice of a `GET /api/routes` binding this module reads. Deliberately
 * loose — `nav.label` and `nav.order` arrive as `unknown` because the response
 * is untrusted instance state, not a typed value this module may trust.
 */
export interface NavBinding {
	path: string
	nav?: { label?: unknown; order?: unknown } | undefined
}

/** A binding whose `nav` passed the shape gate. */
interface PinnedBinding extends NavBinding {
	nav: { label: string; order: number }
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** The unconditioned destinations — every instance shows these. */
const BASE_NAV_ITEMS: readonly { label: string; to: NavRoute }[] = [
	{ label: 'Products', to: '/products' },
	{ label: 'Auctions', to: '/auctions' },
	{ label: 'Community', to: '/community' },
]

/**
 * `Nostr` is instance-gated (`config.appSettings.showNostrLink`): an instance
 * that does not want to advertise the relay surface turns it off, and the link
 * disappears without a code change.
 */
const NOSTR_NAV_ITEM: { label: string; to: NavRoute } = { label: 'Nostr', to: '/nostr' }

/**
 * The shape gate for a pin. `label` must be a string and `order` a finite
 * number; anything else — a missing `nav`, a `nav` that is not an object, a
 * numeric label, an `order` of `NaN` — is not a pin, and an entry that is not a
 * pin is not rendered.
 */
const isPinned = (binding: NavBinding): binding is PinnedBinding =>
	typeof binding.nav?.label === 'string' && Number.isFinite(binding.nav?.order)

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * The nav for one instance: the built-in destinations, then the operator's
 * pinned pages in `nav.order`, ties broken by path so the order is total (two
 * pins may share an `order`).
 *
 * `showNostrLink` comes from `/api/config`; before it resolves — and on an
 * instance that turned the link off — the bar shows the three unconditioned
 * destinations only.
 */
export function navItems(showNostrLink: boolean | undefined, bindings?: readonly NavBinding[]): NavEntry[] {
	const builtIn: NavEntry[] = BASE_NAV_ITEMS.map((item): NavEntry => ({ kind: 'route', label: item.label, to: item.to }))
	if (showNostrLink) builtIn.push({ kind: 'route', label: NOSTR_NAV_ITEM.label, to: NOSTR_NAV_ITEM.to })

	// `filter` copies before `sort`, so the caller's `bindings` array is never
	// reordered under it (react-query hands out a cached value).
	const pinned: NavEntry[] = (bindings ?? [])
		.filter(isPinned)
		.sort((a, b) => a.nav.order - b.nav.order || a.path.localeCompare(b.path))
		// A binding's `path` is stored without its leading slash (`routeFile.ts`
		// validates it as a *name*, `data/routes.example.json` is `"shop"`), and an
		// href without one would resolve against the current location — `/products`
		// would link to `/products/featured`. Root it here, tolerating a slash that
		// a malformed file already carries.
		.map(
			(binding): NavEntry => ({
				kind: 'pinned',
				label: binding.nav.label,
				href: binding.path.startsWith('/') ? binding.path : `/${binding.path}`,
			}),
		)

	return [...builtIn, ...pinned]
}
