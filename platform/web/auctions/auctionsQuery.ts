/**
 * platform/web/auctions/auctionsQuery.ts — the React binding for the auction read layer.
 *
 * The framework-free readers and getters live in `@sdk/commerce/auctions/auctionRead`; this module
 * owns the three things that cannot: React Query (query options, hooks), the host's read context
 * (`createApplesauceReadContext` / the raw event store), and the two gates that belong to a surface
 * rather than to a read model — the ADR-0009 test-label gate on the discovery feed, and the
 * spec-validity admission gate that the SDK reader applies itself.
 *
 * Public API is unchanged from the pre-drain `src/queries/auctions.tsx`: every reader keeps its
 * positional signature (including the `fetchFn` test seam), every query key is literal-identical,
 * and every getter is re-exported from the SDK module at the bottom.
 *
 * Sanctioned deviation (D1 slice 8): the private-auction-claim read stays here. It needs the raw
 * active signer and a 6 s timeout the `EventReadContext` port cannot express, so the four
 * src-owned claim helpers are re-exported through `@platform/web/readContext` (which already
 * owns the `@/lib` NDK edge) instead of adding a new src-importing platform file.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	applesauceIo,
	createApplesauceReadContext,
	getRawEventStore,
	useSubscriptionEvents,
	type NostrFilter,
} from '@platform/web/readContext'
import { excludeTestLabeledEvents } from '@platform/web/config/testLabelsBinding'
import {
	decryptPrivateAuctionClaimMessageForActiveSigner,
	getAuctionClaimPublicMarkerFields,
	privateAuctionClaimMatchesPublicMarker,
	type PrivateAuctionClaimMessage,
} from '@platform/web/readContext'
import {
	buildAuctionBidFilters,
	collapseAuctionVersions,
	fetchAuction as fetchAuctionRead,
	fetchAuctionBids as fetchAuctionBidsRead,
	fetchAuctionBidsByBidder as fetchAuctionBidsByBidderRead,
	fetchAuctionBidsForList as fetchAuctionBidsForListRead,
	fetchAuctionByATag as fetchAuctionByATagRead,
	fetchAuctionClaimOrders as fetchAuctionClaimOrdersRead,
	fetchAuctionPathReleases as fetchAuctionPathReleasesRead,
	fetchAuctionPathReleasesForList as fetchAuctionPathReleasesForListRead,
	fetchAuctionSettlements as fetchAuctionSettlementsRead,
	fetchAuctionSettlementsForList as fetchAuctionSettlementsForListRead,
	fetchAuctionVerdicts as fetchAuctionVerdictsRead,
	fetchAuctionWithRetry as fetchAuctionWithRetryRead,
	fetchAuctions as fetchAuctionsRead,
	fetchAuctionsByPubkey as fetchAuctionsByPubkeyRead,
	mergeAndSortBids,
	recordAuctionDeletion as recordAuctionDeletionInStore,
	toStableUniqueStrings,
	type AuctionByPubkeyReadOptions,
} from '@sdk/commerce/auctions/auctionRead'
import { AUCTION_BID_KIND, AUCTION_KIND } from '@sdk/commerce/auctions/constants'
import { filterBlacklistedEvents } from '@sdk/config/blacklist'
import type { EventFilter, EventReadContext } from '@sdk/core/event-store'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { NIP59_GIFT_WRAP_KIND } from '@sdk/core/nostr/nip59'
import { auctionKeys, type AuctionByPubkeyScope } from '@sdk/core/query/queryKeyFactory'

/** Every getter (and every pure helper) the read model exports, re-exported for existing consumers. */
export * from '@sdk/commerce/auctions/auctionRead'

/**
 * The kind-1025 path-release and kind-1024 settlement parsers, re-exported so the auction publish
 * bindings re-validate with the exact schemas the read path uses. They live in the SDK now (D2
 * slice 23 moved the module out of `src/lib/schemas`), so this clause opens no `platform -> src`
 * edge.
 */
