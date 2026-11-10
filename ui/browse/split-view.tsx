/**
 * browse/split-view.tsx — the master–detail split, as a shift.
 *
 * Frame of record: notes/artboards/browse/frames/vnwQ7csazs__split-view-product-detail-1440.html
 * (`.split`: master pane 55%, a 1px hairline separator with a pill handle,
 * detail pane 45%).
 *
 * The panes are slots: the master keeps the results grid, the detail is the
 * caller's panel (in Browse, `ProductDetailPanel`). Props in, callbacks out.
 *
 * The detail opens by **shrinking** the master: the master's width goes from
 * 100% to `100% − var(--split-detail-width)`, and the detail slides in from the
 * right at that same width. Content reflows into the narrower pane: the results
 * grid fits fewer fixed-width cards, and the hero's centred column — the search
 * field with it — stays centred in the visible (left) area instead of drifting.
 *
 * **This reverses the split's earlier decision.** The split used to keep the
 * master's width and slide it left by the detail's width, so nothing re-measured;
 * the owner has since replaced that: on the live screens the shift moved the
 * home's hero search field off-centre, and a field that moves when the panel
 * opens is worse than a reflow. Shrinking the left view is the current rule;
 * the fixed card width (see the results grid's track sizing) is what keeps the
 * reflow honest — opening the panel changes how many cards fit, never how big
 * each one is.
 *
 * The divider stays a real resize handle — pointer drag plus arrow keys — but it
 * resizes only the detail pane's width, which the master's own width follows; it
 * never translates the master. That is why the split is not built on
 * `react-resizable-panels`: that model is two percentage panes in a row, i.e.
 * exactly the percentage split this pane model still uses, without the handle's
 * own semantics.
 *
 * The group fills its parent, so `className` lands on the wrapper that carries
 * the height: the frame pins its split to the viewport's middle row.
 *
 * **Full-bleed, by the owner's decision.** The frame insets the split by 56px on
 * each side (`margin: 0 56px`); the owner asked for those side margins removed
 * so both panes take the page's full width, edge to edge. That is a deliberate
 * deviation from the frame, and it is why the split carries no horizontal
 * margin or padding of its own: the caller renders it outside the page's
 * centred container, and each pane keeps only its own inner gutter (`px-6.5`)
 * so content is not glued to the viewport edge.
 */

