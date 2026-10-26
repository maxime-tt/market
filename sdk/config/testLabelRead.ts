/**
 * sdk/config/testLabelRead.ts — the framework-free test-label read and its module caches
 * (store drain D1, slice 3).
 *
 * ADR-0009 — Test-listing curation via NIP-32 labels. Label events (kind 1985) mark a product or
 * auction coordinate as a "test" listing. A label counts only when signed by an authorized labeler
 * (the app's admin ∪ editor set). Un-labeling is a NIP-09 deletion event (kind 5) referencing the
 * label event's id in an `e` tag, signed by the same labeler.
 *
 * The logic that used to live in `src/queries/testLabels.tsx` moves here without the relay client:
 * the host supplies an `EventReadContext` (its relay policy + the 8 s budget) and a loader for the
 * authorized-labeler set. This module owns the per-coordinate label cache, the authorized-labeler
 * cache and the reconciliation; the React binding and the settings loader live in
 * `platform/web/config/testLabelsBinding.ts`.
 *
 * The caches are module-level and intentionally shared: the publish flow writes optimistic entries
 * (`setCachedTestLabel`) and drops them on failure (`invalidateTestLabelCache`), and the read must
 * reconcile against relay truth without losing an in-flight optimistic entry.
 */
import type { EventFilter } from '../core/event-store/filter'
import type { EventReadContext } from '../core/event-store/read'
import type { NostrEventLike } from '../core/nostr/eventLike'
import {
	A_TAG,
	E_TAG,
	K_TAG,
	L_TAG,
	LABEL_DELETION_KIND,
	LABEL_EVENT_KIND,
	LABEL_NAMESPACE,
	LABEL_VALUE_TEST,
	l_TAG,
} from './test-label-constants'
import { testLabelActions, type TestLabelInfo } from './test-labels'

/** Max coordinates per relay filter (`#a` / `#e` chunk). */
const TEST_LABEL_FETCH_CHUNK_SIZE = 100

/** How long a fetched label result stays fresh in the module cache. */
const TEST_LABEL_CACHE_TTL_MS = 15_000

/** How long the authorized-labeler list stays fresh. */
const AUTHORIZED_LABELERS_CACHE_TTL_MS = 15_000

interface CachedLabelEntry {
	fetchedAt: number
	label: TestLabelInfo | null
}

const testLabelCache = new Map<string, CachedLabelEntry>()

let authorizedLabelersCache: { fetchedAt: number; pubkeys: string[] } | null = null

/** The host-supplied dependencies of a test-label read. */
export interface TestLabelReadDeps<E extends NostrEventLike> {
	/** Relay policy + the merge store (the read deliberately does not merge these events). */
	context: EventReadContext<E>
	/** The app's admin ∪ editor pubkeys; `null` when authorization is undeterminable (fail open). */
	readAuthorizedLabelers: () => Promise<string[] | null>
	/** Mirrors the pre-drain `if (ndk)` guard: when false the relay read is skipped. */
	isReady?: () => boolean
}

const chunkStrings = (values: string[], size: number): string[][] => {
	const chunks: string[][] = []
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size))
	}
	return chunks
}

/**
 * Drop the module-level authorized-labeler cache so the next read re-reads the admin/editor
 * settings. Exists so unit tests can isolate cache state between cases; production relies on the
 * TTL above.
 */
export const resetAuthorizedLabelersCache = () => {
	authorizedLabelersCache = null
}

/**
 * Resolve the authorized-labeler set through a host loader, caching a determinable answer for the
 * TTL. An undeterminable answer (`null`) is never cached: the next read must retry.
 */
export const resolveAuthorizedLabelers = async (load: () => Promise<string[] | null>): Promise<string[] | null> => {
	const now = Date.now()
	if (authorizedLabelersCache && now - authorizedLabelersCache.fetchedAt < AUTHORIZED_LABELERS_CACHE_TTL_MS) {
		return authorizedLabelersCache.pubkeys
	}

	const pubkeys = await load()
	if (pubkeys !== null) {
		authorizedLabelersCache = { fetchedAt: now, pubkeys }
	}
	return pubkeys
}

/**
 * Item coordinates targeted by a label event's `a` tags.
 * Per ADR-0009 we only act on `a`-tag (item) targets — a `p` tag would label the user and is
 * intentionally out of scope.
 */
export const getLabelTargetCoordinates = (event: NostrEventLike): string[] => {
	return event.tags.filter((tag) => tag[0] === A_TAG && !!tag[1]).map((tag) => tag[1])
}

/**
 * A label event counts only when:
 * - it is a kind-1985 event,
 * - signed by an authorized labeler,
 * - `L` tag is our namespace,
 * - `l` tag is `test` within our namespace,
 * - it targets at least one item coordinate (`a` tag).
 */
