import { useCallback, useSyncExternalStore } from 'react'
import {
	DEFAULT_ADMIN_APPEARANCE,
	parseAdminAppearance,
	resolveAdminMode,
	type AdminAppearance,
	type ResolvedAdminMode,
} from '@ui/admin-theme/admin-appearance'

/**
 * Each admin's own dashboard appearance, kept in this browser only.
 *
 * Deliberately local: it is a personal preference about the back office, not
 * instance configuration, so nothing is published and other admins are not
 * affected (ADR-0022).
 */
export const ADMIN_APPEARANCE_STORAGE_KEY = 'plebeian_admin_appearance'

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedValue: AdminAppearance = DEFAULT_ADMIN_APPEARANCE

function readStored(): AdminAppearance {
	if (typeof window === 'undefined') return DEFAULT_ADMIN_APPEARANCE
	let raw: string | null = null
	try {
		raw = window.localStorage.getItem(ADMIN_APPEARANCE_STORAGE_KEY)
	} catch {
		raw = null
	}
	if (raw !== cachedRaw) {
		cachedRaw = raw
		cachedValue = parseAdminAppearance(raw)
	}
	return cachedValue
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	const onStorage = (event: StorageEvent) => {
		if (event.key === ADMIN_APPEARANCE_STORAGE_KEY) listener()
	}
	window.addEventListener('storage', onStorage)
	return () => {
		listeners.delete(listener)
		window.removeEventListener('storage', onStorage)
	}
}

function writeStored(next: AdminAppearance) {
	try {
		window.localStorage.setItem(ADMIN_APPEARANCE_STORAGE_KEY, JSON.stringify(next))
	} catch {
		// Private mode or a full quota: the choice still applies for this page view.
		cachedRaw = JSON.stringify(next)
		cachedValue = next
	}
	for (const listener of listeners) listener()
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeSystem(listener: () => void): () => void {
	const media = window.matchMedia(DARK_QUERY)
	media.addEventListener('change', listener)
	return () => media.removeEventListener('change', listener)
}

export function useAdminAppearance(): {
	appearance: AdminAppearance
	resolvedMode: ResolvedAdminMode
	setAppearance: (patch: Partial<AdminAppearance>) => void
} {
	const appearance = useSyncExternalStore(subscribe, readStored, () => DEFAULT_ADMIN_APPEARANCE)
	const prefersDark = useSyncExternalStore(
		subscribeSystem,
		() => window.matchMedia(DARK_QUERY).matches,
		() => false,
	)
	const setAppearance = useCallback((patch: Partial<AdminAppearance>) => {
		writeStored(parseAdminAppearance({ ...readStored(), ...patch }))
	}, [])
	return { appearance, resolvedMode: resolveAdminMode(appearance.mode, prefersDark), setAppearance }
}
