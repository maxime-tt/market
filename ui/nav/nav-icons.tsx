import type { LucideIcon } from 'lucide-react'
import {
	ArrowRightLeft,
	AtSign,
	Ban,
	Banknote,
	Circle,
	CreditCard,
	FileText,
	FolderOpen,
	Gavel,
	HandCoins,
	Info,
	Link,
	MessagesSquare,
	Network,
	Package,
	Palette,
	Receipt,
	Recycle,
	Route,
	Settings,
	ShoppingBag,
	SlidersHorizontal,
	Star,
	Truck,
	User,
	Users,
} from 'lucide-react'

/**
 * Line icons for the dashboard menu, keyed by nav path.
 *
 * The admin console (ADR-0022) shows these instead of the nav model's emoji.
 * The emoji stay in the model as data for the surfaces that still use them.
 */
export const DASHBOARD_NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
	'/dashboard/sales/sales': Banknote,
	'/dashboard/sales/messages': MessagesSquare,
	'/dashboard/sales/circular-economy': Recycle,
	'/dashboard/products/products': Package,
	'/dashboard/products/auctions': Gavel,
	'/dashboard/products/bids': Receipt,
	'/dashboard/products/collections': FolderOpen,
	'/dashboard/products/migration-tool': ArrowRightLeft,
	'/dashboard/products/shipping-options': Truck,
	'/dashboard/account/vanity-url': Link,
	'/dashboard/account/nostr-address': AtSign,
	'/dashboard/account/profile': User,
	'/dashboard/account/profile-page': Palette,
	'/dashboard/account/making-payments': CreditCard,
	'/dashboard/account/receiving-payments': HandCoins,
	'/dashboard/account/your-purchases': ShoppingBag,
	'/dashboard/account/network': Network,
	'/dashboard/account/preferences': SlidersHorizontal,
	'/dashboard/app-settings/app-miscelleneous': Settings,
	'/dashboard/app-settings/team': Users,
	'/dashboard/app-settings/blacklists': Ban,
	'/dashboard/app-settings/featured-items': Star,
	'/dashboard/app-settings/routes': Route,
	'/dashboard/app-settings/pages': FileText,
	'/dashboard/about': Info,
}

/** The icon for a nav path, with a neutral dot for any path added later without one. */
export function dashboardNavIcon(path: string): LucideIcon {
	return DASHBOARD_NAV_ICONS[path] ?? Circle
}
