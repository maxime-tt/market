import { describe, expect, test } from 'bun:test'
import {
	DASHBOARD_NAV,
	findNavEmoji,
	findNavItem,
	isFullBleedRoute,
	isNavItemActive,
	navItemLabel,
	resolveBackTarget,
	resolveBadgeCount,
	resolveNavView,
	shouldShowSidebarOnMobile,
	showsPageTitle,
} from './model'

/**
 * The original dashboard navigation was a 132-line table in
 * `src/config/dashboardNavigation.ts`, with the emoji baked into the title
 * string and four separate hardcoded path tables derived from it in
 * `platform/web/routes/_dashboard-layout.tsx`. These expectations are copied
 * from that original data so a transcription slip fails the suite instead of
 * silently changing the sidebar.
 */
const EXPECTED: ReadonlyArray<readonly [path: string, emoji: string, title: string]> = [
	['/dashboard/sales/sales', '💰', 'Sales'],
	['/dashboard/sales/messages', '✉️', 'Messages'],
	['/dashboard/sales/circular-economy', '♻️', 'Circular Economy'],
	['/dashboard/products/products', '📦', 'Products'],
	['/dashboard/products/auctions', '🔨', 'Auctions'],
	['/dashboard/products/bids', '🧾', 'Bids'],
	['/dashboard/products/collections', '🗂️', 'Collections'],
	['/dashboard/products/migration-tool', '🔄', 'Migration Tool'],
	['/dashboard/products/shipping-options', '📫', 'Shipping Options'],
	['/dashboard/account/vanity-url', '✨', 'Vanity URL'],
	['/dashboard/account/nostr-address', '📧', 'Nostr Address'],
	['/dashboard/account/profile', '👤', 'Profile'],
	['/dashboard/account/making-payments', '💳', 'Make Payments'],
	['/dashboard/account/receiving-payments', '💸', 'Receive Payments'],
	['/dashboard/account/your-purchases', '🛍️', 'Your Purchases'],
	['/dashboard/account/network', '🌐', 'Network'],
	['/dashboard/account/preferences', '⚙️', 'Preferences'],
	['/dashboard/app-settings/app-miscelleneous', '⚙️', 'App Miscellaneous'],
	['/dashboard/app-settings/team', '👥', 'Team'],
	['/dashboard/app-settings/blacklists', '🚫', 'Blacklists'],
	['/dashboard/app-settings/featured-items', '⭐', 'Featured Items'],
	['/dashboard/about', 'ℹ️', 'About'],
]

const allItems = DASHBOARD_NAV.flatMap((section) => section.items)

describe('DASHBOARD_NAV fidelity', () => {
	test('keeps the original paths, emoji and titles exactly', () => {
		expect(allItems.map((entry) => [entry.path, entry.emoji, entry.title])).toEqual(EXPECTED.map((row) => [...row]))
	})

	test('keeps the original section order and headings', () => {
		expect(DASHBOARD_NAV.map((section) => section.title)).toEqual(['SALES', 'PRODUCTS', 'ACCOUNT', 'APP SETTINGS', 'INFO'])
	})

	test('keeps APP SETTINGS admin-only at section and item level', () => {
		const settings = DASHBOARD_NAV.find((section) => section.title === 'APP SETTINGS')
		expect(settings?.adminOnly).toBe(true)
		expect(settings?.items.every((entry) => entry.adminOnly === true)).toBe(true)
	})

	test('has no duplicate paths', () => {
		const paths = allItems.map((entry) => entry.path)
		expect(new Set(paths).size).toBe(paths.length)
	})

	test('navItemLabel reproduces the original "emoji title" string', () => {
		const sales = allItems.find((entry) => entry.path === '/dashboard/sales/sales')
		expect(sales && navItemLabel(sales)).toBe('💰 Sales')
	})
})

