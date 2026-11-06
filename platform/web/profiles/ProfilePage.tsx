/**
 * platform/web/profiles/ProfilePage.tsx — the seller profile page.
 *
 * Redesigned onto the `YcjyRPZbVo__seller-profile-1440` frame (Browse Phase 3):
 * the seller header (avatar, name + primary category, npub, reputation facts,
 * ships-from, affordances) over the seller's listings, with the relay verdict
 * the read seam actually returned above the header.
 *
 * Where each of the frame's values comes from — and the two it cannot have:
 *
 * - name / category / avatar  kind-0 profile read; the category is the most
 *                             common real `t` tag across the seller's listings
 * - npub                      the pubkey encoder host
 * - listings                  the SDK read seam's kind-30402 stream for this
 *                             author (a list is a stream, never a `fetch`)
 * - ships-from                the author's own `location` tag — listing first,
 *                             shipping option second
 * - reputation                the kind-0 event's `created_at`, and nothing
 *                             else. The frame's "N trades" is not readable in
 *                             this deployment (orders are gift-wrapped to the
 *                             seller) and "N sats zapped" has no receipt read,
 *                             so both are omitted rather than invented.
 * - Follow                    omitted. The seam has no contact-list (NIP-02)
 *                             read or write, so the control could only be a
 *                             no-op. Contact is real and is wired below.
 */

import { PickupLocationDialog } from '@ui/dialogs/pickup-location-dialog'
import { ShareProfileDialog } from '@platform/web/profiles/ShareProfileDialog'
import { EntityActionsMenu } from '@platform/web/permissions/EntityActionsMenu'
import { SellerProfileView } from '@ui/browse/seller-profile'
import { ProductCard } from '@ui/browse/product-card'
import { RelayIndicator } from '@ui/browse/relay-error'
import { SkeletonGrid } from '@ui/browse/skeleton-grid'
import { EmptyState } from '@ui/shared/empty-state'
import { Button } from '@ui/primitives/button'
import { ZapButtonHost as ZapButton } from '@platform/web/payments/ZapButtonHost'
import { getActiveSignerCapability, useAuth } from '@platform/web/auth/authStore'
import { useEntityPermissions } from '@platform/web/permissions/useEntityPermissions'
import { getHexColorFingerprintFromHexPubkey } from '@platform/web/utils/colors'
import { formatPubkeyShort } from '@sdk/core/nostr/pubkeyDisplay'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { ndkActions } from '@platform/web/ndk/ndkStore'
import { productFormActions } from '@platform/web/products/productFormStore'
import { uiActions } from '@platform/web/app/uiStore'
import { addToBlacklist, removeFromBlacklist } from '@platform/web/config/blacklistPublish'
import { addToFeaturedUsers, removeFromFeaturedUsers } from '@platform/web/featured/featuredPublish'
import { useBlacklistSettings } from '@platform/web/config/blacklistBinding'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useFeaturedUsers } from '@platform/web/featured/featuredQueries'
import { useSellerListings } from '@platform/web/browse/browseQuery'
import { materialForPubkey } from '@platform/web/browse/browseProductMap'
import {
	useShippingOptionsByPubkey,
	getShippingLocation,
	getShippingPickupAddress,
	getShippingService,
	getShippingTitle,
} from '@platform/web/shipping/shippingQuery'
import {
	getNormalizedProfileDisplayName,
	getNormalizedProfilePicture,
	profileByIdentifierQueryOptions,
} from '@platform/web/profiles/profileQuery'
import { encodeIdentifierToNpub } from '@platform/web/profiles/userCardHosts'
import { getProfileIdentifierValidationError } from '@sdk/core/profile/profileValidation'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Edit, MapPin, Plus, RotateCcw, Share2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { TooltipButton } from '@ui/wrappers/tooltip-button'

interface ProfilePageProps {
	profileId: string
}

/** The profile event's own date, as the frame's "joined Mar 2024". */
const JOINED_LABEL = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })

