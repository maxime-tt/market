/**
 * browse/product-card.tsx — Product card view with shot, title, seller row,
 * price row, and context menu (Add to list › / Copy link / Report).
 *
 * Heart + three-dots in the text block — icon-first ghost buttons, no outline.
 */

import type { FC, MouseEventHandler, PointerEventHandler, Ref, TouchEventHandler } from 'react'
import { cn } from '../utils/cn'
import { formatSats } from '../utils/format'
import { ProductArt, type MaterialClass, type ProductSymbolId } from './art'

/**
 * The two card presentations the frames define. `grid` is the results-grid
 * tile; `row` is the browse-by-category tile, which drops the card's top rule.
 */
export type CardPresentation = 'grid' | 'row'

// ---------------------------------------------------------------------------
// Context menu — floating panel
// ---------------------------------------------------------------------------

export interface ProductContextMenuProps {
	/** Whether the context menu is open. */
	open: boolean
	/** Callback when "Add to list" is selected. */
	onAddToList?: () => void
	/** Callback when "Copy link" is selected. */
	onCopyLink?: () => void
	/** Callback when "Report" is selected. */
	onReport?: () => void
	/** Click handler for the product card (fires when clicking outside the menu). */
	onClose?: () => void
	/** Extra classes for the menu container. */
	className?: string
}

/**
 * Context menu — "Add to list ›" / "Copy link" / "Report".
 * Driven by props (open/onAdd/onCopy/onReport); same menu for right-click and long-press.
 */