export { parsePathReleaseEvent, parseSettlementEvent } from '@sdk/commerce/auctions/schemas/settlementEvents'

type EventFetcher = (filter: EventFilter | EventFilter[]) => Promise<NostrEventLike[]>

/**
 * The host read context for one call. `createApplesauceReadContext()` is built per call, exactly as
 * the pre-drain module did, so the auction suites' `applesauceIo.fetchEvents` monkey-patch still
 * intercepts. An injected `fetchFn` (the tests' seam) replaces only the fetch half; the store stays
 * the module singleton.
 */
const readContextFor = (fetchFn?: EventFetcher): EventReadContext => {
	if (!fetchFn) return createApplesauceReadContext()
	return {
		store: getRawEventStore(),
		// Mirrors `createApplesauceReadContext`: a one-filter batch is handed to the port unwrapped.
		fetch: async (filters) => fetchFn(filters.length === 1 ? (filters[0] as EventFilter) : (filters as EventFilter[])),
	}
}

/** Records the author's own published deletion so later reads drop it even if relays keep serving the auction. */
export const recordAuctionDeletion = (deletion: NostrEventLike) => recordAuctionDeletionInStore(getRawEventStore(), deletion)

export const fetchAuctions = async (limit: number = 200): Promise<NostrEventLike[]> => {
	// Discovery surface (the auction feed): the SDK reader applies blacklist → local deletes →
	// version collapse → spec validity; the ADR-0009 test-label gate is this surface's, applied to
	// the collapsed set (it is coordinate-based, so every version of a labeled auction drops together).
	return excludeTestLabeledEvents(await fetchAuctionsRead(createApplesauceReadContext(), limit))
}

export const fetchAuction = (id: string, verifySignatures = false): Promise<NostrEventLike | null> =>
	fetchAuctionRead(createApplesauceReadContext(), id, verifySignatures)

export const fetchAuctionWithRetry = (id: string, verifySignatures = false, attempts = 3, delayMs = 500) =>
	fetchAuctionWithRetryRead(createApplesauceReadContext(), id, verifySignatures, attempts, delayMs)

export const fetchAuctionsByPubkey = (pubkey: string, limit: number = 100, options: AuctionByPubkeyReadOptions = {}) =>
	fetchAuctionsByPubkeyRead(createApplesauceReadContext(), pubkey, limit, options)

export const fetchAuctionByATag = (pubkey: string, dTag: string) => fetchAuctionByATagRead(createApplesauceReadContext(), pubkey, dTag)

export const fetchAuctionBidsForList = (auctionRootEventIds: string[], limit: number = 1000) =>
	fetchAuctionBidsForListRead(createApplesauceReadContext(), auctionRootEventIds, limit)

export const fetchAuctionSettlementsForList = (
	auctionRootEventIds: string[],
	auctionCoordinates: string[],
	limit: number = 200,
	fetchFn?: EventFetcher,
) => fetchAuctionSettlementsForListRead(readContextFor(fetchFn), auctionRootEventIds, auctionCoordinates, limit)

export const fetchAuctionPathReleasesForList = (auctionCoordinates: string[], limit: number = 200, fetchFn?: EventFetcher) =>
	fetchAuctionPathReleasesForListRead(readContextFor(fetchFn), auctionCoordinates, limit)

export const fetchAuctionBids = (
	auctionEventId: string,
	limit: number | null = 500,
	auctionCoordinates?: string,
	verifySignatures = false,
) => fetchAuctionBidsRead(createApplesauceReadContext(), auctionEventId, limit, auctionCoordinates, verifySignatures)

export const fetchAuctionBidsByBidder = (pubkey: string, limit: number | null = 500, verifySignatures = false, since?: number) =>
	fetchAuctionBidsByBidderRead(createApplesauceReadContext(), pubkey, limit, verifySignatures, since)

