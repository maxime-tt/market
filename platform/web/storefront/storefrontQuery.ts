import { getReadContext } from '@platform/web/readContext'
import type { NostrEventLike } from '@sdk/core'
import {
	STOREFRONT_PAGE_D_TAG,
	STOREFRONT_PAGE_KIND,
	parseStorefrontPage,
	type StorefrontPage,
	type StorefrontParseResult,
} from '@sdk/commerce/storefront/storefrontPage'
import { publishStorefrontPage, type PageAddress } from './storefrontPublish'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { storefrontKeys } from '@sdk/core/query/queryKeyFactory'

/**
 * Reading storefront page documents (kind 30024, `d=storefront-page`).
 *
 * The page is user-authored content fetched from relays, so it is untrusted
 * until `parseStorefrontPage` accepts it. This module therefore returns a
 * *result*, not a page: callers need to tell apart "this author has no page"
 * from "this author has a page we could not read", because those lead to
 * different UI — the first is the ordinary profile view, the second is the
 * profile view plus a notice the author can act on.
 */

export interface StorefrontPageResult extends StorefrontParseResult {
	/** Null when the author has never published a page. */
	event: NostrEventLike | null
	/** The document's author, present whenever `event` is. */
	pubkey: string | null
}

const EMPTY_RESULT: StorefrontPageResult = { event: null, pubkey: null, page: null, droppedBlocks: 0, error: null }

/**
 * Picks the winning event for an addressable coordinate.
 *
 * NIP-01: highest `created_at` wins; ties break on the lexicographically
 * smallest id. Relays are not required to return only the newest replacement,
 * and a misbehaving one can return several, so the choice is made here rather
 * than trusting arrival order. A missing `created_at` (the read model types it
 * optional) sorts as the oldest possible event.
 */
export function selectReplaceable(events: NostrEventLike[]): NostrEventLike | null {
	let winner: NostrEventLike | null = null
	for (const event of events) {
		if (!winner) {
			winner = event
			continue
		}
		if ((event.created_at ?? 0) > (winner.created_at ?? 0)) {
			winner = event
			continue
		}
		if ((event.created_at ?? 0) === (winner.created_at ?? 0) && event.id < winner.id) {
			winner = event
		}
	}
	return winner
}

/**
 * Fetches and validates one addressable page: `(author, kind 30024, d)`.
 *
 * The `d` tag defaults to the profile storefront's own coordinate; the generic
 * address route (HANDOVER §6.1) passes the path segment verbatim — there is no
 * date parsing and no prefix handling anywhere in this read, because the
 * segment IS the `d` tag.
 *
 * Returns the empty result for an author who has no page. Relay/transport
 * failures are allowed to reject so React Query reports `isError` and keeps any
 * previously cached page, rather than committing a null-shaped success that
 * would flash the profile fallback over a page that does exist.
 */
export async function fetchStorefrontPage(pubkey: string, dTag: string = STOREFRONT_PAGE_D_TAG): Promise<StorefrontPageResult> {
	if (!isValidHexKey(pubkey) || dTag.length === 0) return EMPTY_RESULT

	// Read-seam justification (ADR-READ-SEAM-STREAMS §8): a single mounted page is a
	// single-entity/detail read — one addressable coordinate (author, kind, `d`) — so a
	// bounded `fetch` is the doctrine-sanctioned class here, not a stream.
	const events = await getReadContext().fetch([
		{
			kinds: [STOREFRONT_PAGE_KIND],
			authors: [pubkey],
			'#d': [dTag],
		},
	])

	// Defence in depth: a relay may answer a filter with events that do not
	// match it. Author and `d` decide the address, so re-check both rather than
	// rendering whatever came back.
	const addressed = events.filter(
		(event) =>
			event.kind === STOREFRONT_PAGE_KIND && event.pubkey === pubkey && event.tags.some((tag) => tag[0] === 'd' && tag[1] === dTag),
	)

	const event = selectReplaceable(addressed)
	if (!event) return EMPTY_RESULT

	const parsed = parseStorefrontPage(event.content)
	return { event, pubkey: event.pubkey, ...parsed }
}

