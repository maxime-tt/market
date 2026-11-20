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

import { useNavFit } from './use-nav-fit'
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
 *
 * ## The search is centred in the BAR, not in the space left over
 *
 * The three slots are three grid tracks, and from `sm` up the tracks are *equal*
 * (`minmax(0,1fr)` each). Equal side tracks are the whole mechanism: the middle
 * track's centre is then the bar's centre by construction, whatever the brand,
 * the nav and the account cluster happen to measure. The field itself is capped
 * at 560px (`SearchField`'s own `max-w-[560px]`) and centred inside its track, so
 * past that cap it stays on the centre line instead of filling it.
 *
 * Why not the tempting `grid-cols-[minmax(0,1fr)_minmax(0,560px)_minmax(0,1fr)]`?
 * It does not centre *and* it breaks: grid hands a track with a definite maximum
 * (`560px`) the free space before the flexible ones, so the side tracks collapse
 * (measured: `0px 288px 0px` on a 360px bar) and the brand/nav paint over the
 * field. Equal tracks spread the deficit instead: the field shrinks with the bar
 * and the side clusters keep their lanes.
 *
 * Below `sm` the bar is TWO rows (`grid-rows-[auto_auto]`): the brand and the
 * account cluster keep the first row and their `auto | 1fr | auto` tracks, and
 * the search slot leaves the middle track for a full-width second row of its
 * own (`col-start-1 col-end-4 row-start-2` — all three tracks, so the row is the
 * bar's full inner width and not the two-thirds a `col-end-3` span leaves; back
 * to the middle track from `sm`). Measured before: in the shared phone row the
 * field resolved to 27px with a 0-width input, because the brand (203px) and the
 * rigid 88px account cluster ate it; on its own row it gets the whole inner
 * width (~358px at 390px, still capped at 560px). The row is an `auto` track, so
 * when no field is mounted (`searchSlot` absent, or a page field hiding the
 * header's) it collapses to nothing and the bar stays one row tall.
 *
 * The nav list appears from `xl`: a third of the bar has to hold brand + nav
 * before a symmetric row is honest, and below that a centred field would either
 * shrink to nothing or have the list drawn over it. Where it does appear it wraps
 * inside its lane rather than clipping, and the left track clips (rather than
 * painting over the field) if an operator's instance name ever outgrows it.
 */
export const AppBarView: FC<AppBarViewProps> = ({ brand, navItems, searchSlot, accountSlot, className, ref }) => {
	// From `xl` the list sits inline only when it fits whole (see use-nav-fit.ts);
	// otherwise `data-nav-fits="false"` hands it to the host's menu button.
	const { laneRef, brandRef, navRef, fits } = useNavFit()
	return (
		<header
			ref={ref}
			data-slot="app-bar"
			data-testid="widget-app-bar"
			data-nav-fits={fits === false ? 'false' : undefined}
			className={cn(
				'group/appbar',
				'grid',
				// Two rows on a phone: brand + account on the first, the search field
				// alone on a full-width second row below `sm` (see the component doc).
				'grid-rows-[auto_auto]',
				'sm:grid-rows-1',
				// Phone: brand | (the search's row is below) | account.
				'grid-cols-[auto_minmax(0,1fr)_auto]',
				// From `sm`: three equal tracks, so the middle one is the bar's centre.
				'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]',
				'items-center',
				'gap-x-5',
				'gap-y-2',
				'px-4',
				'py-2',
				'lg:px-6',
				'sm:py-0',
				// `min-h`, not a fixed `h`: the phone bar grows by the field's own row
				// when one is shown, and the single-row bar keeps its 64px height.
				'min-h-16',
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
			{/* Left track: brand, then the nav list (the host's `mobile-menu-button` covers phones) */}
			<div ref={laneRef} data-slot="app-bar-left" className="col-start-1 row-start-1 flex min-w-0 items-center gap-5 overflow-hidden">
				<div ref={brandRef} data-slot="brand" className="flex min-w-0 items-center gap-3">
					{brand}
				</div>

				{navItems && (
					<nav
						ref={navRef}
						data-slot="app-bar-nav"
						className="hidden xl:flex shrink-0 flex-nowrap items-center gap-x-6 whitespace-nowrap xl:group-data-[nav-fits=false]/appbar:invisible xl:group-data-[nav-fits=false]/appbar:absolute xl:group-data-[nav-fits=false]/appbar:pointer-events-none"
					>
						{navItems}
					</nav>
				)}
			</div>

			{/* Middle track: the search, centred inside it */}
			{searchSlot && (
				/*
				 * `min-w-0` is load-bearing, not cosmetic: a grid item's automatic
				 * minimum is its content's min-content width, so without it this track
				 * refuses to shrink below the field inside it (560px) and the whole
				 * page is pushed out to 822px on a phone. It must sit on the *wrapper*
				 * — a `min-w-0` on the field alone cannot beat an ancestor that still
				 * refuses to shrink.
				 */
				<div
					data-slot="search-slot"
					className="col-start-1 col-end-4 row-start-2 flex w-full min-w-0 items-center justify-center sm:col-start-2 sm:col-end-3 sm:row-start-1"
				>
					{searchSlot}
				</div>
			)}

			{/* Right track: the account cluster, pinned to the bar's end */}
			{accountSlot && (
				<div data-slot="account-slot" className="col-start-3 row-start-1 justify-self-end">
					{accountSlot}
				</div>
			)}
		</header>
	)
}
