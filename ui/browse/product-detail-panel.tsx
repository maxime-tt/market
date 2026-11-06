/**
 * browse/product-detail-panel.tsx — the split-view detail pane.
 *
 * Frame of record: notes/artboards/browse/frames/vnwQ7csazs__split-view-product-detail-1440.html
 * (right pane `.pane.right`).
 *
 * Structure, top to bottom: the header row (the close button, when the caller can
 * dismiss the panel), the product's art (fills the pane), the seller line
 * (tinted initials + seller + elided npub · location), the title row — where the
 * product tools sit **beside the title** (that placement is the frame's point) —
 * the price row (sats + stock state), the description, the spec row (ships from,
 * shipping cost, listing kind) and the action row.
 *
 * Props in, callbacks out: no reads, no store subscriptions, no side effects.
 * Tool icons and the context menu are shared with `product-card.tsx`.
 */

import type { FC, Ref } from 'react'
import { cn } from '../utils/cn'
import { formatSats } from '../utils/format'
import { EmptyState } from '../shared/empty-state'
import { ErrorState } from '../shared/error-state'
import { ProductArt, SKELETON_SHIMMER_CSS, type MaterialClass, type ProductSymbolId } from './art'
import { HeartIcon, ProductContextMenu, ThreeDotsIcon } from './product-card'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** One shipping option's extra cost, from the listing's `shipping_option` tags. */
export interface ProductDetailShipping {
	/** Extra cost in sats. */
	costSats: number
}

/** The product the detail pane renders. */
export interface ProductDetailPanelProduct {
	/** Product id (the kind-30402 `d` tag). */
	id: string
	/** Product title. */
	title: string
	/** Seller display name — the pubkey prefix when no profile name is known. */
	seller: string
	/** Elided seller npub, e.g. `npub1q…7f3k`. */
	sellerNpub?: string
	/** Seller location from the listing's `location` tag, e.g. `Porto`. */
	location?: string
	/** Price in sats. */
	price?: number
	/** Stock note, e.g. `76 in stock`, rendered as the price row's state. */
	stockNote?: string
	/** Description (`content`). */
	description?: string
	/** Shipping options on the listing. */
	shipping?: readonly ProductDetailShipping[]
	/** Material gradient class (.m1–.m8) — the same one the card uses. */
	material: MaterialClass
	/** Product icon symbol (defaults to material-indexed icon). */
	symbolId?: ProductSymbolId
	/** Whether the product is in a saved list (heart filled). */
	inList?: boolean
}

/** The detail pane's own read states. */
export type ProductDetailPanelState = 'loading' | 'empty' | 'error' | 'ready'

export interface ProductDetailPanelProps {
	/** Which state the pane renders. Defaults to `ready`. */
	state?: ProductDetailPanelState
	/** The product; required for `ready`. */
	product?: ProductDetailPanelProduct
	/** Context menu open state (the three-dots button). */
	menuOpen?: boolean
	/** Callback for the heart. The tool renders only when provided. */
	onHeart?: () => void
	/** Callback for the three-dots tool. The tool renders only when provided. */
	onThreeDots?: () => void
	/** Callback for "Add to list" — the pane's button and the menu item. */
	onAddToList?: () => void
	/** Callback for the menu's "Copy link" item. */
	onCopyLink?: () => void
	/** Callback for the menu's "Report" item. */
	onReport?: () => void
	/**
	 * Callback for the panel's close button. The button renders only when
	 * provided — the panel is then dismissible on its own, not only through the
	 * card that opened it (or Escape, which the host also wires).
	 */
	onClose?: () => void
	/** Callback for the primary "Buy with Lightning" action. */
	onBuy?: () => void
	/** Retry callback for the error state. */
	onRetry?: () => void
	/** Extra classes for the pane root. */
	className?: string
	ref?: Ref<HTMLElement>
}

// ---------------------------------------------------------------------------
// The panel's close glyph (the header affordance's own icon)
// ---------------------------------------------------------------------------

const CloseIcon: FC<{ className?: string }> = ({ className }) => (
	<svg
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.5}
		strokeLinecap="round"
		aria-hidden="true"
		className={className}
	>
		<path d="M4 4l8 8M12 4l-8 8" />
	</svg>
)

// ---------------------------------------------------------------------------
// Loading state — the pane's own shape, shimmering
// ---------------------------------------------------------------------------

