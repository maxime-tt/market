/**
 * appbar/app-bar-view.tsx — the application bar's presentation.
 *
 * The one top bar the app frame mounts on every route. It is presentational
 * only: the wordmark (a link to `/`), the nav destinations, the search field and
 * the account cluster all arrive as slots, filled by the frame-level host
 * (`platform/web/layout/AppBar.tsx`). Nothing here reads a router, a store or a
 * query — see `ui/AGENTS.md`'s boundary rule.
 *
 * This is `ui/browse/browse-nav.tsx` generalised: the "Featured" anchor that
 * lived beside the wordmark is now part of the `navItems` slot, because the list
 * is data (the same list feeds the mobile menu later) and the destination is
 * operator data, not a literal.
 *
 * Styling is written against the widget role tokens only — `bg-background`,
 * `border-border-default`, `text-text-*`, `bg-fill-ink`. Inside `.arena-chrome`
 * those tokens resolve to Arena's dark values (`styles/arena-chrome.css`), so
 * both chromes are one code path and the bar needs no per-chrome branch.
 */

import type { FC, ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AppBarViewProps {
	/**
	 * The brand block — the instance's logo and title, already an anchor to `/`
	 * in the host. Required: the bar must never render without identity.
	 */
	brand: ReactNode
	/**
	 * The nav destinations, as link elements. The host supplies the one list
	 * (`platform/web/layout/navItems.ts`) plus, once pinned routes land, the
	 * operator's entries. Omitted means no nav list.
	 */
	navItems?: ReactNode
	/** Rendered search field slot (placed top-centre). */
	searchSlot?: ReactNode
	/** Rendered account/avatar slot (placed on the right). */
	accountSlot?: ReactNode
	/** Extra classes for the bar root. */
	className?: string
	ref?: Ref<HTMLElement>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Application bar.
 *
 * - Left: the brand slot, then the nav list.
 * - Centre: the search slot.
 * - Right: the account slot.
 *
 * The bar is the document's `header` and its nav list is the page's `nav`, so a
 * consuming route renders exactly one of each (`appChrome.test.tsx` pins that).
 */
export const AppBarView: FC<AppBarViewProps> = ({ brand, navItems, searchSlot, accountSlot, className, ref }) => {
	return (
		<header
			ref={ref}
			data-slot="app-bar"
			data-testid="widget-app-bar"
			className={cn(
				'flex',
				'items-center',
				'gap-5',
				'px-4',
				'lg:px-6',
				'h-16',
				'bg-background',
				'border-b',
				'border-border-default',
				'sticky',
				'top-0',
				'z-50',
				'w-full',
				className,
			)}
		>
			{/* Left: brand */}
			<div data-slot="brand" className="flex items-center gap-3 shrink-0">
				{brand}
			</div>

			{/* Nav list — below `sm` the mobile menu carries the same list instead */}
			{navItems && (
				<nav data-slot="app-bar-nav" className="hidden sm:flex items-center gap-6">
					{navItems}
				</nav>
			)}

			{/* Centre: search slot */}
			{searchSlot && (
				/*
				 * `min-w-0` is load-bearing, not cosmetic: a flex item's automatic
				 * minimum is its content's min-content width, so without it this slot
				 * refuses to shrink below the field inside it (560px) and the whole
				 * page is pushed out to 822px on a phone. It must sit on the *wrapper*
				 * — a `min-w-0` on the field alone cannot beat an ancestor that still
				 * refuses to shrink.
				 */
				<div data-slot="search-slot" className="flex-1 flex justify-center min-w-0">
					{searchSlot}
				</div>
			)}

			{/* Right: account slot */}
			{accountSlot && (
				<div data-slot="account-slot" className="ml-auto">
					{accountSlot}
				</div>
			)}
		</header>
	)
}
