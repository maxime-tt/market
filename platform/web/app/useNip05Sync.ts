import { nip05Actions } from '@sdk/config/nip05'
import { useNip05Settings } from '@platform/web/config/nip05Binding'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useEffect } from 'react'

/**
 * Hook to sync the NIP-05 store with the latest data
 * This should be called once at the app level to keep the store in sync
 */
export const useNip05Sync = () => {
	const { data: config } = useConfigQuery()
	const { data: nip05Settings, isLoading } = useNip05Settings(config?.appPublicKey)

	useEffect(() => {
		if (!nip05Settings || isLoading) return

		// Update the nip05 store with the latest data
		nip05Actions.setNip05(nip05Settings.entries || [], nip05Settings.lastUpdated)
	}, [nip05Settings, isLoading])

	return {
		isLoading,
		isLoaded: nip05Actions.isNip05Loaded(),
	}
}
