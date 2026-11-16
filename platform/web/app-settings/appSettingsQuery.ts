/**
 * platform/web/app-settings/appSettingsQuery.ts — the React binding for the admin/editor settings reads
 * (store drain D1, slice 5).
 *
 * The framework-free reads (`readAdminSettingsWorkflow` / `readEditorSettingsWorkflow`) and the parsers
 * live in `@sdk/core/curation`. This file owns the react-query hooks and the live admin/editor list
 * subscriptions, and resolves its NDK client + app relay from `@platform/web/readContext.ts` (the file
 * that already owns the `@/lib/stores/ndk` edge) instead of `@/lib/stores/ndk`, so it adds no counted
 * `platform -> src` import. The query keys are literal-identical to the pre-drain values. The vacated
 * `src/queries/app-settings.tsx` path is an `export *` shim over this file until E1.
 *
 * Identity for the role checks comes from the SDK auth machine — `useStore(authStore)` -> `AuthState.user`
 * (`{ pubkey }`) — not from the NDK instance: `ndk.activeUser` is never assigned in this tree (the signer
 * is the SDK signer capability since A3.5), so reading it made every check fail closed and hid the admin
 * surface. `authStore` is taken from the same `readContext` import as the relay accessors, which is why
 * this file adds no import edge (and no `authStore -> readContext -> applesauceIo` cycle).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
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
} from '@sdk/core/curation'
import { configKeys } from '@sdk/core/query/queryKeyFactory'
import type { AuthUser } from '@sdk/core/auth'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { authStore, createAppRelayReadContext, getAppRelayUrl } from '@platform/web/readContext'
import { getAppNdk } from '@platform/web/ndkPublishContext'

export { getFormattedAdmins, getFormattedEditors, getUserRoleForPubkey, isAdmin, isEditor, isOwner }

export type AdminSettings = SdkAdminSettings<NostrEventLike>

export type EditorSettings = SdkEditorSettings<NostrEventLike>

/**
 * The identity seam both role hooks share: the signed-in user comes from the SDK auth machine
 * (`AuthState.user`, `AuthUser = { pubkey }`), never from the NDK instance.
 *
 * `ndk.activeUser` is permanently undefined in this tree — nothing ever assigns it, because since
 * A3.5 the signer is the SDK signer capability, not an NDK signer. Reading it made every role check
 * fail closed (`isAdmin(settings, '')` is `false`), which hid the whole admin surface from the owner
 * and every admin. The hooks read this through `useStore(authStore)` so a login/logout re-renders
 * them; this function is the pure part of that seam.
 */
export function resolveUserPubkey(user: AuthUser | null | undefined): string | undefined {
	return user?.pubkey
}

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
	// Reactive identity: `useStore` subscribes, so a login/logout re-renders the hook.
	const { user } = useStore(authStore)
	const currentUserPubkey = resolveUserPubkey(user)

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
	// Reactive identity: same SDK auth-machine read as `useAmIAdmin`, never `ndk.activeUser`.
	const { user } = useStore(authStore)
	const currentUserPubkey = resolveUserPubkey(user)

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
