/**
 * browse/empty-state-browse.tsx — Empty marketplace / no-results state.
 *
 * Frame `xAZ75F-_uQ__state-empty-marketplace-1440.html`:
 * - Headline: "Nothing matched "ceramic"."
 * - Explanatory paragraph: every relay answered, none carried the listing,
 *   that is the whole result, not an error
 * - "Try next" suggestion: broader term, seller npub, or clear the field
 * - Hint bar: "local index empty" · "412 ms" · "synced 6 min ago"
 * - The results grid is still visible (past results), the empty banner sits
 *   above it
 */

import type { FC, ReactNode } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmptyStateBrowseProps {
	/** The query that returned nothing. */
	query: string
	/** Optional custom headline. Defaults to `Nothing matched "…".`. */
	headline?: string
	/** Optional custom body copy. */
	description?: string
	/** Optional "Try next" suggestions. */
	suggestions?: ReactNode
	/** Hint metadata shown in a bottom bar. */
	hints?: { label: string }[]
	/** Extra classes for the root. */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Empty marketplace state — zero results but every relay answered.
 *
 * Displays a headline, explanatory paragraph, suggestion line,
 * and optional metadata hints. The results grid renders beneath it.
 */
export const EmptyStateBrowse: FC<EmptyStateBrowseProps> = ({
	query,
	headline,
	description,
	suggestions,
	hints = [{ label: 'local index empty' }, { label: '412 ms' }, { label: 'synced 6 min ago' }],
	className,
}) => {
	return (
		<div data-slot="empty-browse" data-testid="widget-empty-browse" className={cn('max-w-[960px] mx-auto', className)}>
			{/* Headline */}
			<h2 className="text-xl font-medium text-text-high">{headline ?? `Nothing matched "${query}".`}</h2>

			{/* Explanatory body */}
			<p className="mt-2 text-sm text-text-mid leading-relaxed">
				{description ??
					'Every relay this market mirrors answered — none carried a listing for that query, and none are still in flight. That is the whole result, not an error.'}
			</p>

			{/* Try next suggestions */}
			{suggestions && (
				<p className="mt-2 text-sm">
					<span className="text-text-high font-medium">Try next</span> {suggestions}
				</p>
			)}

			{/* Hint bar — metadata */}
			{hints.length > 0 && (
				<div
					data-slot="hints"
					className="mt-6 flex items-center justify-center gap-0 text-xs text-text-mid font-variant-numeric-tabular-nums"
				>
					{hints.map((h, i) => (
						<span key={i} className={cn('px-3.5', i > 0 && 'border-l border-border-default')}>
							{h.label}
						</span>
					))}
				</div>
			)}
		</div>
	)
}