export const ProductContextMenu: FC<ProductContextMenuProps> = ({ open, onAddToList, onCopyLink, onReport, onClose, className }) => {
	if (!open) return null

	return (
		<div
			data-slot="product-context-menu"
			data-testid="widget-product-context-menu"
			className={cn(
				'absolute',
				'top-[30px]',
				'right-0',
				'z-10',
				'w-[198px]',
				'p-[6px]',
				'bg-surface-raised',
				'border',
				'border-border-strong',
				'rounded',
				'box-shadow-[0_4px_12px_rgba(0,0,0,0.12)]',
				className,
			)}
			onClick={(e) => e.stopPropagation()}
		>
			{onAddToList && (
				<button
					type="button"
					data-slot="menu-add-to-list"
					data-testid="widget-context-menu-add-to-list"
					className={cn(
						'flex',
						'items-center',
						'justify-between',
						'gap-2.5',
						'h-8.5',
						'px-2.5',
						'rounded',
						'text-sm',
						'text-text-high',
						'hover:bg-surface-sunken',
						'cursor-pointer',
						'transition-colors',
					)}
					onClick={onAddToList}
				>
					Add to list
					<svg
						className="size-3 text-text-mid"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M9 6l6 6-6 6" />
					</svg>
				</button>
			)}
			<div data-slot="menu-separator" className="h-px my-[5px] mx-2 bg-border-default" />
			{onCopyLink && (
				<button
					type="button"
					data-slot="menu-copy-link"
					data-testid="widget-context-menu-copy-link"
					className={cn(
						'block',
						'px-2.5',
						'h-8.5',
						'rounded',
						'text-sm',
						'text-text-high',
						'hover:bg-surface-sunken',
						'cursor-pointer',
						'transition-colors',
					)}
					onClick={onCopyLink}
				>
					Copy link
				</button>
			)}
			{onReport && (
				<button
					type="button"
					data-slot="menu-report"
					data-testid="widget-context-menu-report"
					className={cn(
						'block',
						'px-2.5',
						'h-8.5',
						'rounded',
						'text-sm',
						'text-text-mid',
						'hover:bg-surface-sunken',
						'cursor-pointer',
						'transition-colors',
					)}
					onClick={onReport}
				>
					Report
				</button>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Product card props
// ---------------------------------------------------------------------------

export interface ProductCardProps {
	/** Product id / Nostr event kind-30405 identifier. */
	id: string
	/** Product title. */
	title: string
	/**
	 * The listing's primary category, rendered as the small chip beside the
	 * title (the seller-profile frame's `NIP-99:310` slot). Real `t` tag only —
	 * omit it and no chip renders.
	 */
	category?: string
	/** Seller name / store name. */
	seller: string
	/** Seller pubkey prefix (first 8 chars). */
	sellerPubkey: string
	/**
	 * Price in sats. Omitted when the listing carries no `price` tag: the card
	 * then shows no price at all, because "0 sats" would be a price the author
	 * never set.
	 */
	price?: number
	/** Stock note, e.g. "76 in stock", "12 left", "40 in stock", "1 of 3". */
	stockNote?: string
	/** Material gradient class (.m1–.m8). */
	material: MaterialClass
	/** Product icon symbol (defaults to material-indexed icon). */
	symbolId?: ProductSymbolId
	/**
	 * Card presentation:
	 * - `grid` (default) — the results-grid tile: a `--border-strong` top rule
	 *   above the card (frame `W8vkrHbRq6`: `.card{border-top:1px solid
	 *   var(--border-strong)}`), a 3/2 shot and a 15px title.
	 * - `row` — the browse-by-category tile (frame `V3PpdwmvGG`): **no top
	 *   rule**, a 16/9 shot and a 14px title.
	 */
	presentation?: CardPresentation
	/** Auction bid count — renders bid pill on the shot. */
	bidCount?: number
	/** Whether the product is in a saved list (heart filled). */
	inList?: boolean
	/** Heart icon is active/filled. */
	heartActive?: boolean
	/**
	 * The card whose detail panel is open (frame `.card.sel`): a 2px ink rule in
	 * place of the 1px hairline, an ink outline on the shot, and an "· open"
	 * note on the seller line.
	 */
	selected?: boolean
	/** Context menu open state. */
	menuOpen?: boolean
	/** Callback when heart is toggled. */
	onHeart?: () => void
	/** Callback when three-dots is clicked (opens context menu). */
	onThreeDots?: () => void
	/** Callback when "Add to list" is selected from context menu. */
	onAddToList?: () => void
	/** Callback when "Copy link" is selected from context menu. */
	onCopyLink?: () => void
	/** Callback when "Report" is selected from context menu. */
	onReport?: () => void
	/** Callback when the card is clicked (opens detail panel). */
	onSelect?: (id: string) => void
	/** Callback when the card is right-clicked (opens context menu). */
	onContextMenu?: (e: React.MouseEvent) => void
	/** Extra classes for the card root. */
	className?: string
	ref?: Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Tool icons — ghost icon buttons, icon-first
//
// Exported because the split-view detail panel reuses the same product tools
// (a heart and a three-dots) beside its title; the icons are one implementation
// shared by the card and the panel.
// ---------------------------------------------------------------------------

export const HeartIcon: FC<{ active?: boolean; className?: string }> = ({ active, className }) => (
	<svg
		className={cn('size-3.5', className)}
		viewBox="0 0 24 24"
		fill={active ? 'currentColor' : 'none'}
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
	</svg>
)

// ---------------------------------------------------------------------------
// Three-dots icon — ghost icon button, icon-first
// ---------------------------------------------------------------------------

export const ThreeDotsIcon: FC<{ open?: boolean; className?: string }> = ({ open, className }) => (
	<svg className={cn('size-3.5', className)} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<circle cx="12" cy="5" r="1.7" />
		<circle cx="12" cy="12" r="1.7" />
		<circle cx="12" cy="19" r="1.7" />
	</svg>
)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Product card — the results grid / category row tile.
 *
 * Anatomy (top to bottom):
 * 1. Shot (3/2 aspect, 6px radius, 1px border, material art)
 *    + optional bid pill (auctions)
 * 2. h3 title
 * 3. Seller row (tinted avatar circle + seller name + heart + three-dots
 *    as icon-first ghost buttons with no outline)
 * 4. Price row (top hairline, sats left, stock note right, 11px text-mid)
 * 5. Context menu (Add to list › / Copy link / Report) — right-click + long-press
 */
export const ProductCard: FC<ProductCardProps> = ({
	id,
	title,
	category,
	seller,
	sellerPubkey,
	price,
	stockNote,
	material,
	symbolId,
	presentation = 'grid',
	bidCount,
	inList,
	heartActive = inList,
	selected = false,
	menuOpen = false,
	onHeart,
	onThreeDots,
	onAddToList,
	onCopyLink,
	onReport,
	onSelect,
	onContextMenu,
	className,
	ref,
	...props
}) => {
	const handleCardClick: MouseEventHandler = (e) => {
		if ((e.target as HTMLElement).closest('[data-slot="tools"], [data-slot="context-menu"]')) return
		onSelect?.(id)
	}

	const handleRightClick: MouseEventHandler = (e) => {
		e.preventDefault()
		onThreeDots?.()
	}

	const handleLongPressStart: PointerEventHandler = (e) => {
		if (e.pointerType !== 'touch') return
		// 500ms long-press on touch → open menu
		const timer = setTimeout(() => onThreeDots?.(), 500)
		;(e.currentTarget as HTMLElement & { _longPressTimer?: ReturnType<typeof setTimeout> })._longPressTimer = timer
	}

	const handleLongPressEnd: PointerEventHandler = (e) => {
		const el = e.currentTarget as HTMLElement & { _longPressTimer?: ReturnType<typeof setTimeout> }
		const timer = el._longPressTimer
		if (timer) {
			clearTimeout(timer)
			delete el._longPressTimer
		}
	}

	// Seller avatar tint — uses .m1–.m8 avatar-tint-* classes from art module
	const avatarTint = sellerPubkey ? parseInt(sellerPubkey, 16) % 3 : 0
	const avatarTintClass = `avatar-tint-${avatarTint}`

	return (
		<article
			ref={ref}
			data-slot="product-card"
			data-testid={`widget-product-card-${id}`}
			data-selected={selected}
			className={cn(
				'relative',
				// `row` tiles carry no top rule (frame V3PpdwmvGG: `.card{border-top:0;
				// padding-top:16px}`); `grid` tiles do.
				presentation === 'row' ? 'pt-4' : selected ? 'border-t-2 border-fill-ink pt-[9px]' : 'border-t border-border-strong pt-3',
				'cursor-pointer',
				'hover:translate-y-[-2px]',
				'transition-transform',
				className,
			)}
			onClick={handleCardClick}
			onContextMenu={handleRightClick}
			onPointerDown={handleLongPressStart}
			onPointerUp={handleLongPressEnd}
			onPointerCancel={handleLongPressEnd}
			{...props}
		>
			{/* Shot — material gradient + SVG icon */}
			<div className="relative">
				<ProductArt
					material={material}
					symbolId={symbolId}
					ratio={presentation === 'row' ? '16/9' : '3/2'}
					className={cn(
						'size-full rounded-[6px] border border-border-default text-on-media',
						selected && 'outline-2 outline-offset-2 outline-fill-ink',
					)}
				/>

				{/* Bid pill — auctions */}
				{bidCount !== undefined && bidCount > 0 && (
					<div
						data-slot="bid-pill"
						data-testid={`widget-product-card-bid-${id}`}
						className="absolute left-[9px] top-[9px] px-2 py-1 rounded-full bg-fill-accent/90 text-on-fill-accent text-xs font-medium"
					>
						{bidCount} bids
					</div>
				)}

				{/* Context menu */}
				<ProductContextMenu
					open={menuOpen}
					onAddToList={onAddToList}
					onCopyLink={onCopyLink}
					onReport={onReport}
					onClose={() => onThreeDots?.()}
					className="right-0"
				/>
			</div>

			{/* Title */}
			<h3
				data-slot="card-title"
				data-testid={`widget-product-card-title-${id}`}
				className={cn('mt-[5px] font-medium leading-[1.3] text-text-high', presentation === 'row' ? 'text-[14px]' : 'text-[15px]')}
			>
				{title}
				{category ? (
					<span
						data-slot="card-category"
						data-testid={`widget-product-card-category-${id}`}
						className="ml-1.5 inline-block rounded-xs bg-surface-sunken px-1.5 py-px align-middle text-[10px] font-normal leading-tight text-text-mid"
					>
						{category}
					</span>
				) : null}
			</h3>

			{/* Seller row — tinted avatar + seller name + heart + three-dots */}
			<div
				data-slot="seller-row"
				data-testid={`widget-product-card-seller-${id}`}
				className="mt-[11px] flex items-center gap-1.5 text-xs tracking-[0.13em] uppercase text-text-mid"
			>
				{/* Tinted avatar circle */}
				<div
					data-slot="seller-avatar"
					className={cn('size-3.5', 'rounded-full', 'shrink-0', 'avatar-tint-' + avatarTint)}
					aria-hidden="true"
				/>
				<span data-slot="seller-name" className="truncate flex-1">
					{seller}
					{selected && <span data-slot="card-open-note"> · open</span>}
				</span>
				{/* Actions — icon-first ghost buttons, no outline */}
				<div data-slot="tools" data-testid={`widget-product-card-tools-${id}`} className="relative flex gap-0.5 shrink-0">
					{onHeart && (
						<button
							type="button"
							data-slot="tool-heart"
							data-testid={`widget-product-card-heart-${id}`}
							aria-label={heartActive ? 'In a list' : 'Add to list'}
							aria-pressed={heartActive}
							className={cn(
								'size-6.5',
								'rounded-[6px]',
								'grid',
								'place-items-center',
								'text-text-mid',
								'hover:text-text-high',
								'hover:bg-surface-sunken',
								'transition-colors',
								'cursor-pointer',
								heartActive && 'text-fill-ink',
							)}
							onClick={(e) => {
								e.stopPropagation()
								onHeart()
							}}
						>
							<HeartIcon active={heartActive} />
						</button>
					)}
					{onThreeDots && (
						<button
							type="button"
							data-slot="tool-three-dots"
							data-testid={`widget-product-card-menu-${id}`}
							aria-label="More actions"
							aria-expanded={menuOpen}
							className={cn(
								'size-6.5',
								'rounded-[6px]',
								'grid',
								'place-items-center',
								'text-text-mid',
								'hover:text-text-high',
								'hover:bg-surface-sunken',
								'transition-colors',
								'cursor-pointer',
								menuOpen && 'text-text-high bg-surface-sunken',
							)}
							onClick={(e) => {
								e.stopPropagation()
								onThreeDots()
							}}
						>
							<ThreeDotsIcon open={menuOpen} />
						</button>
					)}
				</div>
			</div>

			{/* Price row — top hairline (both frames' `.prow`: `border-top:1px solid
			    var(--border-default)`), sats left, stock note right. The row tile
			    tightens the margins (frame V3PpdwmvGG: `margin-top:7px;padding-top:6px`). */}
			<div
				data-slot="price-row"
				data-testid={`widget-product-card-price-${id}`}
				className={cn(
					'flex',
					'items-center',
					'justify-between',
					'border-t',
					'border-border-default',
					presentation === 'row' ? 'mt-[7px] pt-[6px]' : 'mt-2.5 pt-[9px]',
				)}
			>
				{typeof price === 'number' ? (
					<b className="text-sm">
						{formatSats(price)} <small className="font-normal text-text-mid">sats</small>
					</b>
				) : (
					<span />
				)}
				{stockNote && <small className="text-xs text-text-mid">{stockNote}</small>}
			</div>
		</article>
	)
}
