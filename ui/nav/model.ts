/**
 * The dashboard navigation model.
 *
 * This module is the single source of truth for the dashboard's sections, items,
 * labels, icons, admin gating, badge keys and back targets. It is **data plus
 * pure functions only** — no React, no router, no store, no I/O — so it can be
 * unit-tested directly and consumed by any renderer.
 *
 * It replaces five hardcoded per-path tables that used to live in
 * `platform/web/routes/_dashboard-layout.tsx`:
 *
 * 1. `backButtonRoutes` + `getBackButtonInfo` (18-branch prefix walk)
 * 2. `handleBackToSidebar` (a second, divergent copy of the same branch logic)
 * 3. `getCurrentEmoji` (regex-parsed the emoji back out of the item title)
 * 4. `getNotificationCount` (an 11-argument path→count switch)
 * 5. the `p-0 lg:p-0` chain plus the twice-duplicated 22-branch title condition
 *
 * Those tables disagreed with each other: `handleBackToSidebar` sent order
 * details to `/dashboard/sales/sales` while `handleBackToParent` used browser
 * history, and the title lists referenced `/dashboard/products/receiving-payments`,
 * which no route or nav item defines.
 */

/** A notification counter the host can supply for a nav item's badge. */
export type NavBadgeKey =
	| 'unseenOrders'
	| 'unseenMessages'
	| 'unseenPurchases'
	| 'unseenProductThreadComments'
	| 'unseenBidUpdates'
	| 'unseenAuctionBids'
	| 'unseenAuctionLiveChatComments'
	| 'unseenAuctionThreadComments'
	| 'unseenScheduledAuctionsNowLive'
	| 'unseenAuctionSettlementBegins'

/** Counts keyed by {@link NavBadgeKey}; a missing key counts as zero. */
export type NavBadgeCounts = Partial<Record<NavBadgeKey, number>>

export interface NavItem {
	/** Route path; also the item's stable identity. */
	path: string
	/** Visible label without the leading emoji. */
	title: string
	/** Leading emoji, kept as data so no renderer has to parse it out of `title`. */
	emoji: string
	/** Restricts the item to admins. */
	adminOnly?: boolean
	/** Counters summed into the item's badge. */
	badgeKeys?: readonly NavBadgeKey[]
	/** Renders the route's content edge-to-edge instead of inside the padded panel. */
	fullBleed?: boolean
	/** Hides the duplicated in-page title heading when the item already shows one. */
	hidesPageTitle?: boolean
}

export interface NavSection {
	/** Visible section heading. */
	title: string
	items: readonly NavItem[]
	/** Restricts the whole section to admins. */
	adminOnly?: boolean
}

/** A nav item with its badge already resolved to a number. */
export interface NavItemWithBadge extends NavItem {
	badgeCount: number
	active: boolean
}

/** A section with resolved items; empty sections are dropped by the projection. */
export interface NavSectionView {
	title: string
	items: NavItemWithBadge[]
}

/** Where a back control should go. */
export type NavBackTarget = { kind: 'route'; path: string; label: string } | { kind: 'history'; label: string }

interface NavBackRule {
	/** Path prefix this rule matches. */
	prefix: string
	/** A path equal to this value matches (used for the `/new` pages). */
	exact?: string
	/** Section root that must NOT match, so the root itself has no back control. */
	notExact?: string
	/** Parent path, or `null` to fall back to browser history. */
	parentPath: string | null
	/** Label shown on the back control. */
	label: string
}

const item = (path: string, emoji: string, title: string, extra: Omit<NavItem, 'path' | 'emoji' | 'title'> = {}): NavItem => ({
	path,
	emoji,
	title,
	...extra,
})

