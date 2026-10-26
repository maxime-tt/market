/**
 * platform/web/v4v/v4vQuery.ts — the React binding for the V4V share reads and the share publish
 * (store drain D1, slice 5).
 *
 * The framework-free read (`readV4VConfigurationWorkflow`: newest kind-30078 share event, state
 * resolution, share parsing) lives in `@sdk/commerce/v4v/v4vRead`. This file owns the react-query
 * hooks, the recipient display-name lookup and the share publish, and resolves the NDK client,
 * signer and publish action from `@platform/web/ndkPublishContext` (the file that owns the
 * `@/lib/stores/ndk` edge) instead of `@/lib/stores/ndk`, so it adds no counted `platform -> src`
 * import. The community-query fixture seam moved to `@sdk/core/query/communityQueryFixtures`, so the
 * merchant read keeps its seeded-fixture behaviour without a `@/` specifier. `v4vKeys` is
 * literal-identical to the pre-drain key (including the publish invalidations). The vacated
 * `src/queries/v4v.tsx` path is an `export *` shim over this file until E1.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { filterBlacklistedPubkeys } from '@sdk/config/blacklist'
import {
	buildV4VMerchantsFilter,
	buildV4VSharesFilter,
	collectV4VMerchantPubkeys,
	readV4VConfigurationWorkflow,
	resolveV4VConfigurationState,
	type V4VConfigurationReadPort,
	type V4VConfigurationState,
	type V4VShareDTO,
} from '@sdk/commerce/v4v/v4vRead'
import {
	getNextCommunityQueryFixtureStep,
	hasCommunityQueryFixture,
	normalizeCommunityArrayFixture,
	resolveCommunityQueryFixtureStep,
} from '@sdk/core/query/communityQueryFixtures'
import { v4vKeys } from '@sdk/core/query/queryKeyFactory'
import { getAppNdk, getAppSigner, publishAppEvent, NDKEvent, type NdkClient } from '@platform/web/ndkPublishContext'

export type { V4VConfigurationState }
export { resolveV4VConfigurationState }

export interface V4VConfiguration {
	shares: V4VShareDTO[]
	state: V4VConfigurationState
}

/**
 * The host read port: the relay fetch plus the recipient display-name lookup. `getUser(...).fetchProfile()`
 * is the pre-drain enrichment; its rejection is caught by the SDK workflow and leaves the name empty.
 */
function createV4VConfigurationPort(ndk: NdkClient): V4VConfigurationReadPort {
	return {
		fetchShares: async (filter) => await ndk.fetchEvents(filter),
		resolveDisplayName: async (pubkey: string) => {
			const user = ndk.getUser({ pubkey })
			await user.fetchProfile()
			return user.profile?.name || user.profile?.displayName || ''
		},
	}
}

export const fetchV4VConfiguration = async (pubkey: string): Promise<V4VConfiguration> => {
	const ndk = getAppNdk()
	if (!ndk) {
		console.warn('NDK not ready, returning unknown V4V configuration')
		return { shares: [], state: 'unknown' }
	}

	return await readV4VConfigurationWorkflow(createV4VConfigurationPort(ndk), pubkey)
}

export const fetchV4VShares = async (pubkey: string): Promise<V4VShareDTO[]> => {
	const { shares } = await fetchV4VConfiguration(pubkey)
	return shares
}

export const v4VForUserQuery = async (userPubkey: string): Promise<V4VShareDTO[]> => {
	try {
		const { shares } = await fetchV4VConfiguration(userPubkey)
		return shares
	} catch (error) {
		console.error('Error fetching V4V shares:', error)
		return []
	}
}

export const useV4VConfiguration = (pubkey: string) => {
	return useQuery({
		queryKey: v4vKeys.userConfig(pubkey),
		queryFn: () => fetchV4VConfiguration(pubkey),
		enabled: !!pubkey,
	})
}

export const useV4VShares = (pubkey: string) => {
	return useQuery({
		queryKey: v4vKeys.userShares(pubkey),
		queryFn: () => fetchV4VShares(pubkey),
		enabled: !!pubkey,
	})
}

/**
 * Publishes V4V shares configuration
 *
 * Handles three scenarios:
 * 1. shares = [] → Publishes event with empty array (user takes 100%, V4V is 0%)
 * 2. shares = [...] → Publishes event with shares (user configured V4V recipients)
 * 3. To delete/clear → Call this with empty array []
 *
 * NOTE: Empty array is valid and means "I configured V4V to 0%", different from no event.
 */
export const publishV4VShares = async (shares: V4VShareDTO[], userPubkey: string, appPubkey?: string): Promise<boolean> => {
	try {
		const ndk = getAppNdk()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = getAppSigner()
		if (!signer) throw new Error('User signer not available')

		// zapTags can be empty array (user takes 100%)
		const zapTags = shares.map((share) => ['zap', share.pubkey, share.percentage.toString()])

		const event = new NDKEvent(ndk)
		event.kind = 30078
		event.content = JSON.stringify(zapTags)
		event.tags = [
			['d', uuidv4()],
			['l', 'v4v_share'],
		]

		if (appPubkey) {
			event.tags.push(['p', appPubkey])
		}

		await event.sign(signer)
		await publishAppEvent(event)

		return true
	} catch (error) {
		console.error('Error publishing V4V shares:', error)
		return false
	}
}

export const usePublishV4VShares = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationKey: v4vKeys.publishShare(),
		mutationFn: (params: { shares: V4VShareDTO[]; userPubkey: string; appPubkey?: string }) =>
			publishV4VShares(params.shares, params.userPubkey, params.appPubkey),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: v4vKeys.userConfig(variables.userPubkey) })
			// Invalidate the specific user's V4V shares query
			queryClient.invalidateQueries({ queryKey: v4vKeys.userShares(variables.userPubkey) })
			// Also invalidate all V4V queries to be safe
			queryClient.invalidateQueries({ queryKey: v4vKeys.all })
		},
	})
}

/**
 * Fetches all users who have configured V4V shares (merchants)
 * Returns an array of unique pubkeys
 * Throws on relay/network errors to enable error state handling
 */
export const fetchV4VMerchants = async (): Promise<string[]> => {
	const fixtureStep = getNextCommunityQueryFixtureStep<string[]>('merchants')
	if (fixtureStep) {
		return await resolveCommunityQueryFixtureStep('merchants', fixtureStep, (data) =>
			normalizeCommunityArrayFixture<string>('merchants', data),
		)
	}

	const ndk = getAppNdk()
	if (!ndk) {
		throw new Error('NDK not ready, cannot fetch merchants')
	}

	const events = await ndk.fetchEvents(buildV4VMerchantsFilter())

	if (!events || events.size === 0) {
		return []
	}

	return filterBlacklistedPubkeys(collectV4VMerchantPubkeys(events))
}

/**
 * Hook to fetch all merchants who have V4V configured
 */
export const useV4VMerchants = () => {
	return useQuery({
		queryKey: v4vKeys.merchants(),
		queryFn: fetchV4VMerchants,
		retry: (failureCount) => !hasCommunityQueryFixture('merchants') && failureCount < 3,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
