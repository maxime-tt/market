import { getProductId, type ProductReadEvent } from '@sdk/commerce/discovery'
import { cn } from '@ui/utils/cn'
import type { ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, StorefrontSectionTitle } from './shared'

/** The document-facing configuration of the block (what the page event stores). */
export interface ProductRowBlockProps {
	/** The product d-tags, in the exact order the author placed them. Each is resolved against the author's own listings. */
	productDTags: string[]
}

/**
 * The props-only view contract: the block plus its data and status, supplied
 * by the caller. `ui/` never resolves the data itself — the platform host
 * reads the author's listings over the read seam and passes them in.
 */
export interface ProductRowBlockViewProps extends ProductRowBlockProps {
	/** The page author's listings; `null` means no data yet (renders as empty). */
	products: ProductReadEvent[] | null
	isLoading: boolean
	isError: boolean
	/** Host-supplied card renderer (e.g. the wired `ProductCardHost` wrapper). */
	renderProduct: (product: ProductReadEvent) => ReactNode
}

/**
 * A horizontal row of editor-picked, ordered products.
 *
 * Each `d` tag is resolved against the author's own listing set — the same
 * trust boundary that protects FeaturedProduct — so a page can only ever
 * display the author's items. The order in the document is the order the
 * visitor sees.
 */
export function ProductRowBlock({ productDTags, products, isLoading, isError, renderProduct }: ProductRowBlockViewProps) {
	const { isEditing } = useStorefrontContext()

	// Fails closed: no products selected, no data to show.
	if (productDTags.length === 0) {
		if (isError) return <ErrorFallback />
		if (isLoading) return <LoadingFallback />
		return isEditing ? (
			<StorefrontSection width="narrow" className="py-6">
				<StorefrontEditorHint>Add products to show them in a row.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	// Match each d-tag to an actual product. The author's ordering is preserved.
	const resolved: ProductReadEvent[] = []
	for (const dTag of productDTags) {
		const product = (products ?? []).find((p) => getProductId(p) === dTag)
		if (product) resolved.push(product)
	}

	// All products gone (delisted or unpublished).
	if (resolved.length === 0) {
		if (isError) return <ErrorFallback />
		if (isLoading) return <LoadingFallback />
		if (!isEditing) return null
		return (
			<StorefrontSection width="narrow" className="py-6">
				<StorefrontEditorHint>No published product matches the selected d-tags.</StorefrontEditorHint>
			</StorefrontSection>
		)
	}

	return (
		<StorefrontSection className={cn('py-8', isEditing && 'pointer-events-none')}>
			<div className="flex gap-4 overflow-x-auto pb-2">
				{resolved.map((product) => (
					<div key={getProductId(product)} className="flex-none shrink-0 sm:flex-1 sm:basis-64">
						{renderProduct(product)}
					</div>
				))}
			</div>
		</StorefrontSection>
	)
}

function LoadingFallback() {
	return (
		<StorefrontSection width="narrow" className="py-6">
			<p data-testid="storefront-product-row-loading" className="text-center text-muted-foreground">
				Loading…
			</p>
		</StorefrontSection>
	)
}

function ErrorFallback() {
	return (
		<StorefrontSection width="narrow" className="py-6">
			<p data-testid="storefront-product-row-error" className="text-center text-destructive">
				This product row could not be loaded — check your relay connection.
			</p>
		</StorefrontSection>
	)
}
