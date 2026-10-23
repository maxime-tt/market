import { ShareProductDialog } from '@/components/dialogs/ShareProductDialog'
import { publishShareProductNote } from '@/publish/shareNotes'
import { Media } from '@ui/shared/media'
import { ConfirmDialog } from '@ui/shared/confirm-dialog'
import { EntityListItem, type EntityListItemAction } from '@ui/shared/entity-list-item'
import { Button } from '@ui/wrappers/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { authStore } from '@/lib/stores/auth'
import { notificationActions } from '@/lib/stores/notifications'
import { productFormActions } from '@/lib/stores/product'
import { useDeleteProductMutation } from '@/publish/products'
import { getProductId, getProductTitle, productQueryOptions, productsByPubkeyQueryOptions } from '@/queries/products'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useDashboardTitle } from '@platform/web/routes/_dashboard-layout'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Trash } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { DashboardProductDetails, DashboardProductTrigger } from '@ui/dashboard/dashboard-product-list-item'

function ProductListItem({
	product,
	isExpanded,
	onToggleExpanded,
	onEdit,
	onShare,
	onDelete,
	isDeleting,
}: {
	product: NDKEvent
	isExpanded: boolean
	onToggleExpanded: () => void
	onEdit: () => void
	onShare: () => void
	onDelete: () => void
	isDeleting: boolean
}) {
	const queryClient = useQueryClient()
	const triggerContent = (
		<DashboardProductTrigger
			product={product}
			renderImage={(url) => <Media src={url} alt="" className="rounded w-10 h-10 object-cover shrink-0" />}
		/>
	)

	const actions: EntityListItemAction[] = [
		{
			key: 'edit',
			label: `Edit ${getProductTitle(product)}`,
			icon: <span className="w-5 h-5 i-edit" />,
			onClick: () => onEdit(),
		},
		{
			key: 'share',
			label: `Share ${getProductTitle(product)}`,
			icon: <span className="w-4 h-4 i-sharing" />,
			onClick: () => onShare(),
		},
		{
			key: 'delete',
			label: `Delete ${getProductTitle(product)}`,
			icon: <Trash className="w-4 h-4 text-destructive" />,
			onClick: () => onDelete(),
			destructive: true,
			pending: isDeleting,
		},
	]

	return (
		<EntityListItem
			isOpen={isExpanded}
			onOpenChange={onToggleExpanded}
			trigger={triggerContent}
			actions={actions}
			isDeleting={isDeleting}
			icon={false}
		>
			<DashboardProductDetails
				product={product}
				renderImage={(url, alt) => <Media src={url} alt={alt} className="w-full h-full object-cover" />}
				renderLink={(children) => (
					<Link
						to={`/products/${product.id}`}
						onClick={() => queryClient.setQueryData(productQueryOptions(product.id).queryKey, product)}
						className="block cursor-pointer border-t bg-gray-50 p-4 transition-colors hover:bg-gray-100"
					>
						{children}
					</Link>
				)}
			/>
		</EntityListItem>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products')({
	component: ProductsOverviewComponent,
})

