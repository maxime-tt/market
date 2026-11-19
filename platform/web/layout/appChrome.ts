/**
 * platform/web/layout/appChrome.ts — which paths render in the arena chrome.
 *
 * The app frame (`platform/web/routes/__root.tsx`) draws the one `AppBar` on
 * every route; a route no longer opts out of page chrome, because the bar is the
 * frame's, not a page's. The route-metadata header opt-out and its
 * `StaticDataRouteOption` augmentation that used to express it are gone, with
 * the second bar they existed for.
 *
 * What remains here is the one chrome decision the frame still makes: whether
 * the path renders inside the arena's dark token scope.
 */

/**
 * Whether a path renders in the Arena chrome (`styles/arena-chrome.css`).
 * Every public page does (ADR-0024, ADR-0025); only the dashboard keeps its
 * own admin console theme (ADR-0022). The root layout puts `.arena-chrome` on
 * its wrapper, and on `<body>` for portalled pop-ups such as the cart, for
 * these paths. That rebinds the theme tokens to Arena's values without
 * changing any markup.
 */
export function usesArenaChrome(pathname: string): boolean {
	return !(pathname === '/dashboard' || pathname.startsWith('/dashboard/'))
}