export const fetchAuctionSettlements = (
	auctionEventId: string,
	limit: number | null = 100,
	auctionCoordinates?: string,
	fetchFn?: EventFetcher,
	verifySignatures = false,
) => fetchAuctionSettlementsRead(readContextFor(fetchFn), auctionEventId, limit, auctionCoordinates, verifySignatures)

export const fetchAuctionPathReleases = (
	auctionEventId: string,
	limit: number | null = 200,
	auctionCoordinates?: string,
	fetchFn?: EventFetcher,
	verifySignatures = false,
) => fetchAuctionPathReleasesRead(readContextFor(fetchFn), auctionEventId, limit, auctionCoordinates, verifySignatures)

export const fetchAuctionVerdicts = (
	auctionEventId: string,
	limit: number | null = 500,
	auctionCoordinates?: string,
	validatorPubkeys?: string[],
	fetchFn?: EventFetcher,
) => fetchAuctionVerdictsRead(readContextFor(fetchFn), auctionEventId, limit, auctionCoordinates, validatorPubkeys)

// ---------------------------------------------------------------------------
// Query options and hooks — keys are literal-identical to the pre-drain module.
// ---------------------------------------------------------------------------

export const auctionsQueryOptions = (limit: number = 200) =>
	queryOptions({
		queryKey: auctionKeys.all,
		queryFn: () => fetchAuctions(limit),
		staleTime: 30000,
		refetchOnMount: 'always',
	})

export const auctionsByPubkeyQueryOptions = (pubkey: string, limit: number = 100, options: AuctionByPubkeyReadOptions = {}) => {
	const scope: AuctionByPubkeyScope = options.includeInvalid ? 'owner' : 'browsing'
	return queryOptions({
		queryKey: auctionKeys.byPubkey(pubkey, scope),
		queryFn: () => fetchAuctionsByPubkey(pubkey, limit, options),
		enabled: !!pubkey,
	})
}

export const auctionQueryOptions = (id: string, verifySignatures = false, retryUnavailable = false) =>
	queryOptions({
		queryKey: [...auctionKeys.details(id), verifySignatures ? 'verified' : 'unverified'],
		queryFn: () => (retryUnavailable ? fetchAuctionWithRetry(id, verifySignatures) : fetchAuction(id, verifySignatures)),
		staleTime: 300000,
		enabled: !!id,
	})

export const auctionByATagQueryOptions = (pubkey: string, dTag: string) =>
	queryOptions({
		queryKey: auctionKeys.byATag(pubkey, dTag),
		queryFn: () => fetchAuctionByATag(pubkey, dTag),
		staleTime: 300000,
		enabled: !!(pubkey && dTag),
	})

/**
 * Query options for the batched list-page bid fetch. The query key is keyed by
 * the *sorted* set of auction ids so different list orderings don't bust the
 * cache. The interval is intentionally slower than the per-detail subscription
 * — list pages don't need second-level freshness for every card.
 */
export const auctionBidsForListQueryOptions = (auctionRootEventIds: string[], limit: number = 1000) => {
	const stableKey = toStableUniqueStrings(auctionRootEventIds)
	return queryOptions({
		queryKey: auctionKeys.bidsForList(stableKey),
		queryFn: () => fetchAuctionBidsForList(stableKey, limit),
		enabled: stableKey.length > 0,
		staleTime: 15000,
		refetchInterval: 15000,
	})
}

export const auctionSettlementsForListQueryOptions = (auctionRootEventIds: string[], auctionCoordinates: string[], limit: number = 200) => {
	const stableRootIds = toStableUniqueStrings(auctionRootEventIds)
	const stableCoordinates = toStableUniqueStrings(auctionCoordinates)
	return queryOptions({
		queryKey: auctionKeys.settlementsForList(stableRootIds, stableCoordinates),
		queryFn: () => fetchAuctionSettlementsForList(stableRootIds, stableCoordinates, limit),
		enabled: stableRootIds.length > 0 || stableCoordinates.length > 0,
		staleTime: 15000,
		refetchInterval: 15000,
	})
}