describe('isNavItemActive', () => {
	test('matches the item itself', () => {
		expect(isNavItemActive('/dashboard/products/products', '/dashboard/products/products')).toBe(true)
	})

	test('matches descendants, the way fuzzy routing did', () => {
		expect(isNavItemActive('/dashboard/products/products/new', '/dashboard/products/products')).toBe(true)
		expect(isNavItemActive('/dashboard/products/products/abc123', '/dashboard/products/products')).toBe(true)
		expect(isNavItemActive('/dashboard/sales/messages/npub1xyz', '/dashboard/sales/messages')).toBe(true)
	})

	test('does not match a sibling that merely shares a prefix', () => {
		expect(isNavItemActive('/dashboard/products/auctions', '/dashboard/products/products')).toBe(false)
		expect(isNavItemActive('/dashboard/products/bids', '/dashboard/products/bidsomething')).toBe(false)
	})

	test('does not match unrelated routes', () => {
		expect(isNavItemActive('/dashboard', '/dashboard/products/products')).toBe(false)
	})
})

describe('resolveBadgeCount', () => {
	test('returns zero when the item declares no badge keys', () => {
		expect(resolveBadgeCount({}, { unseenOrders: 5 })).toBe(0)
		expect(resolveBadgeCount({ badgeKeys: [] }, { unseenOrders: 5 })).toBe(0)
	})

	test('sums the declared counters, matching the original auction badge', () => {
		const auctions = allItems.find((entry) => entry.path === '/dashboard/products/auctions')
		expect(auctions).toBeDefined()
		expect(
			resolveBadgeCount(auctions!, {
				unseenAuctionBids: 1,
				unseenAuctionLiveChatComments: 2,
				unseenAuctionThreadComments: 3,
				unseenScheduledAuctionsNowLive: 4,
				unseenAuctionSettlementBegins: 5,
			}),
		).toBe(15)
	})

	test('treats a missing counter as zero', () => {
		expect(resolveBadgeCount({ badgeKeys: ['unseenOrders', 'unseenMessages'] }, { unseenOrders: 3 })).toBe(3)
	})
})

const noCounts = {}

describe('resolveNavView', () => {
	test('hides admin-only sections and items from non-admins and drops empty sections', () => {
		const view = resolveNavView(DASHBOARD_NAV, '/dashboard', noCounts, { isAdmin: false })
		expect(view.map((section) => section.title)).toEqual(['SALES', 'PRODUCTS', 'ACCOUNT', 'INFO'])
		expect(view.flatMap((section) => section.items).some((entry) => entry.adminOnly)).toBe(false)
	})

	test('shows every section to admins', () => {
		const view = resolveNavView(DASHBOARD_NAV, '/dashboard', noCounts, { isAdmin: true })
		expect(view.map((section) => section.title)).toEqual(['SALES', 'PRODUCTS', 'ACCOUNT', 'APP SETTINGS', 'INFO'])
	})

	test('shows every section while the admin check is still loading', () => {
		const view = resolveNavView(DASHBOARD_NAV, '/dashboard', noCounts, { isAdmin: false, isAdminLoading: true })
		expect(view.map((section) => section.title)).toContain('APP SETTINGS')
	})

	test('marks exactly the owning item active for a detail route', () => {
		const view = resolveNavView(DASHBOARD_NAV, '/dashboard/products/products/abc', noCounts, { isAdmin: false })
		const active = view.flatMap((section) => section.items).filter((entry) => entry.active)
		expect(active.map((entry) => entry.path)).toEqual(['/dashboard/products/products'])
	})

	test('resolves badges from the supplied counts', () => {
		const view = resolveNavView(DASHBOARD_NAV, '/dashboard', { unseenOrders: 7 }, { isAdmin: false })
		const sales = view.flatMap((section) => section.items).find((entry) => entry.path === '/dashboard/sales/sales')
		expect(sales?.badgeCount).toBe(7)
	})

	test('does not mutate the source model', () => {
		resolveNavView(DASHBOARD_NAV, '/dashboard/sales/sales', { unseenOrders: 1 }, { isAdmin: true })
		expect(allItems.every((entry) => !('badgeCount' in entry) && !('active' in entry))).toBe(true)
	})
})

describe('findNavItem / findNavEmoji', () => {
	test('finds the owning item for a nested route', () => {
		expect(findNavItem(DASHBOARD_NAV, '/dashboard/sales/messages/npub1abc')?.title).toBe('Messages')
	})

	test('returns undefined for a route no item owns', () => {
		expect(findNavItem(DASHBOARD_NAV, '/dashboard')).toBeUndefined()
		expect(findNavItem(DASHBOARD_NAV, '/checkout')).toBeUndefined()
	})

	test('returns the emoji without parsing the title', () => {
		expect(findNavEmoji(DASHBOARD_NAV, '/dashboard/products/bids')).toBe('🧾')
		expect(findNavEmoji(DASHBOARD_NAV, '/dashboard')).toBeNull()
	})
})