export function ProfilePage({ profileId }: ProfilePageProps) {
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { user: viewer } = useAuth()
	const validationError = getProfileIdentifierValidationError(profileId)

	const profileOptions = profileByIdentifierQueryOptions(profileId)
	const {
		data: profileData,
		isFetching: profileIsFetching,
		isLoading: profileIsLoading,
		isError: profileIsError,
		error: profileError,
		refetch: refetchProfile,
	} = useQuery({
		...profileOptions,
		enabled: profileOptions.enabled && !validationError,
		// Profile metadata is slow-changing. Transient fetch failures reject,
		// so React Query retains previously cached data rather than committing
		// a null-shaped success. keepPreviousData preserves observer data while
		// switching query keys.
		//
		// Window-focus refetching is disabled. The default reconnect policy
		// covers browser online/offline recovery only; it does not observe NDK
		// relay readiness. Initial failures remain recoverable through normal
		// retries and the manual Try again action below.
		placeholderData: keepPreviousData,
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	})
	const { profile, user } = profileData || {}

	const profilePubkey = useMemo(() => {
		try {
			const pubkey = user?.pubkey
			return pubkey && isValidHexKey(pubkey) ? pubkey : null
		} catch {
			return null
		}
	}, [user])

	// The seller's listings: the read seam's stream for this author, carrying
	// the relay verdict the frame's status line reports.
	const { data: listingsData, isLoading: listingsAreLoading } = useSellerListings(profilePubkey ?? '')
	const listings = useMemo(() => listingsData?.listings ?? [], [listingsData])
	const eoseRelays = listingsData?.eose ?? []
	const pendingRelays = listingsData?.pending ?? []

	const [shareDialogOpen, setShareDialogOpen] = useState(false)
	const [pickupLocationDialogOpen, setPickupLocationDialogOpen] = useState(false)

	// Get app config
	const { data: config } = useConfigQuery()
	const appPubkey = config?.appPublicKey || ''

	// Get entity permissions
	const permissions = useEntityPermissions(profilePubkey ?? undefined)

	// Get blacklist and featured status
	const { data: blacklistSettings } = useBlacklistSettings(appPubkey)
	const { data: featuredData } = useFeaturedUsers(appPubkey)

	const isBlacklisted = !!profilePubkey && (blacklistSettings?.blacklistedPubkeys.includes(profilePubkey) || false)
	const isFeatured = !!profilePubkey && (featuredData?.featuredUsers.includes(profilePubkey) || false)

	// Get vendor's shipping options to check for pickup locations
	const { data: shippingOptions } = useShippingOptionsByPubkey(profilePubkey ?? '')

	// Find all pickup shipping options with addresses
	const pickupLocations = useMemo(() => {
		if (!shippingOptions) return []

		const locations: Array<{
			name: string
			address: {
				street: string
				city: string
				state: string
				postalCode: string
				country: string
			}
		}> = []

		for (const option of shippingOptions) {
			const serviceTag = getShippingService(option)
			if (serviceTag && serviceTag[1] === 'pickup') {
				const address = getShippingPickupAddress(option)
				if (address && (address.street || address.city)) {
					locations.push({
						name: getShippingTitle(option),
						address,
					})
				}
			}
		}
		return locations
	}, [shippingOptions])

	const isSelf = !!viewer?.pubkey && viewer.pubkey === profilePubkey
	const displayName = getNormalizedProfileDisplayName(profile) ?? (profilePubkey ? formatPubkeyShort(profilePubkey) : 'Profile')
	const npub = encodeIdentifierToNpub(profilePubkey ?? undefined) ?? undefined

	/**
	 * The frame's reputation line — filled only as far as the reads reach.
	 * The kind-0 event's own `created_at` is the one reputation fact this
	 * deployment can read; trades and zapped sats have no readable source.
	 */
	const reputationFacts = useMemo(() => {
		const createdAt = profile?.created_at
		if (typeof createdAt !== 'number' || createdAt <= 0) return []
		return [`Joined ${JOINED_LABEL.format(new Date(createdAt * 1000))}`]
	}, [profile?.created_at])

	/** The seller's primary category: the most common real `t` tag across their listings. */
	const primaryCategory = useMemo(() => {
		const counts = new Map<string, number>()
		for (const listing of listings) {
			for (const category of listing.categories) counts.set(category, (counts.get(category) ?? 0) + 1)
		}
		const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		return ranked[0]?.[0]
	}, [listings])

	/**
	 * "Ships from": the author's own location string — their listings first,
	 * their shipping options second. Absent when they published neither, in
	 * which case the header shows no origin at all.
	 */
	const shipsFrom = useMemo(() => {
		const fromListing = listings.find((listing) => listing.location)?.location
		if (fromListing) return fromListing
		return shippingOptions?.map((option) => getShippingLocation(option)?.[1]).find((value) => Boolean(value)) ?? undefined
	}, [listings, shippingOptions])

	// Handle edit profile
	const handleEdit = () => {
		navigate({ to: '/dashboard/account/profile' })
	}

	// Handle add product
	const handleAddProduct = () => {
		productFormActions.reset()
		navigate({ to: '/dashboard/products/products/new' })
	}

	// Handle message button
	const handleMessageClick = () => {
		if (!profilePubkey) return
		uiActions.openConversation(profilePubkey)
	}

	// A listing opens its own page — the event id is what the product read
	// addresses it by, not the addressable `d` identifier.
	const handleListingSelect = (eventId: string) => {
		navigate({ to: '/products/$productId', params: { productId: eventId } })
	}

	// Handle blacklist toggle
	const handleBlacklistToggle = async () => {
		if (!profilePubkey) return

		const ndk = ndkActions.getNDK()
		// A3.5: the signer is the active capability (the curation family takes
		// it), not NDK's instance signer.
		const signer = getActiveSignerCapability()
		if (!ndk || !signer) {
			toast.error('Please connect your wallet first')
			return
		}

		try {
			if (isBlacklisted) {
				await removeFromBlacklist(profilePubkey, signer, ndk, appPubkey)
				toast.success('User removed from blacklist')
			} else {
				await addToBlacklist(profilePubkey, signer, ndk, appPubkey)
				toast.success('User added to blacklist')
			}
			// Invalidate blacklist query to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['blacklist'] })
		} catch (error) {
			console.error('Blacklist toggle error:', error)
			toast.error('Failed to update blacklist')
		}
	}

	// Handle featured toggle
	const handleFeaturedToggle = async () => {
		if (!profilePubkey) return

		const ndk = ndkActions.getNDK()
		// A3.5: same capability switch as the blacklist toggle above.
		const signer = getActiveSignerCapability()
		if (!ndk || !signer) {
			toast.error('Please connect your wallet first')
			return
		}

		try {
			if (isFeatured) {
				await removeFromFeaturedUsers(profilePubkey, signer, ndk, appPubkey)
				toast.success('User removed from featured')
			} else {
				await addToFeaturedUsers(profilePubkey, signer, ndk, appPubkey)
				toast.success('User added to featured')
			}
			// Invalidate featured query to refresh the UI
			queryClient.invalidateQueries({ queryKey: ['featured'] })
		} catch (error) {
			console.error('Featured toggle error:', error)
			toast.error('Failed to update featured status')
		}
	}

	// Transport error: the query failed (timeout, disconnect, relay
	// exception) on initial load with no cached profile to show. This is
	// distinct from metadata not observed (below) — it is retryable. When a
	// background refetch fails after a successful load, keepPreviousData
	// retains the profile and `profile` stays non-null, so this does not
	// fire and the profile remains visible (covered by profilesFetch.test.ts
	// QueryClient test).
	const profileTransportError = !validationError && !profileIsLoading && !profileIsFetching && profileIsError && !profile
	// Metadata not observed: the query succeeded (no error) but no kind-0 metadata
	// was observed from the configured relays for this user.
	const profileNotFoundError = !validationError && !profileIsLoading && !profileIsFetching && !profileIsError && !profile
	const invalidResolvedPubkeyError =
		!validationError && !profileIsLoading && !profileIsFetching && !profileIsError && !!user && !profilePubkey
	const errorMessage =
		validationError ??
		(profileTransportError
			? `Could not load this profile: ${profileError instanceof Error ? profileError.message : 'the relay may be unreachable or still connecting'}. Please try again.`
			: null) ??
		(invalidResolvedPubkeyError ? 'This profile resolved to an invalid pubkey.' : null) ??
		(profileNotFoundError ? 'No profile metadata was observed from the configured relays for this user.' : null)

	// Only transport errors are retryable; metadata not observed and invalid
	// identifiers are settled states.
	const canRetry = profileTransportError

	const errorTitle = validationError
		? 'Invalid profile identifier'
		: profileTransportError
			? 'Could not load user profile'
			: invalidResolvedPubkeyError
				? 'Invalid profile'
				: 'Profile not found'

	if (errorMessage) {
		return (
			<ProfileErrorState
				title={errorTitle}
				message={errorMessage}
				gradientColor={profilePubkey ? getHexColorFingerprintFromHexPubkey(profilePubkey) : undefined}
				onRetry={canRetry ? () => refetchProfile() : undefined}
			/>
		)
	}

	if (!profilePubkey || (!profileData && (profileIsLoading || profileIsFetching))) {
		return <ProfileLoadingState />
	}

	// Host-owned actions beside the frame's Contact affordance: the controls
	// this page already carried (curation, share, pickup, edit), so the
	// redesign adds the frame without dropping what only this page offers.
	const affordances = (
		<>
			{user && <ZapButton event={user} />}
			{pickupLocations.length > 0 && (
				<TooltipButton variant="outline" size="icon" tooltip="Pickup locations" onClick={() => setPickupLocationDialogOpen(true)}>
					<MapPin className="size-4" />
				</TooltipButton>
			)}
			<TooltipButton variant="outline" size="icon" tooltip="Share" onClick={() => setShareDialogOpen(true)}>
				<Share2 className="size-4" />
			</TooltipButton>
			{permissions.canEdit && (
				<Button variant="outline" onClick={handleEdit} className="rounded-full">
					<Edit className="size-4" />
					Edit profile
				</Button>
			)}
			<EntityActionsMenu
				permissions={permissions}
				entityType="profile"
				entityId={profilePubkey}
				isBlacklisted={isBlacklisted}
				isFeatured={isFeatured}
				onEdit={permissions.canEdit ? handleEdit : undefined}
				onBlacklist={permissions.canBlacklist && !isBlacklisted ? handleBlacklistToggle : undefined}
				onUnblacklist={permissions.canBlacklist && isBlacklisted ? handleBlacklistToggle : undefined}
				onSetFeatured={permissions.canSetFeatured && !isFeatured ? handleFeaturedToggle : undefined}
				onUnsetFeatured={permissions.canSetFeatured && isFeatured ? handleFeaturedToggle : undefined}
			/>
		</>
	)

	const relayStatus =
		profilePubkey && !listingsAreLoading ? (
			<RelayIndicator
				responded={eoseRelays.length}
				totalProducts={listings.length}
				productsLabel="products from this seller"
				relays={[
					...eoseRelays.map((relay) => ({ relay, status: 'responded' as const })),
					...pendingRelays.map((relay) => ({ relay, status: 'pending' as const })),
				]}
			/>
		) : undefined

	return (
		<div className="flex min-h-screen flex-col pb-10">
			<SellerProfileView
				status={relayStatus}
				name={displayName}
				picture={getNormalizedProfilePicture(profile) || null}
				category={primaryCategory}
				npub={npub}
				facts={reputationFacts}
				shipsFrom={shipsFrom}
				onContact={isSelf ? undefined : handleMessageClick}
				affordances={affordances}
				isLoading={profileIsLoading}
				loading={listingsAreLoading ? <SkeletonGrid rows={6} columns={3} /> : undefined}
				empty={
					!listingsAreLoading && listings.length === 0 ? (
						<EmptyState
							title="No listings yet"
							description={isSelf ? 'Listings you publish appear here.' : 'This seller has nothing listed right now.'}
							action={
								permissions.canEdit ? (
									<Button onClick={handleAddProduct}>
										<Plus className="size-4" />
										Add your first listing
									</Button>
								) : undefined
							}
						/>
					) : undefined
				}
			>
				{listings.map((listing) => (
					<ProductCard
						key={listing.id}
						id={listing.id}
						title={listing.title}
						category={listing.categories[0]}
						seller={listing.location ? `${displayName} · ships from ${listing.location}` : displayName}
						sellerPubkey={listing.pubkey}
						price={listing.price}
						stockNote={listing.stock}
						material={materialForPubkey(listing.pubkey)}
						onSelect={() => handleListingSelect(listing.eventId)}
					/>
				))}
			</SellerProfileView>

			<ShareProfileDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen} pubkey={profilePubkey} profileName={profile?.name} />

			{pickupLocations.length > 0 && (
				<PickupLocationDialog
					open={pickupLocationDialogOpen}
					onOpenChange={setPickupLocationDialogOpen}
					locations={pickupLocations}
					vendorName={profile?.name}
				/>
			)}
		</div>
	)
}

function ProfileLoadingState() {
	return (
		<div className="relative flex flex-col min-h-screen">
			<div className="z-10 relative flex flex-1 justify-center items-center px-4 text-center">
				<div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
				<p className="ml-4 text-sm text-text-mid">Loading profile...</p>
			</div>
		</div>
	)
}

interface ProfileErrorStateProps {
	title: string
	message: string
	gradientColor?: string
	onRetry?: () => void
}

function ProfileErrorState({ title, message, gradientColor = 'var(--surface-sunken)', onRetry }: ProfileErrorStateProps) {
	return (
		<div className="relative flex flex-col min-h-screen">
			<div className="z-10 relative flex flex-1 items-center px-4">
				<div className="mx-auto w-full max-w-3xl rounded-lg border border-border-default bg-surface-raised p-8 text-center">
					<div className="mx-auto mb-4 size-12 rounded-full" style={{ background: gradientColor }} aria-hidden="true" />
					<h1 className="text-2xl font-semibold text-text-high">{title}</h1>
					<p className="mt-3 text-sm text-text-mid">{message}</p>
					{onRetry && (
						<Button onClick={onRetry} className="mt-6" variant="secondary">
							<RotateCcw className="w-4 h-4 mr-2" />
							Try again
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}
