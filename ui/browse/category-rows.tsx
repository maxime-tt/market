/**
 * browse/category-rows.tsx — Browse by category: rows of products grouped by
 * category (frame `V3PpdwmvGG__browse-by-category-cms-rows-1440.html`).
 *
 * The frame's row anatomy:
 * - Row header: category `h2`, a count, and a right-aligned `See all →`,
 *   closed by a `--border-strong` rule.
 * - Items: four cards across at 1440, two at tablet, one on mobile.
 *
 * The frame's card treatment: **no top rule on the cards** — the results grid
 * card carries a `border-strong` hairline, this one does not (`V3PpdwmvGG`:
 * `.card{border-top:0;padding-top:16px}`). `ProductCard presentation="row"`
 * is that difference; the card itself stays one implementation.
 *
 * The count is the row's loaded item count, and it is labelled `loaded`: the
 * Browse read is a bounded kind-30402 set, so the frame's market-wide
 * `<span>412 items</span>` is a number this app cannot measure. See
 * `platform/web/browse/browseIndexFeed.ts`.
 */

import type { FC, MouseEventHandler, ReactNode } from 'react'
import { cn } from '../utils/cn'
import { SkeletonGrid } from './skeleton-grid'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CategoryRowProps {
	/** Category name — the row's `h2`. */
	title: string
	/**
	 * Items loaded for this category, shown next to the title. Omit it and the
	 * header renders the title alone rather than an invented count.
	 */
	count?: number
	/** Fired by the `See all →` link. */
	onSeeAll?: () => void
	/** The row's cards (host-rendered `ProductCard`s). */
	children?: ReactNode
	/** Extra classes for the row root. */
	className?: string
}

export interface CategoryRowsProps {
	/** `CategoryRow` children, in order. */
	children?: ReactNode
	/** The feed is still streaming — one shimmering placeholder row. */
	isLoading?: boolean
	/** The feed failed: say so instead of an empty section. */
	isError?: boolean
	/** Extra classes for the section root. */
	className?: string
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** One browse-by-category row: header rule + four cards across. */
export const CategoryRow: FC<CategoryRowProps> = ({ title, count, onSeeAll, children, className }) => {
	const handleSeeAll: MouseEventHandler<HTMLAnchorElement> = (e) => {
		if (!onSeeAll) return
		e.preventDefault()
		onSeeAll()
	}

	return (
		<div data-slot="category-row" data-testid={`widget-category-row-${title}`} className={cn('mb-[18px]', className)}>
			<div data-slot="category-row-header" className="flex items-baseline gap-3.5 pb-2 mb-3 border-b border-border-strong">
				<h2 className="font-display text-[22px] font-medium leading-[1.1] tracking-[-0.015em] text-text-high">{title}</h2>
				{count !== undefined && (
					<span data-slot="category-row-count" className="text-xs text-text-mid tabular-nums">
						{count.toLocaleString('en-US')} loaded
					</span>
				)}
				{onSeeAll && (
					<a
						href="#"
						data-slot="category-row-see-all"
						data-testid={`widget-category-row-see-all-${title}`}
						className="ml-auto text-[11px] uppercase tracking-[0.12em] text-text-mid hover:text-text-high transition-colors cursor-pointer"
						onClick={handleSeeAll}
					>
						See all →
					</a>
				)}
			</div>
			<div data-slot="category-row-items" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[18px]">
				{children}
			</div>
		</div>
	)
}

/**
 * The browse-by-category section. It renders whatever rows it is given and
 * states its own read status: a placeholder row while the feed streams, one
 * honest line when the read failed, and nothing at all when every category is
 * empty (the hero above still carries the page).
 */
export const CategoryRows: FC<CategoryRowsProps> = ({ children, isLoading = false, isError = false, className }) => {
	if (isLoading) {
		return (
			<section data-slot="category-rows" data-testid="widget-category-rows" className={cn('mt-6', className)}>
				<SkeletonGrid rows={4} columns={4} />
			</section>
		)
	}

	if (isError) {
		return (
			<section data-slot="category-rows" data-testid="widget-category-rows" className={cn('mt-6', className)}>
				<p data-testid="widget-category-rows-error" className="py-6 text-sm text-text-mid">
					Categories could not be loaded — no relay answered for this read.
				</p>
			</section>
		)
	}

	return (
		<section data-slot="category-rows" data-testid="widget-category-rows" className={cn('mt-6', className)}>
			{children}
		</section>
	)
}
