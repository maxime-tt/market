import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { THEME_PRESETS } from '@ui/theme/presets'
import { createLocalStorageKeyValuePort } from '@platform/web/storage/localStorageKeyValue'

import { readThemeState, resolveThemeTokens, serializeThemeState, THEME_STORAGE_KEY, type AppThemeState } from './themeState'

const storage = createLocalStorageKeyValuePort()

/**
 * The app shell's theme state. Owns `{ presetIndex, tune }`, hydrates it from
 * localStorage once, persists every user change, and exposes the resolved
 * token record the shell passes to `ThemeMigrationWrapper`.
 *
 * The initial render uses the default theme; the stored value replaces it after
 * the async read resolves. A change made before hydration wins over the stored
 * value and is written once hydration completes.
 */
export function useAppTheme() {
	const [state, setState] = useState<AppThemeState>(() => readThemeState(THEME_PRESETS, null))
	const hydrated = useRef(false)
	const dirty = useRef(false)
	const stateRef = useRef(state)
	stateRef.current = state

	useEffect(() => {
		let cancelled = false
		storage
			.get(THEME_STORAGE_KEY)
			.then((stored) => {
				if (cancelled) return
				if (stored && !dirty.current) setState(readThemeState(THEME_PRESETS, stored))
				hydrated.current = true
				if (dirty.current) void storage.set(THEME_STORAGE_KEY, serializeThemeState(stateRef.current))
			})
			.catch(() => {
				hydrated.current = true
			})
		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		if (!hydrated.current || !dirty.current) return
		void storage.set(THEME_STORAGE_KEY, serializeThemeState(state))
	}, [state])

	const setTheme = useCallback((next: AppThemeState) => {
		dirty.current = true
		setState(next)
	}, [])

	const theme = useMemo(() => resolveThemeTokens(THEME_PRESETS, state), [state])

	return { state, setTheme, theme }
}
