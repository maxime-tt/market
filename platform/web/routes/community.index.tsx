import { createFileRoute } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ItemGrid } from '@ui/components/ItemGrid'
import { Button } from '@ui/primitives/button'
import { CollectionSkeletons, MerchantSkeletons } from '@ui/community/community-skeletons'
import { ErrorState } from '@ui/shared/error-state'
import { uiActions } from '@/lib/stores/ui'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { heroBackgroundStyle } from '@platform/web/app/heroBackground'
import { useState, useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import {
	collectionsQueryOptions,
	collectionByATagQueryOptions,
	useCollectionTitle,
	useCollectionImages,
	getCollectionTitle,
	getCollectionId,
} from '@/queries/collections'
import { CollectionCard } from '@/components/CollectionCard'
import { useV4VMerchants } from '@/queries/v4v'
import { FeaturedUserCard } from '@/components/FeaturedUserCard'
import { blacklistStore } from '@/lib/stores/blacklist'
import { filterBlacklistedPubkeys } from '@/lib/utils/blacklistFilters'
import { useConfigQuery } from '@/queries/config'
import { useFeaturedCollections } from '@/queries/featured'
import type { NDKEvent } from '@nostr-dev-kit/ndk'

// Hook to fetch featured collection events using useQueries
function useFeaturedCollectionEvents(featuredCollections: string[] | undefined) {
	const queries = (featuredCollections || []).map((collectionCoords) => {
		const [, pubkey, dTag] = collectionCoords.split(':')
		return {
			...collectionByATagQueryOptions(pubkey, dTag),
			enabled: !!(pubkey && dTag),
		}
	})

	const results = useQueries({ queries })

	// Filter out loading and null collections, return only loaded collections
	return results
		.filter((result) => !result.isLoading && result.data)
		.map((result) => result.data as NDKEvent)
		.filter((collection) => {
			// Only include collections with images
			return collection.tags.some((tag: string[]) => tag[0] === 'image' && tag[1])
		})
}

export const Route = createFileRoute('/community/')({
	component: CommunityRoute,
})

function CommunityRoute() {
	const collectionsQuery = useQuery(collectionsQueryOptions)
	const collections = collectionsQuery.data || []
	const isLoadingCollections = collectionsQuery.isLoading
	const collectionsError = collectionsQuery.error

	const merchantsQuery = useV4VMerchants()
	const merchantPubkeys = merchantsQuery.data || []
	const isLoadingMerchants = merchantsQuery.isLoading
	const merchantsError = merchantsQuery.error

	// Subscribe to blacklist store for reactive updates when blacklist changes
	useStore(blacklistStore)
	// Filter out blacklisted merchants
	const filteredMerchantPubkeys = filterBlacklistedPubkeys(merchantPubkeys)

	// Fetch featured collections for slides
	const { data: config, isLoading: isLoadingConfig } = useConfigQuery()
	const { data: featuredCollectionsData, isLoading: isLoadingFeatured } = useFeaturedCollections(config?.appPublicKey || '')
	const featuredCollectionEvents = useFeaturedCollectionEvents(featuredCollectionsData?.featuredCollections)
	const isFeaturedLoading = isLoadingConfig || isLoadingFeatured

	const { isAuthenticated } = useStore(authStore)
	const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

	// Touch/swipe handling
	const touchStartX = useRef<number>(0)
	const touchEndX = useRef<number>(0)
	const minSwipeDistance = 50

	// Use featured collections for slides, fallback to recent collections only after featured data has loaded
	const collectionsForSlides =
		featuredCollectionEvents.length > 0
			? featuredCollectionEvents
			: isFeaturedLoading
				? [] // Don't flash generic collections while featured are still loading
				: collections
						.filter((collection: NDKEvent) => {
							return collection.tags.some((tag: string[]) => tag[0] === 'image' && tag[1])
						})
						.slice(0, 4)

	const totalSlides = 1 + collectionsForSlides.length // Homepage + collections

	// Auto-slide functionality - change slide every 8 seconds
	useEffect(() => {
		if (totalSlides <= 1) return // Don't auto-slide if there's only one slide

		const interval = setInterval(() => {
			setCurrentSlideIndex((prev) => (prev + 1) % totalSlides)
		}, 8000) // 8 seconds

		return () => clearInterval(interval)
	}, [totalSlides])

	// Current slide data - homepage banner is index 0
	const isHomepageSlide = currentSlideIndex === 0
	const currentCollection = isHomepageSlide ? null : collectionsForSlides[currentSlideIndex - 1]
	const currentCollectionId = currentCollection ? getCollectionId(currentCollection) : undefined

	// Get current collections data (only if not homepage slide)
	const { data: currentTitle } = useCollectionTitle(currentCollectionId || '')
	const { data: currentImages = [] } = useCollectionImages(currentCollectionId || '')

	// Get the actual title from the collection or fallback to empty string to avoid "Latest Collection"
	const displayTitle = currentTitle || (currentCollection ? getCollectionTitle(currentCollection) : '')

	// Get background image from current collection (only if not homepage slide)
	const backgroundImageUrl = !isHomepageSlide && currentImages.length > 0 ? currentImages[0][1] : ''

	// Use the market image for homepage background instead of random collection
	const marketBackgroundImageUrl = '/images/market-background.jpg'

	const handleStartSelling = () => {
		if (isAuthenticated) {
			uiActions.openDrawer('createCollection')
		} else {
			uiActions.openDialog('login')
		}
	}

	const handleDotClick = (index: number) => {
		setCurrentSlideIndex(index)
	}

	// Touch event handlers for swipe functionality
	const handleTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.targetTouches[0].clientX
	}

	const handleTouchMove = (e: React.TouchEvent) => {
		touchEndX.current = e.targetTouches[0].clientX
	}

	const handleTouchEnd = () => {
		if (!touchStartX.current || !touchEndX.current) return

		const distance = touchStartX.current - touchEndX.current
		const isLeftSwipe = distance > minSwipeDistance
		const isRightSwipe = distance < -minSwipeDistance

		if (isLeftSwipe && currentSlideIndex < totalSlides - 1) {
			// Swipe left - go to next slide
			setCurrentSlideIndex((prev) => prev + 1)
		}

		if (isRightSwipe && currentSlideIndex > 0) {
			// Swipe right - go to previous slide
			setCurrentSlideIndex((prev) => prev - 1)
		}

		// Reset touch positions
		touchStartX.current = 0
		touchEndX.current = 0
	}

	// Render homepage hero content
	const renderHomepageHero = () => (
		<div className="z-20 relative flex flex-col justify-center items-center lg:col-span-2 mt-16 lg:mt-0 text-white text-center">
			<div className="flex justify-center items-center h-24 lg:h-32">
				<h1 className="font-theylive text-4xl lg:text-5xl transition-opacity duration-500">Browse Collections</h1>
			</div>

			<div className="flex flex-col gap-6 items-center">
				<Button variant="secondary" size="lg" onClick={handleStartSelling} className="bg-focus rounded hover:bg-focus-foreground-hover">
					<span className="flex items-center gap-2">
						<span className="size-6 i-nostr" />
						Start Selling
					</span>
				</Button>

				{/* Pagination dots */}
				{totalSlides > 1 && (
					<div className="flex justify-center gap-2">
						{Array.from({ length: totalSlides }).map((_, index) => (
							<button
								key={index}
								onClick={() => handleDotClick(index)}
								className={`w-3 h-3 rounded-full transition-all duration-300 ${
									index === currentSlideIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
								}`}
								aria-label={`View ${index === 1 ? 'homepage' : `collection ${index === 0 ? 1 : index}`}`}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)

	// Render collections hero content
	const renderCollectionsHero = () => (
		<div className="z-20 relative flex flex-col justify-center items-center lg:col-span-2 mt-16 lg:mt-0 text-white text-center">
			<div className="flex justify-center items-center h-24 lg:h-32">
				<h1 className="font-theylive text-4xl lg:text-5xl transition-opacity duration-500">{displayTitle || 'Loading...'}</h1>
			</div>

			<div className="flex flex-col gap-6">
				<Link to={`/collection/${currentCollectionId}`}>
					<Button variant="secondary" size="lg">
						View Collection
					</Button>
				</Link>

				{/* Pagination dots */}
				{totalSlides > 1 && (
					<div className="flex justify-center gap-2">
						{Array.from({ length: totalSlides }).map((_, index) => (
							<button
								key={index}
								onClick={() => handleDotClick(index)}
								className={`w-3 h-3 rounded-full transition-all duration-300 ${
									index === currentSlideIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
								}`}
								aria-label={`View ${index === 1 ? 'homepage' : `collection ${index === 0 ? 1 : index}`}`}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	)

	return (
		<div data-testid="community-page">
			{isHomepageSlide ? (
				// Homepage hero styling with random collection background
				<div
					data-testid="community-hero"
					className={`relative hero-container ${marketBackgroundImageUrl ? 'bg-hero-image' : 'bg-gray-700'}`}
					style={heroBackgroundStyle(marketBackgroundImageUrl)}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="z-10 absolute inset-0 bg-radial-overlay opacity-40" />
						<div className="z-10 absolute inset-0 bg-dots-overlay opacity-20" />
					</div>

					<div className="hero-content">{renderHomepageHero()}</div>
				</div>
			) : (
				// Collection hero styling (existing collection page style)
				<div
					data-testid="community-hero"
					className={`relative hero-container ${backgroundImageUrl ? 'bg-hero-image' : 'bg-gray-700'}`}
					style={heroBackgroundStyle(backgroundImageUrl)}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
				>
					<div className="hero-overlays">
						<div className="z-10 absolute inset-0 bg-radial-overlay opacity-40" />
						<div className="z-10 absolute inset-0 bg-dots-overlay opacity-20" />
					</div>

					<div className="hero-content">{renderCollectionsHero()}</div>
				</div>
			)}

			<div className="flex flex-col gap-12 px-4 py-4">
				<section aria-label="Community collections" data-testid="community-collections-section">
					<ItemGrid title="Collections">
						{isLoadingCollections ? (
							<CollectionSkeletons count={12} />
						) : collectionsError ? (
							<ErrorState
								title="Unable to load collections"
								message={collectionsError instanceof Error ? collectionsError.message : 'There was a problem connecting to relays.'}
								onRetry={() => collectionsQuery.refetch()}
								retryTestId="community-collections-retry"
								data-testid="community-collections-error"
							/>
						) : collections.length === 0 ? (
							<div className="col-span-full py-8 text-gray-500 text-center" data-testid="community-collections-empty">
								No collections found
							</div>
						) : (
							collections.map((collection) => (
								<div key={collection.id} data-testid="community-collection-card">
									<CollectionCard collection={collection} />
								</div>
							))
						)}
					</ItemGrid>
				</section>
				<section aria-label="Community merchants" data-testid="community-merchants-section">
					<ItemGrid title="Merchants" cols={2} smCols={2} lgCols={2} xlCols={3} gap={16}>
						{isLoadingMerchants ? (
							<MerchantSkeletons count={6} />
						) : merchantsError ? (
							<ErrorState
								title="Unable to load merchants"
								message={merchantsError instanceof Error ? merchantsError.message : 'There was a problem connecting to relays.'}
								onRetry={() => merchantsQuery.refetch()}
								retryTestId="community-merchants-retry"
								data-testid="community-merchants-error"
							/>
						) : filteredMerchantPubkeys.length === 0 ? (
							<div className="col-span-full py-8 text-gray-500 text-center" data-testid="community-merchants-empty">
								No merchants found
							</div>
						) : (
							filteredMerchantPubkeys.map((pubkey) => (
								<div key={pubkey} data-testid="community-merchant-card">
									<FeaturedUserCard userPubkey={pubkey} />
								</div>
							))
						)}
					</ItemGrid>
				</section>
			</div>
		</div>
	)
}
