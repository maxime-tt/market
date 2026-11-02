import { CollectionImageTagSchema, CollectionSummaryTagSchema, CollectionTitleTagSchema } from '@sdk/config/schemas/productCollection'
import { filterBlacklistedEvents } from '@sdk/config/blacklist'
import { naddrFromAddress } from '@sdk/core/nostr/naddr'
import { isValidHexKey } from '@sdk/core/utils/utils'
// Facade fallback (batch E): the structural `NostrEventLike` widening is blocked by two deferred
// route consumers (routes/collection.$collectionId.tsx, routes/community.index.tsx) that still
// require `NDKEvent`; the event type is sourced from the platform read facade, and the structural
// retirement moves with those routes. Zero type change vs HEAD.
import type { NDKEvent, NDKFilter } from '@platform/web/readContext'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { collectionKeys, collectionsKeys } from '@sdk/core/query/queryKeyFactory'
import {
	getNextCommunityQueryFixtureStep,
	hasCommunityQueryFixture,
	normalizeCommunityArrayFixture,
	resolveCommunityQueryFixtureStep,
} from '@sdk/core/query/communityQueryFixtures'
import {
	getCollectionCoordinates as getCollectionCoordinatesFromSdk,
	getCollectionId as getCollectionIdFromSdk,
	getCollectionImages as getCollectionImagesFromSdk,
	getCollectionShippingOptions as getCollectionShippingOptionsFromSdk,
	getCollectionSummary as getCollectionSummaryFromSdk,
	getCollectionTitle as getCollectionTitleFromSdk,
	readCollectionsWorkflow,
} from '@sdk/commerce/collections'
import { createNdkReadContext, fetchEventsByFilter, fetchEventById, fetchEventByNaddr } from '@platform/web/readContext'

// --- DATA FETCHING FUNCTIONS ---
/**
 * Fetches all collections
 * @returns Array of collection events sorted by creation date (blacklist filtered)
 */
export const fetchCollections = async () => {
	const fixtureStep = getNextCommunityQueryFixtureStep<NDKEvent[]>('collections')
	if (fixtureStep) {
		return await resolveCommunityQueryFixtureStep('collections', fixtureStep, (data) =>
			normalizeCommunityArrayFixture<NDKEvent>('collections', data),
		)
	}

	return filterBlacklistedEvents(await readCollectionsWorkflow(createNdkReadContext(10000), { limit: 50 }))
}
/**
 * Fetches all collections from a specific pubkey
 * @param pubkey The pubkey of the user
 * @returns Array of collection events sorted by creation date (blacklist filtered)
 */
export const fetchCollectionsByPubkey = async (pubkey: string) => {
	// A malformed (not just empty) pubkey would build { authors: [...] } that
	// trips NDK's strict filter validation. Reject before constructing it.
	if (!isValidHexKey(pubkey)) return []

	return filterBlacklistedEvents(await readCollectionsWorkflow(createNdkReadContext(10000), { author: pubkey, limit: 50 }))
}

/**
 * Fetches a single collection listing by d-tag
 * @param dTag The d-tag identifier of the collection
 * @returns The collection listing event
 */
export const fetchCollection = async (dTag: string) => {
	if (!dTag) return null

	const events = await fetchEventsByFilter({
		kinds: [30405 as NonNullable<NDKFilter['kinds']>[number]],
		'#d': [dTag],
	})

	if (events.length === 0) {
		return null
	}

	return events[0]
}

/**
 * Fetches a single collection by event ID
 * @param id The event ID of the collection
 * @returns The collection event
 */
export const fetchCollectionByEventId = async (id: string) => {
	if (!id) return null

	const event = await fetchEventById(id)

	if (!event || event.kind !== 30405) {
		return null
	}

	return event
}

/**
 * Fetches a collection by addressable tag (a-tag)
 * @param pubkey The pubkey of the author
 * @param dTag The d-tag identifier
 * @returns The collection event
 */
export const fetchCollectionByATag = async (pubkey: string, dTag: string) => {
	if (!pubkey || !dTag) return null

	const naddr = naddrFromAddress(30405, pubkey, dTag)
	return await fetchEventByNaddr(naddr)
}

