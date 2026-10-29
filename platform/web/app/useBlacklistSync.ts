import { blacklistActions } from '@platform/web/config/blacklistStore'
import { useBlacklistSettings } from '@platform/web/config/blacklistBinding'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useEffect } from 'react'

/**
 * Hook to sync the blacklist store with the latest blacklist data
 * This should be called once at the app level to keep the store in sync
 */
export const useBlacklistSync = () => {
	const { data: config } = useConfigQuery()
	const { data: blacklistSettings, isLoading } = useBlacklistSettings(config?.appPublicKey)

	useEffect(() => {
		if (!blacklistSettings || isLoading) return

		// Update the blacklist store with the latest data
		blacklistActions.setBlacklist({
			blacklistedPubkeys: blacklistSettings.blacklistedPubkeys || [],
			blacklistedProducts: blacklistSettings.blacklistedProducts || [],
			blacklistedCollections: blacklistSettings.blacklistedCollections || [],
			lastUpdated: blacklistSettings.lastUpdated,
		})
	}, [blacklistSettings, isLoading])

	return {
		isLoading,
		isLoaded: blacklistActions.isBlacklistLoaded(),
	}
}
