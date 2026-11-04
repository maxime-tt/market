import { getProductId, type ProductReadEvent } from '@sdk/commerce/discovery'
import { cn } from '@ui/utils/cn'
import type { ReactNode } from 'react'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection } from './shared'

/** The document-facing configuration of the block (what the page event stores). */
export interface FeaturedProductBlockProps {
	productDTag: string
}

/**
 * The props-only view contract: the block plus the author's listings and
 * status, supplied by the caller. `ui/` never resolves the data itself.
 */
export interface FeaturedProductBlockViewProps extends FeaturedProductBlockProps {
	/** The page author's listings; `null` means no data yet. */
	products: ProductReadEvent[] | null
	isLoading: boolean
	isError: boolean
	/** Host-supplied card renderer (e.g. the wired `ProductCardView` host). */
	renderProduct: (product: ProductReadEvent) => ReactNode
}

/**
 * A single highlighted listing, referenced by its `d` tag.
 *
 * Resolved out of the author's own listing set rather than by a direct lookup,
 * which is what makes the reference safe: the identity of the product is
 * `(author pubkey of the listings the host passed in, d tag from the document)`,
 * so a page cannot point at an arbitrary event id and display a stranger's
 * listing under the author's name. The fork enforced the same rule by reading
 * `useQuery(productsByPubkeyQueryOptions(pubkey))` against the context pubkey;
 * this view keeps the rule and leaves the acquisition to the platform host.
 */
export function FeaturedProductBlock({ productDTag, products, isLoading, isError, renderProduct }: FeaturedProductBlockViewProps) {
	const { isEditing } = useStorefrontContext()

	if (productDTag.trim().length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-6">
				<StorefrontEditorHint>Choose a product to feature.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	const product = (products ?? []).find((candidate) => getProductId(candidate) === productDTag)

	if (isLoading) {
		return (
			<StorefrontSection width="narrow" className="py-6">
				<p data-testid="storefront-featured-product-loading" className="text-center text-muted-foreground">
					Loading…
				</p>
			</StorefrontSection>
		)
	}

	// A featured product that no longer exists (unlisted, sold out, or deleted)
	// renders as nothing for visitors rather than as a broken slot. The author
	// still sees why, because the editor hint is theirs alone.
	if (!product) {
		if (!isEditing) return null
		return (
			<StorefrontSection className="py-6">
				<StorefrontEditorHint>
					{isError
						? 'This product could not be loaded — check your relay connection.'
						: `No published product matches "${productDTag}". It may be hidden, out of stock, or deleted.`}
				</StorefrontEditorHint>
			</StorefrontSection>
		)
	}

	return (
		<StorefrontSection width="narrow" className={cn('py-8', isEditing && 'pointer-events-none')}>
			<div data-testid="storefront-featured-product">{renderProduct(product)}</div>
		</StorefrontSection>
	)
}
