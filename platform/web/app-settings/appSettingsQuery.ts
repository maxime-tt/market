/**
 * platform/web/app-settings/appSettingsQuery.ts — the React binding for the admin/editor settings reads
 * (store drain D1, slice 5).
 *
 * The framework-free reads (`readAdminSettingsWorkflow` / `readEditorSettingsWorkflow`) and the parsers
 * live in `@sdk/commerce/curation`. This file owns the react-query hooks and the live admin/editor list
 * subscriptions, and resolves its NDK client + app relay from `@platform/web/readContext.ts` (the file
 * that already owns the `@/lib/stores/ndk` edge) instead of `@/lib/stores/ndk`, so it adds no counted
 * `platform -> src` import. The query keys are literal-identical to the pre-drain values. The vacated
 * `src/queries/app-settings.tsx` path is an `export *` shim over this file until E1.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
	buildCurationListFilter,
	getFormattedAdmins,
	getFormattedEditors,
	getUserRoleForPubkey,
	isAdmin,
	isEditor,
	isOwner,
	readAdminSettingsWorkflow,
	readEditorSettingsWorkflow,
	type AdminSettings as SdkAdminSettings,
	type EditorSettings as SdkEditorSettings,
} from '@sdk/commerce/curation'
import { configKeys } from '@sdk/core/query/queryKeyFactory'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { createAppRelayReadContext, getAppRelayUrl } from '@platform/web/readContext'
import { getAppNdk } from '@platform/web/ndkPublishContext'

export { getFormattedAdmins, getFormattedEditors, getUserRoleForPubkey, isAdmin, isEditor, isOwner }

export type AdminSettings = SdkAdminSettings<NostrEventLike>

export type EditorSettings = SdkEditorSettings<NostrEventLike>

/**
 * Fetches admin settings (kind 30000) for the app
 */
export const fetchAdminSettings = async (appPubkey?: string): Promise<AdminSettings | null> => {
	if (!getAppNdk()) throw new Error('NDK not initialized')

	// If no app pubkey provided, the read throws 'App pubkey is required' (the pre-drain behaviour).
	return await readAdminSettingsWorkflow(createAppRelayReadContext(), appPubkey)
}

/**
 * Hook to fetch admin settings for the app
 */
export const useAdminSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = getAppNdk()
	const mainRelay = getAppRelayUrl()

	// Set up a live subscription to monitor admin list changes
	useEffect(() => {
		if (!appPubkey || !ndk || !mainRelay) return

		const adminListFilter = buildCurationListFilter('admins', appPubkey)

		// Track latest event timestamp to avoid reacting to historical events
		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(adminListFilter, {
			closeOnEose: false, // Keep subscription open
			relayUrls: [mainRelay],
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
		})

		// Event handler for admin list updates - only react to newer events after EOSE
		subscription.on('event', (newEvent) => {
			const eventTime = newEvent.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				queryClient.invalidateQueries({ queryKey: configKeys.admins(appPubkey) })
				queryClient.refetchQueries({ queryKey: configKeys.admins(appPubkey) })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, mainRelay, queryClient])

	return useQuery({
		queryKey: configKeys.admins(appPubkey || ''),
		queryFn: () => fetchAdminSettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000, // Consider data stale after 30 seconds
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Hook to check if the current user is an admin
 */
export const useAmIAdmin = (appPubkey?: string) => {
	const { data: adminSettings, isLoading } = useAdminSettings(appPubkey)
	const ndk = getAppNdk()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	const amIAdmin = isAdmin(adminSettings, currentUserPubkey || '')
	const amIOwner = isOwner(adminSettings, currentUserPubkey || '')

	return {
		amIAdmin,
		amIOwner,
		isLoading,
		adminSettings,
		currentUserPubkey,
	}
}

/**
 * Fetches editor settings (kind 30000) for the app
 */
export const fetchEditorSettings = async (appPubkey?: string): Promise<EditorSettings | null> => {
	if (!getAppNdk()) throw new Error('NDK not initialized')

	return await readEditorSettingsWorkflow(createAppRelayReadContext(), appPubkey)
}

/**
 * Hook to fetch editor settings for the app
 */
export const useEditorSettings = (appPubkey?: string) => {
	const queryClient = useQueryClient()
	const ndk = getAppNdk()
	const mainRelay = getAppRelayUrl()

	// Set up a live subscription to monitor editor list changes
	useEffect(() => {
		if (!appPubkey || !ndk || !mainRelay) return

		const editorListFilter = buildCurationListFilter('editors', appPubkey)

		// Track latest event timestamp to avoid reacting to historical events
		let latestEventTime = 0
		let receivedEose = false

		const subscription = ndk.subscribe(editorListFilter, {
			closeOnEose: false, // Keep subscription open
			relayUrls: [mainRelay],
			exclusiveRelay: true, // Reject stale copies from other relays in the pool
		})

		// Event handler for editor list updates - only react to newer events after EOSE
		subscription.on('event', (newEvent) => {
			const eventTime = newEvent.created_at ?? 0
			if (receivedEose && eventTime > latestEventTime) {
				queryClient.invalidateQueries({ queryKey: configKeys.editors(appPubkey) })
				queryClient.refetchQueries({ queryKey: configKeys.editors(appPubkey) })
			}
			if (eventTime > latestEventTime) {
				latestEventTime = eventTime
			}
		})

		subscription.on('eose', () => {
			receivedEose = true
		})

		// Clean up subscription when unmounting
		return () => {
			subscription.stop()
		}
	}, [appPubkey, ndk, mainRelay, queryClient])

	return useQuery({
		queryKey: configKeys.editors(appPubkey || ''),
		queryFn: () => fetchEditorSettings(appPubkey),
		enabled: !!appPubkey,
		staleTime: 30000, // Consider data stale after 30 seconds
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	})
}

/**
 * Hook to check comprehensive user role status (admin, editor, etc.)
 */
export const useUserRole = (appPubkey?: string) => {
	const { data: adminSettings, isLoading: isLoadingAdmins } = useAdminSettings(appPubkey)
	const { data: editorSettings, isLoading: isLoadingEditors } = useEditorSettings(appPubkey)
	const ndk = getAppNdk()
	const currentUserPubkey = ndk?.activeUser?.pubkey

	const amIAdmin = isAdmin(adminSettings, currentUserPubkey || '')
	const amIOwner = isOwner(adminSettings, currentUserPubkey || '')
	const amIEditor = isEditor(editorSettings, currentUserPubkey || '')

	// Determine the user's highest role
	const userRole = getUserRoleForPubkey(adminSettings, editorSettings, currentUserPubkey || '')

	return {
		amIAdmin,
		amIOwner,
		amIEditor,
		userRole,
		isLoading: isLoadingAdmins || isLoadingEditors,
		adminSettings,
		editorSettings,
		currentUserPubkey,
	}
}