/** The dashboard's sections, in render order. */
export const DASHBOARD_NAV: readonly NavSection[] = [
	{
		title: 'SALES',
		items: [
			item('/dashboard/sales/sales', '💰', 'Sales', { badgeKeys: ['unseenOrders'], fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/sales/messages', '✉️', 'Messages', {
				badgeKeys: ['unseenMessages'],
				fullBleed: true,
				hidesPageTitle: true,
			}),
			item('/dashboard/sales/circular-economy', '♻️', 'Circular Economy', { fullBleed: true, hidesPageTitle: true }),
		],
	},
	{
		title: 'PRODUCTS',
		items: [
			item('/dashboard/products/products', '📦', 'Products', {
				badgeKeys: ['unseenProductThreadComments'],
				fullBleed: true,
				hidesPageTitle: true,
			}),
			item('/dashboard/products/auctions', '🔨', 'Auctions', {
				badgeKeys: [
					'unseenAuctionBids',
					'unseenAuctionLiveChatComments',
					'unseenAuctionThreadComments',
					'unseenScheduledAuctionsNowLive',
					'unseenAuctionSettlementBegins',
				],
				fullBleed: true,
				hidesPageTitle: true,
			}),
			item('/dashboard/products/bids', '🧾', 'Bids', { badgeKeys: ['unseenBidUpdates'], fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/products/collections', '🗂️', 'Collections', { fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/products/migration-tool', '🔄', 'Migration Tool', { fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/products/shipping-options', '📫', 'Shipping Options', { fullBleed: true, hidesPageTitle: true }),
		],
	},
	{
		title: 'ACCOUNT',
		items: [
			item('/dashboard/account/vanity-url', '✨', 'Vanity URL'),
			item('/dashboard/account/nostr-address', '📧', 'Nostr Address'),
			item('/dashboard/account/profile', '👤', 'Profile', { fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/account/making-payments', '💳', 'Make Payments', { fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/account/receiving-payments', '💸', 'Receive Payments', { fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/account/your-purchases', '🛍️', 'Your Purchases', {
				badgeKeys: ['unseenPurchases'],
				fullBleed: true,
				hidesPageTitle: true,
			}),
			item('/dashboard/account/network', '🌐', 'Network', { fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/account/preferences', '⚙️', 'Preferences', { fullBleed: true, hidesPageTitle: true }),
		],
	},
	{
		title: 'APP SETTINGS',
		adminOnly: true,
		items: [
			item('/dashboard/app-settings/app-miscelleneous', '⚙️', 'App Miscellaneous', {
				adminOnly: true,
				fullBleed: true,
				hidesPageTitle: true,
			}),
			item('/dashboard/app-settings/team', '👥', 'Team', { adminOnly: true, fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/app-settings/blacklists', '🚫', 'Blacklists', { adminOnly: true, fullBleed: true, hidesPageTitle: true }),
			item('/dashboard/app-settings/featured-items', '⭐', 'Featured Items', {
				adminOnly: true,
				fullBleed: true,
				hidesPageTitle: true,
			}),
		],
	},
	{
		title: 'INFO',
		items: [item('/dashboard/about', 'ℹ️', 'About', { fullBleed: true, hidesPageTitle: true })],
	},
]

/**
 * Back-navigation rules, in match order. `notExact` keeps a section root from
 * matching its own detail-route rule.
 */
export const DASHBOARD_BACK_RULES: readonly NavBackRule[] = [
	{
		prefix: '/dashboard/products/products/',
		exact: '/dashboard/products/products/new',
		parentPath: '/dashboard/products/products',
		label: '📦 Products',
	},
	{
		prefix: '/dashboard/products/products/',
		notExact: '/dashboard/products/products',
		parentPath: '/dashboard/products/products',
		label: '📦 Products',
	},
	{
		prefix: '/dashboard/products/collections/',
		exact: '/dashboard/products/collections/new',
		parentPath: '/dashboard/products/collections',
		label: '🗂️ Collections',
	},
	{
		prefix: '/dashboard/products/collections/',
		notExact: '/dashboard/products/collections',
		parentPath: '/dashboard/products/collections',
		label: '🗂️ Collections',
	},
	{
		prefix: '/dashboard/products/auctions/',
		notExact: '/dashboard/products/auctions',
		parentPath: '/dashboard/products/auctions',
		label: '🔨 Auctions',
	},
	{ prefix: '/dashboard/orders/', notExact: '/dashboard/orders', parentPath: null, label: 'Orders' },
	{
		prefix: '/dashboard/sales/messages/',
		notExact: '/dashboard/sales/messages',
		parentPath: '/dashboard/sales/messages',
		label: '✉️ Messages',
	},
]

/** Joins an item's emoji and label into the single visible string renderers show. */
export function navItemLabel(entry: Pick<NavItem, 'emoji' | 'title'>): string {
	return `${entry.emoji} ${entry.title}`
}

/**
 * Whether `pathname` belongs to `itemPath`. Mirrors TanStack Router's
 * `fuzzy: true` match, which the layout relied on: the item's own path and any
 * of its descendants are active, but a longer sibling path is not.
 */
export function isNavItemActive(pathname: string, itemPath: string): boolean {
	if (pathname === itemPath) return true
	return pathname.startsWith(itemPath.endsWith('/') ? itemPath : `${itemPath}/`)
}

/** Sums the counters an item declares. Unknown or missing keys count as zero. */
export function resolveBadgeCount(item: Pick<NavItem, 'badgeKeys'>, counts: NavBadgeCounts): number {
	if (!item.badgeKeys?.length) return 0
	return item.badgeKeys.reduce((total, key) => total + (counts[key] ?? 0), 0)
}

/**
 * Filters the model for the viewer and resolves badges and active state.
 *
 * `isAdminLoading` reproduces the original behaviour of showing every section
 * while the admin check is still in flight, so the sidebar does not flicker.
 */
export function resolveNavView(
	model: readonly NavSection[],
	pathname: string,
	counts: NavBadgeCounts,
	options: { isAdmin: boolean; isAdminLoading?: boolean },
): NavSectionView[] {
	const { isAdmin, isAdminLoading = false } = options

	return model
		.filter((section) => isAdminLoading || !section.adminOnly || isAdmin)
		.map((section) => ({
			title: section.title,
			items: section.items
				.filter((entry) => isAdminLoading || !entry.adminOnly || isAdmin)
				.map((entry) => ({
					...entry,
					badgeCount: resolveBadgeCount(entry, counts),
					active: isNavItemActive(pathname, entry.path),
				})),
		}))
		.filter((section) => section.items.length > 0)
}

/** Finds the nav item that owns `pathname`, if any. */
export function findNavItem(model: readonly NavSection[], pathname: string): NavItem | undefined {
	for (const section of model) {
		for (const entry of section.items) {
			if (isNavItemActive(pathname, entry.path)) return entry
		}
	}
	return undefined
}

/** The emoji for the current route, used by the mobile header. */
export function findNavEmoji(model: readonly NavSection[], pathname: string): string | null {
	return findNavItem(model, pathname)?.emoji ?? null
}

/**
 * Resolves the back control for `pathname`, or `null` when the route has none.
 *
 * `null` return means "no back control"; a `{ kind: 'history' }` target means
 * "go back in browser history", which is what order details need because they
 * are reachable from either sales or purchases.
 */
export function resolveBackTarget(pathname: string, rules: readonly NavBackRule[] = DASHBOARD_BACK_RULES): NavBackTarget | null {
	for (const rule of rules) {
		const matchesPrefix = pathname.startsWith(rule.prefix)
		const matchesExact = rule.exact !== undefined && pathname === rule.exact
		if (!matchesPrefix && !matchesExact) continue
		if (rule.notExact !== undefined && pathname === rule.notExact) continue
		if (rule.parentPath === null) return { kind: 'history', label: rule.label }
		return { kind: 'route', path: rule.parentPath, label: rule.label }
	}
	return null
}

/** Whether the route's content renders edge-to-edge instead of inside the padded panel. */
export function isFullBleedRoute(model: readonly NavSection[], pathname: string): boolean {
	return findNavItem(model, pathname)?.fullBleed ?? false
}

/**
 * Whether the shell should render its own page-title heading for this route.
 *
 * Replaces the twice-duplicated 22-branch condition list: routes that already
 * render their own heading declare `hidesPageTitle`. The dashboard root shows
 * the "Dashboard" heading instead.
 */
export function showsPageTitle(model: readonly NavSection[], pathname: string, hideWhenBackButton = false): boolean {
	if (pathname === '/dashboard') return false
	if (hideWhenBackButton && resolveBackTarget(pathname) !== null) return false
	const entry = findNavItem(model, pathname)
	return !(entry?.hidesPageTitle ?? false)
}

/**
 * Whether a section root should be shown on a compact viewport. On mobile the
 * dashboard root shows the sidebar and every other route shows content.
 */
export function shouldShowSidebarOnMobile(pathname: string): boolean {
	return pathname === '/dashboard'
}
