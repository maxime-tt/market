/**
 * platform/web/layout/navItems.ts — the one built-in nav list.
 *
 * The destinations the app itself defines, in one place: the frame-level
 * `AppBar` renders them, and the small-screen menu reads the same list (the
 * second consumer lands with the menu's own change, WP4). Before this module the
 * same three links existed twice — once in the legacy header's desktop list and
 * once in `MobileMenu`'s `menuItems` — so adding a destination meant editing two
 * files and remembering the second.
 *
 * This is data, not a route table: each entry is a compiled-in route and the
 * label the bar shows. Operator-pinned entries (`data/routes.json` `nav`) are
 * runtime data and join the list at the bar, not here — see the TODO below.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItem {
	/** The visible label. */
	label: string
	/** The compiled-in destination the bar links to. */
	to: '/products' | '/auctions' | '/community' | '/nostr'
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** The unconditioned destinations — every instance shows these. */
const BASE_NAV_ITEMS: readonly NavItem[] = [
	{ label: 'Products', to: '/products' },
	{ label: 'Auctions', to: '/auctions' },
	{ label: 'Community', to: '/community' },
]

/**
 * `Nostr` is instance-gated (`config.appSettings.showNostrLink`): an instance
 * that does not want to advertise the relay surface turns it off, and the link
 * disappears without a code change.
 */
const NOSTR_NAV_ITEM: NavItem = { label: 'Nostr', to: '/nostr' }

/**
 * The built-in nav list for one instance.
 *
 * `showNostrLink` comes from `/api/config`; before it resolves — and on an
 * instance that turned the link off — the bar shows the three unconditioned
 * destinations only.
 *
 * TODO(WP7): operator-pinned routes are appended after these, ordered by their
 * binding's `nav.order`. The hardcoded "Featured" link the Browse nav used to
 * carry is deliberately not recreated here: it becomes a pin, and recreating it
 * would give the bar two sources for the same destination.
 */
export function navItems(showNostrLink: boolean | undefined): NavItem[] {
	return showNostrLink ? [...BASE_NAV_ITEMS, NOSTR_NAV_ITEM] : [...BASE_NAV_ITEMS]
}
