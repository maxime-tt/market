/**
 * browse/product-strip.tsx — the idle inventory band: full-bleed rows of
 * clickable product tiles that drift slowly and pause under the pointer.
 *
 * Frame `Glje8eeQGh__browse-idle-1440.html` is the design of record: the band
 * is full-bleed to both viewport edges (`.row{ left:0 }` inside a `.wall` that
 * is `inset:0`), the tiles are `188×176`, the row drifts on a long linear loop
 * (`@keyframes drift` → `translate3d(-50%,0,0)`) and `:hover` pauses it. The
 * frame's five-row background wall is deliberately NOT built: the screen draws
 * one strip above the title block and one below, at full contrast, no veil.
 *
 * The loop is real, not decorative: the track holds the same run of tiles
 * enough times to cover a wide viewport, and the keyframes translate it by
 * exactly one run's width, so the seam is invisible and the row never ends.
 * The extra runs are `aria-hidden` — they are the same products, not more of
 * them.
 *
 * The strips are product cards, not wallpaper: each tile is the listing's own
 * image (the deterministic art when it has none) and reveals its seller, title
 * and price on hover/focus. No veil — the strips are meant to be read and
 * clicked.
 */

import type { CSSProperties, FC, KeyboardEvent, MouseEventHandler, Ref } from 'react'
import { cn } from '../utils/cn'
import { formatPriceUnit, formatSats } from '../utils/format'
import type { MaterialClass, ProductSymbolId } from './art'
import { ListingImage } from './product-card'

// ---------------------------------------------------------------------------
// Strip item props
// ---------------------------------------------------------------------------

export interface StripItem {
	/** Unique id for the item (product event id). */
	id: string
	/** Product title, shown on hover. */
	title: string
	/** Seller name, shown on hover — the resolved profile name, never a pubkey prefix when one exists. */
	seller: string
	/**
	 * The listing's first `image` tag, when it carries one. The deterministic
	 * art is the fallback, exactly as on the card.
	 */
	image?: string
	/**
	 * The listing's price amount, omitted when it carries no `price` tag (a
	 * "0 sats" line would state a price the author never set).
	 */
	price?: number
	/** The listing's own price unit (`price` tag's third element); `SATS`/absent spell as `sats`. */
	priceCurrency?: string
	/** Material gradient class (.m1–.m8) — the fallback tile. */
	material: MaterialClass
	/** Product icon symbol (defaults to material-indexed icon). */
	symbolId?: ProductSymbolId
}

export interface ProductStripProps {
	/** Items rendered in the strip. */
	items: readonly StripItem[]
	/** Callback when an item is clicked (opens detail panel). */
	onSelect?: (id: string) => void
	/** Drift the other way — the frame alternates the direction of its rows. */
	reverse?: boolean
	/** Extra classes for the strip row. */
	className?: string
	ref?: Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** One tile plus the frame's 14px gap — the pitch the coverage estimate uses. */
const TILE_PITCH = 202
/** How much horizontal track the loop should cover before it repeats. */
const TRACK_COVERAGE = 4800
/** A cap on the repeated runs, so a one-item strip cannot explode the DOM. */
const MAX_RUNS = 16

/**
 * How many identical runs the track needs: enough that one run's width is at
 * least {@link TRACK_COVERAGE} wide, and never fewer than two (the loop needs a
 * second copy to translate onto).
 */
export function stripRunCount(itemCount: number): number {
	const runWidth = Math.max(itemCount, 1) * TILE_PITCH
	return Math.min(MAX_RUNS, Math.max(2, Math.ceil(TRACK_COVERAGE / runWidth)))
}

/**
 * The drift keyframes. The distance is a variable because it is one run's share
 * of the track (`-100% / runs`), which is what makes the loop seamless: the
 * track lands exactly on the next run's first tile.
 */
export const STRIP_DRIFT_CSS = `
@keyframes strip-drift {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(var(--strip-shift, -50%), 0, 0); }
}
`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Product strip — a full-bleed, looping row of clickable tiles.
 *
 * Idle: the listing's image (or its art). Hover/focus: seller, title, price,
 * lift + saturate, arrow affordance. The row pauses while the pointer is over
 * it, so a tile can be read and clicked.
 */
export const ProductStrip: FC<ProductStripProps> = ({ items, onSelect, reverse = false, className, ref, ...props }) => {
	const handleClick: MouseEventHandler<HTMLElement> = (event) => {
		const id = event.currentTarget.getAttribute('data-item-id')
		if (id) onSelect?.(id)
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== 'Enter' && event.key !== ' ') return
		event.preventDefault()
		const id = event.currentTarget.getAttribute('data-item-id')
		if (id) onSelect?.(id)
	}

