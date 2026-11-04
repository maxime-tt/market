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
	/** Current page; "browse" highlights the wordmark. */
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
					href="/#featured"
					data-slot="featured-link"
					data-testid="widget-browse-nav-featured"
					className={cn(
						'text-sm',
						'font-medium',
						'text-text-mid',
						'hover:text-fill-ink',
						'transition-colors',
						'cursor-pointer',
					)}
					onClick={handleFeaturedClick}
					aria-label="Featured products"
				>
					Featured
				</a>
			</div>

			{/* Centre: search field slot */}
			{searchSlot && (
				<div
					data-slot="search-slot"
					className="flex-1 flex justify-center"
				>
					{searchSlot}
				</div>
			)}

			{/* Right: account slot */}
			{accountSlot && (
				<div
					data-slot="account-slot"
					className="ml-auto"
				>
					{accountSlot}
				</div>
			)}
		</nav>
	)
}
