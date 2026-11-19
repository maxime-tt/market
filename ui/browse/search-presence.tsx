/**
 * browse/search-presence.tsx — who is showing a search field.
 *
 * The frame's `AppBar` draws one search field by default. Some pages already
 * carry a search field of their own — the CMS `Search` block, the browse idle
 * hero — and two fields on one screen is one too many: the header's field
 * retreats whenever page content is showing one.
 *
 * The seam is a React context, deliberately not a module store: `servedPage.tsx`
 * renders on the server, and a module-level registry would be shared by every
 * request the process serves, leaking one page's field into another's. A context
 * is scoped to the tree — and to the request — that mounted its provider.
 *
 * The provider sits in `platform/web/app/AppProviders.tsx`, above the router and
 * therefore above both the frame-level bar and every page's content.
 *
 * Announcement is an effect, not a render-time write: a component may not update
 * a parent while rendering. `SearchField` announces itself on mount and
 * withdraws on unmount, so the count is always exactly the number of page fields
 * currently mounted. The header's own field opts out (`announce={false}`) and
 * can never count itself.
 */

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface SearchPresenceValue {
	/** How many page-level search fields are currently announced. */
	count: number
	/** Announce a page-level field; the returned function withdraws it. */
	register: () => () => void
}

/**
 * The value a tree with no provider above it reads: nothing announced, and a
 * registration that goes nowhere. A field rendered on its own — a unit test, a
 * widget preview — announces into this and behaves as it always has.
 *
 * Exported so a host test can render a consumer against a *stated* presence
 * without mounting a real field and its effects (the bar's decision is
 * `count === 0`).
 */
export const SearchPresenceContext = createContext<SearchPresenceValue>({ count: 0, register: () => () => {} })

// ---------------------------------------------------------------------------
// The registry — one per provider instance, so nothing is shared between trees
// ---------------------------------------------------------------------------

interface PresenceStore {
	register: () => () => void
	subscribe: (listener: () => void) => () => void
	getSnapshot: () => number
	getServerSnapshot: () => number
}

/**
 * A tiny external store: the count plus its subscribers. Created by
 * `useState`'s lazy initialiser so it is one instance per provider mount —
 * per request on the server — and never a module singleton.
 *
 * The count is a number, not a set of ids: the consumers only ever ask "is any
 * page field shown?", and a count is the honest shape for that question. (Two
 * fields count twice, which still hides the header just the same.)
 */
function createPresenceStore(): PresenceStore {
	let count = 0
	const listeners = new Set<() => void>()
	const notify = () => {
		for (const listener of listeners) listener()
	}

	return {
		register() {
			count += 1
			notify()
			// Idempotent withdraw: a StrictMode double-effect (mount, unmount,
			// mount) must not drive the count negative.
			let active = true
			return () => {
				if (!active) return
				active = false
				count -= 1
				notify()
			}
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		getSnapshot: () => count,
		// The server never runs mount effects, so a server render always sees no
		// page field and draws the header's own — the same field it drew before
		// this context existed.
		getServerSnapshot: () => count,
	}
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Provides the page-search-field presence to everything below it. Mounted once,
 * by `AppProviders`, above the router.
 */
export function SearchPresenceProvider({ children }: { children: ReactNode }) {
	const [store] = useState(createPresenceStore)
	const count = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
	const value = useMemo<SearchPresenceValue>(() => ({ count, register: store.register }), [count, store])

	return <SearchPresenceContext.Provider value={value}>{children}</SearchPresenceContext.Provider>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * The context value itself. Exported so a host-level test can render a consumer
 * against a stated count without mounting a real field and its effects.
 */
export function useSearchPresence(): SearchPresenceValue {
	return useContext(SearchPresenceContext)
}

/** How many page-level fields are announced. The bar renders its own field only at zero. */
export function usePageSearchFieldCount(): number {
	return useSearchPresence().count
}

/**
 * Announce a page-level search field for as long as this component is mounted.
 *
 * `enabled` is false for the header's own field, which must never count itself —
 * if it did, it would register, hide the middle track, unmount, withdraw, and
 * show again, a flicker loop.
 */
export function useAnnounceSearchField(enabled = true): void {
	const { register } = useSearchPresence()
	useEffect(() => {
		if (!enabled) return
		return register()
	}, [enabled, register])
}
