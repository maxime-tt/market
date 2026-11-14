/**
 * Route names: the grammar a path may use, the names the URL space already
 * owns, and the split between those two kinds of "owned".
 *
 * This module is the single copy of a list that had been copy-pasted into
 * `sdk/config/vanity.ts` and `platform/server/VanityManager.ts` (37 names
 * each, identical). Keeping a third copy in the routing file's validator
 * would make four, so both existing modules import from here instead.
 *
 * It imports nothing: it is read by the browser bundle and by the Bun server.
 */

/**
 * The app's name grammar — identical to the one both live vanity copies used
 * (`sdk/config/vanity.ts:171-175` before this module existed). A name is
 * 3–30 characters, starts and ends alphanumeric, and may contain `_` or `-`.
 */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/

export function isValidRouteName(value: unknown): value is string {
	return typeof value === 'string' && NAME_PATTERN.test(value)
}

/**
 * Names the app reserves. Order is preserved from the two existing copies so
 * this extraction is a move, not an edit.
 */
export const RESERVED_NAMES: readonly string[] = [
	'admin',
	'api',
	'dashboard',
	'products',
	'product',
	'profile',
	'checkout',
	'setup',
	'community',
	'posts',
	'post',
	'nostr',
	'search',
	'collection',
	'collections',
	'settings',
	'support',
	'help',
	'about',
	'terms',
	'privacy',
	'login',
	'logout',
	'register',
	'signup',
	'signin',
	'account',
	'user',
	'users',
	'app',
	'static',
	'assets',
	'images',
	'public',
	'favicon',
	'robots',
	'sitemap',
]

/**
 * The top-level segments this build compiles in, derived from
 * `platform/web/routeTree.gen.ts` at the time of writing: of the 9 static
 * one-segment paths, `/new` is nested under the dashboard route and is not a
 * top-level segment, leaving these 8.
 *
 * Increment 2 replaces this hand-kept list with a generated artefact and a
 * drift test (`sdk/config/compiledInSegments.ts`). Until then the split logic
 * — which is what the validator needs — is already the final shape.
 */
export const COMPILED_IN_NAMES: readonly string[] = [
	'auctions',
	'checkout',
	'community',
	'dashboard',
	'nostr',
	'posts',
	'products',
	'setup',
]

/**
 * Reserved names that are NOT compiled-in routes (`api`, `images`, …). These
 * are the URL space itself and may never become a binding: a routing file
 * naming one is broken, not merely surprising.
 */
export const URL_SPACE_NAMES: readonly string[] = RESERVED_NAMES.filter((name) => !COMPILED_IN_NAMES.includes(name))

export function isCompiledInName(name: string): boolean {
	return COMPILED_IN_NAMES.includes(name)
}

export function isUrlSpaceName(name: string): boolean {
	return URL_SPACE_NAMES.includes(name)
}