export const isValidAuthorizedTestLabel = (event: NostrEventLike, authorizedLabelers: string[]): boolean => {
	if (event.kind !== LABEL_EVENT_KIND) return false
	// Only authorized labelers' labels count (ADR-0009)
	if (!authorizedLabelers.includes(event.pubkey)) return false
	// NIP-32: L tag must carry our namespace
	if (!event.tags.some((tag) => tag[0] === L_TAG && tag[1] === LABEL_NAMESPACE)) return false
	// NIP-32: l tag value must be "test" scoped to our namespace
	if (!event.tags.some((tag) => tag[0] === l_TAG && tag[1] === LABEL_VALUE_TEST && tag[2] === LABEL_NAMESPACE)) return false
	// Must target an item coordinate
	return event.tags.some((tag) => tag[0] === A_TAG && !!tag[1])
}

/**
 * NIP-09 deletion validation: a deletion applies to a label event only when it references the label
 * event's id in an `e` tag AND is signed by the same pubkey as the label event (NIP-09 MUST). The
 * `k` tag is a SHOULD — when present it must declare kind 1985 to apply to our labels.
 */
export const isLabelDeletionForLabel = (deletion: NostrEventLike, label: NostrEventLike): boolean => {
	if (deletion.kind !== LABEL_DELETION_KIND) return false
	if (deletion.pubkey !== label.pubkey) return false
	const referencesLabel = deletion.tags.some((tag) => tag[0] === E_TAG && tag[1] === label.id)
	if (!referencesLabel) return false
	const kTags = deletion.tags.filter((tag) => tag[0] === K_TAG && tag[1]).map((tag) => tag[1])
	if (kTags.length > 0 && !kTags.includes(String(LABEL_EVENT_KIND))) return false
	return true
}

/**
 * Determine which coordinates carry an ACTIVE test label.
 *
 * A coordinate is labeled if ANY authorized label event targeting it has no matching NIP-09
 * deletion (§7.7 of the handover). When several active labels exist for one coordinate, the newest
 * one's metadata is returned.
 *
 * @param labelEvents authorized kind-1985 label events
 * @param deletionEvents kind-5 deletion events that may reference those labels
 * @param requestedCoordinates when provided, only these coordinates are returned
 */
export const reconcileActiveTestLabels = (
	labelEvents: NostrEventLike[],
	deletionEvents: NostrEventLike[],
	requestedCoordinates?: string[],
): Map<string, TestLabelInfo> => {
	const requested = requestedCoordinates ? new Set(requestedCoordinates) : null

	// Newest active label per coordinate
	const activeByCoordinate = new Map<string, NostrEventLike>()

	for (const label of labelEvents) {
		if (label.kind !== LABEL_EVENT_KIND) continue
		// Skip labels whose NIP-09 deletion has been seen — the item reappears
		const isDeleted = deletionEvents.some((deletion) => isLabelDeletionForLabel(deletion, label))
		if (isDeleted) continue

		for (const coordinate of getLabelTargetCoordinates(label)) {
			if (requested && !requested.has(coordinate)) continue
			const existing = activeByCoordinate.get(coordinate)
			if (!existing || (label.created_at ?? 0) >= (existing.created_at ?? 0)) {
				activeByCoordinate.set(coordinate, label)
			}
		}
	}

	const result = new Map<string, TestLabelInfo>()
	for (const [coordinate, label] of Array.from(activeByCoordinate)) {
		result.set(coordinate, { eventId: label.id, labelerPubkey: label.pubkey })
	}
	return result
}

/** Relay fetch of the authorized kind-1985 label events for a batch of coordinates (chunked). */
const fetchAuthorizedLabelEvents = async <E extends NostrEventLike>(
	context: EventReadContext<E>,
	coordinates: string[],
	adminPubkeys: string[],
): Promise<E[]> => {
	// Chunk queries are independent, so run them concurrently instead of paying one relay round-trip
	// per chunk serially. `Promise.all` + `flat` preserves the sequential loop's chunk order.
	const chunkResults = await Promise.all(
		chunkStrings(coordinates, TEST_LABEL_FETCH_CHUNK_SIZE).map((chunk) => {
			// Batched relay query: one filter for the whole chunk of coordinates. `#L` narrows to our
			// namespace at the relay; tags are re-validated client-side for relays that ignore unknown
			// single-letter tag filters.
			const filter: EventFilter = {
				kinds: [LABEL_EVENT_KIND],
				'#a': chunk,
				'#L': [LABEL_NAMESPACE],
				...(adminPubkeys.length > 0 ? { authors: adminPubkeys } : {}),
			}
			return context.fetch([filter])
		}),
	)
	return chunkResults.flat()
}

