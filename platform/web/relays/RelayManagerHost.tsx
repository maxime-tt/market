/**
 * Host for the `@ui/settings/relay-manager-views` cluster. This is the retired
 * `src/components/ui/relay-manager/{RelayManager,RelayCard}.tsx` pair moved
 * verbatim onto its platform homes: the NDK store bridge (pool relays, relay
 * add/remove/defaults), the NIP-65 relay-list and relay-preferences publish
 * bindings, and the auth read. Per-relay connectivity is classified by
 * `relayConnectionStatus` in `relayListNdkRead`, so this host names no NDK
 * transport of its own. The retired RelayCard additionally subscribed to each
 * relay object's `connect`/`disconnect` events; those are subscribed here (per
 * relay, in one effect) so outbox statuses keep refreshing the same way.
 */
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@platform/web/auth/authStore'
import { ndkActions, ndkStore } from '@platform/web/ndk/ndkStore'
import { relayConnectionStatus } from '@platform/web/relays/relayListNdkRead'
import { usePublishRelayList, useUserRelayList, type RelayPreference } from '@platform/web/relays/relayList'
import { usePublishRelayPreferences, useRelayPreferences } from '@platform/web/relays/relayPreferences'
import { RelayManagerView } from '@ui/settings/relay-manager-views'
import type { RelayRow } from '@ui/settings/relay-manager-views'

type PoolRelays = ReturnType<typeof ndkActions.getRelays>