function ProductsOverviewComponent() {
	const { user, isAuthenticated } = useStore(authStore)
	const navigate = useNavigate()
	const matchRoute = useMatchRoute()
	const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
	const [orderBy, setOrderBy] = useState<string>('newest')
	const [shareDialogOpen, setShareDialogOpen] = useState(false)
	const [productToShare, setProductToShare] = useState<NDKEvent | null>(null)
	const [pendingDeleteProduct, setPendingDeleteProduct] = useState<NDKEvent | null>(null)
	useDashboardTitle('Products')

	useEffect(() => {
		if (isAuthenticated) {
			notificationActions.markProductCommentsSeen()
		}
	}, [isAuthenticated])

	// Auto-animate for smooth list transitions
	const [animationParent] = (() => {
		try {
			return useAutoAnimate()
		} catch (error) {
			console.warn('Auto-animate not available:', error)
			return [null]
		}
	})()
	// Check if we're on a child route (editing or creating a product)
	const isOnChildRoute =
		matchRoute({
			to: '/dashboard/products/products/$productId',
			fuzzy: true,
		}) ||
		matchRoute({
			to: '/dashboard/products/products/new',
			fuzzy: true,
		})

	const dashboardProductOptions = productsByPubkeyQueryOptions(user?.pubkey ?? '', true) // Include hidden products for own dashboard
	const {
		data: products,
		isLoading,
		error,
	} = useQuery({
		...dashboardProductOptions,
		enabled: dashboardProductOptions.enabled && isAuthenticated,
	})

	// Sort products based on orderBy
	const sortedProducts = useMemo(() => {
		if (!products) return []
		return [...products].sort((a, b) => {
			// Alphabetical sorting
			if (orderBy === 'alphabetical') {
				const titleA = getProductTitle(a).toLowerCase()
				const titleB = getProductTitle(b).toLowerCase()
				return titleA.localeCompare(titleB)
			}
			if (orderBy === 'alphabetical-reverse') {
				const titleA = getProductTitle(a).toLowerCase()
				const titleB = getProductTitle(b).toLowerCase()
				return titleB.localeCompare(titleA)
			}
			// Time-based sorting
			const timeA = a.created_at || 0
			const timeB = b.created_at || 0
			if (orderBy === 'oldest' || orderBy === 'least-updated') {
				return timeA - timeB
			} else {
				return timeB - timeA
			}
		})
	}, [products, orderBy])

	// Delete mutation
	const deleteMutation = useDeleteProductMutation()

	const handleAddProductClick = () => {
		navigate({
			to: '/dashboard/products/products/new',
		})
	}

	const handleEditProductClick = (productId: string) => {
		navigate({
			to: '/dashboard/products/products/$productId',
			params: { productId },
		})
	}

	const handleToggleExpanded = (productId: string) => {
		setExpandedProduct(expandedProduct === productId ? null : productId)
	}

	const handleShareProductClick = (product: NDKEvent) => {
		setProductToShare(product)
		setShareDialogOpen(true)
	}

	const handleDeleteProductClick = (product: NDKEvent) => {
		setPendingDeleteProduct(product)
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="p-6 text-center">
				<p>Please log in to manage your products.</p>
			</div>
		)
	}

	// If we're on a child route, render the child route
	if (isOnChildRoute) {
		return <Outlet />
	}

	return (
		<div>
			<div className="hidden top-0 z-10 sticky lg:flex justify-between items-center bg-white px-4 lg:px-6 py-4 border-b">
				<h1 className="font-bold text-2xl">Products</h1>
				<div className="flex items-center gap-4">
					<Select value={orderBy} onValueChange={setOrderBy}>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="alphabetical">Alphabetically (A-Z)</SelectItem>
							<SelectItem value="alphabetical-reverse">Alphabetically (Z-A)</SelectItem>
							<SelectItem value="newest">Newest First</SelectItem>
							<SelectItem value="oldest">Oldest First</SelectItem>
							<SelectItem value="recently-updated">Recently Updated</SelectItem>
							<SelectItem value="least-updated">Least Recently Updated</SelectItem>
						</SelectContent>
					</Select>
					<Button
						onClick={handleAddProductClick}
						data-testid="add-product-button"
						className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 px-4 py-2 font-semibold text-white text-sm"
					>
						<span className="w-5 h-5 i-product" /> Add A Product
					</Button>
				</div>
			</div>
			<div className="space-y-6 p-4 lg:p-6">
				<div className="lg:hidden space-y-4">
					<Select value={orderBy} onValueChange={setOrderBy}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Order By" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="alphabetical">Alphabetically (A-Z)</SelectItem>
							<SelectItem value="alphabetical-reverse">Alphabetically (Z-A)</SelectItem>
							<SelectItem value="newest">Newest First</SelectItem>
							<SelectItem value="oldest">Oldest First</SelectItem>
							<SelectItem value="recently-updated">Recently Updated</SelectItem>
							<SelectItem value="least-updated">Least Recently Updated</SelectItem>
						</SelectContent>
					</Select>
					<Button
						onClick={handleAddProductClick}
						data-testid="add-product-button-mobile"
						className="flex justify-center items-center gap-2 bg-neutral-800 hover:bg-neutral-700 py-3 border-neutral-600 border-b rounded-t-md rounded-b-none w-full font-semibold text-white text-base"
					>
						<span className="w-5 h-5 i-product" /> Add A Product
					</Button>
				</div>

				<div>
					{isLoading && <div className="mt-4 p-6 text-gray-500 text-center">Loading your products...</div>}
					{error && <div className="mt-4 p-6 text-red-600 text-center">Failed to load products: {error.message}</div>}

					{!isLoading && !error && (
						<>
							{sortedProducts && sortedProducts.length > 0 ? (
								<ul ref={animationParent} className="flex flex-col gap-4 mt-4">
									{sortedProducts.map((product) => (
										<li key={product.id}>
											<ProductListItem
												product={product}
												isExpanded={expandedProduct === product.id}
												onToggleExpanded={() => handleToggleExpanded(product.id)}
												onEdit={() => handleEditProductClick(product.id)}
												onShare={() => handleShareProductClick(product)}
												onDelete={() => handleDeleteProductClick(product)}
												isDeleting={deleteMutation.isPending && deleteMutation.variables === getProductId(product)}
											/>
										</li>
									))}
								</ul>
							) : (
								<div className="px-6 py-10 text-gray-500 text-center">
									<span className="w-5 h-5 i-product" />
									<h3 className="mt-2 font-semibold text-gray-700 text-lg">No products yet</h3>
									<p className="mt-1 text-sm">Click the "Add A Product" button to create your first one.</p>
								</div>
							)}
						</>
					)}
				</div>
			</div>

			{productToShare && (
				<ShareProductDialog
					open={shareDialogOpen}
					onOpenChange={(open) => {
						setShareDialogOpen(open)
						if (!open) setProductToShare(null)
					}}
					productId={getProductId(productToShare) || productToShare.id}
					pubkey={productToShare.pubkey}
					title={getProductTitle(productToShare)}
					onPost={publishShareProductNote}
				/>
			)}

			<ConfirmDialog
				open={pendingDeleteProduct !== null}
				onOpenChange={(open) => {
					if (!open && !deleteMutation.isPending) setPendingDeleteProduct(null)
				}}
				title="Delete product?"
				description={pendingDeleteProduct ? `Are you sure you want to delete "${getProductTitle(pendingDeleteProduct)}"?` : undefined}
				confirmLabel="Delete"
				destructive
				isPending={deleteMutation.isPending}
				onConfirm={() => {
					if (pendingDeleteProduct) {
						const productDTag = getProductId(pendingDeleteProduct)
						if (productDTag) {
							deleteMutation.mutate(productDTag)
						}
					}
				}}
			/>
		</div>
	)
}
