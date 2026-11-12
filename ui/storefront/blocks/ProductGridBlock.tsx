import { getProductCollection, getProductId, type ProductReadEvent } from '@sdk/commerce/discovery'
import { cn } from '@ui/utils/cn'
import type { ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'

/** The document-facing configuration of the block (what the page event stores). */
export interface ProductGridBlockProps {
	title: string
	source: 'all' | 'collection'
	collectionDTag: string
	limit: number
	columns: 2 | 3 | 4
	emptyMessage: string
}

/**
 * The props-only view contract: the block plus its data and status, supplied
 * by the caller. `ui/` never resolves the data itself — the platform host
 * reads the author's listings over the read seam and passes them in.
 */
export interface ProductGridBlockViewProps extends ProductGridBlockProps {
	/** The page author's listings; `null` means no data yet (renders as empty). */
	products: ProductReadEvent[] | null
	isLoading: boolean
	isError: boolean
	/** Host-supplied card renderer (e.g. the wired `ProductCardView` host). */
	renderProduct: (product: ProductReadEvent) => ReactNode
}

const columnClass: Record<2 | 3 | 4, string> = {
	2: 'sm:grid-cols-2',
	3: 'sm:grid-cols-2 lg:grid-cols-3',
	4: 'sm:grid-cols-2 lg:grid-cols-4',
}

/**
 * Products are matched by `d` tag, and a product's `collection` tag may carry
 * either a bare `d` tag or a full `kind:pubkey:d` coordinate depending on when
 * it was published. Accept both, but anchor the coordinate form on the final
 * segment so `summer` cannot match a collection called `not-summer`.
 */
function belongsToCollection(collectionRef: string | null, dTag: string): boolean {
	if (!collectionRef) return false
	if (collectionRef === dTag) return true
	return collectionRef.endsWith(`:${dTag}`)
}

/**
 * A grid of the page author's own listings.
 *
 * The fork resolved the data with `useQuery(productsByPubkeyQueryOptions(pubkey))`
 * against the context pubkey. This view keeps the *rule* that made that safe —
 * the document stores the *query* (which collection, how many, how wide) and
 * never denormalised titles or prices, per ADR-019: a cached price on a page
 * would be a price the seller did not agree to honour — while moving the
 * data acquisition into the platform host, because `ui/` is props-only.
 */
export function ProductGridBlock({
	title,
	source,
	collectionDTag,
	limit,
	columns,
	emptyMessage,
	products,
	isLoading,
	isError,
	renderProduct,
}: ProductGridBlockViewProps) {
	const { isEditing } = useStorefrontContext()

	if (source === 'collection' && collectionDTag.trim().length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-8">
				<StorefrontSectionTitle title={title} />
				<StorefrontEditorHint>Pick a collection, or switch this block back to showing all products.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	const filtered = (products ?? [])
		.filter((product) => (source === 'collection' ? belongsToCollection(getProductCollection(product), collectionDTag) : true))
		.slice(0, limit)

	return (
		<StorefrontSection width="wide" className="py-10">
			<StorefrontSectionTitle title={title} />

			{isLoading && (
				<p data-testid="storefront-product-grid-loading" className="py-8 text-center text-muted-foreground">
					Loading products…
				</p>
			)}

			{/* A relay failure is reported, not flattened into "no products".
			    Telling a visitor the shop is empty when it is merely unreachable
			    costs the seller a sale and tells nobody the truth. */}
			{isError && !isLoading && (
				<p data-testid="storefront-product-grid-error" className="py-8 text-center text-muted-foreground">
					Products could not be loaded right now. Please try again shortly.
				</p>
			)}

			{!isLoading && !isError && filtered.length === 0 && (
				<p data-testid="storefront-product-grid-empty" className="py-8 text-center text-muted-foreground">
					{emptyMessage.trim() || 'Nothing listed here yet.'}
				</p>
			)}

			{filtered.length > 0 && (
				// Cards stay inert inside the editor: a click in the canvas
				// selects the block, and must not put anything in a cart.
				<div
					data-testid="storefront-product-grid"
					className={cn('grid grid-cols-1 gap-6', columnClass[columns], isEditing && 'pointer-events-none')}
				>
					{filtered.map((product) => (
						<div key={getProductId(product)}>{renderProduct(product)}</div>
					))}
				</div>
			)}
		</StorefrontSection>
	)
}
