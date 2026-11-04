import { useState } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductCard } from '@ui/browse/product-card'
import { EmptyState } from '@ui/shared/empty-state'
import { LoadingState } from '@ui/shared/loading-state'
import { ErrorState } from '@ui/shared/error-state'
import { useBrowseSearch } from '@platform/web/browse/browseQuery'
import { useAuth } from '@platform/web/auth/authStore'

/** The Browse URL state the host asks the route to write back. */
export interface BrowseSearchState {
	q?: string
	tag?: string
	p?: string
}

interface BrowseIndexHostProps {
	q: string
	tag: string | undefined
	onNavigate: (search: BrowseSearchState) => void
	onNavigateFeatured: () => void
}

/**
 * Host that wires the Browse shell to real reads. The route
 * (platform/web/routes/index.tsx) composes it.
 *
 * Phase-2 surfaces are deliberately absent: the account pane, the relay
 * indicator, the wallet balance, the card context-menu actions and the `?p=`
 * split view. The account affordance renders the signed-in identity read-only.
 * `browseProductDetailQueryOptions` in ./browseQuery is the seam the panel lane
 * consumes when it fills the split view.
 */
export function BrowseIndexHost({ q, tag, onNavigate, onNavigateFeatured }: BrowseIndexHostProps) {
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

	const { user } = useAuth()

	const searchQuery = useBrowseSearch(q, tag, 100)
	const products = searchQuery.data ?? []

	const handleSearchChange = (value: string) => {
		onNavigate({ q: value, p: undefined, tag: tag ?? undefined })
	}

	const handleSearchGo = () => {
		onNavigate({ q, p: undefined, tag: tag ?? undefined })
	}

	const handleCardSelect = (id: string) => {
		onNavigate({ q, p: id, tag: tag ?? undefined })
	}

	const handleMenuToggle = (id: string) => {
		setMenuOpenId((prev) => (prev === id ? null : id))
	}

	/** Deterministic material class from a pubkey hash. */
	const materialForPubkey = (pubkey: string): 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7' | 'm8' => {
		const hash = pubkey.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
		return `m${(hash % 8) + 1}` as 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7' | 'm8'
	}

	/** The signed-in pubkey's initial, or nothing when signed out. */
	const accountInitial = user?.pubkey ? user.pubkey.slice(0, 2).toUpperCase() : undefined

	return (
		<div className="min-h-screen bg-background">
			<BrowseNav
				active={true}
				onNavigateHome={() => onNavigate({ q: '', p: undefined, tag: undefined })}
				onNavigateFeatured={onNavigateFeatured}
				searchSlot={<SearchField value={q} onChange={handleSearchChange} onGo={handleSearchGo} />}
				accountSlot={
					accountInitial ? (
						<span data-slot="account-trigger" className="flex items-center gap-2 text-sm text-text-mid" title="Account">
							<span className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">
								{accountInitial}
							</span>
							{/* The account pane itself is a Phase-2 surface. */}
						</span>
					) : null
				}
			/>

			<main className="max-w-[1040px] mx-auto px-4 py-4">
				{searchQuery.isLoading ? (
					<LoadingState variant="skeleton" rows={8} />
				) : searchQuery.isError ? (
					<ErrorState title="Search failed" message={searchQuery.error?.message} />
				) : products.length === 0 ? (
					<EmptyState title="No products found" description="Try a different search or clear the filter." />
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{products.map((product) => (
							<ProductCard
								key={product.id}
								id={product.id}
								title={product.title}
								seller={product.pubkey.slice(0, 8)}
								sellerPubkey={product.pubkey}
								price={typeof product.price === 'number' ? product.price : 0}
								stockNote={typeof product.stock === 'string' ? product.stock : undefined}
								material={materialForPubkey(product.pubkey)}
								onSelect={handleCardSelect}
								onThreeDots={() => handleMenuToggle(product.id)}
								menuOpen={menuOpenId === product.id}
							/>
						))}
					</div>
				)}
			</main>
		</div>
	)
}