export const auctionPathReleasesForListQueryOptions = (auctionCoordinates: string[], limit: number = 200) => {
	const stableCoordinates = toStableUniqueStrings(auctionCoordinates)
	return queryOptions({
		queryKey: auctionKeys.pathReleasesForList(stableCoordinates),
		queryFn: () => fetchAuctionPathReleasesForList(stableCoordinates, limit),
		enabled: stableCoordinates.length > 0,
		staleTime: 15000,
		refetchInterval: 15000,
	})
}

/*
 * One batched bid query for the whole list.
 * See `auctionBidsForListQueryOptions` for rationale.
 */
export const useAuctionBidsForList = (auctionRootEventIds: string[], limit: number = 1000) =>
	useQuery({
		...auctionBidsForListQueryOptions(auctionRootEventIds, limit),
	})

export const useAuctionSettlementsForList = (auctionRootEventIds: string[], auctionCoordinates: string[], limit: number = 200) =>
	useQuery({
		...auctionSettlementsForListQueryOptions(auctionRootEventIds, auctionCoordinates, limit),
	})

export const useAuctionPathReleasesForList = (auctionCoordinates: string[], limit: number = 200) =>
	useQuery({
		...auctionPathReleasesForListQueryOptions(auctionCoordinates, limit),
	})

