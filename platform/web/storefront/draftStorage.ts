import {
	STOREFRONT_PAGE_D_TAG,
	StorefrontPageEnvelopeSchema,
	parseStorefrontPage,
	type StorefrontPage,
} from '@sdk/commerce/storefront/storefrontPage'

/**
 * Unpublished editor state, kept in localStorage.
 *
 * This is browser storage in the sense the repo README allows: temporary local
 * state, never the source of truth. The published page lives on relays; this
 * only stops a refresh or an accidental navigation from costing the author
 * their afternoon.
 *
 * Drafts are keyed per (pubkey, page address) so two accounts on one browser —
 * and two pages of one author — cannot inherit each other's work. The storefront
 * page is the default address, so a caller that names no page gets the
 * storefront draft.
 */

const DRAFT_KEY_PREFIX = 'plebeian-storefront-draft'

function draftKey(pubkey: string, dTag: string = STOREFRONT_PAGE_D_TAG): string {
	return `${DRAFT_KEY_PREFIX}:${pubkey}:${dTag}`
}

/**
 * The key drafts used before pages had an address. Kept so the storefront draft
 * an author typed yesterday is migrated instead of silently lost — see
 * `loadStorefrontDraft`.
 */
function legacyDraftKey(pubkey: string): string {
	return `${DRAFT_KEY_PREFIX}:${pubkey}`
}

/**
 * Every localStorage access is guarded: the API throws outright in a Safari
 * private window and when site data is blocked, and losing a draft must never
 * take the editor down with it.
 *
 * `dTag` is the page's address. It is optional and defaults to the storefront
 * page, so an existing caller that passes only a pubkey writes the same draft it
 * always did.
 */
export function saveStorefrontDraft(pubkey: string, dTag: string | undefined, page: StorefrontPage): void {
	if (!pubkey) return
	try {
		localStorage.setItem(draftKey(pubkey, dTag), JSON.stringify(page))
	} catch {
		// Quota exceeded or storage unavailable. The editor keeps working from
		// memory; only crash recovery is lost.
	}
}

/** Reads one key and validates it, dropping a document that does not parse. */
function readDraftAt(key: string): StorefrontPage | null {
	let raw: string | null = null
	try {
		raw = localStorage.getItem(key)
	} catch {
		return null
	}
	if (!raw) return null

	// Validated on the way in exactly like a relay document would be:
	// localStorage is writable by anything running on this origin, and a draft
	// that skipped validation would be a way to get an unvalidated block into
	// the editor and from there into a signed event.
	const parsed = parseStorefrontPage(raw)
	if (!parsed.page) {
		removeKey(key)
		return null
	}
	return parsed.page
}

function removeKey(key: string): void {
	try {
		localStorage.removeItem(key)
	} catch {
		// Nothing to do — a stale draft is re-validated on next load anyway.
	}
}

/**
 * Reads a draft back.
 *
 * When the address is the storefront page and the new key is empty, the draft
 * written before pages had an address is read from the legacy key once and
 * re-saved under the new one, so a split of the key space does not cost an
 * author their unsaved afternoon. A non-storefront address never consults the
 * legacy key: that draft is the storefront's.
 */
export function loadStorefrontDraft(pubkey: string, dTag?: string): StorefrontPage | null {
	if (!pubkey) return null

	const stored = readDraftAt(draftKey(pubkey, dTag))
	if (stored) return stored

	if (dTag === undefined || dTag === STOREFRONT_PAGE_D_TAG) {
		const legacy = readDraftAt(legacyDraftKey(pubkey))
		if (legacy) {
			saveStorefrontDraft(pubkey, dTag, legacy)
			return legacy
		}
	}

	return null
}

export function clearStorefrontDraft(pubkey: string, dTag?: string): void {
	if (!pubkey) return
	removeKey(draftKey(pubkey, dTag))
}

/** True when a stored draft exists and parses. Used to show the unsaved marker. */
export function hasStorefrontDraft(pubkey: string, dTag?: string): boolean {
	return loadStorefrontDraft(pubkey, dTag) !== null
}

/** Exported for tests: the envelope a draft must satisfy. */
export { StorefrontPageEnvelopeSchema }
