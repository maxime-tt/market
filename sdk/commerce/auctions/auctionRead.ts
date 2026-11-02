import type { MintKeys } from '@cashu/cashu-ts'
import { getAuctionId } from '@sdk/commerce/auctions/auctionId'
import { computeValidatedBids, type ValidatedBidSet } from '@sdk/commerce/auctions/bidValidation'
import {
	AUCTION_BID_KIND,
	AUCTION_KIND,
	AUCTION_PATH_RELEASE_KIND,
	AUCTION_ROOT_EVENT_ID_TAG,
	AUCTION_SETTLEMENT_KIND,
	DEFAULT_AUDITOR_QUORUM,
	VALIDATOR_VERDICT_KIND,
	type Nut7ProofState,
} from '@sdk/commerce/auctions/constants'
import type { ParsedAuctionEvent, ParsedBidEvent, ParsedValidatorVerdictEvent } from '@sdk/commerce/auctions/events'
import {
	getAuctionBiddingCutoffAt as getAuctionBiddingCutoffAtValue,
	getAuctionCurrentPrice as computeAuctionCurrentPrice,
	getAuctionEffectiveEndAt as computeAuctionEffectiveEndAt,
	getAuctionEndAt as getAuctionEndAtValue,
	getAuctionExtensionRule as parseAuctionExtensionRule,
	getAuctionMaxEndAt as getAuctionMaxEndAtValue,
	getAuctionSettlementGrace as getAuctionSettlementGraceValue,
	getAuctionRootEventId as getAuctionRootEventIdValue,
	getAuctionStartAt as getAuctionStartAtValue,
	getAuctionWindowValidBids,
	resolveAuctionVersionSet,
} from '@sdk/commerce/auctions/settlement'
import { ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@sdk/commerce/messaging/orderSchema'
import { filterBlacklistedEvents } from '@sdk/config/blacklist'
import { excludeDeleted, type EventFilter, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'
import { toRawEvent, type NostrEventLike } from '@sdk/core/nostr/eventLike'
import { verifyNostrEventSignature } from '@sdk/core/nostr/eventSignature'
import { filterAdmissibleAuctionEvents } from './schemas/auctionAdmission'
import { parseAuctionEvent } from './schemas/auctionEvent'
import { parseBidEvent } from './schemas/bidEvent'
import { parseValidatorVerdictEvent } from './schemas/validatorEvents'

const filterVerifiedAuctionEvents = (events: NostrEventLike[], verifySignatures: boolean): NostrEventLike[] => {
	if (!verifySignatures) return events
	return events.filter((event) => {
		try {
			return verifyNostrEventSignature(toRawEvent(event) as Parameters<typeof verifyNostrEventSignature>[0])
		} catch {
			return false
		}
	})
}

export type AuctionSettlementStatus = 'settled' | 'reserve_not_met' | 'cancelled' | 'unknown'

const AUCTION_LIST_FILTER_CHUNK_SIZE = 80

/** Records the author's own published deletion so later reads drop it even if relays keep serving the auction. */
export const recordAuctionDeletion = async (store: EventStorePort<NostrEventLike>, deletion: NostrEventLike): Promise<void> => {
	await store.add(deletion)
}

// Deletion lookup only: auction reads keep every version, because the canonical event is resolved from the whole version set.
const filterDeletedAuctions = (context: EventReadContext, events: NostrEventLike[]): Promise<NostrEventLike[]> =>
	excludeDeleted(context, events)

const dedupeEventsById = (events: NostrEventLike[]): NostrEventLike[] => {
	const eventsById = new Map<string, NostrEventLike>()
	for (const event of events) {
		eventsById.set(event.id, event)
	}
	return Array.from(eventsById.values())
}

export const toStableUniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean))).sort()

const chunkStrings = (values: string[], size: number): string[][] => {
	const chunks: string[][] = []
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size))
	}
	return chunks
}

const cloneAuctionEventWithRootId = (event: NostrEventLike, rootEventId: string): NostrEventLike => ({
	...event,
	tags: [...event.tags.filter((tag) => tag[0] !== AUCTION_ROOT_EVENT_ID_TAG), [AUCTION_ROOT_EVENT_ID_TAG, rootEventId]],
})

const getAuctionGroupingKey = (event: NostrEventLike): string => {
	const dTag = getAuctionId(event)
	return dTag ? `${event.pubkey}:${dTag}` : event.id
}

const resolveCanonicalAuctionEvent = (events: NostrEventLike[]): NostrEventLike | null => {
	const resolved = resolveAuctionVersionSet(events)
	if (!resolved) return null
	return cloneAuctionEventWithRootId(resolved.displayEvent, resolved.rootEventId)
}

export const collapseAuctionVersions = (events: NostrEventLike[]): NostrEventLike[] => {
	const groupedEvents = new Map<string, NostrEventLike[]>()
	for (const event of events) {
		const key = getAuctionGroupingKey(event)
		const group = groupedEvents.get(key)
		if (group) group.push(event)
		else groupedEvents.set(key, [event])
	}

	return Array.from(groupedEvents.values())
		.map((group) => resolveCanonicalAuctionEvent(group))
		.filter((event): event is NostrEventLike => !!event)
}

