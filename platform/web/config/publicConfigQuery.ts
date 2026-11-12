import { useQuery } from '@tanstack/react-query'
import { configActions } from '@sdk/config/app-config'
import { applyBrowseSearchConfig } from '@platform/web/config/browseSearchBinding'
import type { PublicAppConfig } from '@sdk/config/instance-config'
import { parsePublicConfigEnvelope } from '@sdk/core/publicConfig'
import { configKeys } from '@sdk/core/query/queryKeyFactory'

/**
 * platform/web/config/publicConfigQuery.ts — the public app-config read binding (store drain D1, slice 1).
 *
 * The framework-free validation lives in `sdk/core/publicConfig` (`parsePublicConfigEnvelope`); this
 * module owns the host-side orchestration — the `/api/config` fetch, the resolved-config memory
 * (`getConfig`) and the react-query hook — and writes the resolved value into the SDK app-config state
 * (`@sdk/config/app-config`) so the reactive binding (`appConfigBinding.ts`) and `src/lib/stores/config.ts`
 * see it. It imports no `@/…`, so it adds no `platform -> src` edge.
 *
 * Behaviour is unchanged from the vacated `src/queries/config.tsx`: same URL, same error strings, same
 * `staleTime`/`retry`/`refetchOnWindowFocus` policy keyed off the cached `needsSetup` flag, same
 * `configKeys.all` query key.
 */
let cachedConfig: PublicAppConfig | null = null

const fetchConfig = async (): Promise<PublicAppConfig> => {
	const response = await fetch('/api/config')
	if (!response.ok) {
		throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`)
	}
	const parsed = parsePublicConfigEnvelope<PublicAppConfig>(await response.json())
	if (!parsed.ok) throw new Error(`Invalid /api/config response: ${parsed.error.message}`)
	const config = parsed.value
	console.log('Fetched config:', config)
	cachedConfig = config
	configActions.setConfig(config)
	applyBrowseSearchConfig(config)
	return config
}

export const getConfig = () => cachedConfig

export const useConfigQuery = () => {
	return useQuery({
		queryKey: configKeys.all,
		queryFn: fetchConfig,
		staleTime: cachedConfig?.needsSetup ? 0 : Infinity,
		retry: 3,
		refetchOnWindowFocus: cachedConfig?.needsSetup ? true : false,
	})
}