/**
 * Fetches a collection by ID (supports both d-tag and event ID)
 * Tries d-tag first, then event ID if the input is 64 characters long
 * @param id The d-tag identifier or event ID of the collection
 * @returns The collection event or null if not found
 */
export const fetchCollectionById = async (id: string): Promise<NDKEvent | null> => {
	if (!id) return null

	// First try fetching by d-tag
	let collection = await fetchCollection(id)

	// If not found and input looks like an event ID (64 chars), try fetching by event ID
	if (!collection && id.length === 64) {
		collection = await fetchCollectionByEventId(id)
	}

	return collection
}

/**
 * Gets the collection title from an event
 */
export const getCollectionTitle = (event: NDKEvent | null): z.infer<typeof CollectionTitleTagSchema>[1] => getCollectionTitleFromSdk(event)

/**
 * Get the collection summary from an event
 */
export const getCollectionSummary = (event: NDKEvent | null): z.infer<typeof CollectionSummaryTagSchema>[1] =>
	getCollectionSummaryFromSdk(event)

/**
 * Gets the collection ID from an event
 */
export const getCollectionId = (event: NDKEvent): string => {
	return getCollectionIdFromSdk(event)
}

export const getCollectionImages = (event: NDKEvent | null): z.infer<typeof CollectionImageTagSchema>[] => {
	return getCollectionImagesFromSdk(event) as z.infer<typeof CollectionImageTagSchema>[]
}

/**
 * Gets the shipping option tags from a collection event
 * @param event The collection event or null
 * @returns An array of shipping option tuples with format [tag, shipping_reference, extra_cost?]
 */
export const getCollectionShippingOptions = (event: NDKEvent | null): Array<string[]> => {
	return getCollectionShippingOptionsFromSdk(event)
}

/**
 * Creates collection coordinates string
 */
export const getCollectionCoordinates = (event: NDKEvent): string => {
	return getCollectionCoordinatesFromSdk(event)
}

// --- REACT QUERY OPTIONS ---

export const collectionQueryOptions = (id: string) =>
	queryOptions({
		queryKey: collectionKeys.details(id),
		queryFn: () => fetchCollection(id),
		staleTime: 300000,
	})

/**
 * React Query options for fetching a collection by ID (supports both d-tag and event ID)
 * @param id The d-tag identifier or event ID
 * @returns Query options object
 */
export const collectionByIdQueryOptions = (id: string) =>
	queryOptions({
		queryKey: collectionKeys.details(id),
		queryFn: () => fetchCollectionById(id),
		staleTime: 300000,
	})

/**
 * React Query options for fetching a collection by addressable tag (a-tag)
 * @param pubkey The pubkey of the author
 * @param dTag The d-tag identifier
 * @returns Query options object
 */
export const collectionByATagQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: collectionKeys.byATag(pubkey, dTag),
		queryFn: () => fetchCollectionByATag(pubkey, dTag),
		staleTime: 300000,
	})
/**
 * React Query options for fetching collections
 * @param id Collection ID
 * @returns Query options object
 */
export const collectionsQueryOptions = queryOptions({
	queryKey: collectionsKeys.all,
	queryFn: fetchCollections,
	retry: (failureCount) => !hasCommunityQueryFixture('collections') && failureCount < 3,
	staleTime: 30000, // Consider fresh for 30 seconds
	refetchOnMount: 'always', // Always refetch to pick up deletions
})

/**
 * React Query options for fetching collections by pubkey
 * @param pubkey User's pubkey
 */
export const collectionsByPubkeyQueryOptions = (pubkey: string) =>
	queryOptions({
		queryKey: collectionsKeys.byPubkey(pubkey),
		queryFn: () => fetchCollectionsByPubkey(pubkey),
		enabled: isValidHexKey(pubkey),
	})

// --- HOOKS ---

/**
 * Hook to get collections by pubkey
 * @param pubkey User's pubkey
 * @returns Query result with an array of collection events
 */
export const useCollectionsByPubkey = (pubkey: string) => {
	return useQuery({
		...collectionsByPubkeyQueryOptions(pubkey),
	})
}

export const useCollectionTitle = (id: string) => {
	return useQuery({
		...collectionQueryOptions(id),
		select: getCollectionTitle,
	})
}

export const useCollectionImages = (id: string) => {
	return useQuery({
		...collectionQueryOptions(id),
		select: getCollectionImages,
	})
}