const fetchAuctionVersionEvents = async (
	context: EventReadContext,
	pubkey: string,
	dTag: string,
	limit: number = 50,
): Promise<NostrEventLike[]> => {
	if (!pubkey || !dTag) return []

	const events = await context.fetch([
		{
			kinds: [AUCTION_KIND],
			authors: [pubkey],
			'#d': [dTag],
			limit,
		},
	])
	// NOT gated, deliberately — neither on test labels nor on spec validity. This
	// read resolves a coordinate's version set for three callers that must keep a
	// labeled *and* a malformed auction reachable: detail-by-id,
	// detail-by-a-tag, and the Featured carousel's by-a-tag read (a curation
	// surface, ungated by the ADR-0009 rev 4 taxonomy). ADR-0009 step 3 — "the
	// label never removes the item from direct navigation" — is only true if this
	// read stays clean, and the same holds for validity: the detail page has to
	// resolve the event to render the notice that explains why it is missing from
	// browsing. The gates belong to the surfaces that compose this read:
	// `fetchAuctions` and `fetchAuctionsByPubkey`.
	return filterDeletedAuctions(context, filterBlacklistedEvents(events))
}

export const fetchAuctions = async (context: EventReadContext, limit: number = 200): Promise<NostrEventLike[]> => {
	const filter: EventFilter = {
		kinds: [AUCTION_KIND],
		limit,
	}

	const events = await context.fetch([filter])
	// Discovery surface (the auction feed): blacklist → local deletes, then
	// collapse versions. The test-label gate is the host's — this reader returns
	// the filtered-but-ungated set (ADR-0009: label gating is browsing-only and
	// belongs to the surface that composes this read).
	const filteredEvents = await filterDeletedAuctions(context, filterBlacklistedEvents(events))
	// Spec-validity admission (AUCTIONS.md §4.1). This is a *browsing* gate, not
	// a read gate: an event that is shaped like a 30408 but is not a well-formed
	// auction must not take a card slot — least of all slot #1, which it wins
	// outright when its close time is missing. Applied to the collapsed set, so
	// the decision is made about the version the feed would actually render.
	const admittedEvents = filterAdmissibleAuctionEvents(collapseAuctionVersions(filteredEvents))
	return admittedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuction = async (context: EventReadContext, id: string, verifySignatures = false): Promise<NostrEventLike | null> => {
	if (!id) return null

	const filter: EventFilter = {
		kinds: [AUCTION_KIND],
		ids: [id],
		limit: 1,
	}

	const events = await context.fetch([filter])
	const event = filterVerifiedAuctionEvents(events, verifySignatures)[0] ?? null
	if (!event) return null
	const dTag = getAuctionId(event)
	if (dTag && (await filterDeletedAuctions(context, [event])).length === 0) return null
	if (!dTag) return filterBlacklistedEvents([event])[0] || null

	const versionEvents = filterVerifiedAuctionEvents(await fetchAuctionVersionEvents(context, event.pubkey, dTag), verifySignatures)
	return resolveCanonicalAuctionEvent(dedupeEventsById([event, ...versionEvents]))
}

export const fetchAuctionWithRetry = async (
	context: EventReadContext,
	id: string,
	verifySignatures = false,
	attempts = 3,
	delayMs = 500,
): Promise<NostrEventLike | null> => {
	for (let attempt = 0; attempt < attempts; attempt++) {
		const auction = await fetchAuction(context, id, verifySignatures)
		if (auction) return auction
		if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
	}
	return null
}

/**
 * Options for the by-pubkey auction read. The spec-validity gate (see
 * `inspectAuctionAdmission`) applies by default, because this read backs
 * browsing surfaces — the seller's profile and "more from seller". The owner
 * dashboard opts out: ADR-0009 keeps the owner's own inventory reachable, and an
 * owner cannot republish a corrected event they cannot see. The detail page
 * carries the notice that explains the state either way.
 */
export interface AuctionByPubkeyReadOptions {
	includeInvalid?: boolean
}

export const fetchAuctionsByPubkey = async (
	context: EventReadContext,
	pubkey: string,
	limit: number = 100,
	options: AuctionByPubkeyReadOptions = {},
): Promise<NostrEventLike[]> => {
	if (!pubkey) return []

	const filter: EventFilter = {
		kinds: [AUCTION_KIND],
		authors: [pubkey],
		limit,
	}

	const events = await context.fetch([filter])
	// Test labels do not gate this read (ADR-0009: label gating is
	// browsing-only, and this surface is also how the owner reaches their own
	// inventory). Spec validity does, unless the caller opts out — see
	// `AuctionByPubkeyReadOptions`.
	const collapsed = collapseAuctionVersions(await filterDeletedAuctions(context, filterBlacklistedEvents(events)))
	const admitted = options.includeInvalid ? collapsed : filterAdmissibleAuctionEvents(collapsed)
	return admitted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export const fetchAuctionByATag = async (context: EventReadContext, pubkey: string, dTag: string): Promise<NostrEventLike | null> => {
	if (!pubkey || !dTag) return null

	const versionEvents = await fetchAuctionVersionEvents(context, pubkey, dTag)
	if (versionEvents.length === 0) {
		const fallbackEvents = await context.fetch([
			{
				kinds: [AUCTION_KIND],
				authors: [pubkey],
				'#d': [dTag],
				limit: 1,
			},
		])
		const event = fallbackEvents[0] ?? null
		if (!event) return null
		if ((await filterDeletedAuctions(context, [event])).length === 0) return null
		return resolveCanonicalAuctionEvent([event])
	}

	return resolveCanonicalAuctionEvent(versionEvents)
}

/**
 * Batch-fetch bids for a set of auctions in a single relay subscription.
 *
 * The auctions list page may render hundreds of cards; if every card runs its
 * own `useAuctionBids` (which polls every 5s), we issue hundreds of parallel
 * subscriptions to the relay, saturate it, and end up with empty/stale price
 * displays. Instead the list resolves all visible auctions' bids in one
 * `kinds: [1023], '#e': [...ids]` filter and slices the result per auction in
 * memory.
 *
 * Returns a Map<rootEventId, NostrEventLike[]> keyed by the auction root event id.
 */
export const fetchAuctionBidsForList = async (
	context: EventReadContext,
	auctionRootEventIds: string[],
	limit: number = 1000,
): Promise<Map<string, NostrEventLike[]>> => {
	const ids = Array.from(new Set(auctionRootEventIds.filter(Boolean)))
	if (ids.length === 0) return new Map()

	const events = await context.fetch([
		{
			kinds: [AUCTION_BID_KIND],
			'#e': ids,
			limit,
		},
	])

	const byAuctionId = new Map<string, NostrEventLike[]>()
	for (const id of ids) byAuctionId.set(id, [])
	for (const bid of filterBlacklistedEvents(events)) {
		const auctionEventId = bid.tags.find((tag) => tag[0] === 'e')?.[1]
		if (!auctionEventId) continue
		const bucket = byAuctionId.get(auctionEventId)
		if (bucket) bucket.push(bid)
	}
	byAuctionId.forEach((bucket) => bucket.sort((a, b) => (a.created_at || 0) - (b.created_at || 0)))
	return byAuctionId
}

/**
 * Batch-fetch settlements for a list of auctions and group results by both
 * root event id (`#e`) and coordinate (`#a`).
 */
export const fetchAuctionSettlementsForList = async (
	context: EventReadContext,
	auctionRootEventIds: string[],
	auctionCoordinates: string[],
	limit: number = 200,
): Promise<Map<string, NostrEventLike[]>> => {
	const ids = toStableUniqueStrings(auctionRootEventIds)
	const coordinates = toStableUniqueStrings(auctionCoordinates)
	if (ids.length === 0 && coordinates.length === 0) return new Map()

	const filters: EventFilter[] = []
	for (const idChunk of chunkStrings(ids, AUCTION_LIST_FILTER_CHUNK_SIZE)) {
		filters.push({
			kinds: [AUCTION_SETTLEMENT_KIND],
			'#e': idChunk,
			limit,
		})
	}
	for (const coordinateChunk of chunkStrings(coordinates, AUCTION_LIST_FILTER_CHUNK_SIZE)) {
		filters.push({
			kinds: [AUCTION_SETTLEMENT_KIND],
			'#a': coordinateChunk,
			limit,
		})
	}

	if (filters.length === 0) return new Map()

	const events = await context.fetch(filters)
	const settlements = filterBlacklistedEvents(dedupeEventsById(events)).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	const byAuction = new Map<string, NostrEventLike[]>()
	for (const id of ids) byAuction.set(id, [])
	for (const coordinate of coordinates) byAuction.set(coordinate, [])

	for (const settlement of settlements) {
		const rootIds = settlement.tags.filter((tag) => tag[0] === 'e' && !!tag[1]).map((tag) => tag[1])
		const coords = settlement.tags.filter((tag) => tag[0] === 'a' && !!tag[1]).map((tag) => tag[1])
		for (const rootId of rootIds) {
			const bucket = byAuction.get(rootId)
			if (bucket) bucket.push(settlement)
		}
		for (const coord of coords) {
			const bucket = byAuction.get(coord)
			if (bucket) bucket.push(settlement)
		}
	}

	byAuction.forEach((bucket, key) => {
		const dedupedBucket = dedupeEventsById(bucket).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		byAuction.set(key, dedupedBucket)
	})

	return byAuction
}

/**
 * Batch-fetch path releases for a list of auction coordinates.
 */
export const fetchAuctionPathReleasesForList = async (
	context: EventReadContext,
	auctionCoordinates: string[],
	limit: number = 200,
): Promise<Map<string, NostrEventLike[]>> => {
	const coordinates = toStableUniqueStrings(auctionCoordinates)
	if (coordinates.length === 0) return new Map()

	const filters: EventFilter[] = []
	for (const coordinateChunk of chunkStrings(coordinates, AUCTION_LIST_FILTER_CHUNK_SIZE)) {
		filters.push({
			kinds: [AUCTION_PATH_RELEASE_KIND as unknown as number],
			'#a': coordinateChunk,
			limit,
		})
	}

	if (filters.length === 0) return new Map()

	const events = await context.fetch(filters)
	const releases = filterBlacklistedEvents(dedupeEventsById(events)).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

	const byCoordinate = new Map<string, NostrEventLike[]>()
	for (const coordinate of coordinates) byCoordinate.set(coordinate, [])

	for (const release of releases) {
		const releaseCoordinates = release.tags.filter((tag) => tag[0] === 'a' && !!tag[1]).map((tag) => tag[1])
		for (const releaseCoordinate of releaseCoordinates) {
			const bucket = byCoordinate.get(releaseCoordinate)
			if (bucket) bucket.push(release)
		}
	}

	byCoordinate.forEach((bucket, key) => {
		const dedupedBucket = dedupeEventsById(bucket)
			.filter((event) => isAuctionPathReleaseForCoordinate(event, key))
			.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		byCoordinate.set(key, dedupedBucket)
	})

	return byCoordinate
}

export const fetchAuctionBids = async (
	context: EventReadContext,
	auctionEventId: string,
	limit: number | null = 500,
	auctionCoordinates?: string,
	verifySignatures = false,
): Promise<NostrEventLike[]> => {
	if (!auctionEventId && !auctionCoordinates) return []

	const filters: EventFilter[] = []
	if (auctionEventId) {
		filters.push({
			kinds: [AUCTION_BID_KIND],
			'#e': [auctionEventId],
			...(limit === null ? {} : { limit }),
		})
	}
	if (auctionCoordinates) {
		filters.push({
			kinds: [AUCTION_BID_KIND],
			'#a': [auctionCoordinates],
			...(limit === null ? {} : { limit }),
		})
	}

	const events = await context.fetch(filters)
	return filterVerifiedAuctionEvents(filterBlacklistedEvents(events), verifySignatures).sort(
		(a, b) => (a.created_at || 0) - (b.created_at || 0),
	)
}

export const fetchAuctionBidsByBidder = async (
	context: EventReadContext,
	pubkey: string,
	limit: number | null = 500,
	verifySignatures = false,
	since?: number,
): Promise<NostrEventLike[]> => {
	if (!pubkey) return []

	const events = await context.fetch([
		{
			kinds: [AUCTION_BID_KIND],
			authors: [pubkey],
			...(limit === null ? {} : { limit }),
			...(since === undefined ? {} : { since }),
		},
	])
	return filterVerifiedAuctionEvents(filterBlacklistedEvents(events), verifySignatures).sort(
		(a, b) => (b.created_at || 0) - (a.created_at || 0),
	)
}

export const fetchAuctionSettlements = async (
	context: EventReadContext,
	auctionEventId: string,
	limit: number | null = 100,
	auctionCoordinates?: string,
	verifySignatures = false,
): Promise<NostrEventLike[]> => {
	if (!auctionEventId && !auctionCoordinates) return []

	const filters: EventFilter[] = []
	if (auctionEventId) {
		filters.push({
			kinds: [AUCTION_SETTLEMENT_KIND],
			'#e': [auctionEventId],
			...(limit === null ? {} : { limit }),
		})
	}
	if (auctionCoordinates) {
		filters.push({
			kinds: [AUCTION_SETTLEMENT_KIND],
			'#a': [auctionCoordinates],
			...(limit === null ? {} : { limit }),
		})
	}

	const events = await context.fetch(filters)
	return filterVerifiedAuctionEvents(filterBlacklistedEvents(events), verifySignatures).sort(
		(a, b) => (b.created_at || 0) - (a.created_at || 0),
	)
}

/**
 * Fetch all kind-1025 path-release events for an auction. Sellers use
 * this to discover when a winning bidder has settled. Validators use
 * this when deriving verdicts. Path releases are queried by auction
 * coordinate only; never query kind-1025 broadly by root event id alone.
 */
export const fetchAuctionPathReleases = async (
	context: EventReadContext,
	auctionEventId: string,
	limit: number | null = 200,
	auctionCoordinates?: string,
	verifySignatures = false,
): Promise<NostrEventLike[]> => {
	const filter = buildAuctionPathReleaseFilter(auctionCoordinates, limit)
	if (!filter) return []
	const coordinate = filter['#a']?.[0]
	if (!coordinate) return []

	void auctionEventId

	const events = await context.fetch([filter])
	return filterVerifiedAuctionEvents(filterBlacklistedEvents(events), verifySignatures)
		.filter((event) => isAuctionPathReleaseForCoordinate(event, coordinate))
		.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}

export function buildAuctionPathReleaseFilter(auctionCoordinates: string | undefined, limit: number | null = 200): EventFilter | null {
	const coordinate = auctionCoordinates?.trim()
	if (!coordinate) return null
	return {
		kinds: [AUCTION_PATH_RELEASE_KIND as unknown as number],
		'#a': [coordinate],
		...(limit === null ? {} : { limit }),
	}
}

export function isAuctionPathReleaseForCoordinate(event: NostrEventLike, auctionCoordinates: string): boolean {
	return event.tags.some((tag) => tag[0] === 'a' && tag[1] === auctionCoordinates)
}

/**
 * Fetch kind-30440 validator verdicts for an auction. These are
 * parameterised-replaceable per (validator, bidder, auction, bid)
 * — per-bid addressability, ADR-0003 §4.4.1 amendment — so the relay
 * returns at most one verdict per bid per validator.
 *
 * Trust boundary ("signed ≠ authorized", review #1235 Should-fix 3):
 * this surface feeds UI that renders 'Bid Rejected' / 'Bid successfully
 * placed!', so authorization and signature validity are each enforced
 * here *and* kept in `computeVerdictQuorum` (belt and braces):
 *
 * - `validatorPubkeys` is the auction event's `auditors` tags (the same
 *   source `computeVerdictQuorum` counts, via `getAuctionAuditors`). When
 *   provided it is sent as the relay `authors` filter (ADR-0015
 *   production-safe filtering) and re-checked client-side, because
 *   relays may ignore or over-serve filters. An empty list means no
 *   auditor is configured, so nothing is authorized — fail closed.
 * - Every event is explicitly Schnorr-verified at this parse boundary
 *   via the nostr-tools seam (ADR-0002) before it is returned; NDK's
 *   own verification is sampling-based and must not be relied on.
 */
export const fetchAuctionVerdicts = async (
	context: EventReadContext,
	auctionEventId: string,
	limit: number | null = 500,
	auctionCoordinates?: string,
	validatorPubkeys?: string[],
): Promise<NostrEventLike[]> => {
	if (!auctionEventId && !auctionCoordinates) return []
	// Stable (sorted, de-duplicated) author set — same order in the filter and the query key.
	const auditorPubkeys = validatorPubkeys ? toStableUniqueStrings(validatorPubkeys) : undefined
	// Fail closed: an auction with no configured auditors has no authorized verdicts.
	if (auditorPubkeys && auditorPubkeys.length === 0) return []

	const filter: EventFilter = {
		kinds: [VALIDATOR_VERDICT_KIND as unknown as number],
		...(limit === null ? {} : { limit }),
	}
	if (auditorPubkeys) filter.authors = auditorPubkeys
	if (auctionEventId) filter['#e'] = [auctionEventId]
	if (auctionCoordinates) filter['#a'] = [auctionCoordinates]

	const events = await context.fetch([filter])
	return (
		filterBlacklistedEvents(events)
			// Signature verification at the parse boundary: drop unverified events
			// before any component can render a verdict from them.
			.filter(isVerifiedVerdictEvent)
			// Client-side author check: a relay may ignore or over-serve the
			// `authors` filter, so authorization is enforced again here.
			.filter((event) => !auditorPubkeys || auditorPubkeys.includes(event.pubkey))
			.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
	)
}

/**
 * Explicit signature check for kind-30440 verdicts. Tolerates both real
 * `NDKEvent`s (via `rawEvent()`) and duck-typed event objects so the parse
 * boundary never trusts an event it cannot verify.
 */
const isVerifiedVerdictEvent = (event: NostrEventLike & { rawEvent?: () => unknown }): boolean => {
	try {
		const raw = typeof event.rawEvent === 'function' ? event.rawEvent() : event
		return verifyNostrEventSignature(raw as Parameters<typeof verifyNostrEventSignature>[0])
	} catch {
		return false
	}
}

export { getAuctionId } from '@sdk/commerce/auctions/auctionId'
export const getAuctionRootEventId = (event: NostrEventLike | null): string => (event ? getAuctionRootEventIdValue(event) : '')

export const getAuctionTitle = (event: NostrEventLike | null): string =>
	event?.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled Auction'

export const getAuctionSummary = (event: NostrEventLike | null): string => event?.tags.find((t) => t[0] === 'summary')?.[1] || ''

export const getAuctionCategories = (event: NostrEventLike | null): string[] => {
	if (!event) return []
	return event.tags.filter((tag) => tag[0] === 't' && !!tag[1]).map((tag) => tag[1])
}

export const getAuctionImages = (event: NostrEventLike | null): Array<string[]> => {
	if (!event) return []
	return event.tags
		.filter((t) => t[0] === 'image')
		.sort((a, b) => {
			const aOrder = a[3] ? parseInt(a[3], 10) : 0
			const bOrder = b[3] ? parseInt(b[3], 10) : 0
			return aOrder - bOrder
		})
}

export const getAuctionEndAt = (event: NostrEventLike | null): number => {
	return event ? getAuctionEndAtValue(event) : 0
}

export const getAuctionStartAt = (event: NostrEventLike | null): number => {
	return event ? getAuctionStartAtValue(event) : 0
}

export const getAuctionEffectiveEndAt = (event: NostrEventLike | null, bids: NostrEventLike[] = []): number => {
	if (!event) return 0
	return computeAuctionEffectiveEndAt(event, bids)
}

export const getAuctionMaxEndAt = (event: NostrEventLike | null): number => (event ? getAuctionMaxEndAtValue(event) : 0)

export const getAuctionBiddingCutoffAt = (event: NostrEventLike | null): number => (event ? getAuctionBiddingCutoffAtValue(event) : 0)

export const getAuctionSettlementGrace = (event: NostrEventLike | null): number => (event ? getAuctionSettlementGraceValue(event) : 0)

export const getAuctionExtensionRule = (event: NostrEventLike | null): string => (event ? parseAuctionExtensionRule(event).raw : 'none')

/**
 * Display-side bid floor. Reads `starting_bid` and nothing else.
 *
 * The old `price` fallback made this a second source of truth for the same
 * number: `price` is a product-shaped display tag, while `starting_bid` is the
 * protocol floor the parser hard-fails on when absent (#1315) and the value the
 * settlement path and the validators read. A malformed event with no floor
 * therefore rendered a plausible one here — the same "a missing value silently
 * becomes a plausible one" defect this PR's gate closes — and two callers could
 * disagree about the floor of one auction.
 *
 * Absent or unparseable → `0`, i.e. "no declared floor". The detail page's
 * invalid-event notice states that the tag is missing, so the `0` is explained
 * rather than implied.
 */
export const getAuctionStartingBid = (event: NostrEventLike | null): number => {
	if (!event) return 0

	const startingBidTag = event.tags.find((t) => t[0] === 'starting_bid')
	const parsed = startingBidTag?.[1] ? parseInt(startingBidTag[1], 10) : Number.NaN
	return Number.isNaN(parsed) ? 0 : parsed
}

export const getAuctionBidIncrement = (event: NostrEventLike | null): number => {
	if (!event) return 1
	const tag = event.tags.find((t) => t[0] === 'bid_increment')
	const parsed = tag?.[1] ? parseInt(tag[1], 10) : NaN
	return !isNaN(parsed) && parsed > 0 ? parsed : 1
}

export const getAuctionReserve = (event: NostrEventLike | null): number => {
	if (!event) return 0
	const tag = event.tags.find((t) => t[0] === 'reserve')
	const parsed = tag?.[1] ? parseInt(tag[1], 10) : NaN
	return !isNaN(parsed) ? parsed : 0
}

export const getAuctionType = (event: NostrEventLike | null): string => event?.tags.find((t) => t[0] === 'auction_type')?.[1] || 'english'

export const getAuctionCurrency = (event: NostrEventLike | null): string => event?.tags.find((t) => t[0] === 'currency')?.[1] || 'SAT'

export const getAuctionMints = (event: NostrEventLike | null): string[] => {
	if (!event) return []
	return event.tags.filter((tag) => tag[0] === 'mint' && !!tag[1]).map((tag) => tag[1])
}

/**
 * Lock-key derivation method recorded on the auction event (`key_scheme` tag).
 * Currently always `hd_p2pk` — the bidder's destination is an HD-derived P2PK
 * pubkey. Note that this is the *lock-derivation* method, not the overall
 * settlement scheme (which lives in the `settlement_policy` tag, e.g.
 * `cashu_p2pk_path_oracle_v1`).
 */
export const getAuctionKeyScheme = (event: NostrEventLike | null): 'hd_p2pk' => {
	if (!event) return 'hd_p2pk'
	const raw = event.tags.find((tag) => tag[0] === 'key_scheme')?.[1]
	return raw === 'hd_p2pk' ? raw : 'hd_p2pk'
}

export const getAuctionP2pkXpub = (event: NostrEventLike | null): string => event?.tags.find((tag) => tag[0] === 'p2pk_xpub')?.[1] || ''

/**
 * Validator pubkeys the auction trusts to audit its bids. Auction events
 * under `cashu_p2pk_bidder_path_v1` use repeated `auditors` tags (§4.1).
 */
export const getAuctionAuditors = (event: NostrEventLike | null): string[] =>
	(event?.tags ?? []).filter((tag) => tag[0] === 'auditors' && !!tag[1]).map((tag) => tag[1])

/** Number of distinct auditor verdicts required for a bid to be confirmed (§4.1). */
export const getAuctionAuditorQuorum = (event: NostrEventLike | null): number => {
	const raw = event?.tags.find((tag) => tag[0] === 'auditor_quorum' && !!tag[1])?.[1]
	const parsed = raw ? parseInt(raw, 10) : NaN
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUDITOR_QUORUM
}

/**
 * Legacy single-pubkey accessor preserved for callers still phrased
 * around "path_issuer." Returns the first listed auditor, or '' when
 * none are listed. Phase 7 (reputation UI) will swap call sites to the
 * proper multi-value {@link getAuctionAuditors}.
 */
export const getAuctionPathIssuer = (event: NostrEventLike | null): string => getAuctionAuditors(event)[0] || ''

export const getAuctionSettlementPolicy = (event: NostrEventLike | null): string =>
	event?.tags.find((t) => t[0] === 'settlement_policy')?.[1] || ''

export const getAuctionSchema = (event: NostrEventLike | null): string => event?.tags.find((t) => t[0] === 'schema')?.[1] || ''

export const getAuctionShippingOptions = (event: NostrEventLike | null): Array<{ shippingRef: string; extraCost: string }> => {
	if (!event) return []
	return event.tags
		.filter((tag) => tag[0] === 'shipping_option' && !!tag[1])
		.map((tag) => ({
			shippingRef: tag[1],
			extraCost: typeof tag[2] === 'string' ? tag[2] : '',
		}))
}

export const getAuctionSpecs = (event: NostrEventLike | null): Array<{ key: string; value: string }> => {
	if (!event) return []
	return event.tags
		.filter((tag) => tag[0] === 'spec' && !!tag[1])
		.map((tag) => ({
			key: tag[1],
			value: typeof tag[2] === 'string' ? tag[2] : '',
		}))
}

export const getBidAmount = (bidEvent: NostrEventLike | null): number => {
	if (!bidEvent) return 0
	const amountTag = bidEvent.tags.find((tag) => tag[0] === 'amount')?.[1]
	const parsed = amountTag ? parseInt(amountTag, 10) : NaN
	if (!isNaN(parsed)) return parsed

	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		const contentAmount = parseInt(parsedContent?.amount || '0', 10)
		return !isNaN(contentAmount) ? contentAmount : 0
	} catch {
		return 0
	}
}

export const getBidAuctionEventId = (bidEvent: NostrEventLike | null): string => bidEvent?.tags.find((tag) => tag[0] === 'e')?.[1] || ''

export const getBidAuctionCoordinates = (bidEvent: NostrEventLike | null): string => bidEvent?.tags.find((tag) => tag[0] === 'a')?.[1] || ''

export const getBidSellerPubkey = (bidEvent: NostrEventLike | null): string => bidEvent?.tags.find((tag) => tag[0] === 'p')?.[1] || ''

export const getBidMint = (bidEvent: NostrEventLike | null): string => {
	if (!bidEvent) return ''
	const tagMint = bidEvent.tags.find((tag) => tag[0] === 'mint')?.[1]
	if (tagMint) return tagMint
	try {
		const parsedContent = JSON.parse(bidEvent.content || '{}')
		return parsedContent?.mint || ''
	} catch {
		return ''
	}
}

export const getBidStatus = (bidEvent: NostrEventLike | null): string => {
	if (!bidEvent) return 'unknown'
	return bidEvent.tags.find((tag) => tag[0] === 'status')?.[1] || 'unknown'
}

export const getBidLocktime = (bidEvent: NostrEventLike | null): number => {
	if (!bidEvent) return 0
	const parsed = parseInt(bidEvent.tags.find((tag) => tag[0] === 'locktime')?.[1] || '0', 10)
	return Number.isFinite(parsed) ? parsed : 0
}

/**
 * @deprecated Use `getValidatedCurrentPriceFromBids` instead when verdicts are
 * available. This function uses `getAuctionWindowValidBids` which does not
 * account for validator verdicts. Kept for callers (e.g. AuctionCard list view)
 * that lack verdicts in scope.
 */
export const getAuctionCurrentPriceFromBids = (auction: NostrEventLike | null, bids: NostrEventLike[], startingBid: number = 0): number =>
	auction
		? computeAuctionCurrentPrice(auction, bids, startingBid)
		: bids.reduce((max, bid) => Math.max(max, getBidAmount(bid)), startingBid)

/**
 * @deprecated Use validated variants that consume a `ValidatedBidSet` instead
 * when verdicts are available.
 */
export const getAuctionBidCountFromBids = (auction: NostrEventLike | null, bids: NostrEventLike[]): number =>
	auction ? getAuctionWindowValidBids(auction, bids).length : bids.length

/**
 * @deprecated Use validated variants that consume a `ValidatedBidSet` instead
 * when verdicts are available.
 */
export const getAuctionTopBidFromBids = (auction: NostrEventLike | null, bids: NostrEventLike[]): NostrEventLike | null => {
	const validBids = auction ? getAuctionWindowValidBids(auction, bids) : bids
	if (validBids.length === 0) return null
	return validBids.reduce((top, bid) => (getBidAmount(bid) > getBidAmount(top) ? bid : top), validBids[0])
}

/**
 * Result of the raw-event → validated-bid pipeline. Carries only what a
 * consumer needs: the two bid partitions and the two display amounts.
 *
 * Deliberately no `count` (ambiguous — valid only, or valid + pending? — and
 * both lengths are already on the arrays it would sit next to) and no `status`
 * discriminator (`validBids.length === 0` is the pending-only case).
 */
interface ValidatedCurrentPriceResult {
	currentTopValidAmount: number
	validBids: ParsedBidEvent[]
	pendingBids: ParsedBidEvent[]
	validatedTopBidAmount: number
}

/**
 * Validated variant of `getAuctionCurrentPriceFromBids`. Parses the raw
 * events through schema parsers, runs `computeValidatedBids`, and returns
 * the validated top amount plus the bid partitions.
 *
 * When verdicts or nut7States are empty/missing the result has a zero
 * `currentTopValidAmount` and empty `validBids`, while `pendingBids` holds the
 * un-verdicted bids — correct behaviour per the quorum requirement.
 *
 * NOTE: no call sites yet. Consumers that already hold a `ValidatedBidSet`
 * should prefer the pure selectors in `@sdk/commerce/auctions/validatedBidView`
 * (`getValidatedTopAmount`, `getValidatedBidderState`, `getBidClassification`);
 * this wrapper exists for surfaces that still receive raw events and therefore
 * need the parse step too (the deferred AuctionCard verdict-fetch work). If
 * that lands as a query hook instead, delete this.
 *
 * @param startingBid - Floor value from the auction's `starting_bid` tag.
 *   The returned `validatedTopBidAmount` is `Math.max(currentTopValidAmount, startingBid)`.
 */
export function getValidatedCurrentPriceFromBids(
	auction: NostrEventLike | null,
	bids: NostrEventLike[],
	verdicts: NostrEventLike[],
	nut7States?: Map<string, Nut7ProofState>,
	startingBid: number = 0,
	// ADR-0011 review R1: callers MUST pass the map gathered via
	// `fetchDleqKeysetsForBids` (one-shot) or `useDleqKeysetPolling` (React
	// surfaces). This helper is synchronous and performs no network I/O, so it
	// cannot acquire evidence itself; omitting the map leaves every DLEQ-bearing
	// bid PENDING (non-authoritative) by contract, not a wrong-but-valid price.
	dleqKeysets?: Map<string, MintKeys>,
): ValidatedCurrentPriceResult {
	if (!auction || bids.length === 0) {
		return {
			currentTopValidAmount: 0,
			validBids: [],
			pendingBids: [],
			validatedTopBidAmount: startingBid,
		}
	}

	const parsedAuction = parseAuctionEvent(auction)
	if (!parsedAuction.ok) {
		return {
			currentTopValidAmount: 0,
			validBids: [],
			pendingBids: [],
			validatedTopBidAmount: startingBid,
		}
	}

	const parsedBids: ParsedBidEvent[] = []
	for (const bid of bids) {
		const result = parseBidEvent(bid)
		if (result.ok) parsedBids.push(result.value)
	}

	const parsedVerdicts: ParsedValidatorVerdictEvent[] = []
	for (const v of verdicts) {
		const result = parseValidatorVerdictEvent(v)
		if (result.ok) parsedVerdicts.push(result.value)
	}

	const validatedSet = computeValidatedBids({
		auction: parsedAuction.value,
		bids: parsedBids,
		verdicts: parsedVerdicts,
		nut7States,
		dleqKeysets,
	})

	return {
		currentTopValidAmount: validatedSet.currentTopValidAmount,
		validBids: validatedSet.validBids,
		pendingBids: validatedSet.pendingBids,
		validatedTopBidAmount: Math.max(validatedSet.currentTopValidAmount, startingBid),
	}
}

/**
 * Validated variant of `getAuctionBidCountFromBids`. Takes a pre-computed
 * `ValidatedBidSet` and returns the count of valid bids.
 */
export function getValidatedBidCountFromBids(set: ValidatedBidSet): number {
	return set.validBids.length
}

/**
 * Validated variant of `getAuctionTopBidFromBids`. Takes a pre-computed
 * `ValidatedBidSet` and returns the canonical winner's raw event, or null.
 */
export function getValidatedTopBidFromBids(set: ValidatedBidSet): NostrEventLike | null {
	return set.canonicalWinner?.rawEvent ?? null
}

export const getAuctionSettlementStatus = (settlementEvent: NostrEventLike | null): AuctionSettlementStatus => {
	if (!settlementEvent) return 'unknown'
	const status = settlementEvent.tags.find((tag) => tag[0] === 'status')?.[1]
	if (status === 'settled' || status === 'reserve_not_met' || status === 'cancelled') return status
	return 'unknown'
}

export const getAuctionSettlementWinningBid = (settlementEvent: NostrEventLike | null): string =>
	settlementEvent?.tags.find((tag) => tag[0] === 'winning_bid')?.[1] || ''

export const getAuctionSettlementWinner = (settlementEvent: NostrEventLike | null): string =>
	settlementEvent?.tags.find((tag) => tag[0] === 'winner')?.[1] || ''

export const getAuctionSettlementFinalAmount = (settlementEvent: NostrEventLike | null): number => {
	if (!settlementEvent) return 0
	const parsed = parseInt(settlementEvent.tags.find((tag) => tag[0] === 'final_amount')?.[1] || '0', 10)
	return Number.isFinite(parsed) ? parsed : 0
}

export const isNSFWAuction = (event: NostrEventLike | null): boolean => {
	if (!event) return false
	return event.tags.find((t) => t[0] === 'content-warning')?.[1] === 'nsfw'
}

export const filterNSFWAuctions = (events: NostrEventLike[], showNSFW: boolean): NostrEventLike[] => {
	if (showNSFW) return events
	return events.filter((event) => !isNSFWAuction(event))
}

// Pure helpers — exported for unit tests and for the host's streaming hook.

export function buildAuctionBidFilters(rootEventId: string, coordinates: string | undefined, limit: number): EventFilter[] {
	const filters: EventFilter[] = []
	if (rootEventId) filters.push({ kinds: [AUCTION_BID_KIND], '#e': [rootEventId], limit })
	if (coordinates) filters.push({ kinds: [AUCTION_BID_KIND], '#a': [coordinates], limit })
	return filters
}

export function mergeAndSortBids(existing: NostrEventLike[], incoming: NostrEventLike[]): NostrEventLike[] {
	const existingIds = new Set(existing.map((b) => b.id))
	const fresh = incoming.filter((b) => !existingIds.has(b.id))
	if (fresh.length === 0) return existing
	return [...existing, ...fresh].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
}

// ---------------------------------------------------------------------------
// Auction Claim Order — Kind 16 order events linked to an auction via `a` tag
// ---------------------------------------------------------------------------

/**
 * Fetches the Kind 16 order event(s) created by the auction winner after settlement.
 * These are identified by having an `a` tag matching the auction coordinates and a
 * `type` tag of ORDER_CREATION ('1').
 */
export const fetchAuctionClaimOrders = async (context: EventReadContext, auctionCoordinates: string): Promise<NostrEventLike[]> => {
	if (!auctionCoordinates) return []

	const filter: EventFilter = {
		kinds: [ORDER_PROCESS_KIND as unknown as number],
		'#a': [auctionCoordinates],
		limit: 20,
	}

	const events = await context.fetch([filter])
	return events
		.filter((e) => {
			const type = e.tags.find((t) => t[0] === 'type')?.[1]
			return type === ORDER_MESSAGE_TYPE.ORDER_CREATION
		})
		.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
}
