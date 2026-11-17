import { STOREFRONT_PAGE_D_TAG } from '@sdk/commerce/storefront/storefrontPage'
import { isValidPagePath } from '@platform/server/routes/pagePaths'
import { shortPubkey } from './routeAuthoring'

/**
 * Page identity in the authoring UI: what a page is called, who owns it, and
 * whether a typed name may be used at all.
 *
 * Pure, like `routeAuthoring.ts`: no React and no network, so the naming rules
 * are unit-testable without rendering. The name **is** the address — a page is
 * `(author, d)`, and the `d` is what the UI shows as the page's name — so the
 * one grammar that decides it is the route-name grammar the path layer already
 * uses (`NAME_PATTERN`, reached through `isValidPagePath`).
 *
 * The storefront page is not a special kind of document; it is the page whose
 * `d` happens to be the reserved default. That is why nothing here needs a mode
 * flag: `isDefault` is derived from the address and nothing else.
 */

/** A page's addressable coordinate. */
export interface PageIdentity {
	author: string
	d: string
}

/** A page as the UI names it. */
export interface PageLabel {
	name: string
	authorLabel: string
	enabled: boolean
	isDefault: boolean
}

/** The storefront page is the one whose `d` is the reserved default. */
export function pageIsStorefront(d: string): boolean {
	return d === STOREFRONT_PAGE_D_TAG
}

/**
 * The human name of a page.
 *
 * The reserved default is shown as "Storefront" wherever a page is listed: the
 * author never typed that name, and printing the raw tag would make the
 * storefront look like one of their custom pages.
 */
export function pageLabel(name: string): string {
	return pageIsStorefront(name) ? 'Storefront' : name
}

/** Everything a page row or a picker row needs to name one page. */
export function describePage(identity: PageIdentity, enabled: boolean): PageLabel {
	return {
		name: pageLabel(identity.d),
		authorLabel: shortPubkey(identity.author),
		enabled,
		isDefault: pageIsStorefront(identity.d),
	}
}

/**
 * Whether a typed name may become a page's `d`.
 *
 * Returns the sentence to show under the field, or null when the name is fine —
 * the same shape as `validateIntentPath`, so the form needs no second mapping.
 * The rules are the **path** rules, not the looser intent-`d` rules: a page's
 * `d` is the segment it is reachable at, so a name the path layer would refuse
 * must never be minted here. The reserved default is refused as a *new* name
 * because it already exists — "creating" it would silently retarget the
 * storefront instead of making a page.
 */
export function validatePageName(input: string): string | null {
	if (input.length === 0) return 'Enter a name for the page.'
	if (pageIsStorefront(input)) {
		return `“${STOREFRONT_PAGE_D_TAG}” is the storefront page’s own name and cannot be used for a new page.`
	}
	if (!isValidPagePath(input)) {
		return 'A page name is 3–30 characters: lowercase letters, digits, "-" or "_", and it cannot begin or end with "-" or "_".'
	}
	return null
}

/**
 * A notice for a name the author already has.
 *
 * This is deliberately not an error: a page's address is a replaceable
 * coordinate, so writing to an existing `d` replaces that page rather than
 * colliding with it. The honest thing to say is what will happen.
 */
export function pageNameNotice(name: string, existing: readonly string[]): string | null {
	if (name.length === 0 || !existing.includes(name)) return null
	return 'You already have a page called this. Creating it opens the existing one.'
}