export const auctionBidsQueryOptions = (auctionEventId: string, limit: number = 500, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.bids(auctionEventId || auctionCoordinates || ''), auctionCoordinates || ''],
		queryFn: () => fetchAuctionBids(auctionEventId, limit, auctionCoordinates),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const auctionBidsByBidderQueryOptions = (pubkey: string, limit: number = 500) =>
	queryOptions({
		queryKey: auctionKeys.byBidder(pubkey),
		queryFn: () => fetchAuctionBidsByBidder(pubkey, limit),
		enabled: !!pubkey,
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const auctionSettlementsQueryOptions = (
	auctionEventId: string,
	limit: number = 100,
	auctionCoordinates?: string,
	verifySignatures = false,
) =>
	queryOptions({
		queryKey: [
			...auctionKeys.settlements(auctionEventId || auctionCoordinates || ''),
			auctionCoordinates || '',
			verifySignatures ? 'verified' : 'unverified',
		],
		queryFn: () => fetchAuctionSettlements(auctionEventId, limit, auctionCoordinates, undefined, verifySignatures),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const auctionPathReleasesQueryOptions = (auctionEventId: string, limit: number = 200, auctionCoordinates?: string) =>
	queryOptions({
		queryKey: [...auctionKeys.pathReleases(auctionEventId || auctionCoordinates || ''), auctionCoordinates || ''],
		queryFn: () => fetchAuctionPathReleases(auctionEventId, limit, auctionCoordinates),
		enabled: !!auctionCoordinates?.trim(),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const auctionVerdictsQueryOptions = (
	auctionEventId: string,
	limit: number = 500,
	auctionCoordinates?: string,
	validatorPubkeys?: string[],
) =>
	queryOptions({
		// The auditor set is part of the key: two views of the same auction with
		// different configured auditors must never share cached verdicts.
		queryKey: [
			...auctionKeys.verdicts(auctionEventId || auctionCoordinates || ''),
			auctionCoordinates || '',
			validatorPubkeys ? toStableUniqueStrings(validatorPubkeys) : [],
		],
		queryFn: () => fetchAuctionVerdicts(auctionEventId, limit, auctionCoordinates, validatorPubkeys),
		enabled: !!(auctionEventId || auctionCoordinates),
		staleTime: 5000,
		refetchInterval: 5000,
	})

export const useAuctionBids = (auctionEventId: string, limit: number = 500, auctionCoordinates?: string) =>
	useQuery({
		...auctionBidsQueryOptions(auctionEventId, limit, auctionCoordinates),
	})

export function useStreamingAuctionBids(
	auctionRootEventId: string,
	limit: number = 500,
	auctionCoordinates?: string,
): { bids: NostrEventLike[]; isStreaming: boolean } {
	const [bids, setBids] = useState<NostrEventLike[]>([])
	const [isStreaming, setIsStreaming] = useState(false)
	const seenIds = useRef(new Set<string>())
	const pendingBids = useRef<NostrEventLike[]>([])
	const eoseReceived = useRef(false)

	useEffect(() => {
		if (!auctionRootEventId && !auctionCoordinates) return
		// Clear buffers but keep displayed bids — avoids a flash of empty state when
		// auctionCoordinates arrives after the auction query resolves.
		seenIds.current.clear()
		pendingBids.current = []
		eoseReceived.current = false
		setIsStreaming(true)

		const filters = buildAuctionBidFilters(auctionRootEventId, auctionCoordinates, limit)

		// Merge pending buffer into state without clearing existing bids — prevents
		// a flash of empty state when the effect re-runs as auctionCoordinates resolves.
		const flushPending = () => {
			const incoming = pendingBids.current
			pendingBids.current = []
			setBids((prev) => mergeAndSortBids(prev, incoming))
		}

		const settle = () => {
			eoseReceived.current = true
			flushPending()
			setIsStreaming(false)
		}

		const unsubscribe = applesauceIo.subscribe(
			filters.length === 1 ? filters[0] : filters,
			(rawEvent) => {
				const event = rawEvent as NostrEventLike
				if (seenIds.current.has(event.id)) return
				seenIds.current.add(event.id)
				const [filtered] = filterBlacklistedEvents([event])
				if (!filtered) return

				if (!eoseReceived.current) {
					pendingBids.current.push(filtered)
				} else {
					setBids((prev) => mergeAndSortBids(prev, [filtered]))
				}
			},
			{ onEose: settle },
		)

		const timeoutId = setTimeout(() => {
			if (eoseReceived.current) return
			settle()
		}, 10000)

		return () => {
			clearTimeout(timeoutId)
			unsubscribe()
		}
	}, [auctionRootEventId, auctionCoordinates, limit])

	return { bids, isStreaming }
}

export const useAuctionBidsByBidder = (pubkey: string, limit: number = 500) =>
	useQuery({
		...auctionBidsByBidderQueryOptions(pubkey, limit),
	})

/**
 * Live subscription to a bidder's bid events (kind 1023 by author), routed
 * through the applesauce I/O adapter. Used by the auctions home page
 * "You Previously Bid" grid so it updates without polling.
 */
export const useAuctionBidsByBidderStream = (pubkey: string, limit: number = 500): { bids: NostrEventLike[]; isStreaming: boolean } => {
	const filter = useMemo<NostrFilter | null>(
		() => (pubkey ? { kinds: [AUCTION_BID_KIND], authors: [pubkey], limit } : null),
		[pubkey, limit],
	)
	const { events, isStreaming } = useSubscriptionEvents(filter, !!pubkey)
	const bids = useMemo(() => filterBlacklistedEvents(events), [events])
	return { bids, isStreaming }
}

/**
 * Live subscription to a seller's auction events (kind 30408 by author) with
 * version collapsing, routed through applesauce. Used by the auctions home
 * page "Your Auctions" grid so it updates without polling.
 */
export const useAuctionsByPubkeyStream = (pubkey: string, limit: number = 100): { auctions: NostrEventLike[]; isStreaming: boolean } => {
	const filter = useMemo<NostrFilter | null>(() => (pubkey ? { kinds: [AUCTION_KIND], authors: [pubkey], limit } : null), [pubkey, limit])
	const { events, isStreaming } = useSubscriptionEvents(filter, !!pubkey)
	// Synchronous: drops deletions the raw store has already seen (own deletes, earlier reads' lookups).
	const auctions = useMemo(
		() => collapseAuctionVersions(filterBlacklistedEvents(events).filter((event) => !getRawEventStore().isDeleted(event))),
		[events],
	)
	return { auctions, isStreaming }
}

export const useAuctionSettlements = (auctionEventId: string, limit: number = 100, auctionCoordinates?: string) =>
	useQuery({
		...auctionSettlementsQueryOptions(auctionEventId, limit, auctionCoordinates),
	})

export const useAuctionPathReleases = (auctionEventId: string, limit: number = 200, auctionCoordinates?: string) =>
	useQuery({
		...auctionPathReleasesQueryOptions(auctionEventId, limit, auctionCoordinates),
	})

export const useAuctionVerdicts = (auctionEventId: string, limit: number = 500, auctionCoordinates?: string, validatorPubkeys?: string[]) =>
	useQuery({
		...auctionVerdictsQueryOptions(auctionEventId, limit, auctionCoordinates, validatorPubkeys),
	})

// ---------------------------------------------------------------------------
// Auction Claim Order — Kind 16 order events linked to an auction via `a` tag
// ---------------------------------------------------------------------------

export const fetchAuctionClaimOrders = (auctionCoordinates: string) =>
	fetchAuctionClaimOrdersRead(createApplesauceReadContext(), auctionCoordinates)

export const auctionClaimOrdersQueryOptions = (auctionCoordinates: string) =>
	queryOptions({
		queryKey: [...auctionKeys.all, 'claimOrders', auctionCoordinates],
		queryFn: () => fetchAuctionClaimOrders(auctionCoordinates),
		enabled: !!auctionCoordinates,
		staleTime: 10000,
		refetchInterval: 10000,
	})

export const useAuctionClaimOrders = (auctionCoordinates: string) =>
	useQuery({
		...auctionClaimOrdersQueryOptions(auctionCoordinates),
	})

// ---------------------------------------------------------------------------
// Private auction claim — the sanctioned deviation (see the module docblock).
// ---------------------------------------------------------------------------

export type PrivateAuctionClaimLookupResult =
	| { status: 'found'; claim: PrivateAuctionClaimMessage }
	| { status: 'not_found' }
	| { status: 'unavailable'; reason: 'missing_marker_fields' | 'no_signer' | 'not_seller' | 'relay_error' }

const PRIVATE_AUCTION_CLAIM_GIFT_WRAP_PAGE_LIMIT = 100
const PRIVATE_AUCTION_CLAIM_GIFT_WRAP_MAX_PAGES = 5
const PRIVATE_AUCTION_CLAIM_GIFT_WRAP_WINDOW_SECONDS = 60 * 60 * 24
const PRIVATE_AUCTION_CLAIM_GIFT_WRAP_POST_MARKER_GRACE_SECONDS = 5 * 60

export const fetchPrivateAuctionClaimForMarker = async (publicMarker: NostrEventLike): Promise<PrivateAuctionClaimLookupResult> => {
	const markerFields = getAuctionClaimPublicMarkerFields({ pubkey: publicMarker.pubkey, tags: publicMarker.tags })
	if (!markerFields) return { status: 'unavailable', reason: 'missing_marker_fields' }

	const activeUser = await applesauceIo.getUser()
	if (!activeUser?.pubkey) return { status: 'unavailable', reason: 'no_signer' }
	if (activeUser.pubkey !== markerFields.sellerPubkey) return { status: 'unavailable', reason: 'not_seller' }

	const matches: PrivateAuctionClaimMessage[] = []
	const seenGiftWrapIds = new Set<string>()
	const markerCreatedAt = publicMarker.created_at
	const hasMarkerCreatedAt = Number.isSafeInteger(markerCreatedAt) && (markerCreatedAt ?? 0) > 0
	const since = hasMarkerCreatedAt ? Math.max(0, (markerCreatedAt ?? 0) - PRIVATE_AUCTION_CLAIM_GIFT_WRAP_WINDOW_SECONDS) : undefined
	let until = hasMarkerCreatedAt ? (markerCreatedAt ?? 0) + PRIVATE_AUCTION_CLAIM_GIFT_WRAP_POST_MARKER_GRACE_SECONDS : undefined

	// The private gift wrap is expected just before the public marker. A small
	// post-marker grace covers relay timestamp/clock skew while keeping the
	// lookup bounded at 5 pages / 500 seller-addressed gift wraps.
	for (let page = 0; page < PRIVATE_AUCTION_CLAIM_GIFT_WRAP_MAX_PAGES; page += 1) {
		const filter: NostrFilter = {
			kinds: [NIP59_GIFT_WRAP_KIND as unknown as NonNullable<NostrFilter['kinds']>[number]],
			'#p': [markerFields.sellerPubkey],
			limit: PRIVATE_AUCTION_CLAIM_GIFT_WRAP_PAGE_LIMIT,
			...(since !== undefined ? { since } : {}),
			...(until !== undefined ? { until } : {}),
		}

		let events: Awaited<ReturnType<typeof applesauceIo.fetchEvents>>
		try {
			events = await applesauceIo.fetchEvents(filter, { timeoutMs: 6000 })
		} catch (error) {
			// The applesauce adapter REJECTS on a subscription error (the NDK helper
			// this replaced resolved). Left uncaught, a relay error would throw out
			// of the query instead of the `unavailable` result the UI handles.
			// Keep the reason diagnosable without logging marker/claim data.
			// (review 2026-09-18)
			console.warn('[private-claim] relay read failed:', error instanceof Error ? error.message : String(error))
			return { status: 'unavailable', reason: 'relay_error' }
		}
		if (events.length === 0) break

		let oldestCreatedAt: number | undefined
		for (const giftWrap of events) {
			if (Number.isSafeInteger(giftWrap.created_at) && (oldestCreatedAt === undefined || (giftWrap.created_at ?? 0) < oldestCreatedAt)) {
				oldestCreatedAt = giftWrap.created_at
			}

			if (giftWrap.id && seenGiftWrapIds.has(giftWrap.id)) continue
			if (giftWrap.id) seenGiftWrapIds.add(giftWrap.id)

			try {
				const claim = await decryptPrivateAuctionClaimMessageForActiveSigner({
					giftWrap,
					expectedBuyerPubkey: markerFields.buyerPubkey,
					expectedSellerPubkey: markerFields.sellerPubkey,
					expectedOrderId: markerFields.orderId,
				})
				if (privateAuctionClaimMatchesPublicMarker(claim.payload, markerFields)) {
					matches.push(claim)
				}
			} catch {
				// Relay data is untrusted. Ignore malformed, unrelated, or undecryptable gift wraps without logging private payloads.
			}
		}

		if (matches.length > 0) break
		if (oldestCreatedAt === undefined) break

		const nextUntil = oldestCreatedAt - 1
		if (since !== undefined && nextUntil < since) break
		until = nextUntil
		if (until < 0) break
		if (seenGiftWrapIds.size === 0) {
			break
		}
	}

	if (matches.length === 0) return { status: 'not_found' }

	matches.sort((a, b) => {
		const createdAtDelta = (b.rumor.created_at ?? 0) - (a.rumor.created_at ?? 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return (b.rumor.id ?? '').localeCompare(a.rumor.id ?? '')
	})

	return { status: 'found', claim: matches[0] }
}

export const privateAuctionClaimQueryOptions = (publicMarker: NostrEventLike | null | undefined, enabled: boolean = true) =>
	queryOptions({
		queryKey: [...auctionKeys.all, 'privateClaim', publicMarker?.id ?? ''],
		queryFn: () => {
			if (!publicMarker) return Promise.resolve<PrivateAuctionClaimLookupResult>({ status: 'not_found' })
			return fetchPrivateAuctionClaimForMarker(publicMarker)
		},
		enabled: enabled && !!publicMarker,
		staleTime: 10000,
	})

export const usePrivateAuctionClaimForOrder = (publicMarker: NostrEventLike | null | undefined, enabled: boolean = true) =>
	useQuery({
		...privateAuctionClaimQueryOptions(publicMarker, enabled),
	})
