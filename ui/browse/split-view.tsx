/**
 * browse/split-view.tsx — the master–detail split.
 *
 * Frame of record: notes/artboards/browse/frames/vnwQ7csazs__split-view-product-detail-1440.html
 * (`.split`: master pane 55%, a 1px hairline separator with a pill handle,
 * detail pane 45%).
 *
 * Props in, callbacks out. The panes are slots: the master keeps the results
 * grid, the detail is the caller's panel (in Browse, `ProductDetailPanel`).
 * Resizing is `react-resizable-panels` — the frame's `.sep` is a drag handle,
 * so a static two-column grid would not be the frame: the separator carries the
 * frame's 7×44px pill and the library's separator role (keyboard resize plus a
 * widened pointer hit area).
 *
 * The group fills its parent (`height:100%`, set by the library and not
 * overridable), so `className` lands on a wrapper that carries the height: the
 * frame pins its split to the viewport's middle row.
 */

import type { FC, ReactNode, Ref } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '../utils/cn'

/** The frame's master share of the split. */
const MASTER_SIZE = 55
/** Below these shares a pane stops being usable, so the drag stops there. */
const MIN_MASTER_SIZE = 30
const MIN_DETAIL_SIZE = 25

export interface SplitViewProps {
	/** Left pane: the results list/grid. */
	master: ReactNode
	/** Right pane: the detail panel. */
	detail: ReactNode
	/** Master share of the width, in percent. Defaults to the frame's 55. */
	masterSize?: number
	/** Minimum master share, in percent. Defaults to 30. */
	minMasterSize?: number
	/** Minimum detail share, in percent. Defaults to 25. */
	minDetailSize?: number
	/** Extra classes for the split root (the caller sets the height). */
	className?: string
	elementRef?: Ref<HTMLDivElement | null>
}

export const SplitView: FC<SplitViewProps> = ({
	master,
	detail,
	masterSize = MASTER_SIZE,
	minMasterSize = MIN_MASTER_SIZE,
	minDetailSize = MIN_DETAIL_SIZE,
	className,
	elementRef,
}) => {
	return (
		<div className={cn('min-h-0', className)}>
			<Group orientation="horizontal" elementRef={elementRef}>
				<Panel
					data-slot="split-master"
					defaultSize={`${masterSize}%`}
					minSize={`${minMasterSize}%`}
					groupResizeBehavior="preserve-relative-size"
					className="min-h-0 overflow-y-auto pr-6.5 pt-4"
				>
					{master}
				</Panel>

				<Separator data-slot="split-separator" aria-label="Resize panes" className="relative w-px flex-none bg-border-default">
					<span
						data-slot="split-handle"
						aria-hidden="true"
						className="absolute left-1/2 top-1/2 h-11 w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-[4px] border border-border-default bg-surface-raised"
					/>
				</Separator>

				<Panel
					data-slot="split-detail"
					defaultSize={`${100 - masterSize}%`}
					minSize={`${minDetailSize}%`}
					groupResizeBehavior="preserve-relative-size"
					className="min-h-0 overflow-y-auto pl-6.5 pt-4"
				>
					{detail}
				</Panel>
			</Group>
		</div>
	)
}
