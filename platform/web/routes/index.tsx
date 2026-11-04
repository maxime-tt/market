import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { RelayIndicator, DeadSearchError } from '@ui/browse/list-views'
import { ProductCard, ProductStrip } from '@ui/browse/product-card'
import { AccountPane } from '@ui/browse/account-pane'
import { EmptyState, LoadingState, ErrorState } from '@ui/shared'
import { useBrowseSearch, useBrowseProductDetail } from '@platform/web/browse/browseQuery'
import type { BrowseProduct } from '@platform/web/browse/browseQuery'

/**
 * URL state: ?q=&tag=&p=
 *
 * q — search query string
 * tag — product category/hashtag filter
 * p — open product event id (resolves into right-hand panel in Phase 2)
 */
const browseSearchSchema = z.object({
	q: z.string().default(''),
	tag: z.string().optional(),
	p: z.string().optional(),
})
type BrowseSearch = z.infer<typeof browseSearchSchema>

export const Route = createFileRoute('/')({
	component: BrowseIndex,
	validateSearch: browseSearchSchema,
	beforeLoad: () => {
		// Redirect legacy hero/featured URLs to the browse assembly
		throw redirect({ to: '/', search: { q: '', p: undefined } })
	},
})

function BrowseIndex() {
	const navigate = useNavigate()
	const { q, tag, p } = Route.useSearch()
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
	const [accountOpen, setAccountOpen] = useState(false)

	// Search/results stream (never fetch a list — use stream)
	const searchQuery = useBrowseSearch(q, tag, 100)
	const products = searchQuery.data ?? []

	// Open product detail (fetch for single entity — justified: one product by id)
	const detailQuery = p ? useBrowseProductDetail(p) : null

	// ── Panel seam ─────────────────────────────────────────────────────────
	// Phase 2: render the right-hand split-view panel here when p is set.
	// The open product resolves from the right-hand panel.
	const openProduct = p && detailQuery?.data?.[0] ? detailQuery.data[0] : undefined
	// ───────────────────────────────────────────────────────────────────────

	// Dead search (all relays failed)
	const isDeadSearch = searchQuery.isError && products.length === 0

	const handleSearchChange = (value: string) => {
		navigate({ search: (prev: BrowseSearch) => ({ ...prev, q: value, p: undefined }) })
	}

	const handleSearchGo = () => {
		// Force navigation with current q value
		navigate({ search: (prev: BrowseSearch) => ({ ...prev, p: undefined }) })
	}

	const handleCardSelect = (id: string) => {
		navigate({ search: (prev: BrowseSearch) => ({ ...prev, p: id }) })
	}

	const handleMenuToggle = (id: string) => {
		setMenuOpenId((prev) => (prev === id ? null : id))
	}

	return (
		<div className="min-h-screen bg-background">
			{/* Browse nav */}
			<BrowseNav
				active={true}
				onNavigateHome={() => navigate({ search: { q: '', tag: undefined, p: undefined } })}
				onNavigateFeatured={() => {}}
				searchSlot={
					<SearchField
						value={q}
						onChange={handleSearchChange}
						onGo={handleSearchGo}
					/>
				}
				accountSlot={
					<button
						type="button"
						data-slot="account-trigger"
						className="flex items-center gap-2 text-sm text-text-mid cursor-pointer"
						onClick={() => setAccountOpen((v) => !v)}
					>
						<div className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">M</div>
						Maxime
					</button>
				}
			/>

			{/* Main content */}
			<main className="max-w-[1040px] mx-auto px-4 py-4">
				{/* Relay indicator */}
				{products.length > 0 && (
					<div className="mb-4">
						<RelayIndicator
							responded={products.length}
							totalProducts={products.length}
						/>
					</div>
				)}

				{/* Dead search error */}
				{isDeadSearch && (
					<DeadSearchError
						totalRelays={3}
						timeoutCount={3}
						refusedCount={0}
						message="All relays failed. Check your connection and try again."
					/>
				)}

				{/* Results grid or empty/loading/error state */}
				{searchQuery.isLoading ? (
					<LoadingState variant="skeleton" rows={8} />
				) : searchQuery.isError && !isDeadSearch ? (
					<ErrorState title="Search failed" message={searchQuery.error?.message} />
				) : products.length === 0 && !searchQuery.isLoading ? (
					<EmptyState
						title="No products found"
						description="Try a different search or clear the filter."
					/>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{products.map((product) => (
							<ProductCard
								key={product.id}
								id={product.id}
								title={product.title}
								seller={product.pubkey.slice(0, 8)}
								sellerPubkey={product.pubkey}
								price={product.price ?? 0}
								stockNote={product.stock}
								material="m1"
								onSelect={handleCardSelect}
								onThreeDots={() => handleMenuToggle(product.id)}
								menuOpen={menuOpenId === product.id}
								onAddToList={() => {}}
								onCopyLink={() => {}}
								onReport={() => {}}
							/>
						))}
					</div>
				)}
			</main>

			{/* Account pane (floating right panel) */}
			{accountOpen && (
				<div className="fixed top-16 right-0 z-40">
					<AccountPane
						name="Maxime"
						npub="npub1q…7f3k"
						avatarInitial="M"
						signedInWith="Signed in with extension signer, remote signer or nsec"
						balance={128400}
						onTopUp={() => {}}
						onWithdraw={() => {}}
						onTransactions={() => {}}
						onConnectNWC={() => {}}
						onOrders={() => {}}
						onNotifications={() => {}}
						onSavedLists={() => {}}
						onSignOut={() => {}}
					/>
				</div>
			)}
		</div>
	)
}
