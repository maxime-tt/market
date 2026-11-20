import { lazy, type ComponentType } from 'react'

const RELOAD_FLAG = 'chunk-reload'

/**
 * `React.lazy` that survives a deploy (ADR-0027). Each release serves only its
 * own hashed chunks, so a tab opened before a deploy can ask for a chunk that no
 * longer exists. The first failure reloads the page once to pick up the new
 * release; a second failure in the same session is a real error and is thrown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound React.lazy uses
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
	return lazy<T>(() =>
		load().then<{ default: T }, { default: T }>(
			(mod) => {
				try {
					sessionStorage.removeItem(RELOAD_FLAG)
				} catch {
					// storage unavailable: nothing to clear
				}
				return mod
			},
			(error: unknown) => {
				let reloaded = false
				try {
					reloaded = !!sessionStorage.getItem(RELOAD_FLAG)
					if (!reloaded) sessionStorage.setItem(RELOAD_FLAG, '1')
				} catch {
					reloaded = true
				}
				if (reloaded || typeof window === 'undefined') throw error
				window.location.reload()
				return new Promise<{ default: T }>(() => {})
			},
		),
	)
}
