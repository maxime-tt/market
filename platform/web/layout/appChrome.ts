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
 * Whether a path renders in the Arena chrome (`styles/arena-chrome.css`): the
 * home / Browse surface at `/`, the auction routes, and the product list and
 * product pages (ADR-0024). The root layout puts
 * `.arena-chrome` on its wrapper for these paths, which rebinds the theme
 * tokens to Arena's dark values for the app bar, the footer, the Browse nav and
 * the search field without changing their markup.
 */
export function usesArenaChrome(pathname: string): boolean {
	return (
		pathname === '/' ||
		pathname === '/auctions' ||
		pathname.startsWith('/auctions/') ||
		pathname === '/products' ||
		pathname.startsWith('/products/')
	)
}