import { useState, type CSSProperties, type FC, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { cn } from '../utils/cn'

/** The frame's master share of the split, and the detail's own default (100 - this). */
const MASTER_SIZE = 55
/** Below these shares a pane stops being usable, so the drag stops there. */
const MIN_MASTER_SIZE = 30
const MIN_DETAIL_SIZE = 25
/** The drag step for the separator's arrow keys, in percent (10 with Shift). */
const KEY_STEP = 2

export interface SplitViewProps {
	/** Left pane: the results list/grid. */
	master: ReactNode
	/** Right pane: the detail panel. */
	detail: ReactNode
	/** Master share of the width, in percent, when the split mounts. Defaults to the frame's 55. */
	masterSize?: number
	/** Minimum master share, in percent. Defaults to 30. */
	minMasterSize?: number
	/** Minimum detail share, in percent. Defaults to 25. */
	minDetailSize?: number
	/** Extra classes for the split root (the caller sets the height). */
	className?: string
	elementRef?: Ref<HTMLDivElement | null>
	/**
	 * Dismiss the detail. Below `lg` the pane is a pushed view and this is the
	 * back bar's action — a phone needs a visible way out that is not the
	 * desktop's 7px drag handle. Omitted, no back bar renders.
	 */
	onCloseDetail?: () => void
}

/**
 * The split's motion, injected once like `art.tsx`'s shimmer: the master's
 * width shrinks by the detail's width and the detail slides in from the right.
 * Both fill `both` so the open state is the animation's end state — with
 * `motion-reduce:animate-none` the same end state is the inline one, so a
 * reduced-motion reader sees the open pane without the motion.
 *
 * The master animates `width`, not `transform`: shrinking is the layout the
 * owner asked for (the left view reflows and the search field stays centred),
 * so the pane genuinely gets narrower rather than being translated out of view.
 *
 * **The split is a wide-viewport layout.** Below `lg` there is no second
 * column to fit: the detail is a *pushed* view — full width, on top of the
 * master, with its own back bar — and the master keeps its whole width
 * underneath. The breakpoint is 1024px: at 768 the detail pane would be 346px
 * beside a 422px master, i.e. two scrolling columns on a touch screen, which is
 * exactly the shape the owner rejected. `--split-detail-width` is therefore the
 * *resolved* pane width and `--split-detail-size` is the drag state; the media
 * query below pins the resolved width to 100% so the master is not shrunk at
 * all on a phone. Declaring this in the sheet (not inline) matters: an inline
 * width on the pane would beat a media query and the phone would keep the
 * desktop split — the trap is `!important` or nothing, and nothing is wrong.
 */
const SPLIT_VIEW_CSS = `
[data-slot="split-view"] { --split-detail-width: var(--split-detail-size); }
@keyframes split-master-shrink {
	from { width: 100%; }
	to { width: calc(100% - var(--split-detail-width)); }
}
@keyframes split-detail-in {
	from { transform: translateX(100%); }
	to { transform: translateX(0); }
}
@media (max-width: 1023.98px) {
	[data-slot="split-view"] { --split-detail-width: 100%; }
	/* The pane's own 26px hairline close would sit under the back bar and is
	   below the touch floor; on a phone the back bar is the dismissal. */
	[data-slot="split-detail"] [data-slot="product-detail-header"] { display: none; }
}
@media (min-width: 1024px) {
	[data-slot="split-master-pane"] {
		width: calc(100% - var(--split-detail-width));
		animation: split-master-shrink 300ms ease-out both;
	}
}
@media (min-width: 1024px) and (prefers-reduced-motion: reduce) {
	[data-slot="split-master-pane"], [data-slot="split-detail"] { animation: none; }
}
`

export const SplitView: FC<SplitViewProps> = ({
	master,
	detail,
	masterSize = MASTER_SIZE,
	minMasterSize = MIN_MASTER_SIZE,
	minDetailSize = MIN_DETAIL_SIZE,
	className,
	elementRef,
	onCloseDetail,
}) => {
	/** The detail pane's width, in percent of the split — the shift's own distance. */
	const [detailSize, setDetailSize] = useState(() => 100 - masterSize)

	const clamp = (percent: number): number => Math.min(100 - minMasterSize, Math.max(minDetailSize, percent))

	// The detail's width is the divider's position from the right edge: the drag
	// reports the pointer's distance from that edge, clamped to the usable range.
	const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
		const container = event.currentTarget.parentElement
		if (!container) return
		event.preventDefault()
		const rect = container.getBoundingClientRect()
		if (rect.width === 0) return

		const move = (moveEvent: globalThis.PointerEvent) => {
			setDetailSize(clamp(((rect.right - moveEvent.clientX) / rect.width) * 100))
		}
		const stop = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', stop)
			window.removeEventListener('pointercancel', stop)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', stop)
		window.addEventListener('pointercancel', stop)
	}

	// Arrow keys resize the same way the library's separator did: left widens the
	// detail (the divider moves left), right narrows it.
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP
		if (event.key === 'ArrowLeft') {
			event.preventDefault()
			setDetailSize((size) => clamp(size + step))
		} else if (event.key === 'ArrowRight') {
			event.preventDefault()
			setDetailSize((size) => clamp(size - step))
		}
	}

	return (
		<div
			ref={elementRef}
			data-slot="split-view"
			className={cn('relative min-h-0 overflow-hidden', className)}
			style={{ '--split-detail-size': `${detailSize}%` } as CSSProperties}
		>
			{/* The master gives the detail its width: the pane shrinks and its
			    content reflows, so the visible left area is what carries the
			    page's own centred columns (the hero search field included).
			    Its width and shrink animation live in SPLIT_VIEW_CSS below,
			    behind the `lg` query: on a phone nothing shrinks, because the
			    detail is pushed on top rather than placed beside it. */}
			<div data-slot="split-master-pane" className="h-full w-full invisible lg:visible">
				<div data-slot="split-master" className="h-full min-h-0 overflow-y-auto px-6.5 pt-4">
					{master}
				</div>
			</div>

			{/* The detail overlays the right edge and slides in over the master.
			    Below `lg` it is the whole pane — a full-width pushed view, its
			    own scroll, its own back bar — and above it is the frame's right
			    share of the split, with the hairline. */}
			<div
				data-slot="split-detail"
				className="absolute inset-0 z-20 flex w-full min-h-0 flex-col overflow-y-auto bg-background px-6.5 pt-4 animate-[split-detail-in_300ms_ease-out_both] motion-reduce:animate-none lg:inset-y-0 lg:left-auto lg:right-0 lg:z-0 lg:w-[var(--split-detail-width)] lg:border-l lg:border-border-default"
			>
				{onCloseDetail && (
					<div data-slot="split-detail-bar" className="flex flex-none items-center pb-1 lg:hidden">
						<button
							type="button"
							data-slot="split-detail-back"
							onClick={onCloseDetail}
							className="inline-flex min-h-11 -ml-2 items-center gap-1.5 rounded px-2 text-sm font-medium text-text-high cursor-pointer transition-colors hover:bg-surface-sunken"
						>
							<svg
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth={1.6}
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
								className="size-4"
							>
								<path d="M10 3 5 8l5 5" />
							</svg>
							Back
						</button>
					</div>
				)}
				{detail}
			</div>

			{/* The frame's hairline + pill, now the detail pane's own drag handle.
			    Desktop only: on a phone the pane is a pushed view, so there is no
			    divider to drag and no 7px touch target to hit by accident. */}
			<div
				data-slot="split-separator"
				role="separator"
				aria-label="Resize panes"
				aria-orientation="vertical"
				aria-valuenow={Math.round(detailSize)}
				aria-valuemin={minDetailSize}
				aria-valuemax={100 - minMasterSize}
				tabIndex={0}
				className="absolute inset-y-0 z-10 hidden w-[7px] -translate-x-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0 lg:block"
				style={{ left: 'calc(100% - var(--split-detail-width))' }}
				onPointerDown={handlePointerDown}
				onKeyDown={handleKeyDown}
			>
				<span
					data-slot="split-handle"
					aria-hidden="true"
					className="absolute left-1/2 top-1/2 h-11 w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-[4px] border border-border-default bg-surface-raised"
				/>
			</div>

			<style dangerouslySetInnerHTML={{ __html: SPLIT_VIEW_CSS }} />
		</div>
	)
}
