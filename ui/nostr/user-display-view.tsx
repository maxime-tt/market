import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Button } from '../primitives/button'
import { Card } from '../primitives/card'
import { cn } from '../utils/cn'

export interface UserDisplayViewProps {
	/** The identity node for the row; the host supplies a wired user card. */
	userCard: ReactNode
	/** Replaces the built-in reorder/remove cluster when provided. */
	customActions?: ReactNode
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove?: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving?: boolean
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * Presentational app-settings user row: a card wrapping an identity node and an
 * action cluster. Extracted from the retiring
 * `src/components/UserDisplayComponent.tsx`. The profile read the legacy file
 * ran for nothing, the unused `index` prop and the `nip19` /
 * `profileQueryOptions` imports all stay behind in the platform host.
 */
export function UserDisplayView({
	userCard,
	customActions,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
	className,
	ref,
}: UserDisplayViewProps) {
	return (
		<Card ref={ref} data-slot="user-display-view" className={cn('p-4', className)}>
			<div className="flex items-center gap-4 justify-between">
				{userCard}

				{/* Action Buttons */}
				{customActions ? (
					<div className="flex flex-col gap-1">{customActions}</div>
				) : (
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
						{onRemove && (
							<Button variant="destructive" size="sm" onClick={onRemove} disabled={isRemoving} className="h-8 w-8 p-0">
								<Trash2 className="h-4 w-4" />
							</Button>
						)}
					</div>
				)}
			</div>
		</Card>
	)
}
