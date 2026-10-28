import { useQuery } from '@tanstack/react-query'
import { getCoordsFromATag } from '@sdk/core/utils/coords'
import { collectionQueryOptions } from '@platform/web/collections/collectionQuery'
import { fetchProductByATag, productKeys } from '@platform/web/products/productQuery'
import { Media } from '@ui/shared/media'
import { CollectionDisplayView } from '@ui/products/collection-display-view'
import { ProductDisplayView } from '@ui/products/product-display-view'

/**
 * Parses an a-tag coordinate string into its kind/pubkey/identifier parts.
 * Shared by both app-settings entity rows; the browser hosts gave up their
 * own copies when the src/ components retired (D4 W3a).
 */
export function resolveEntityDisplayInput(coords: string): { kind: number; pubkey: string; identifier: string } {
	return getCoordsFromATag(coords)
}

interface CollectionDisplayHostProps {
	collectionCoords: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
}

/** App-settings collection row: wires the collection query, delegates rendering to the ui/ view. */
export function CollectionDisplayHost({
	collectionCoords,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: CollectionDisplayHostProps) {
	// Parse coordinates to get collection ID
	const coords = resolveEntityDisplayInput(collectionCoords)
	const collectionId = coords.identifier

	// Fetch collection data
	const { data: collection, isLoading } = useQuery({
		...collectionQueryOptions(collectionId),
		enabled: !!collectionId,
	})

	return (
		<CollectionDisplayView
			collection={collection ?? null}
			collectionId={collectionId}
			index={index}
			isLoading={isLoading}
			onMoveUp={onMoveUp}
			onMoveDown={onMoveDown}
			onRemove={onRemove}
			canMoveUp={canMoveUp}
			canMoveDown={canMoveDown}
			isReordering={isReordering}
			isRemoving={isRemoving}
			renderImage={(url, title) => <Media src={url} alt={title} className="h-full w-full object-cover" />}
		/>
	)
}

interface ProductDisplayHostProps {
	productCoords: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
}

/** App-settings product row: wires the product query, delegates rendering to the ui/ view. */
export function ProductDisplayHost({
	productCoords,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: ProductDisplayHostProps) {
	// Parse coordinates to get product ID
	const coords = resolveEntityDisplayInput(productCoords)
	const productId = coords.identifier

	// Fetch product data
	const { data: product, isLoading } = useQuery({
		queryKey: productKeys.byATag(coords.pubkey, productId),
		queryFn: () => fetchProductByATag(coords.pubkey, productId),
		enabled: !!productId && !!coords.pubkey,
	})

	return (
		<ProductDisplayView
			product={product ?? null}
			productId={productId}
			index={index}
			isLoading={isLoading}
			onMoveUp={onMoveUp}
			onMoveDown={onMoveDown}
			onRemove={onRemove}
			canMoveUp={canMoveUp}
			canMoveDown={canMoveDown}
			isReordering={isReordering}
			isRemoving={isRemoving}
			renderImage={(url, title) => <Media src={url} alt={title} className="h-full w-full object-cover" />}
		/>
	)
}
