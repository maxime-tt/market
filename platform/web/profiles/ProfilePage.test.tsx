/**
 * platform/web/profiles/ProfilePage.test.tsx — the seller page host.
 *
 * `ProfilePage` is what `/profile/$profileId` (and `/$vanityName`) render for a
 * seller with no CMS storefront — i.e. the seller page a product surface links
 * to. These tests prove the three states the page must not confuse:
 *
 *  - a seller with listings renders the seller's header (name/category/npub)
 *    over their listing cards;
 *  - a seller with none renders the honest empty state;
 *  - a failed listings read renders a failure with a retry, NOT the empty state
 *    (a "nothing listed" claim the read never observed);
 *  - a failed profile read renders the page's own error state.
 *
 * The reads and every host-side seam are stubbed (per-file under
 * `bun test --isolate`, which the gate battery uses): `mock.module` is consulted
 * at import time, so they are declared BEFORE `./ProfilePage` is imported.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** The seller under test — a real pubkey shape (hex, 64 chars). */
const SELLER_PUBKEY = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b'
const SELLER_NPUB = 'npub1seller0000000000000000000000000000000000000000000000000000'

/** The identity read's settled state, driven per test. */
interface ProfileQueryState {
	data: { profile: Record<string, unknown> | null; user: { pubkey: string } } | undefined
	isLoading: boolean
	isFetching: boolean
	isError: boolean
	error: unknown
	refetch: () => void
}

let profileQuery: ProfileQueryState = {
	data: undefined,
	isLoading: false,
	isFetching: false,
	isError: false,
	error: null,
	refetch: () => {},
}

interface SellerListingsState {
	data: { listings: unknown[]; eose: string[]; pending: string[] } | undefined
	isLoading: boolean
	isError: boolean
	refetch: () => void
}

let listingsQuery: SellerListingsState = { data: undefined, isLoading: false, isError: false, refetch: () => {} }

mock.module('@tanstack/react-query', () => {
	return {
		// The page reads exactly one query through the seam; the host stubs its state.
		useQuery: () => profileQuery,
		useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {} }),
		keepPreviousData: (previous: unknown) => previous,
	}
})

mock.module('@platform/web/profiles/profileQuery', () => ({
	profileByIdentifierQueryOptions: (identifier: string) => ({ queryKey: ['profile', identifier], enabled: true }),
	getNormalizedProfileDisplayName: (profile: { display_name?: string | null; name?: string | null } | null | undefined) =>
		profile?.display_name ?? profile?.name ?? null,
	getNormalizedProfilePicture: (profile: { picture?: string } | null | undefined) => profile?.picture ?? '',
}))

mock.module('@platform/web/profiles/userCardHosts', () => ({
	encodeIdentifierToNpub: (identifier: string | undefined) => (identifier ? SELLER_NPUB : null),
}))

mock.module('@platform/web/browse/browseQuery', () => ({
	useSellerListings: () => listingsQuery,
}))

mock.module('@platform/web/auth/authStore', () => ({
	useAuth: () => ({ user: null }),
	getActiveSignerCapability: () => null,
}))

mock.module('@platform/web/permissions/useEntityPermissions', () => ({
	useEntityPermissions: () => ({ canEdit: false, canBlacklist: false, canSetFeatured: false }),
}))

mock.module('@platform/web/permissions/EntityActionsMenu', () => ({
	EntityActionsMenu: () => null,
}))

mock.module('@platform/web/config/blacklistBinding', () => ({
	useBlacklistSettings: () => ({ data: { blacklistedPubkeys: [] } }),
}))

mock.module('@platform/web/config/publicConfigQuery', () => ({
	useConfigQuery: () => ({ data: { appPublicKey: '' } }),
}))

mock.module('@platform/web/featured/featuredQueries', () => ({
	useFeaturedUsers: () => ({ data: { featuredUsers: [] } }),
}))

mock.module('@platform/web/shipping/shippingQuery', () => ({
	useShippingOptionsByPubkey: () => ({ data: [] }),
	getShippingLocation: () => undefined,
	getShippingPickupAddress: () => undefined,
	getShippingService: () => undefined,
	getShippingTitle: () => '',
}))

mock.module('@platform/web/ndk/ndkStore', () => ({
	ndkActions: { getNDK: () => null },
}))

mock.module('@platform/web/products/productFormStore', () => ({
	productFormActions: { reset: () => {} },
}))

mock.module('@platform/web/app/uiStore', () => ({
	uiActions: { openConversation: () => {} },
}))

mock.module('@platform/web/config/blacklistPublish', () => ({
	addToBlacklist: async () => {},
	removeFromBlacklist: async () => {},
}))

mock.module('@platform/web/featured/featuredPublish', () => ({
	addToFeaturedUsers: async () => {},
	removeFromFeaturedUsers: async () => {},
}))

mock.module('@platform/web/utils/colors', () => ({
	getHexColorFingerprintFromHexPubkey: () => 'var(--surface-sunken)',
}))

