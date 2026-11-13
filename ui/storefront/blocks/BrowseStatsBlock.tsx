import { describeIdleStats, type BrowseIdleStats } from '@ui/browse/browse-idle'
import { cn } from '@ui/utils/cn'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, type StorefrontAlign } from './shared'

/** The document-facing configuration of the block (what the page event stores). */
export interface BrowseStatsBlockProps {
	align: StorefrontAlign
}

/**
 * The props-only view contract: the block plus its data and status, supplied by
 * the caller. `ui/` never resolves the data itself — the platform host reads the
 * browse index feed and passes its measured `feed.stats` in.
 */
export interface BrowseStatsBlockViewProps extends BrowseStatsBlockProps {
	/** The feed's measured facts; `undefined` means nothing measured yet. */
	stats?: BrowseIdleStats
	isLoading: boolean
	isError: boolean
}

const justifyClass: Record<StorefrontAlign, string> = {
	left: 'justify-start text-left',
	center: 'justify-center text-center',
	right: 'justify-end text-right',
}

/**
 * The measured facts line — the browse hero's *"N items loaded from N sellers"*
 * copy, as a page block.
 *
 * Measurement only. The wording comes from the browse hero's own
 * `describeIdleStats`, so this block and the hero cannot disagree about how a
 * count is stated — and neither emits the frame's market-wide placeholder copy.
 * With nothing measured the block renders nothing for a visitor (a numberless
 * line is not a measurement) and a hint for the author.
 */
export function BrowseStatsBlock({ align, stats, isLoading, isError }: BrowseStatsBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const { headline, relays } = describeIdleStats(stats)
	const hasContent = headline.length > 0 || Boolean(relays)

	if (!hasContent) {
		if (isError) return <ErrorFallback />
		if (isLoading) return null
		return isEditing ? (
			<StorefrontSection width="narrow" className="py-4">
				<StorefrontEditorHint>Live browse stats appear here once the feed loads.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	return (
		<StorefrontSection width="narrow" className={cn('py-4', isEditing && 'pointer-events-none')}>
			<div
				data-testid="storefront-browse-stats"
				className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground', justifyClass[align])}
			>
				{headline.length > 0 && <span>{headline.join(' — ')}</span>}
				{relays && <span className="text-xs">{relays}</span>}
			</div>
		</StorefrontSection>
	)
}

function ErrorFallback() {
	return (
		<StorefrontSection width="narrow" className="py-4">
			<p data-testid="storefront-browse-stats-error" className="text-center text-destructive">
				The browse stats could not be loaded — check your relay connection.
			</p>
		</StorefrontSection>
	)
}