describe('resolveBackTarget', () => {
	test('routes product edit and create pages back to the products list', () => {
		expect(resolveBackTarget('/dashboard/products/products/new')).toEqual({
			kind: 'route',
			path: '/dashboard/products/products',
			label: '📦 Products',
		})
		expect(resolveBackTarget('/dashboard/products/products/abc123')).toEqual({
			kind: 'route',
			path: '/dashboard/products/products',
			label: '📦 Products',
		})
	})

	test('gives no back control on a section root', () => {
		expect(resolveBackTarget('/dashboard/products/products')).toBeNull()
		expect(resolveBackTarget('/dashboard/products/auctions')).toBeNull()
		expect(resolveBackTarget('/dashboard/sales/messages')).toBeNull()
	})

	test('routes collection and auction details to their parents', () => {
		expect(resolveBackTarget('/dashboard/products/collections/c1')).toEqual({
			kind: 'route',
			path: '/dashboard/products/collections',
			label: '🗂️ Collections',
		})
		expect(resolveBackTarget('/dashboard/products/auctions/a1')).toEqual({
			kind: 'route',
			path: '/dashboard/products/auctions',
			label: '🔨 Auctions',
		})
		expect(resolveBackTarget('/dashboard/sales/messages/npub1abc')).toEqual({
			kind: 'route',
			path: '/dashboard/sales/messages',
			label: '✉️ Messages',
		})
	})

	test('uses browser history for order details, which are reachable from two places', () => {
		expect(resolveBackTarget('/dashboard/orders/o1')).toEqual({ kind: 'history', label: 'Orders' })
	})

	test('returns null for routes with no back rule', () => {
		expect(resolveBackTarget('/dashboard')).toBeNull()
		expect(resolveBackTarget('/dashboard/about')).toBeNull()
		expect(resolveBackTarget('/dashboard/account/profile')).toBeNull()
	})
})

describe('isFullBleedRoute', () => {
	test('is true for the routes the legacy p-0 chain listed', () => {
		expect(isFullBleedRoute(DASHBOARD_NAV, '/dashboard/sales/sales')).toBe(true)
		expect(isFullBleedRoute(DASHBOARD_NAV, '/dashboard/products/migration-tool')).toBe(true)
		expect(isFullBleedRoute(DASHBOARD_NAV, '/dashboard/app-settings/team')).toBe(true)
		expect(isFullBleedRoute(DASHBOARD_NAV, '/dashboard/about')).toBe(true)
	})

	test('is false for routes outside the navigation', () => {
		expect(isFullBleedRoute(DASHBOARD_NAV, '/dashboard')).toBe(false)
		expect(isFullBleedRoute(DASHBOARD_NAV, '/checkout')).toBe(false)
	})
})

describe('showsPageTitle', () => {
	test('never shows a page title on the dashboard root', () => {
		expect(showsPageTitle(DASHBOARD_NAV, '/dashboard')).toBe(false)
	})

	test('shows a title only for routes not declared to hide it', () => {
		expect(showsPageTitle(DASHBOARD_NAV, '/dashboard/products/products')).toBe(false)
		expect(showsPageTitle(DASHBOARD_NAV, '/dashboard/account/profile')).toBe(false)
	})

	test('suppresses the title when a back control already provides the context', () => {
		expect(showsPageTitle(DASHBOARD_NAV, '/dashboard/orders/o1', true)).toBe(false)
	})

	test('replaces the legacy condition list, which referenced a route no item defines', () => {
		// The old title lists named /dashboard/products/receiving-payments, which is
		// not a route or a nav item; the model derives the answer from real data.
		expect(findNavItem(DASHBOARD_NAV, '/dashboard/products/receiving-payments')).toBeUndefined()
	})
})

describe('shouldShowSidebarOnMobile', () => {
	test('shows the sidebar only on the dashboard root', () => {
		expect(shouldShowSidebarOnMobile('/dashboard')).toBe(true)
		expect(shouldShowSidebarOnMobile('/dashboard/products/products')).toBe(false)
		expect(shouldShowSidebarOnMobile('/dashboard/sales/messages/npub1abc')).toBe(false)
	})
})
