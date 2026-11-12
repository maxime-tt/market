import { vanityActions } from '@platform/web/config/vanityStore'
import { useVanitySettings } from '@platform/web/config/vanityBinding'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useEffect } from 'react'

/**
 * Hook to sync the vanity store with the latest vanity data
 * This should be called once at the app level to keep the store in sync
 */
export const useVanitySync = () => {
	const { data: config } = useConfigQuery()
	const { data: vanitySettings, isLoading } = useVanitySettings(config?.appPublicKey)

	useEffect(() => {
		if (!vanitySettings || isLoading) return

		// Update the vanity store with the latest data
		vanityActions.setVanity(vanitySettings.entries || [], vanitySettings.lastUpdated)
	}, [vanitySettings, isLoading])

	return {
		isLoading,
		isLoaded: vanityActions.isVanityLoaded(),
	}
}