const PanelLoading: FC = () => (
	<div data-slot="product-detail-loading" className="flex flex-1 flex-col gap-4" aria-busy="true">
		<div className="min-h-[220px] flex-1 rounded-[6px] border border-border-default bg-surface-sunken animate-skeleton-shimmer" />
		<div className="flex items-center gap-3.5">
			<div className="size-[38px] flex-none rounded-full bg-surface-sunken animate-skeleton-shimmer" />
			<div className="h-[11px] w-[46%] rounded bg-surface-sunken animate-skeleton-shimmer" />
		</div>
		<div className="h-[26px] w-[62%] rounded bg-surface-sunken animate-skeleton-shimmer" />
		<div className="h-[19px] w-[34%] rounded bg-surface-sunken animate-skeleton-shimmer" />
		<div className="space-y-2">
			<div className="h-[11px] w-full rounded bg-surface-sunken animate-skeleton-shimmer" />
			<div className="h-[11px] w-[82%] rounded bg-surface-sunken animate-skeleton-shimmer" />
		</div>
		<style dangerouslySetInnerHTML={{ __html: SKELETON_SHIMMER_CSS }} />
	</div>
)

// ---------------------------------------------------------------------------
// Ready state — the pane's content
// ---------------------------------------------------------------------------

const PanelContent: FC<{
	product: ProductDetailPanelProduct
	menuOpen: boolean
	onHeart?: () => void
	onThreeDots?: () => void
	onAddToList?: () => void
	onCopyLink?: () => void
	onReport?: () => void
	onBuy?: () => void
}> = ({ product, menuOpen, onHeart, onThreeDots, onAddToList, onCopyLink, onReport, onBuy }) => {
	const initials = product.seller.slice(0, 2).toUpperCase()
	const sellerMeta = [product.sellerNpub, product.location].filter(Boolean).join(' · ')

	return (
		<>
			{/* Shot — fills the pane; the studio object grows into the frame */}
			<ProductArt
				data-slot="product-detail-art"
				material={product.material}
				symbolId={product.symbolId}
				ratio="detail"
				className="min-h-[220px] flex-1"
			/>

			<div data-slot="product-detail-meta" className="mt-4">
				{/* Seller line — initials avatar + seller + npub · location */}
				<div
					data-slot="product-detail-seller"
					className="flex items-center gap-[13px] text-[11px] uppercase tracking-[0.13em] text-text-mid"
				>
					<span
						data-slot="seller-avatar"
						className="size-[38px] flex-none grid place-items-center rounded-full bg-fill-ink text-on-fill-ink text-[13px] font-semibold leading-none tracking-[0.02em]"
						aria-label={`${product.seller} avatar`}
					>
						{initials}
					</span>
					<span data-slot="seller-who" className="flex flex-col gap-[3px]">
						<b className="font-medium text-text-high">{product.seller}</b>
						{sellerMeta && <em className="text-[10.5px] not-italic tracking-[0.1em]">{sellerMeta}</em>}
					</span>
				</div>

				{/* Title row — the product tools sit beside the title */}
				<div data-slot="product-detail-titlerow" className="mt-[7px] flex items-start justify-between gap-2.5">
					<h2
						data-slot="product-detail-title"
						className="font-display text-3xl font-medium leading-[1.1] tracking-[-0.015em] text-text-high"
					>
						{product.title}
					</h2>
					{(onThreeDots || onHeart) && (
						<div data-slot="tools" className="relative flex flex-none gap-0.5">
							{onThreeDots && (
								<button
									type="button"
									data-slot="tool-three-dots"
									aria-label="More actions"
									aria-expanded={menuOpen}
									className={cn(
										'size-6.5 rounded-[6px] grid place-items-center cursor-pointer border-0 transition-colors',
										menuOpen ? 'text-text-high bg-surface-sunken' : 'text-text-mid hover:text-text-high hover:bg-surface-sunken',
									)}
									onClick={onThreeDots}
								>
									<ThreeDotsIcon open={menuOpen} className="size-4" />
								</button>
							)}
							{onHeart && (
								<button
									type="button"
									data-slot="tool-heart"
									aria-label={product.inList ? 'In a list' : 'Add to list'}
									aria-pressed={product.inList}
									className={cn(
										'size-6.5 rounded-[6px] grid place-items-center cursor-pointer border-0 transition-colors',
										product.inList ? 'text-fill-ink' : 'text-text-mid hover:text-text-high hover:bg-surface-sunken',
									)}
									onClick={onHeart}
								>
									<HeartIcon active={product.inList} className="size-4" />
								</button>
							)}
							<ProductContextMenu
								open={menuOpen}
								onAddToList={onAddToList}
								onCopyLink={onCopyLink}
								onReport={onReport}
								onClose={onThreeDots}
							/>
						</div>
					)}
				</div>

				{/* Price row — sats left, stock state right */}
				<div data-slot="product-detail-price" className="mt-3 flex items-baseline gap-3 pb-3 border-b border-border-default tabular-nums">
					<b className="text-2xl font-medium leading-none">
						{product.price === undefined ? '—' : formatSats(product.price)}{' '}
						{product.price !== undefined && <small className="text-[13px] font-normal text-text-mid">sats</small>}
					</b>
					{product.stockNote && (
						<span data-slot="product-detail-stock" className="ml-auto text-[11px] uppercase tracking-[0.08em] text-text-mid">
							{product.stockNote}
						</span>
					)}
				</div>

				{/* Description */}
				{product.description && (
					<p data-slot="product-detail-description" className="mt-3 max-w-[52ch] text-sm text-text-mid">
						{product.description}
					</p>
				)}

				{/* Spec row — listing tags the panel could resolve */}
				<dl data-slot="product-detail-spec" className="mt-3.5 flex gap-6.5 text-xs">
					{product.location && (
						<div data-slot="spec-ships-from">
							<dt className="text-[10.5px] uppercase tracking-[0.1em] text-text-mid">Ships from</dt>
							<dd className="mt-[3px]">{product.location}</dd>
						</div>
					)}
					{(product.shipping ?? []).map((option, index) => (
						<div key={`shipping-${index}`} data-slot="spec-shipping">
							<dt className="text-[10.5px] uppercase tracking-[0.1em] text-text-mid">Shipping</dt>
							<dd className="mt-[3px] tabular-nums">{formatSats(option.costSats)} sats</dd>
						</div>
					))}
					<div data-slot="spec-listing">
						<dt className="text-[10.5px] uppercase tracking-[0.1em] text-text-mid">Listing</dt>
						<dd className="mt-[3px]">NIP-99 · kind 30402</dd>
					</div>
				</dl>

				{/* Action row */}
				{(onBuy || onAddToList) && (
					<div data-slot="product-detail-actions" className="mt-4.5 flex gap-3">
						{onBuy && (
							<button
								type="button"
								data-slot="action-buy"
								className="inline-flex h-11.5 items-center gap-2.5 rounded px-5.5 text-sm font-medium cursor-pointer transition-colors bg-fill-ink text-on-fill-ink hover:bg-fill-ink-hover"
								onClick={onBuy}
							>
								Buy with Lightning
							</button>
						)}
						{onAddToList && (
							<button
								type="button"
								data-slot="action-add-to-list"
								className="inline-flex h-11.5 items-center gap-2.5 rounded border border-border-strong px-5.5 text-sm font-medium text-text-high cursor-pointer transition-colors hover:bg-surface-sunken"
								onClick={onAddToList}
							>
								Add to list
							</button>
						)}
					</div>
				)}
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The split-view detail pane.
 *
 * Renders the frame's pane in every read state: `loading` (the pane's own
 * shimmering shape), `empty` (the coordinate resolved to no listing), `error`
 * (the read failed, with retry) and `ready`. The action row renders the actions
 * the caller can actually perform — a tool or button with no callback is not
 * rendered rather than rendered inert.
 */
export const ProductDetailPanel: FC<ProductDetailPanelProps> = ({
	state = 'ready',
	product,
	menuOpen = false,
	onHeart,
	onThreeDots,
	onAddToList,
	onCopyLink,
	onReport,
	onClose,
	onBuy,
	onRetry,
	className,
	ref,
	...props
}) => {
	return (
		<aside
			ref={ref}
			data-slot="product-detail-panel"
			data-testid="widget-product-detail-panel"
			data-state={state}
			className={cn('flex h-full min-h-0 flex-col', className)}
			{...props}
		>
			{/* Header — the panel's own close affordance, in every read state */}
			{onClose && (
				<div data-slot="product-detail-header" className="flex flex-none items-center justify-end pb-2">
					<button
						type="button"
						data-slot="product-detail-close"
						aria-label="Close product"
						className="size-6.5 rounded-[6px] grid place-items-center cursor-pointer border-0 text-text-mid transition-colors hover:bg-surface-sunken hover:text-text-high"
						onClick={onClose}
					>
						<CloseIcon className="size-4" />
					</button>
				</div>
			)}

			{state === 'loading' && <PanelLoading />}

			{state === 'empty' && (
				<EmptyState
					compact
					title="This listing is not on the relays"
					description="The product link may have been deleted, or the relay that holds it is not answering."
					className="flex-1"
				/>
			)}

			{state === 'error' && (
				<ErrorState
					title="The listing could not be loaded"
					message="The relay read failed before the product arrived."
					onRetry={onRetry}
					retryTestId="widget-product-detail-retry"
					className="flex-1"
				/>
			)}

			{state === 'ready' && product && (
				<PanelContent
					product={product}
					menuOpen={menuOpen}
					onHeart={onHeart}
					onThreeDots={onThreeDots}
					onAddToList={onAddToList}
					onCopyLink={onCopyLink}
					onReport={onReport}
					onBuy={onBuy}
				/>
			)}
		</aside>
	)
}
