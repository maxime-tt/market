import type { ReactNode, Ref } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '../primitives/button'
import { EmptyState } from '../shared/empty-state'
import { ErrorState } from '../shared/error-state'
import { ItemGrid } from '../shared/item-grid'
import { LoadingState } from '../shared/loading-state'
import { cn } from '../utils/cn'

/** Minimal shape the view needs; the host owns the event type. */
export interface InfiniteProductListItem {
	id: string
}

export interface InfiniteProductListViewProps<TProduct extends InfiniteProductListItem = InfiniteProductListItem> {
	/** Title displayed above the product grid; a string renders as a page heading. */
	title?: ReactNode
	className?: string
	/** Already-filtered, chunked products to display. */
	products: readonly TProduct[]
	isLoading: boolean
	isError: boolean
	error?: { message?: string } | null
	hasMore: boolean
	totalProducts: number
	/** Invoked by the load-more button. */
	onLoadMore: () => void
	/** Invoked by the error-state retry control; the reload policy stays with the host. */
	onRetry?: () => void
	/** Renders one grid card per product; the card host is platform wiring. */
	renderProduct: (product: TProduct) => ReactNode
	ref?: Ref<HTMLDivElement>
}

/**
 * Presentational product grid with chunked load-more, moved verbatim from the
 * retired `src/components/InfiniteProductList.tsx`. Query/cache wiring, the
 * NSFW preference, and scroll restoration stay in the platform
 * `InfiniteProductListHost`; this view is a pure function of its props.
 */
export function InfiniteProductListView<TProduct extends InfiniteProductListItem = InfiniteProductListItem>({
	title,
	className,
	products,
	isLoading,
	isError,
	error,
	hasMore,
	totalProducts,
	onLoadMore,
	onRetry,
	renderProduct,
	ref,
}: InfiniteProductListViewProps<TProduct>) {
	if (isError && error) {
		return (
			<ErrorState
				title="Error loading products"
				message={error.message}
				onRetry={onRetry}
				retryLabel="Try Again"
				retryTestId="infinite-product-list-retry"
			/>
		)
	}

	if (isLoading && products.length === 0) {
		return (
			<div className={cn('w-full max-w-full overflow-hidden', className)} ref={ref}>
				{title && (
					<div className="mb-4">
						{typeof title === 'string' ? <h1 className="text-xl text-center sm:text-2xl sm:text-left">{title}</h1> : title}
					</div>
				)}
				<LoadingState label="Loading products..." className="min-h-[60vh]" data-testid="infinite-product-list-loading" />
			</div>
		)
	}

	if (products.length === 0) {
		return (
			<EmptyState
				title="No products found"
				description="There are no products available at the moment."
				data-testid="infinite-product-list-empty"
			/>
		)
	}

	return (
		<div className={cn('w-full max-w-full overflow-hidden', className)} ref={ref} data-testid="infinite-product-list">
			{/* Title */}
			{title && (
				<div className="mb-4">
					{typeof title === 'string' ? <h1 className="text-xl text-center sm:text-2xl sm:text-left">{title}</h1> : title}
				</div>
			)}

			{/* Product Grid */}
			<ItemGrid className="gap-4 sm:gap-8">{products.map((product) => renderProduct(product))}</ItemGrid>

			{/* Load more button */}
			{hasMore && (
				<div className="flex min-h-[80px] items-center justify-center py-8">
					<Button
						onClick={onLoadMore}
						variant="outline"
						size="lg"
						className="h-12 min-w-[200px]"
						disabled={isLoading}
						data-testid="infinite-product-list-load-more"
					>
						{isLoading ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Loading...
							</>
						) : (
							'Load More Products'
						)}
					</Button>
				</div>
			)}

			{/* End of results message */}
			{!hasMore && products.length > 0 && (
				<div className="flex justify-center py-8">
					<p className="text-sm text-muted-foreground" data-testid="infinite-product-list-end">
						Showing {products.length} of {totalProducts} products
					</p>
				</div>
			)}
		</div>
	)
}