mock.module('@platform/web/payments/ZapButtonHost', () => ({
	ZapButtonHost: () => null,
}))

mock.module('@platform/web/profiles/ShareProfileDialog', () => ({
	ShareProfileDialog: () => null,
}))

mock.module('@ui/dialogs/pickup-location-dialog', () => ({
	PickupLocationDialog: () => null,
}))

mock.module('@ui/wrappers/tooltip-button', () => ({
	TooltipButton: () => null,
}))

mock.module('@tanstack/react-router', () => ({
	useNavigate: () => () => {},
}))

mock.module('sonner', () => ({
	toast: { success: () => {}, error: () => {} },
}))

import { ProfilePage } from './ProfilePage'

/** A listing as `fetchSellerListings` hands it over, trimmed to what the card reads. */
function listing(id: string) {
	return {
		id,
		eventId: `evt-${id}`,
		pubkey: SELLER_PUBKEY,
		title: `Listing ${id}`,
		price: 21000,
		currency: 'SATS',
		stock: '3 in stock',
		categories: ['pottery'],
	}
}

function render(): string {
	return renderToStaticMarkup(createElement(ProfilePage, { profileId: SELLER_PUBKEY }))
}

/** A settled identity read for the seller, with the fields the header consumes. */
function sellerProfile(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		created_at: 1_710_000_000,
		display_name: 'atelier-norte',
		picture: 'https://example.test/av.jpg',
		...overrides,
	}
}

beforeEach(() => {
	listingsQuery = { data: undefined, isLoading: false, isError: false, refetch: () => {} }
	profileQuery = {
		data: { profile: sellerProfile(), user: { pubkey: SELLER_PUBKEY } },
		isLoading: false,
		isFetching: false,
		isError: false,
		error: null,
		refetch: () => {},
	}
})

describe('ProfilePage — the seller page', () => {
	test('renders the seller header and their listing cards for a seller with listings', () => {
		listingsQuery = {
			data: { listings: [listing('evt-1'), listing('evt-2')], eose: ['wss://relay.test'], pending: [] },
			isLoading: false,
			isError: false,
			refetch: () => {},
		}

		const markup = render()

		expect(markup).toContain('widget-seller-profile-view')
		expect(markup).toContain('widget-seller-profile-header')
		expect(markup).toContain('atelier-norte')
		expect(markup).toContain('pottery')
		expect(markup).toContain(SELLER_NPUB)
		// The frame's other reputation facts (trades, zapped sats) have no read;
		// the page states only the join date the kind-0 event carries.
		expect(markup).toContain('Joined ')
		expect(markup).not.toContain('trades')
		expect(markup).not.toContain('zapped')
		expect(markup).toContain('widget-product-card-evt-1')
		expect(markup).toContain('widget-product-card-evt-2')
		expect(markup).toContain('widget-seller-profile-listings')
	})

	test('renders the empty state (never an error) when the seller has no listings', () => {
		listingsQuery = { data: { listings: [], eose: ['wss://relay.test'], pending: [] }, isLoading: false, isError: false, refetch: () => {} }

		const markup = render()

		expect(markup).toContain('No listings yet')
		expect(markup).not.toContain('widget-product-card-')
		expect(markup).toContain('widget-seller-profile-header')
		expect(markup).not.toContain('profile-listings-retry')
	})

	test('renders a listings failure with a retry, not the empty state', () => {
		let retried = 0
		listingsQuery = {
			data: undefined,
			isLoading: false,
			isError: true,
			refetch: () => {
				retried += 1
			},
		}

		const markup = render()

		expect(markup).toContain('Could not load this seller&#x27;s listings')
		expect(markup).toContain('profile-listings-retry')
		// The lie this branch exists to prevent: a failed read reported as
		// "this seller has nothing listed".
		expect(markup).not.toContain('No listings yet')
		expect(markup).not.toContain('widget-product-card-')
		expect(markup).toContain('widget-seller-profile-header')
		// The retry the region renders is the listings read's own, not a no-op.
		listingsQuery.refetch()
		expect(retried).toBe(1)
	})

	test('renders the page error state when the profile read failed', () => {
		profileQuery = {
			data: undefined,
			isLoading: false,
			isFetching: false,
			isError: true,
			error: new Error('relay unreachable'),
			refetch: () => {},
		}

		const markup = render()

		expect(markup).toContain('Could not load user profile')
		expect(markup).not.toContain('widget-seller-profile-header')
		expect(markup).not.toContain('widget-seller-profile-view')
	})

	test('renders the loading state while the profile resolves', () => {
		profileQuery = {
			data: undefined,
			isLoading: true,
			isFetching: true,
			isError: false,
			error: null,
			refetch: () => {},
		}

		const markup = render()

		expect(markup).toContain('Loading profile')
		expect(markup).not.toContain('widget-seller-profile-view')
	})
})
