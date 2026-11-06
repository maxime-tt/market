import type { StaticDataRouteOption } from '@tanstack/react-router'

/**
 * platform/web/layout/appChrome.ts — which routes draw their own page chrome.
 *
 * The root layout (`platform/web/routes/__root.tsx`) draws the legacy `Header`
 * above every route. A surface that draws its own page-level navigation —
 * Browse renders `BrowseNav` inside `BrowseIndexHost` — would then show two nav
 * bars stacked on the same page.
 *
 * The opt-out is route metadata rather than a pathname list in the layout: the
 * route that owns the surface declares `staticData.hidesAppHeader`, so a new
 * state under that same route (another search param, another panel) inherits
 * the decision instead of silently double-navving again. The chain is read as a
 * whole, so a layout route can also opt every child out in one place.
 *
 * The field is augmented onto TanStack's `StaticDataRouteOption` so it
 * typechecks on both sides of the seam: the route that declares it and the
 * layout that reads it.
 */
declare module '@tanstack/react-router' {
	interface StaticDataRouteOption {
		/**
		 * `true` when the route renders its own page-level navigation, so the
		 * root layout must not also render the legacy app `Header` above it.
		 */
		hidesAppHeader?: boolean
	}
}

/**
 * The part of a route match this module reads. Structural, so it accepts both
 * TanStack's match objects and plain fixtures in tests.
 */
export interface AppChromeMatch {
	staticData?: StaticDataRouteOption | undefined
}

/**
 * Whether the active match chain declares `hidesAppHeader`.
 *
 * A chain where no route opts out (every legacy page) keeps the header, which
 * is the default: only an explicit `hidesAppHeader: true` suppresses it.
 */
export function hidesAppHeader(matches: ReadonlyArray<AppChromeMatch>): boolean {
	return matches.some((match) => match.staticData?.hidesAppHeader === true)
}
