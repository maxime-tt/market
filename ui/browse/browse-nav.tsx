/**
 * browse/browse-nav.tsx — Browse shell navigation bar.
 *
 * The wordmark **is** the Browse link; only `Featured` is a nav text link.
 * Slots for the search field and the account button follow the same
 * `renderLink`/`onNavigate`/`render` pattern as `ui/nav/sidebar-nav.tsx`.
 */

import type { FC, MouseEventHandler, ReactNode } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrowseNavProps {
	/** Label for the Browse wordmark link. Defaults to "Plebeian Market". */
	wordmarkLabel?: string
	/**
	 * Which destination is current. `browse` marks the wordmark (the wordmark
	 * *is* the Browse link); `featured` marks the `Featured` link with the
	 * frame's active underline and moves `aria-current` onto it.
	 */
	currentPage?: 'browse' | 'featured'
	/** Click handler for the wordmark link. */
	onNavigateHome?: () => void
	/** Click handler for the Featured link. */
	onNavigateFeatured?: () => void
	/** Whether the wordmark link is active. */
	active?: boolean
	/** Rendered search field slot (placed top-centre). */
	searchSlot?: ReactNode
	/** Rendered account/avatar slot (placed on the right). */
	accountSlot?: ReactNode
	/** Extra classes for the nav bar root. */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Browse navigation bar.
 *
 * - Left: wordmark (Browse link) + "Featured" text link.
 * - Centre: search field slot.
 * - Right: account/avatar slot.
 *
 * The wordmark uses `--fill-ink` for the label and brand-pink for "Market".
 */
export const BrowseNav: FC<BrowseNavProps> = ({
	wordmarkLabel = 'Plebeian Market',
	currentPage = 'browse',
	active = true,
	onNavigateHome,
	onNavigateFeatured,
	searchSlot,
	accountSlot,
	className,
}) => {
	const handleWordmarkClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
		if (onNavigateHome) {
			e.preventDefault()
			onNavigateHome()
		}
	}

	const handleFeaturedClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
		if (onNavigateFeatured) {
			e.preventDefault()
			onNavigateFeatured()
		}
	}

	return (
		<nav
			data-slot="browse-nav"
			data-testid="widget-browse-nav"
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
			{/* Left: wordmark + Featured link */}
			<div className="flex items-center gap-3 shrink-0">
				<a
					href="/"
					data-status={active ? 'active' : 'inactive'}
					data-slot="wordmark-link"
					data-testid="widget-browse-nav-wordmark"
					data-current={currentPage === 'browse'}
					aria-current={currentPage === 'browse' ? 'page' : undefined}
					className={cn(
						'font-display',
						'text-[20px]',
						'leading-tight',
						'tracking-[-0.01em]',
						'font-bold',
						'text-fill-ink',
						'hover:text-fill-ink-hover',
						'transition-colors',
						'cursor-pointer',
					)}
					onClick={handleWordmarkClick}
					aria-label="Plebeian Market — Browse"
				>
					{wordmarkLabel}
				</a>
				<a
					href="/featured"
					data-slot="featured-link"
					data-testid="widget-browse-nav-featured"
					data-current={currentPage === 'featured'}
					aria-current={currentPage === 'featured' ? 'page' : undefined}
					className={cn(
						'text-sm',
						'font-medium',
						'transition-colors',
						'cursor-pointer',
						// A phone's nav row cannot hold the wordmark, this link and a
						// search field at once: the field was left 81px at 360. The link
						// is the redundant one (the wordmark already goes to Browse), so
						// below `sm` it yields its width to the field.
						'hidden sm:block',
						// The frame's active link: ink text with a 2px ink underline.
						currentPage === 'featured' ? 'text-text-high border-b-2 border-fill-ink pb-[3px]' : 'text-text-mid hover:text-fill-ink',
					)}
					onClick={handleFeaturedClick}
					aria-label="Featured products"
				>
					Featured
				</a>
			</div>

			{/* Centre: search field slot */}
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
		</nav>
	)
}
