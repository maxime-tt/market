import { queryOptions, useQuery } from '@tanstack/react-query'
import type { NostrEventLike } from '@sdk/core'
import { storefrontKeys } from '@sdk/core/query/queryKeyFactory'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { STOREFRONT_PAGE_KIND, parseStorefrontPage, type StorefrontPageChrome } from '@sdk/commerce/storefront/storefrontPage'
import { getReadContext } from '@platform/web/readContext'
import { selectReplaceable } from '@platform/web/storefront/storefrontQuery'

/**
 * "Which pages do I have?" — one author's kind-30024 documents, with no `d`.
 *
 * Every other page read in this tree pins a single `#d` (the address route
 * passes one segment, the builder opens one address). The page list is the one
 * surface that needs the *set*, so this is the one read that must not carry a
 * `#d` filter — the filter shape is asserted verbatim in the tests, because
 * re-pinning it here would silently turn "my pages" into "my storefront page".
 *
 * Three properties the caller depends on, each pinned by a test:
 *
 *  - **It is a relay read.** There is no local page index in this build, so this
 *    can be slow and it can fail. A failure rejects; it never resolves to an
 *    empty list. An empty picker on a failed read is a lie that leads an admin
 *    to create a duplicate page — the same rule the bindings list already
 *    follows.
 *  - **Replaceable semantics are applied client-side.** A relay is free to
 *    return several versions of one `d`; the newest wins, exactly as
 *    `selectReplaceable` decides for one address.
 *  - **It is capped, and says by how much.** The owner's scale is hundreds of
 *    pages, and a relay answers with whatever it likes, so the list keeps the
 *    most recent `PAGE_LIST_CAP` and reports the remainder rather than
 *    pretending the set is complete.
 *
 * It is deliberately *not* a statement about serving: a page can be in this list
 * and still be unpublished or unreadable on this instance. The UI says "pointing
 * at this page" and nothing more.
 */

/**
 * How many pages the list keeps. The rest are counted, not silently dropped —
 * see `PageListResult.dropped`.
 */
export const PAGE_LIST_CAP = 200

export interface AuthorPage {
	/** The page's `d` — its name and its address. */
	d: string
	/** The document's `title` tag, when it has one. */
	title: string | null
	/** The document's own switch. A page that does not parse is not enabled. */
	enabled: boolean
	/**
	 * The document's presentation intent. A page that does not parse — or one
	 * published before the field existed — is the app-chrome default, which is
	 * the same answer the serve path gives it.
	 */
	chrome: StorefrontPageChrome
	/** The winning event's `created_at`, for ordering. */
	updatedAt: number
	/** The winning event's id, so a row can be keyed on the real document. */
	eventId: string
}

export interface PageListResult {
	pages: AuthorPage[]
	/** How many pages the cap left out. Zero when the list is complete. */
	dropped: number
}

/** The `d` a page event addresses, or null when it carries none. */
function pageD(event: NostrEventLike): string | null {
	const tag = event.tags.find((candidate) => candidate[0] === 'd')
	return typeof tag?.[1] === 'string' && tag[1].length > 0 ? tag[1] : null
}

/**
 * Every page this author has, newest first.
 *
 * Relay and transport failures are allowed to reject, so React Query reports
 * `isError` and the caller renders a distinct error state instead of an empty
 * picker.
 */
export async function fetchMyPages(pubkey: string): Promise<PageListResult> {
	if (!isValidHexKey(pubkey)) return { pages: [], dropped: 0 }

	// Read-seam justification (ADR-READ-SEAM-STREAMS §8): this is a bounded,
	// single-shot "list my own entities" read — the author's own documents, no
	// live tail — so `fetch` is the doctrine-sanctioned class, not a stream.
	const events = await getReadContext().fetch([{ kinds: [STOREFRONT_PAGE_KIND], authors: [pubkey] }])

	// Defence in depth: a relay may answer a filter with events that do not match
	// it. Author and kind decide whose page this is, so both are re-checked.
	const addressed = events.filter((event) => event.kind === STOREFRONT_PAGE_KIND && event.pubkey === pubkey)

	// NIP-01 replaceable semantics, per `d`: several versions of one page
	// collapse to the newest, never to arrival order.
	const byD = new Map<string, NostrEventLike[]>()
	for (const event of addressed) {
		const d = pageD(event)
		if (!d) continue
		const bucket = byD.get(d)
		if (bucket) bucket.push(event)
		else byD.set(d, [event])
	}

	const pages: AuthorPage[] = []
	for (const [d, bucket] of byD) {
		const winner = selectReplaceable(bucket)
		if (!winner) continue
		// One parse: the switch and the presentation intent come from the same
		// document. A document that does not parse is neither live nor anything
		// but the default intent.
		const document = parseStorefrontPage(winner.content).page
		pages.push({
			d,
			title: winner.tags.find((tag) => tag[0] === 'title')?.[1] ?? null,
			enabled: document?.enabled ?? false,
			chrome: document?.chrome ?? 'app',
			updatedAt: winner.created_at ?? 0,
			eventId: winner.id,
		})
	}

	// Newest first, so a capped list keeps the pages an author is most likely to
	// want; the `d` breaks a tie so the order is stable between reads.
	pages.sort((a, b) => b.updatedAt - a.updatedAt || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))

	const dropped = Math.max(0, pages.length - PAGE_LIST_CAP)
	return { pages: pages.slice(0, PAGE_LIST_CAP), dropped }
}

/**
 * The author's own pages. The key lives under the storefront family, composed
 * here because the sdk key factory has no member for it and `sdk/` is out of
 * this lane's scope.
 */
export function myPagesQueryOptions(pubkey: string) {
	return queryOptions({
		queryKey: [...storefrontKeys.all, 'my-pages', pubkey] as const,
		queryFn: () => fetchMyPages(pubkey),
		enabled: isValidHexKey(pubkey),
		// The list is a picker's data source, not a live view: a short stale
		// window is enough to survive a form being re-opened, and a fresh read is
		// cheap enough that the author can always force one with a retry.
		staleTime: 30 * 1000,
	})
}

export function useMyPages(pubkey: string | undefined) {
	return useQuery(myPagesQueryOptions(pubkey ?? ''))
}