/** Relay fetch of the NIP-09 deletions for a batch of label ids (chunked). */
const fetchLabelDeletionEvents = async <E extends NostrEventLike>(
	context: EventReadContext<E>,
	labelEventIds: string[],
	adminPubkeys: string[],
): Promise<E[]> => {
	const chunkResults = await Promise.all(
		chunkStrings(labelEventIds, TEST_LABEL_FETCH_CHUNK_SIZE).map((chunk) => {
			const filter: EventFilter = {
				kinds: [LABEL_DELETION_KIND],
				'#e': chunk,
				...(adminPubkeys.length > 0 ? { authors: adminPubkeys } : {}),
			}
			return context.fetch([filter])
		}),
	)
	return chunkResults.flat()
}

/**
 * Fetch the active test labels for a set of item coordinates.
 *
 * For each coordinate this looks for kind-1985 label events (filtered to authorized labelers and our
 * namespace) and reconciles them against kind-5 deletion events, so a freshly un-labeled item is not
 * kept hidden by a stale cached label (§7.5 of the handover).
 *
 * Results are cached per coordinate for {@link TEST_LABEL_CACHE_TTL_MS} and the store is reconciled
 * with the fetched truth.
 *
 * @returns Map of coordinate → label metadata for coordinates with an ACTIVE label
 */
export const fetchTestLabelsWorkflow = async <E extends NostrEventLike>(
	deps: TestLabelReadDeps<E>,
	coordinates: string[],
): Promise<Map<string, TestLabelInfo>> => {
	const uniqueCoordinates = Array.from(new Set(coordinates.filter(Boolean)))
	if (uniqueCoordinates.length === 0) return new Map()

	const now = Date.now()
	const result = new Map<string, TestLabelInfo>()
	const staleCoordinates: string[] = []

	for (const coordinate of uniqueCoordinates) {
		const cached = testLabelCache.get(coordinate)
		if (cached && now - cached.fetchedAt < TEST_LABEL_CACHE_TTL_MS) {
			if (cached.label) result.set(coordinate, cached.label)
		} else {
			staleCoordinates.push(coordinate)
		}
	}

	// Cache hits imply a prior successful fetch, so the store can be synced for them.
	let authorizationResolved = staleCoordinates.length === 0

	if (staleCoordinates.length > 0) {
		const adminPubkeys = await resolveAuthorizedLabelers(deps.readAuthorizedLabelers)
		if (adminPubkeys !== null) {
			authorizationResolved = true
			// Mirrors the pre-drain `if (ndk)` guard: if the relay client is not ready the store stays
			// "not loaded" for the stale coordinates so the filter fails open.
			if (deps.isReady?.() ?? true) {
				let activeLabels = new Map<string, TestLabelInfo>()
				if (adminPubkeys.length > 0) {
					const labelEvents = await fetchAuthorizedLabelEvents(deps.context, staleCoordinates, adminPubkeys)

					// Validate labels and collect their ids for the deletion lookup
					const candidateLabels = labelEvents.filter((event) => isValidAuthorizedTestLabel(event, adminPubkeys))
					const labelEventIds = Array.from(new Set(candidateLabels.map((event) => event.id).filter(Boolean)))

					const deletionEvents = labelEventIds.length > 0 ? await fetchLabelDeletionEvents(deps.context, labelEventIds, adminPubkeys) : []
					activeLabels = reconcileActiveTestLabels(candidateLabels, deletionEvents, staleCoordinates)
				}
				// An empty authorized set means no labels can exist — nothing to fetch.

				// Write-through cache (including "no label" results) and reconcile the store
				const fetchedAt = Date.now()
				for (const coordinate of staleCoordinates) {
					const label = activeLabels.get(coordinate) ?? null
					testLabelCache.set(coordinate, { fetchedAt, label })
					if (label) result.set(coordinate, label)
				}
				testLabelActions.applyFetchedLabels(activeLabels, staleCoordinates)
			}
		}
	}

	// Sync the store with the full known truth for the requested coordinates, including cache-hit
	// entries (keeps store and cache consistent after optimistic updates). Skipped when authorization
	// was unavailable — the store must stay "not loaded" so filtering fails open.
	if (authorizationResolved) {
		testLabelActions.applyFetchedLabels(result, uniqueCoordinates)
	}

	return result
}

/**
 * Drop the module-level label cache (all coordinates, or one).
 * Used to discard optimistic entries when a label/deletion publish fails, so the next fetch
 * reconciles with the relay instead of serving a stale cache.
 */
export const invalidateTestLabelCache = (coordinate?: string) => {
	if (coordinate) {
		testLabelCache.delete(coordinate)
	} else {
		testLabelCache.clear()
	}
}

/**
 * Write a label result into the module cache as if freshly fetched.
 * Used by the publish flows to keep the optimistic store state consistent with the cache during the
 * relay round-trip (prevents a concurrent refetch from reverting the optimistic update before
 * propagation completes).
 */
export const setCachedTestLabel = (coordinate: string, label: TestLabelInfo | null) => {
	if (!coordinate) return
	testLabelCache.set(coordinate, { fetchedAt: Date.now(), label })
}
