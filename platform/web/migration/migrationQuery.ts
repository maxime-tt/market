/**
 * platform/web/migration/migrationQuery.ts — the React binding for the NIP-15 migration reads
 * (store drain D1, slice 5).
 *
 * The framework-free pieces (`buildNip15ProductsFilter`, `buildMigratedProductsFilter`,
 * `readRelayListUrls`, `resolveMigrationRelays`, `collectMigratedOriginalIds`) already live in
 * `@sdk/commerce/products/nip15MigrationRead`; this file keeps the host relay orchestration and the
 * react-query options. It resolves the NDK client from `@platform/web/ndkPublishContext` and the app
 * relay + relay additions from `@platform/web/readContext` (the files that own the
 * `@/lib/stores/ndk` edge), so it adds no counted `platform -> src` import. `migrationKeys` is
 * literal-identical to the pre-drain key. The sibling `platform/web/migration.tsx` is the D2 publish
 * binding and is untouched. The vacated `src/queries/migration.tsx` path is an `export *` shim over
 * this file until E1.
 */
import { queryOptions } from '@tanstack/react-query'
import {
	buildMigratedProductsFilter,
	buildNip15ProductsFilter,
	collectMigratedOriginalIds,
	readRelayListUrls,
	resolveMigrationRelays,
} from '@sdk/commerce/products/nip15MigrationRead'
import { buildRelayListFilter } from '@sdk/core/relays/relayListRead'
import { migrationKeys } from '@sdk/core/query/queryKeyFactory'
import { addAppExplicitRelays, getAppRelayUrl, type NDKEvent } from '@platform/web/readContext'
import { getAppNdk } from '@platform/web/ndkPublishContext'

export { migrationKeys }

/**
 * Fetches user's relay list (kind 10002)
 */
export const fetchUserRelayList = async (userPubkey: string): Promise<string[]> => {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')

	const events = await ndk.fetchEvents(buildRelayListFilter(userPubkey))

	return readRelayListUrls(events)
}

/**
 * Fetches NIP-15 product events (kind 30018) from user's relay list
 */
export const fetchNip15Products = async (userPubkey: string): Promise<NDKEvent[]> => {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')

	const appRelay = getAppRelayUrl()

	// Ensure app relay is added to NDK so we can fetch relay list and products
	if (appRelay) {
		try {
			addAppExplicitRelays([appRelay])
			// Small delay to ensure relay connection is established
			await new Promise((resolve) => setTimeout(resolve, 500))
		} catch (error) {
			console.error('Failed to add app relay:', error)
		}
	}

	// Get user's relay list
	const userRelays = await fetchUserRelayList(userPubkey)

	// Build relay list: app relay + user relays (or fallback to NDK's current relays)
	const relaysToUse = resolveMigrationRelays(appRelay, userRelays, ndk.explicitRelayUrls || [])

	// Temporarily add all relays to NDK
	if (relaysToUse.length > 0) {
		try {
			addAppExplicitRelays(relaysToUse)
		} catch (error) {
			console.error('Failed to add relays:', error)
		}
	}

	try {
		const events = await ndk.fetchEvents(buildNip15ProductsFilter(userPubkey))
		const eventsArray = Array.from(events)
		return eventsArray
	} catch (error) {
		console.error('Failed to fetch NIP-15 products:', error)
		return []
	}
}

/**
 * Fetches already migrated events (NIP-99 events with "migrated" tag)
 */
export const fetchMigratedEvents = async (userPubkey: string): Promise<Set<string>> => {
	const ndk = getAppNdk()
	if (!ndk) throw new Error('NDK not initialized')

	const appRelay = getAppRelayUrl()
	if (!appRelay) {
		console.warn('No app relay configured, cannot check migrated events')
		return new Set()
	}

	// Ensure app relay is added
	try {
		addAppExplicitRelays([appRelay])
	} catch (error) {
		console.error('Failed to add app relay:', error)
	}

	try {
		const events = await ndk.fetchEvents(buildMigratedProductsFilter(userPubkey))
		return collectMigratedOriginalIds(events)
	} catch (error) {
		console.error('Failed to fetch migrated events:', error)
		return new Set()
	}
}

/**
 * React Query options for fetching NIP-15 products
 */
export const nip15ProductsQueryOptions = (userPubkey: string) => {
	return queryOptions({
		queryKey: migrationKeys.nip15Products(userPubkey),
		queryFn: () => fetchNip15Products(userPubkey),
		enabled: !!userPubkey,
		staleTime: 5 * 60 * 1000, // Keep fresh for 5 minutes
		gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
		refetchOnWindowFocus: false, // Don't refetch on window focus
	})
}

/**
 * React Query options for fetching migrated events
 */
export const migratedEventsQueryOptions = (userPubkey: string) => {
	return queryOptions({
		queryKey: migrationKeys.migratedEvents(userPubkey),
		queryFn: () => fetchMigratedEvents(userPubkey),
		enabled: !!userPubkey,
		staleTime: 5 * 60 * 1000, // Keep fresh for 5 minutes
		gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
		refetchOnWindowFocus: false, // Don't refetch on window focus
	})
}
