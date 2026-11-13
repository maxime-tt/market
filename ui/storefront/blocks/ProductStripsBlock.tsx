import { cn } from '@ui/utils/cn'
import { ProductStrip, type StripItem } from '@ui/browse/product-strip'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'

/**
 * The document-facing configuration of the block (what the page event stores).
 *
 * The block stores the *query*, never the listings: a page that denormalised
 * titles or prices would be a page stating prices the seller may no longer
 * honour (ADR-019).
 */
export interface ProductStripsBlockProps {
	/** Optional heading above the band. */
	title: string
	/** How many listings the strip draws from the feed. */
	limit: number
	/** Drift the row the other way — two strips then read as one band. */
	reverse: boolean
}

/**
 * The props-only view contract: the block plus its data and status, supplied
 * by the caller. `ui/` never resolves the data itself — the platform host reads
 * the browse index feed over the read seam and passes the strip items in.
 */
export interface ProductStripsBlockViewProps extends ProductStripsBlockProps {
	/** The feed's own strip items; `null` means no data yet (renders as empty). */
	items: readonly StripItem[] | null
	isLoading: boolean
	isError: boolean
	/** Host-supplied activation (e.g. opening the product panel in place). */
	onSelect?: (id: string) => void
}

/**
 * The live wall strips — a full-bleed, looping band of the feed's own listings.
 *
 * The strip itself (`@ui/browse/product-strip`) is the browse home's own
 * component, wrapped rather than reimplemented, so the CMS page and the browse
 * hero draw the identical band. A visitor with no loaded listings sees nothing
 * (never invented content); the author sees a hint in the editor.
 */
export function ProductStripsBlock({ title, limit, reverse, items, isLoading, isError, onSelect }: ProductStripsBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const shown = (items ?? []).slice(0, limit)

	if (isError) return <ErrorFallback />

	if (shown.length === 0) {
		if (isLoading) return <LoadingFallback />
		if (!isEditing) return null
		return (
			<StorefrontSection width="narrow" className="py-6">
				<StorefrontEditorHint>Live product strips appear here once the browse feed loads.</StorefrontEditorHint>
			</StorefrontSection>
		)
	}

	return (
		<StorefrontSection width="full" className={cn('py-6', isEditing && 'pointer-events-none')}>
			<StorefrontSectionTitle title={title} />
			<ProductStrip items={shown} reverse={reverse} onSelect={onSelect} />
		</StorefrontSection>
	)
}

function LoadingFallback() {
	return (
		<StorefrontSection width="narrow" className="py-6">
			<p data-testid="storefront-product-strips-loading" className="text-center text-muted-foreground">
				Loading…
			</p>
		</StorefrontSection>
	)
}

function ErrorFallback() {
	return (
		<StorefrontSection width="narrow" className="py-6">
			<p data-testid="storefront-product-strips-error" className="text-center text-destructive">
				These product strips could not be loaded — check your relay connection.
			</p>
		</StorefrontSection>
	)
}
