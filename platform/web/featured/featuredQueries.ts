/**
 * platform/web/featured/featuredQueries.ts — the React binding for the featured-list reads
 * (store drain D1, slice 4).
 *
 * The read model (`readFeaturedWorkflow`, newest list event over the app-relay `EventReadContext`) and
 * the parsers live framework-free in `sdk/commerce/curation`; the blacklist coordinate filters live in
 * `@sdk/config/blacklist`. This file owns the react-query hooks, the live invalidation subscription and
 * the port resolution — `createAppRelayReadContext` pins the read to the instance's main relay exactly
 * as the pre-drain `fetchLatestAppEvent`/`getAppRelaySet` pairing did. The query keys are
 * literal-identical to the pre-drain values. It sits beside the untouched D2 `featuredPublish.tsx`.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { filterBlacklistedCollectionCoords, filterBlacklistedProductCoords, filterBlacklistedPubkeys } from '@sdk/config/blacklist'
import {
	buildCurationListFilter,
	parseFeaturedAuctions,
	parseFeaturedCollections,
	parseFeaturedProducts,
	parseFeaturedUsers,
	readFeaturedWorkflow,
	type FeaturedListKey,
} from '@sdk/core/curation'
import { configKeys } from '@sdk/core/query/queryKeyFactory'
import { createAppRelayReadContext, getAppRelaySet } from '@platform/web/readContext'
import { getAppNdk } from '@platform/web/ndkPublishContext'

// The featured data shapes live in `sdk/commerce/curation`; re-exported under the names the pre-drain
// module used so no consumer has to reach into `src/lib/schemas/featured`.
export type {
	FeaturedAuctionsData as FeaturedAuctions,
	FeaturedCollectionsData as FeaturedCollections,
	FeaturedProductsData as FeaturedProducts,
	FeaturedUsersData as FeaturedUsers,
} from '@sdk/core/curation'

// --- DATA FETCHING FUNCTIONS ---

/**
 * Fetches featured products settings (kind 30405)
 * @param appPubkey The app's pubkey
 * @returns Featured products data or null
 */
export const fetchFeaturedProducts = async (appPubkey: string) => {
	const event = await readFeaturedWorkflow(createAppRelayReadContext(), 'featuredProducts', appPubkey)
	return event ? parseFeaturedProducts(event, filterBlacklistedProductCoords) : null
}

/**
 * Fetches featured collections settings (kind 30003)
 * @param appPubkey The app's pubkey
 * @returns Featured collections data or null
 */
export const fetchFeaturedCollections = async (appPubkey: string) => {
	const event = await readFeaturedWorkflow(createAppRelayReadContext(), 'featuredCollections', appPubkey)
	return event ? parseFeaturedCollections(event, filterBlacklistedCollectionCoords) : null
}

/**
 * Fetches featured auctions settings (kind 30409)
 * @param appPubkey The app's pubkey
 * @returns Featured auctions data or null
 */
export const fetchFeaturedAuctions = async (appPubkey: string) => {
	const event = await readFeaturedWorkflow(createAppRelayReadContext(), 'featuredAuctions', appPubkey)
	return event ? parseFeaturedAuctions(event, filterBlacklistedPubkeys) : null
}

/**
 * Fetches featured users settings (kind 30000)
 * @param appPubkey The app's pubkey
 * @returns Featured users data or null
 */
export const fetchFeaturedUsers = async (appPubkey: string) => {
	const event = await readFeaturedWorkflow(createAppRelayReadContext(), 'featuredUsers', appPubkey)
	return event ? parseFeaturedUsers(event, filterBlacklistedPubkeys) : null
}

// --- REACT QUERY HOOKS ---

const useFeaturedSettingsSubscription = (appPubkey: string, queryKey: readonly unknown[], list: FeaturedListKey) => {
	const queryClient = useQueryClient()
	const ndk = getAppNdk()

	useEffect(() => {
		if (!appPubkey || !ndk) return

		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(buildCurationListFilter(list, appPubkey), {
			closeOnEose: false,
			relaySet: getAppRelaySet(),
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
		})

		subscription.on('event', (event) => {
			const eventTime = event.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				void queryClient.invalidateQueries({ queryKey })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		return () => {
			subscription.stop()
		}
	}, [appPubkey, list, ndk, queryClient, queryKey])
}

/**
 * Hook to fetch featured products
 */
export const useFeaturedProducts = (appPubkey: string) => {
	const queryKey = configKeys.featuredProducts(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredProducts')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedProducts(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured collections
 */
export const useFeaturedCollections = (appPubkey: string) => {
	const queryKey = configKeys.featuredCollections(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredCollections')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedCollections(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured auctions
 */
export const useFeaturedAuctions = (appPubkey: string) => {
	const queryKey = configKeys.featuredAuctions(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredAuctions')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedAuctions(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}

/**
 * Hook to fetch featured users
 */
export const useFeaturedUsers = (appPubkey: string) => {
	const queryKey = configKeys.featuredUsers(appPubkey)
	useFeaturedSettingsSubscription(appPubkey, queryKey, 'featuredUsers')

	return useQuery({
		queryKey,
		queryFn: () => fetchFeaturedUsers(appPubkey),
		enabled: !!appPubkey,
		staleTime: 5 * 60 * 1000, // 5 minutes
	})
}
