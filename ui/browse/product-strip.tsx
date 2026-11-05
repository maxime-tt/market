/**
 * browse/product-strip.tsx — Idle wall row: clickable tiles that reveal
 * title + seller on hover/focus.
 *
 * The strips are product cards, not images. On hover each shows the item's
 * title and seller, and it is clickable (selection opens the detail panel).
 * No veil — the strips are meant to be read and clicked.
 */

import type { FC, MouseEventHandler, ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'
import { ProductArt, type MaterialClass } from './art'

// ---------------------------------------------------------------------------
// Strip item props
// ---------------------------------------------------------------------------

export interface StripItem {
	/** Unique id for the item (product event id). */
	id: string
	/** Product title, shown on hover. */
	title: string
	/** Seller name, shown on hover. */
	seller: string
	/** Material gradient class (.m1–.m8). */
	material: MaterialClass
	/** Product icon symbol (defaults to material-indexed icon). */
	symbolId?: 'p-bowl' | 'p-bottle' | 'p-mug' | 'p-lamp' | 'p-books' | 'p-crate' | 'p-candle' | 'p-jar'
}

export interface ProductStripProps {
	/** Items rendered in the strip. */
	items: readonly StripItem[]
	/** Callback when an item is clicked (opens detail panel). */
	onSelect?: (id: string) => void
	/** Extra classes for the strip row. */
	className?: string
	ref?: Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Product strip — a horizontal row of clickable tiles.
 *
 * Idle: just the material art.
 * Hover: title + seller overlay, lift + saturate, arrow affordance.
 */
export const ProductStrip: FC<ProductStripProps> = ({ items, onSelect, className, ref, ...props }) => {
	const handleClick: MouseEventHandler = (e) => {
		const target = e.currentTarget
		const article = target.closest('article')
		const id = article?.getAttribute('data-item-id')
		if (id) {
			onSelect?.(id)
		}
	}

	return (
		<div
			ref={ref}
			data-slot="product-strip"
			data-testid="widget-product-strip"
			className={cn('flex', 'items-start', 'gap-4', 'overflow-x-auto', 'py-2', className)}
			{...props}
		>
			{items.map((item) => (
				<article
					key={item.id}
					data-item-id={item.id}
					data-slot="strip-item"
					data-testid={`widget-strip-item-${item.id}`}
					className={cn(
						'relative',
						'w-[188px]',
						'h-[176px]',
						'flex-none',
						'rounded-[6px]',
						'overflow-hidden',
						'cursor-pointer',
						'transition-all',
						'duration-150',
						'hover:translate-y-[-4px]',
						'hover:scale-[1.04]',
						'hover:border-border-strong',
						'hover:shadow-[0_4px_12px_rgba(0,0,0,0.12)]',
						'hover:filter-none',
						'group',
					)}
					onClick={handleClick}
				>
					{/* Material art tile — no veil, strips are meant to be read and clicked */}
					<div data-slot="strip-tile" className={cn('relative', 'w-full', 'h-full', 'overflow-hidden')}>
						<ProductArt material={item.material} symbolId={item.symbolId} ratio="1/1" className="size-full" />
					</div>

					{/* Arrow affordance — click opens the panel */}
					<div
						data-slot="strip-arrow"
						className="absolute top-2.5 right-2.5 text-text-high opacity-0 group-hover:opacity-75 transition-opacity"
					>
						<svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
							<path d="M9 6l6 6-6 6" />
						</svg>
					</div>

					{/* Title + seller overlay — visible on hover/focus */}
					<div
						data-slot="strip-info"
						className={cn(
							'absolute',
							'bottom-0',
							'left-0',
							'right-0',
							'p-2.5',
							'opacity-0',
							'group-hover:opacity-100',
							'peer-focus:opacity-100',
							'transition-opacity',
							'duration-150',
						)}
					>
						<div data-slot="strip-seller" className={cn('text-[10px]', 'tracking-[0.13em]', 'uppercase', 'text-text-high', 'opacity-80')}>
							{item.seller}
						</div>
						<div
							data-slot="strip-title"
							className={cn('text-xs', 'font-medium', 'text-text-high', 'opacity-100', 'leading-tight', 'mt-0.5', 'truncate')}
						>
							{item.title}
						</div>
					</div>
				</article>
			))}
		</div>
	)
}