/**
 * The cache key for one author's page document.
 *
 * The storefront page keeps the key it has always had
 * (`['storefront','page',pubkey]`), so the builder and the public profile read
 * one entry; every other address appends its `d`, so two pages of one author
 * never share a cache entry. `sdk/core/query/queryKeyFactory.ts` owns
 * `storefrontKeys` and this lane must not edit `sdk/`, so the per-`d` segment is
 * composed here — one function, so the query and its invalidation cannot drift.
 */
export function storefrontPageKey(pubkey: string, dTag?: string) {
	return dTag === undefined || dTag === STOREFRONT_PAGE_D_TAG
		? storefrontKeys.page(pubkey)
		: ([...storefrontKeys.page(pubkey), dTag] as const)
}

export const storefrontPageQueryOptions = (pubkey: string, dTag?: string) =>
	queryOptions({
		queryKey: storefrontPageKey(pubkey, dTag),
		queryFn: () => fetchStorefrontPage(pubkey, dTag),
		enabled: isValidHexKey(pubkey) && (dTag ?? STOREFRONT_PAGE_D_TAG).length > 0,
		// Pages change rarely and sit on the critical path of every profile
		// view, so a generous stale window avoids a relay round trip per visit.
		staleTime: 2 * 60 * 1000,
	})

/**
 * One author's page at one address. `pubkey` must be hex; resolve npub/NIP-05
 * first. `dTag` defaults to the storefront page, so the existing call sites
 * read exactly the coordinate (and the cache entry) they always did.
 */
export function useStorefrontPage(pubkey: string | undefined, dTag?: string) {
	return useQuery(storefrontPageQueryOptions(pubkey ?? '', dTag))
}

/**
 * Query options for the generic address coordinate: `(author, kind 30024, d)`.
 *
 * This is the read behind the generic address route (HANDOVER §6.1): the `d`
 * tag arrives verbatim from the path segment, so `/featured` and
 * `/featured-2026-11-03` are plain coordinates here — no route-level date or
 * prefix logic exists. The sdk key factory has no per-`d` member and this lane
 * must not edit `sdk/`, so the address key is composed from `storefrontKeys.all`.
 */
export const storefrontAddressPageQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: [...storefrontKeys.all, 'address', pubkey, dTag] as const,
		queryFn: () => fetchStorefrontPage(pubkey, dTag),
		enabled: isValidHexKey(pubkey) && dTag.length > 0,
		// Same cadence as the profile page read: pages change rarely and sit on
		// the critical path of the address route.
		staleTime: 2 * 60 * 1000,
	})

/** One addressable page by `(author, d)`. Resolve the author (e.g. the app key) first. */
export function useStorefrontAddressPage(pubkey: string | undefined, dTag: string) {
	return useQuery(storefrontAddressPageQueryOptions(pubkey ?? '', dTag))
}

/**
 * True when this author's page should replace the default profile view.
 *
 * Both conditions matter: the document must have parsed, and the author must
 * have switched it on. A page that parsed to zero surviving blocks is also
 * refused — an empty page is worse for a visitor than the profile they expected.
 */
export function shouldRenderStorefrontPage(result: StorefrontPageResult | undefined): result is StorefrontPageResult & {
	page: StorefrontPage
} {
	return Boolean(result?.page?.enabled && result.page.content.length > 0)
}

/**
 * Publishes a page and refreshes the cached copy of the address it wrote.
 *
 * Invalidation is a cache hint, not proof of relay retention: the mutation
 * result carries the relays that actually ACKed, and the UI reports from that.
 * The key comes from the same helper the read uses, so a publish at `dTag`
 * refreshes exactly the entry that `dTag` reads.
 */
export function usePublishStorefrontPage() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ page, address }: { page: StorefrontPage; address?: PageAddress }) => publishStorefrontPage(page, address),
		onSuccess: (result, variables) => {
			queryClient.invalidateQueries({ queryKey: storefrontPageKey(result.pubkey, variables.address?.dTag) })
		},
	})
}