	const runs = stripRunCount(items.length)
	// One run's share of the track: the distance the loop travels before the
	// next run's first tile sits where this run's first tile started.
	const shift = `-${(100 / runs).toFixed(4)}%`

	const renderRun = (run: number) => {
		const clone = run > 0
		return (
			<div
				key={run}
				data-slot="strip-run"
				data-clone={clone ? 'true' : undefined}
				aria-hidden={clone || undefined}
				className={cn('flex', 'flex-none', 'gap-3.5', 'pr-3.5')}
			>
				{items.map((item) => {
					const priceLine = typeof item.price === 'number' ? `${formatSats(item.price)} ${formatPriceUnit(item.priceCurrency)}` : undefined

					return (
						<article
							key={item.id}
							data-item-id={item.id}
							data-slot="strip-item"
							data-testid={clone ? undefined : `widget-strip-item-${item.id}`}
							role="button"
							// The repeated runs are the same products: clickable, but not a
							// second stop in the tab order or a second entry for a reader.
							tabIndex={clone ? -1 : 0}
							aria-label={priceLine ? `${item.title} — ${item.seller}, ${priceLine}` : `${item.title} — ${item.seller}`}
							className={cn(
								'group/tile',
								'relative',
								'w-[188px]',
								'h-[176px]',
								'flex-none',
								'rounded-[6px]',
								'border',
								'border-border-default',
								'overflow-hidden',
								'cursor-pointer',
								'transition-[transform,box-shadow]',
								'duration-150',
								'hover:z-10',
								'hover:-translate-y-1',
								'hover:scale-[1.04]',
								'hover:border-border-strong',
								'hover:shadow-[0_4px_12px_rgba(0,0,0,0.12)]',
								'focus-visible:outline-2',
								'focus-visible:outline-offset-2',
								'focus-visible:outline-focus-ring',
							)}
							onClick={handleClick}
							onKeyDown={handleKeyDown}
						>
							{/* The listing's own shot; the deterministic art when it has none. */}
							<ListingImage
								image={item.image}
								material={item.material}
								symbolId={item.symbolId}
								ratio="1/1"
								alt={item.title}
								className={cn('size-full', 'rounded-none', 'border-0')}
							/>

							{/* Seller + title + price — visible on hover/focus, over a scrim so
							    the ink stays legible whatever the image behind it is. */}
							<div
								data-slot="strip-info"
								className={cn(
									'pointer-events-none',
									'absolute',
									'inset-0',
									'flex',
									'flex-col',
									'justify-end',
									'gap-0.5',
									'p-2.5',
									'bg-gradient-to-t',
									'from-fill-accent/85',
									'via-fill-accent/35',
									'to-transparent',
									'opacity-0',
									'transition-opacity',
									'duration-150',
									'group-hover/tile:opacity-100',
									'group-focus/tile:opacity-100',
								)}
							>
								<div
									data-slot="strip-seller"
									className={cn('text-[10px]', 'tracking-[0.12em]', 'uppercase', 'text-on-media/80', 'truncate')}
								>
									{item.seller}
								</div>
								<div className={cn('flex', 'items-baseline', 'gap-1')}>
									<span
										data-slot="strip-title"
										className={cn('min-w-0', 'flex-1', 'truncate', 'text-xs', 'font-medium', 'leading-tight', 'text-on-media')}
									>
										{item.title}
									</span>
									<span aria-hidden="true" className={cn('text-base', 'leading-none', 'text-on-media')}>
										›
									</span>
								</div>
								{priceLine && (
									<div data-slot="strip-price" className={cn('text-[11px]', 'text-on-media/80')}>
										{priceLine}
									</div>
								)}
							</div>
						</article>
					)
				})}
			</div>
		)
	}

	return (
		<div
			ref={ref}
			data-slot="product-strip"
			data-testid="widget-product-strip"
			className={cn('group/strip', 'relative', 'w-full', 'overflow-hidden', 'py-2', className)}
			{...props}
		>
			<div
				data-slot="strip-track"
				data-runs={runs}
				className={cn(
					'flex',
					'w-max',
					'will-change-transform',
					reverse ? 'animate-[strip-drift_72s_linear_infinite_reverse]' : 'animate-[strip-drift_58s_linear_infinite]',
					'group-hover/strip:[animation-play-state:paused]',
					'motion-reduce:animate-none',
				)}
				style={{ '--strip-shift': shift } as CSSProperties}
			>
				{Array.from({ length: runs }, (_, run) => renderRun(run))}
			</div>

			<style dangerouslySetInnerHTML={{ __html: STRIP_DRIFT_CSS }} />
		</div>
	)
}
