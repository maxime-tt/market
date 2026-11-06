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
 * The detail opens with a **shift**: it slides in from the right, flush to the
 * pane's edge, and the master slides left by exactly the detail's width. The
 * results keep the width and the column count the caller gave them — nothing
 * reflows or compresses, which is what the percentage-pane layout did (a
 * `flex-basis` split resizes the master, and the grid then re-lays out its
 * columns). The motion is a transform in each pane's own compositing layer, so
 * the grid's items never re-measure.
 *
 * The divider stays a real resize handle — pointer drag plus arrow keys — but it
 * resizes only the detail pane's width, which the master's shift follows; it
 * never resizes the master's layout. That is why the split is not built on
 * `react-resizable-panels`: that model is two percentage panes in a row, i.e.
 * the compression this replaces.
 *
 * The group fills its parent, so `className` lands on the wrapper that carries
 * the height: the frame pins its split to the viewport's middle row.
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
}

/**
 * The split's motion, injected once like `art.tsx`'s shimmer: the master shifts
 * left by the detail's width and the detail slides in from the right. Both
 * animate `transform` only, and both fill `both` so the open state is the
 * animation's end state — with `motion-reduce:animate-none` the same end state
 * is the inline one, so a reduced-motion reader sees the open pane without the
 * slide.
 */
const SPLIT_VIEW_CSS = `
@keyframes split-master-shift {
	from { transform: translateX(0); }
	to { transform: translateX(calc(-1 * var(--split-detail-width))); }
}
@keyframes split-detail-in {
	from { transform: translateX(100%); }
	to { transform: translateX(0); }
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
			style={{ '--split-detail-width': `${detailSize}%` } as CSSProperties}
		>
			{/* The master shifts as a whole; its own layout (width, columns) is untouched. */}
			<div
				data-slot="split-shift"
				className="h-full animate-[split-master-shift_300ms_ease-out_both] motion-reduce:animate-none"
				style={{ transform: 'translateX(calc(-1 * var(--split-detail-width)))' }}
			>
				<div data-slot="split-master" className="h-full min-h-0 overflow-y-auto pr-6.5 pt-4">
					{master}
				</div>
			</div>

			{/* The detail overlays the right edge and slides in over the master. */}
			<div
				data-slot="split-detail"
				className="absolute inset-y-0 right-0 flex min-h-0 flex-col overflow-y-auto border-l border-border-default bg-background pl-6.5 pt-4 animate-[split-detail-in_300ms_ease-out_both] motion-reduce:animate-none"
				style={{ width: 'var(--split-detail-width)' }}
			>
				{detail}
			</div>

			{/* The frame's hairline + pill, now the detail pane's own drag handle. */}
			<div
				data-slot="split-separator"
				role="separator"
				aria-label="Resize panes"
				aria-orientation="vertical"
				aria-valuenow={Math.round(detailSize)}
				aria-valuemin={minDetailSize}
				aria-valuemax={100 - minMasterSize}
				tabIndex={0}
				className="absolute inset-y-0 z-10 w-[7px] -translate-x-1/2 cursor-col-resize touch-none border-0 bg-transparent p-0"
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
