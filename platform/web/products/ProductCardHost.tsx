/**
 * Host/binding for the pure `@ui/products/product-card-view` view. It is the
 * retired `src/components/ProductCard.tsx` moved verbatim onto its platform/sdk
 * homes: the cart store and ui store, the product query cache seeding, the
 * auth read, the test-label coordinate helper, and the platform
 * PriceDisplay/TestListingNotice/ZapButton hosts. The router Link wrapper (the
 * card is navigable) stays here because routing is app wiring, not
 * presentation. The add-to-cart guard is extracted as `canAddToCart` so the
 * stock/ownership rules have one behaviour test.
 */
import { cartActions, useCart } from '@platform/web/cart/cartStore'
import { Media } from '@ui/shared/media'
import { uiActions } from '@platform/web/app/uiStore'
import { productQueryOptions } from './productQuery'
import { getProductStock, getProductVisibility, isProductInStock } from '@sdk/commerce/discovery'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { PriceDisplayHost } from './PriceDisplayHost'
import { useAuth } from '@platform/web/auth/authStore'
import { ZapButtonHost } from '@platform/web/payments/ZapButtonHost'
import { cn } from '@ui/utils/cn'
import { getItemTestLabelCoordinate } from '@sdk/config/testLabelFilters'
import { TestListingNoticeHost } from '@platform/web/config/testListingNoticeHost'
import type { NDKEvent } from '@platform/web/readContext'
import { ProductCardView } from '@ui/products/product-card-view'

export interface ProductCardHostProps extends React.HTMLAttributes<HTMLDivElement> {
	product: NDKEvent
}

/** The add-to-cart guard the legacy card owned. Exported for the one behaviour test. */
export const canAddToCart = (state: {
	isOwnProduct: boolean
	visibility: string
	isOutOfStock: boolean
	stockQuantity: number | undefined
	cartQuantity: number
}): boolean => {
	if (state.isOwnProduct || state.visibility === 'hidden' || state.isOutOfStock) return false // Don't allow adding own products, hidden products, or out of stock items

	// Check if adding would exceed available stock
	if (state.stockQuantity !== undefined && state.cartQuantity >= state.stockQuantity) return false
	return true
}

export function ProductCardHost({ product, className }: ProductCardHostProps) {
	const stockTag = getProductStock(product)
	const parsedStockQuantity = stockTag ? Number.parseInt(stockTag[1], 10) : undefined
	const stockQuantity = parsedStockQuantity !== undefined && Number.isFinite(parsedStockQuantity) ? parsedStockQuantity : undefined
	const visibility = getProductVisibility(product)?.[1] || 'on-sale'
	const isOutOfStock = visibility !== 'pre-order' && !isProductInStock(product)
	const [isAddingToCart, setIsAddingToCart] = useState(false)
	const [showConfirmation, setShowConfirmation] = useState(false)
	const location = useLocation()
	const cart = useCart()
	const queryClient = useQueryClient()
	const { user, isAuthenticated } = useAuth()

	const isOwnProduct = isAuthenticated && user?.pubkey === product.pubkey

	// ADR-0009: coordinate used by the test-listing indicator. Cards normally
	// only carry test-labeled items when the viewer revealed them or is on the
	// seller's profile, so the marker explains what they are looking at.
	const testLabelCoordinate = getItemTestLabelCoordinate(product)

	// Check if product is already in cart
	const isInCart = !!cart.cart.products[product.id]
	const cartQuantity = isInCart ? cart.cart.products[product.id]?.amount || 0 : 0

	const handleAddToCart = async () => {
		if (!canAddToCart({ isOwnProduct, visibility, isOutOfStock, stockQuantity, cartQuantity })) return

		setIsAddingToCart(true)
		try {
			await cartActions.addProduct(product)
			setShowConfirmation(true)
			setTimeout(() => setShowConfirmation(false), 1200)
		} finally {
			setIsAddingToCart(false)
		}
	}

	const handleProductClick = () => {
		// Seed the product details cache so the product page can render immediately on navigation.
		queryClient.setQueryData(productQueryOptions(product.id).queryKey, product)

		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setProductSourcePath(location.pathname)
	}

	return (
		<Link
			to={`/products/${product.id}`}
			onClick={handleProductClick}
			className={cn(
				'border border-zinc-800 rounded-lg bg-white shadow-sm flex flex-col w-full max-w-full overflow-hidden hover:shadow-md transition-shadow duration-200 cursor-pointer',
				className,
			)}
			data-testid="product-card"
		>
			<ProductCardView
				product={product}
				isOwnProduct={isOwnProduct}
				isInCart={isInCart}
				cartQuantity={cartQuantity}
				isAddingToCart={isAddingToCart}
				showConfirmation={showConfirmation}
				onAddToCart={handleAddToCart}
				renderImage={(src, alt) => (
					<Media
						src={src}
						alt={alt}
						className="h-full w-full rounded-t-[calc(var(--radius)-1px)] object-cover transition-transform duration-200 hover:scale-105"
					/>
				)}
				renderPrice={(priceTag) => (
					<PriceDisplayHost priceValue={Number.parseFloat(priceTag[1])} originalCurrency={priceTag[2] || 'SATS'} />
				)}
				renderNotice={
					testLabelCoordinate ? (
						<TestListingNoticeHost coordinate={testLabelCoordinate} variant="icon" className="absolute top-2 right-2" />
					) : null
				}
				renderSecondaryAction={<ZapButtonHost event={product} />}
			/>
		</Link>
	)
}