export function RelayManagerHost() {
	const ndkState = useStore(ndkStore)
	const ndk = ndkState.ndk
	const { user } = useAuth()
	const userPubkey = user?.pubkey

	const [newRelayUrl, setNewRelayUrl] = useState('')
	const [relays, setRelays] = useState<PoolRelays>({ explicit: [], outbox: [] })
	const [isAddingRelay, setIsAddingRelay] = useState(false)

	// Queries for Nostr-stored relay data
	const { data: nostrRelays, isLoading: isLoadingNostrRelays, refetch: refetchNostrRelays } = useUserRelayList(userPubkey)
	const { data: relayPreferences, isLoading: isLoadingPreferences } = useRelayPreferences(userPubkey)

	// Mutations for saving to Nostr
	const publishRelayList = usePublishRelayList()
	const publishRelayPreferences = usePublishRelayPreferences()

	// Track if local relays differ from published
	const hasUnsavedChanges = useMemo(() => {
		if (!nostrRelays || nostrRelays.length === 0) return relays.explicit.length > 0
		const localUrls = new Set(relays.explicit.map((r) => r.url))
		const nostrUrls = new Set(nostrRelays.map((r) => r.url))
		if (localUrls.size !== nostrUrls.size) return true
		for (const url of localUrls) {
			if (!nostrUrls.has(url)) return true
		}
		return false
	}, [relays.explicit, nostrRelays])

	// Update relays when NDK changes
	useEffect(() => {
		if (ndk) {
			setRelays(ndkActions.getRelays())
		}
	}, [ndk])

	// Listen for relay changes on the pool
	useEffect(() => {
		if (!ndk || !ndk.pool) return

		const updateRelays = () => {
			setRelays(ndkActions.getRelays())
		}

		// Listen for relay events - wrap in try/catch to handle potential errors
		try {
			ndk.pool.on('relay:connect', updateRelays)
			ndk.pool.on('relay:disconnect', updateRelays)
		} catch (error) {
			console.error('Failed to attach relay event listeners:', error)
		}

		return () => {
			try {
				ndk.pool.off('relay:connect', updateRelays)
				ndk.pool.off('relay:disconnect', updateRelays)
			} catch (error) {
				console.error('Failed to remove relay event listeners:', error)
			}
		}
	}, [ndk])

	// Per-relay status listeners (the retired RelayCard's subscription, lifted here).
	// ndkActions.getRelays() re-reads the ndk store on every call, so a stable
	// refresh handle never closes over stale relay state.
	useEffect(() => {
		const refresh = () => {
			setRelays(ndkActions.getRelays())
		}
		const detach: (() => void)[] = []
		for (const relay of [...relays.explicit, ...relays.outbox]) {
			try {
				relay.on('connect', refresh)
				relay.on('disconnect', refresh)
				detach.push(() => {
					try {
						relay.off('connect', refresh)
						relay.off('disconnect', refresh)
					} catch (error) {
						console.error('Failed to remove relay status listeners:', error)
					}
				})
			} catch (error) {
				console.error('Failed to attach relay status listeners:', error)
			}
		}
		return () => {
			for (const off of detach) off()
		}
	}, [relays])

	const handleAddRelay = async () => {
		if (!newRelayUrl.trim()) return

		setIsAddingRelay(true)
		try {
			const success = ndkActions.addSingleRelay(newRelayUrl.trim())
			if (success) {
				setNewRelayUrl('')
				toast.success('Relay added successfully')
				// Update relay list
				setTimeout(() => {
					setRelays(ndkActions.getRelays())
				}, 500)
			} else {
				toast.error('Failed to add relay')
			}
		} catch (error) {
			console.error('Error adding relay:', error)
			toast.error('Failed to add relay')
		} finally {
			setIsAddingRelay(false)
		}
	}

	const handleRemoveRelay = async (relayUrl: string) => {
		try {
			const success = ndkActions.removeRelay(relayUrl)
			if (success) {
				toast.success('Relay removed successfully')
				// Update relay list
				setRelays(ndkActions.getRelays())
			} else {
				toast.error('Failed to remove relay')
			}
		} catch (error) {
			console.error('Error removing relay:', error)
			toast.error('Failed to remove relay')
		}
	}

	const handleConnectToDefaults = async () => {
		try {
			const success = ndkActions.connectToDefaultRelays()
			if (success) {
				toast.success('Connected to default relays')
				// Update relay list
				setTimeout(() => {
					setRelays(ndkActions.getRelays())
				}, 500)
			} else {
				toast.error('Failed to connect to default relays')
			}
		} catch (error) {
			console.error('Error connecting to default relays:', error)
			toast.error('Failed to connect to default relays')
		}
	}

	const handleLoadFromNostr = async () => {
		if (!userPubkey) {
			toast.error('Please log in to load relays from Nostr')
			return
		}

		try {
			const result = await refetchNostrRelays()
			if (result.data && result.data.length > 0) {
				// Clear existing explicit relays and add the ones from Nostr
				const currentRelays = ndkActions.getRelays()
				for (const relay of currentRelays.explicit) {
					ndkActions.removeRelay(relay.url)
				}

				// Add relays from Nostr
				for (const relay of result.data) {
					ndkActions.addSingleRelay(relay.url)
				}

				// Update local state
				setTimeout(() => {
					setRelays(ndkActions.getRelays())
				}, 500)

				toast.success(`Loaded ${result.data.length} relays from Nostr`)
			} else {
				toast.info('No relay list found on Nostr')
			}
		} catch (error) {
			console.error('Error loading relays from Nostr:', error)
			toast.error('Failed to load relays from Nostr')
		}
	}

	const handleSaveToNostr = async () => {
		if (!userPubkey) {
			toast.error('Please log in to save relays to Nostr')
			return
		}

		if (relays.explicit.length === 0) {
			toast.error('No relays to save')
			return
		}

		try {
			// Convert current relays to RelayPreference format
			const relayPrefs: RelayPreference[] = relays.explicit.map((relay) => ({
				url: relay.url,
				read: true,
				write: true,
			}))

			await publishRelayList.mutateAsync(relayPrefs)
			toast.success('Relay list saved to Nostr')
		} catch (error) {
			console.error('Error saving relays to Nostr:', error)
			toast.error('Failed to save relays to Nostr')
		}
	}

	const handleToggleAppDefaults = async (enabled: boolean) => {
		if (!userPubkey) {
			toast.error('Please log in to save preferences')
			return
		}

		try {
			await publishRelayPreferences.mutateAsync({ includeAppDefaults: enabled })
			toast.success(enabled ? 'App default relays enabled' : 'App default relays disabled')
		} catch (error) {
			console.error('Error saving relay preferences:', error)
			toast.error('Failed to save preference')
		}
	}

	const toRows = (pool: PoolRelays['explicit']): RelayRow[] =>
		pool.map((relay) => ({ url: relay.url, status: relayConnectionStatus(relay) }))

	return (
		<RelayManagerView
			ndkReady={Boolean(ndk)}
			showNostrSync={Boolean(userPubkey)}
			relayListLoading={isLoadingNostrRelays}
			preferencesLoading={isLoadingPreferences}
			preferencesPending={publishRelayPreferences.isPending}
			saving={publishRelayList.isPending || publishRelayPreferences.isPending}
			hasUnsavedChanges={hasUnsavedChanges}
			includeAppDefaults={relayPreferences?.includeAppDefaults ?? true}
			onLoadFromNostr={handleLoadFromNostr}
			onSaveToNostr={handleSaveToNostr}
			onToggleAppDefaults={handleToggleAppDefaults}
			newRelayUrl={newRelayUrl}
			onNewRelayUrlChange={setNewRelayUrl}
			onAddRelay={handleAddRelay}
			addingRelay={isAddingRelay}
			onConnectToDefaults={handleConnectToDefaults}
			explicitRelays={toRows(relays.explicit)}
			outboxRelays={toRows(relays.outbox)}
			onRemoveRelay={handleRemoveRelay}
		/>
	)
}
