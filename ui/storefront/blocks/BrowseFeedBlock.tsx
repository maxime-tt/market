import { cn } from '@ui/utils/cn'
import type { ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'

/**
 * The minimal live-feed row: a stable `id` the grid keys on, handed straight to
 * the host's card renderer. The host's own product shape (the browse
 * read-model) satisfies it structurally, so the block never names a row field
 * it does not need — and `ui/` never learns a platform type.
 */
export interface BrowseFeedRow {
	id: string
}

/** The document-facing configuration of the block (what the page event stores). */
export interface BrowseFeedBlockProps {
	title: string
	/** How many listings the grid draws from the feed. */
	limit: number
	columns: 2 | 3 | 4
	emptyMessage: string
}

/**
 * The props-only view contract: the block plus its data and status, supplied by
 * the caller. `ui/` never resolves the data itself — the platform host reads the
 * browse index feed and passes the loaded listings in.
 */
export interface BrowseFeedBlockViewProps extends BrowseFeedBlockProps {
	/** The browse feed's loaded listings; `null` means no data yet (renders as empty). */
	products: BrowseFeedRow[] | null
	isLoading: boolean
	isError: boolean
	/** Host-supplied card renderer (the browse card host). */
	renderProduct: (product: BrowseFeedRow) => ReactNode
}

const columnClass: Record<2 | 3 | 4, string> = {
	2: 'sm:grid-cols-2',
	3: 'sm:grid-cols-2 lg:grid-cols-3',
	4: 'sm:grid-cols-2 lg:grid-cols-4',
}

/**
 * The live browse feed — the streamed grid of listings.
 *
 * The data is the browse index feed's own progressive read, so the block paints
 * cards as they arrive exactly as the browse home does; it never opens a second
 * feed. The card is the host's business (`renderProduct`); the block owns the
 * grid, its empty/loading/error states, and nothing else.
 */
export function BrowseFeedBlock({ title, limit, columns, emptyMessage, products, isLoading, isError, renderProduct }: BrowseFeedBlockViewProps) {
	const { isEditing } = useStorefrontContext()
	const shown = (products ?? []).slice(0, limit)

	return (
		<StorefrontSection width="wide" className="py-10">
			<StorefrontSectionTitle title={title} />

			{isLoading && (
				<p data-testid="storefront-browse-feed-loading" className="py-8 text-center text-muted-foreground">
					Loading products…
				</p>
			)}

			{/* A relay failure is reported, not flattened into "no products" —
			    telling a visitor the feed is empty when it is merely unreachable
			    states something the block cannot know. */}
			{isError && !isLoading && (
				<p data-testid="storefront-browse-feed-error" className="py-8 text-center text-muted-foreground">
					Products could not be loaded right now. Please try again shortly.
				</p>
			)}

			{!isLoading && !isError && shown.length === 0 && (
				isEditing ? (
					<StorefrontEditorHint>Live browse products appear here once the feed loads.</StorefrontEditorHint>
				) : (
					<p data-testid="storefront-browse-feed-empty" className="py-8 text-center text-muted-foreground">
						{emptyMessage.trim() || 'No products loaded yet.'}
					</p>
				)
			)}

			{shown.length > 0 && (
				// Cards stay inert inside the editor: a click in the canvas selects
				// the block, and must not navigate away from the page being edited.
				<div
					data-testid="storefront-browse-feed"
					className={cn('grid grid-cols-1 gap-6', columnClass[columns], isEditing && 'pointer-events-none')}
				>
					{shown.map((product) => (
						<div key={product.id}>{renderProduct(product)}</div>
					))}
				</div>
			)}
		</StorefrontSection>
	)
}