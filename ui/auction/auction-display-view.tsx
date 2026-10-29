import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Media } from '../shared/media'
import { Button } from '../primitives/button'
import { Card } from '../primitives/card'
import { cn } from '../utils/cn'

export interface AuctionDisplayViewProps {
	title: string
	summary: string
	imageUrl: string | null
	endAtLabel: string
	coordsIdentifier: string
	/** Host-owned countdown node; `undefined` renders the no-countdown state. */
	countdownSlot?: ReactNode
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
	className?: string
}

/**
 * App-settings featured-auction row, lifted out of the retired
 * `src/components/AuctionDisplayComponent.tsx`. Presentation only: the host
 * resolves the auction query and derivations and injects the countdown.
 *
 * Declared visible changes: none. Markup and copy are identical to the legacy
 * leaf; the only difference is the prop surface. The leaf's raw grey palette
 * classes were migrated to the Tier-1 role vocabulary — the image frame and its
 * no-image placeholder to the sunken / hover surfaces, and the summary, close
 * label and identifier copy to the mid text role.
 */
export function AuctionDisplayView({
	title,
	summary,
	imageUrl,
	endAtLabel,
	coordsIdentifier,
	countdownSlot,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
	className,
}: AuctionDisplayViewProps) {
	return (
		<Card className={cn('p-4', className)}>
			<div className="flex items-center gap-4">
				<div className="w-16 h-16 bg-surface-sunken rounded-md overflow-hidden flex-shrink-0">
					{imageUrl ? (
						<Media src={imageUrl} alt={title} className="w-full h-full object-cover" />
					) : (
						<div className="w-full h-full bg-surface-hover flex items-center justify-center text-text-mid text-xs">No Image</div>
					)}
				</div>

				<div className="flex-1 min-w-0">
					<h3 className="font-semibold text-sm truncate">{title}</h3>
					<p className="text-xs text-text-mid mt-1 line-clamp-2">{summary}</p>
					{countdownSlot && <div className="mt-2">{countdownSlot}</div>}
					<p className="text-xs text-text-mid mt-1">Closes: {endAtLabel}</p>
					<p className="text-xs text-text-mid mt-1">ID: {coordsIdentifier}</p>
				</div>

				<div className="flex flex-col gap-1">
					{onMoveUp && (
						<Button variant="outline" size="sm" onClick={onMoveUp} disabled={!canMoveUp || isReordering} className="h-8 w-8 p-0">
							<ChevronUp className="h-4 w-4" />
						</Button>
					)}
					{onMoveDown && (
						<Button variant="outline" size="sm" onClick={onMoveDown} disabled={!canMoveDown || isReordering} className="h-8 w-8 p-0">
							<ChevronDown className="h-4 w-4" />
						</Button>
					)}
					<Button variant="destructive" size="sm" onClick={onRemove} disabled={isRemoving} className="h-8 w-8 p-0">
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</Card>
	)
}
