/**
 * Host for the pure `@ui/products/infinite-product-list-view` view. This is the
 * retired `src/components/InfiniteProductList.tsx` moved verbatim onto its
 * platform homes: the chunked product query (`useSimpleInfiniteScroll`), scroll
 * persistence (`useScrollRestoration`), the NSFW preference from the ui store,
 * and the platform `ProductCardHost` as the grid's card renderer. The
 * window-reload retry policy stays here because reloading the app is host
 * wiring, not presentation.
 */
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef } from 'react'
import { useScrollRestoration } from '@platform/web/app/useScrollRestoration'
import { uiStore } from '@platform/web/app/uiStore'
import { InfiniteProductListView } from '@ui/products/infinite-product-list-view'
import type { SortOption } from '@ui/products/product-filters'
import { ProductCardHost } from './ProductCardHost'
import { filterNSFWProducts } from './productQuery'
import { useSimpleInfiniteScroll } from './useSimpleInfiniteScroll'

export interface InfiniteProductListHostProps {
	/** Title to display above the product grid. */
	title?: React.ReactNode
	/** Number of products to load per chunk. */
	chunkSize?: number
	/** Maximum number of products to preload. */
	maxProducts?: number
	/** Threshold in pixels from bottom to trigger auto-load. */
	threshold?: number
	/** Whether to enable automatic loading on scroll. */
	autoLoad?: boolean
	/** Additional CSS classes. */
	className?: string
	/** Unique key for scroll restoration. */
	scrollKey: string
	/** Optional tag to filter products by. */
	tag?: string
	/** Whether to show out of stock products. */
	showOutOfStock?: boolean
	/** Whether to hide pre-order products. */
	hidePreorder?: boolean
	/** Sort order for products. */
	sort?: SortOption
	/** Country name to filter products by location. */
	country?: string
}

export function InfiniteProductListHost({
	title,
	chunkSize = 20,
	maxProducts = 500,
	threshold = 1000,
	autoLoad = true,
	className,
	scrollKey,
	tag,
	showOutOfStock = false,
	hidePreorder = false,
	sort = 'newest',
	country = '',
}: InfiniteProductListHostProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const { showNSFWContent } = useStore(uiStore)

	// Use simplified infinite scroll hook
	const {
		products: rawProducts,
		isLoading,
		isError,
		error,
		hasMore,
		loadMore,
		totalProducts,
		currentChunk,
	} = useSimpleInfiniteScroll({
		chunkSize,
		maxProducts,
		threshold,
		autoLoad,
		tag,
		showOutOfStock,
		hidePreorder,
		sort,
		country,
	})

	// Filter out NSFW products if user hasn't enabled viewing
	const products = useMemo(() => filterNSFWProducts(rawProducts, showNSFWContent), [rawProducts, showNSFWContent])

	// Use scroll restoration hook
	const { scrollElementRef, saveScrollPosition, restoreScrollPosition } = useScrollRestoration({
		key: scrollKey,
		ttl: 30 * 60 * 1000, // 30 minutes
	})

	// Note: scrollElementRef is not used since we're using window-level scrolling
	void scrollElementRef

	// Only restore scroll position on initial load
	useEffect(() => {
		if (products.length && !isLoading) {
			// Only restore on first chunk
			if (currentChunk === 1) {
				const timer = setTimeout(() => {
					restoreScrollPosition()
				}, 100)
				return () => clearTimeout(timer)
			}
		}
	}, [products.length, isLoading, currentChunk, restoreScrollPosition])

	// Save scroll position periodically
	useEffect(() => {
		if (!isLoading) {
			const timer = setTimeout(() => {
				saveScrollPosition()
			}, 100)
			return () => clearTimeout(timer)
		}
	}, [products.length, saveScrollPosition, isLoading])

	return (
		<InfiniteProductListView
			className={className}
			title={title}
			products={products}
			isLoading={isLoading}
			isError={isError}
			error={error}
			hasMore={hasMore}
			totalProducts={totalProducts}
			onLoadMore={loadMore}
			onRetry={() => window.location.reload()}
			renderProduct={(product) => <ProductCardHost key={product.id} product={product} />}
			ref={containerRef}
		/>
	)
}
