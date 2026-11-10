/**
 * platform/web/browse/rabbitholeClient.ts — The RabbitHole search client.
 *
 * The search service answers **one request, one streamed NDJSON response**
 * (handover `notes/HANDOVER-RABBITHOLE-SEARCH.md` §1): a `POST /search` returns
 * `application/x-ndjson`, one JSON object per line. The body must be read as a
 * stream — `await response.json()` fails on a multi-line body. The five frame
 * types, in arrival order:
 *
 *   - `search`   always first; the index hits, rendered immediately
 *   - `relay`    a relay subscription starting (`querying`) or settling
 *                (`answered` / `failed`) — the "why is this partial" signal
 *   - `event`    a full kind-30402 payload, the moment it arrives
 *   - `dropped`  a payload discarded (duplicate / expired), with the reason
 *   - `outcome`  always last; `status` is `"complete"` or `"partial"`
 *
 * RabbitHole **bypasses** the NIP-50 seam gap for list queries: the SDK
 * `EventFilter` has no `search` field, so the local path matches the query in
 * memory. RabbitHole pushes the query to an index and dials the relays for us.
 * This client deliberately lives in `platform/web` and does NOT widen
 * `sdk/core`'s `EventFilter`.
 *
 * The one rule that must not be flattened: a `partial` outcome (a relay failed
 * or timed out) keeps its failed relays in the seam's `pending` array — the
 * relay-failure state the Browse UI already renders (`RelayIndicator`'s pending
 * breakdown) — never in `eose`, and never dropped.
 */

import {
	collapseProductFamilyEvents,
	isProductFamilyEvent,
	type BrowseFacet,
	type BrowseProduct,
	type BrowseSearchResult,
} from './browseProductMap'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'

// ---------------------------------------------------------------------------
// Wire types (the five frame types + the in-stream error frame)
// ---------------------------------------------------------------------------

/** One index hit in the `search` frame (the fast first paint). */
interface RabbitHoleHit {
	coordinate?: string
	event_id?: string
	title?: string
	pubkey?: string
	price_amount?: number
	currency?: string | null
	category_tags?: string[]
	relays_seen?: string[]
	has_image?: boolean
	created_at?: number
}

interface RabbitHoleSuggestion {
	field: string
	value: string
	count: number
	coverage?: number
	filter?: string
}

/**
 * A bucket as the SERVICE states it: a narrowing option derived from the full
 * result set's own documents, across tags and sellers. The structural twin of
 * `ui/browse/search-buckets.tsx`'s `Bucket` — that one is the presentation type,
 * this one is the wire.
 *
 * NOT a facet. A facet is the engine's own count over a candidate superset and
 * over-reports (measured on `q=bitcoin`: 1197 against a true 1100 for `bitcoin`,
 * 242 against 199 for `clothing`). `count` here is counted over the documents the
 * scan actually read, so it is the number to render.
 */
export interface RabbitHoleBucket {
	dimension: 'label_tags' | 'category_tags' | 'seller'
	/** What choosing the bucket adds to the query — a tag, or a seller's pubkey. */
	value: string
	count: number
	share: number
	/** Present for a seller bucket: the display name, when the service knows one. */
	label?: string
}

interface RabbitHoleSearchFrame {
	type: 'search'
	configHash?: string
	query?: string
	candidateCount?: number
	hits?: RabbitHoleHit[]
	suggested?: RabbitHoleSuggestion[]
	buckets?: RabbitHoleBucket[]
	/**
	 * True when the full-set scan could not read the whole set. A caller must
	 * DISCLOSE this rather than present the buckets as describing everything.
	 */
	truncated?: boolean
	/** How many documents the scan actually reached — the "first N" a disclosure names. */
	scanned?: number
	searchTimeMs?: number
	candidatesWithHints?: number
}

type RabbitHoleRelayState = 'querying' | 'answered' | 'failed'

interface RabbitHoleRelayFrame {
	type: 'relay'
	relay: string
	state: RabbitHoleRelayState
	reason?: string
}

interface RabbitHoleEventFrame {
	type: 'event'
	sequence?: number
	event?: NostrEventLike
}

interface RabbitHoleDroppedFrame {
	type: 'dropped'
	sequence?: number
	dropped?: string
	id?: string
}

interface RabbitHoleOutcome {
	relaysQueried: string[]
	relaysAnswered: string[]
	/**
	 * NOT a `string[]`, however much the name suggests it. The service states each
	 * failure as an OBJECT — `{ relay, reason }` — and declaring it as a string
	 * array here is what let the mistake compile: the array flowed into the seam's
	 * `pending: string[]`, BrowseIndexHost wrapped each entry as
	 * `{ relay: <entry>, status }`, and the relay popover rendered the object as a
	 * React child. That is a crash (React error #31), and it took a click on the
	 * "pending" chip to reach it. Type the wire, not the wish.
	 */
	relaysFailed: Array<{ relay: string; reason?: string }>
	deadlineHit?: boolean
	eventsDelivered?: number
	eventsDeduped?: number
	eventsExpired?: number
	elapsedMs?: number
}

/** The verdict. `partial` means a relay failed or timed out — the delivered events are real but the set is not known to be whole. */
interface RabbitHoleOutcomeFrame {
	type: 'outcome'
	status: 'complete' | 'partial'
	outcome?: RabbitHoleOutcome
}

/** An error that arrives AFTER the stream has started — it is a frame, not an HTTP status. */
interface RabbitHoleErrorFrame {
	type: 'error'
	message?: string
	code?: string
}

/** One line of the NDJSON body; unknown types are ignored, not fatal. */
type RabbitHoleFrame =
	| RabbitHoleSearchFrame
	| RabbitHoleRelayFrame
	| RabbitHoleEventFrame
	| RabbitHoleDroppedFrame
	| RabbitHoleOutcomeFrame
	| RabbitHoleErrorFrame

const FRAME_TYPES: readonly string[] = ['search', 'relay', 'event', 'dropped', 'outcome', 'error']

function isRabbitHoleFrame(value: unknown): value is RabbitHoleFrame {
	if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string') return false
	return FRAME_TYPES.includes(value.type)
}

// ---------------------------------------------------------------------------
// The index hit, restated as the event shape the shared mapper reads
// ---------------------------------------------------------------------------

/**
 * The `d` tag inside a listing coordinate (`30402:<pubkey>:<d>`).
 *
 * The index documents carry the real `d` tag — the coordinate is built from it
 * at ingestion — but the hit projects only the coordinate. Splitting on the two
 * leading colons (not `split(':')`) keeps a `d` that itself contains a colon
 * intact, which is the same rule `getProductAddress` obeys.
 *
 * An empty `d` returns `undefined` so the listing is treated as one published
 * without a `d` tag: the mapper then falls back to the event id, exactly as it
 * does for the real event.
 */
function coordinateDTag(coordinate: string | undefined): string | undefined {
	if (!coordinate) return undefined
	const first = coordinate.indexOf(':')
	const second = coordinate.indexOf(':', first + 1)
	if (first === -1 || second === -1) return undefined
	if (coordinate.slice(0, first) !== '30402') return undefined
	return coordinate.slice(second + 1) || undefined
}

/**
 * A slim index hit restated as a kind-30402 event.
 *
 * WHY this exists rather than a second, hit-shaped mapper: the `search` frame
 * is the only frame that arrives before any relay answers, and the grid must
 * paint from it. Two mappers would be free to drift, and a card painted from
 * the index would then contradict the same card painted from its relay event —
 * the exact disagreement this restatement rules out. So the hit is turned into
 * the input the ONE mapper (`mapProduct`, via the settled path's own
 * `collapseProductFamilyEvents`) already understands, and nothing else maps a
 * hit.
 *
 * Deliberately ABSENT, never invented: any field the index does not carry
 * (`stock`, `location`, the image URL — the hit states only `has_image`). They
 * stay absent on the painted card and are filled in when the real event lands;
 * fabricating them would be a claim the settled card then has to retract.
 *
 * A hit with no `event_id` or no `pubkey` is not paintable: it could not be
 * correlated with the event that later enriches it, so it would paint a card
 * that the settled read cannot account for.
 */
function indexHitToEvent(hit: RabbitHoleHit): NostrEventLike | undefined {
	if (!hit.event_id || !hit.pubkey) return undefined

	const tags: string[][] = []
	const dTag = coordinateDTag(hit.coordinate)
	if (dTag) tags.push(['d', dTag])
	if (hit.title) tags.push(['title', hit.title])
	if (typeof hit.price_amount === 'number') {
		// The price tag's third element is the unit. A null currency states
		// none — the same shape as a listing whose tag omits it — so the card
		// never labels a fiat amount "sats".
		tags.push(hit.currency ? ['price', String(hit.price_amount), hit.currency] : ['price', String(hit.price_amount)])
	}
	// The seller's own `t` tags, which is what the mapper reads into
	// `categories`. The index's `all_tags` also carries labeller tags, which
	// the event-painted card would not have — so they stay out of the card.
	for (const category of hit.category_tags ?? []) tags.push(['t', category])

	return {
		id: hit.event_id,
		pubkey: hit.pubkey,
		kind: 30402,
		created_at: hit.created_at ?? 0,
		content: '',
		tags,
	}
}

// ---------------------------------------------------------------------------
// Request / response
// ---------------------------------------------------------------------------

export interface RabbitHoleSearchRequest {
	/** The free-text query (≤ 512 chars, enforced below the first byte). */
	q: string
	/** Result cap, clamped to 1–100 on the wire (an over/under-limit caller value is corrected, not rejected). */
	limit?: number
	/** Index filters (≤ 8), e.g. `category_tags = "pottery"` (from the search frame's `suggested`). */
	filters?: string[]
	/** Index the query without dialing any relay — only the `search` frame is returned. */
	indexOnly?: boolean
}

/** Limits the service enforces before the first byte; enforced here too so a bad request never reaches the wire. */
export const RABBITHOLE_LIMITS = {
	maxQueryLength: 512,
	maxFilters: 8,
	minLimit: 1,
	maxLimit: 100,
} as const

/**
 * The SERVICE's own worst-case budget, mirrored here. NOT settable from this
 * side: it is read from `rabbithole/config/rabbithole.config.json` → `fetch`:
 *
 *   per_relay_timeout_ms: 6000   one hanging relay may burn 6 s
 *   total_deadline_ms:    12000  the service stops the fan-out at 12 s, and only
 *                                THEN sends its `outcome` frame
 *
 * The two numbers live in two repositories with nothing else tying them
 * together, so they are restated here with their source and the client's
 * default is derived from them (asserted in `rabbitholeClient.test.ts`). If the
 * service's config moves, this constant moves with it — the test fails instead
 * of the client silently cutting reads off again.
 */
export const RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS = 12_000

/** Headroom over the service's deadline for the proxy hop between this client and the service. */
export const RABBITHOLE_TIMEOUT_HEADROOM_MS = 3_000

/**
 * The client's whole-request deadline: the service's 12 s total deadline plus
 * 3 s of proxy headroom = 15 s.
 *
 * MEASURED, and the reason this is not 8000 ms any more — the two deadlines
 * were INVERTED. The client gave up at 8 s on a service allowed 12 s, so every
 * search with one slow relay was cut off mid-stream by construction, not by
 * the service being slow. On the live page the results request ran 8,010 ms and
 * the client aborted it — `AbortError: The user aborted a request` surfaced on
 * the response-body read while the upstream was still streaming — while a warm
 * identical request returned 75 KB in 0.8–1.2 s, and the service's own outcome
 * frames reported `elapsedMs` 715 / 778 / 1119 with `deadlineHit: false` once a
 * bad relay failed fast instead of hanging. The slowness is one relay spending
 * its 6 s per-relay budget, inside a budget the client was refusing to wait for.
 *
 * A read that still misses this deadline is reported as incomplete with
 * everything that arrived (see {@link RabbitHoleError.partial}), never as a
 * verdict and never by substituting the local stream's answer.
 */
export const RABBITHOLE_DEFAULT_TIMEOUT_MS = RABBITHOLE_SERVICE_TOTAL_DEADLINE_MS + RABBITHOLE_TIMEOUT_HEADROOM_MS

/** The loopback API (the service binds to loopback; public exposure is a reverse-proxy decision for the owner). */
export const RABBITHOLE_DEFAULT_BASE = 'http://127.0.0.1:7711'

/**
 * A snapshot of a read that is still running.
 *
 * `complete` is typed as the literal `false`, not `boolean`: a caller cannot
 * present a streamed snapshot as a verdict without a type error. The verified
 * result is the one `rabbitholeSearch` resolves with, never one of these.
 */
export interface RabbitHoleStreamStats {
	/** Raw `event` frames accepted so far, before the family collapse. */
	eventsDelivered: number
	/** Relays that have answered so far, first-seen wire order. */
	relaysAnswered: string[]
	/** Every relay the read has seen a `relay` frame for so far (`querying`/`answered`/`failed`). */
	relaysSeen: string[]
	/** Always `false`: this snapshot is not a verdict. */
	complete: false
}

/** What a read had delivered when it stopped before its verdict. */
export interface RabbitHolePartialResult {
	/** Products mapped exactly as the settled result maps them (same mapper, same collapse rules). */
	products: BrowseProduct[]
	/** Raw `event` frames accepted before the read stopped. */
	eventsDelivered: number
	/** Relays that had answered. */
	relaysAnswered: string[]
	/** Every relay seen on the wire (the not-answered ones are the honest `pending`). */
	relaysSeen: string[]
}

export interface RabbitHoleSearchOptions {
	/** The `fetch` to use (stubbed in tests). Defaults to the global fetch. */
	fetchImpl?: typeof fetch
	/** Per-request deadline in ms. Defaults to {@link RABBITHOLE_DEFAULT_TIMEOUT_MS}. */
	timeoutMs?: number
	/** The caller's abort signal (e.g. the react-query context signal). */
	signal?: AbortSignal
	/** API base, e.g. `http://127.0.0.1:7711`. Defaults to {@link RABBITHOLE_DEFAULT_BASE}. */
	baseUrl?: string
	/**
	 * Called with the products delivered SO FAR after each chunk that changed
	 * anything — before the `outcome` frame, so the caller can render as the
	 * stream arrives instead of waiting for the read to settle.
	 *
	 * The FIRST call is normally the `search` frame alone: the index hits are
	 * restated as events and mapped through the same mapper, so the grid paints
	 * at index time (tens of milliseconds) with `eventsDelivered: 0` and no
	 * relay having answered. The relay payloads that follow replace those rows
	 * in place, id for id, and fill in what a slim hit cannot state (stock,
	 * location, the image URL).
	 *
	 * The products come from the same mapper and family collapse the settled
	 * result uses, so a streamed card and the settled card for the same event
	 * cannot disagree. Two honest limits:
	 *  - family rows are WITHHELD from snapshots (a family's row can still
	 *    change identity while its parent is in flight, so a partial states no
	 *    family at all; the settled result states it) — and a slim hit cannot
	 *    say whether its listing is part of a family at all, so an index-painted
	 *    card may be replaced by its family's row once the events land;
	 *  - the list can only GROW in row count, but its contents are still
	 *    provisional — `stats.complete` is `false`, always.
	 */
	onProducts?: (products: readonly BrowseProduct[], stats: RabbitHoleStreamStats) => void
}

/**
 * Thrown for a bad request, an HTTP-level failure, a mid-stream `error` frame,
 * a timeout, or a truncated stream. The caller falls back to the local stream.
 */
export class RabbitHoleError extends Error {
	/** A machine-readable code: `bad-request`, `http`, `stream-error`, `timeout`, `truncated`. */
	readonly code: 'bad-request' | 'http' | 'stream-error' | 'timeout' | 'truncated'
	/**
	 * What the read had delivered when it stopped — set for `timeout` and
	 * `truncated` only, because those are reads that were UNDER WAY and lost
	 * their result to the cut. A caller must report them as incomplete rather
	 * than substituting another provider's answer.
	 */
	partial?: RabbitHolePartialResult
	constructor(code: RabbitHoleError['code'], message: string) {
		super(message)
		this.name = 'RabbitHoleError'
		this.code = code
	}
}

function assertValidRequest(request: RabbitHoleSearchRequest): void {
	const q = request.q
	if (typeof q !== 'string') throw new RabbitHoleError('bad-request', 'RabbitHole: query must be a string')
	if (q.length > RABBITHOLE_LIMITS.maxQueryLength) {
		throw new RabbitHoleError('bad-request', `RabbitHole: query exceeds ${RABBITHOLE_LIMITS.maxQueryLength} chars (got ${q.length})`)
	}
	const filters = request.filters ?? []
	if (filters.length > RABBITHOLE_LIMITS.maxFilters) {
		throw new RabbitHoleError('bad-request', `RabbitHole: at most ${RABBITHOLE_LIMITS.maxFilters} filters (got ${filters.length})`)
	}
	// An empty query is a real request — the index answers a filter-only browse
	// (the category-row `See all →`) and an `indexOnly` facet probe. What is
	// never valid is an empty query with nothing else to narrow it.
	if (q.trim() === '' && filters.length === 0 && !request.indexOnly) {
		throw new RabbitHoleError('bad-request', 'RabbitHole: query must be non-empty unless filters are supplied')
	}
	const limit = request.limit
	if (limit !== undefined && (!Number.isInteger(limit) || limit < RABBITHOLE_LIMITS.minLimit || limit > RABBITHOLE_LIMITS.maxLimit)) {
		throw new RabbitHoleError(
			'bad-request',
			`RabbitHole: limit must be an integer in ${RABBITHOLE_LIMITS.minLimit}–${RABBITHOLE_LIMITS.maxLimit} (got ${limit})`,
		)
	}
}

/** Clamp a caller limit into the enforced 1–100 range (the service's range). */
export function clampRabbitHoleLimit(limit: number | undefined): number {
	const n = typeof limit === 'number' && Number.isFinite(limit) ? limit : RABBITHOLE_LIMITS.maxLimit
	return Math.min(RABBITHOLE_LIMITS.maxLimit, Math.max(RABBITHOLE_LIMITS.minLimit, Math.trunc(n)))
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/**
 * Query RabbitHole and read the whole streamed NDJSON response.
 *
 * Resolves with the seam's `BrowseSearchResult`: the delivered kind-30402
 * payloads mapped to `BrowseProduct`, plus the relay verdict — `eose` (the
 * relays that answered) and `pending` (the relays that did not, i.e. failed).
 * A `partial` outcome therefore keeps its failed relays in `pending` (the
 * relay-failure state) and is never flattened into `eose`.
 *
 * Rejects with {@link RabbitHoleError} when the caller should fall back to the
 * local stream: a bad request, an HTTP-level failure, a mid-stream `error`
 * frame, a timeout, or a stream that ends without its `outcome` frame. A caller
 * abort (react-query cancel) is re-thrown as-is, not treated as a fallback.
 *
 * A `timeout` or `truncated` rejection carries `err.partial` — the products the
 * read had already delivered. Those are the two codes that mean "a read was
 * under way and got cut", so the caller must report them as incomplete: it has
 * real products, and substituting the local stream's unrelated verdict for them
 * is exactly how a slow relay came to look like a finished empty search.
 */
export async function rabbitholeSearch(
	request: RabbitHoleSearchRequest,
	options: RabbitHoleSearchOptions = {},
): Promise<BrowseSearchResult> {
	const fetchImpl = options.fetchImpl ?? fetch
	const timeoutMs = options.timeoutMs ?? RABBITHOLE_DEFAULT_TIMEOUT_MS
	const baseUrl = (options.baseUrl ?? RABBITHOLE_DEFAULT_BASE).replace(/\/$/, '')
	const callerSignal = options.signal

	// The request as it goes on the wire: the limit is clamped into the
	// service's 1–100 range, and the query/filter limits are enforced, all
	// before the first byte is sent.
	const body: Record<string, unknown> = { q: request.q, limit: clampRabbitHoleLimit(request.limit) }
	if (request.filters && request.filters.length > 0) body.filters = request.filters
	if (request.indexOnly) body.indexOnly = true
	assertValidRequest({ ...request, limit: body.limit as number })

	// One deadline for the whole request (headers + body): the caller's signal
	// plus a hard timeout, owned here so it is always cleared (no dangling timer).
	// Bun does not reject a stalled body read on signal abort, so each body read
	// is also raced against `deadline` in `readRabbitHoleStream`.
	const deadline = new AbortController()
	const timeoutId = setTimeout(() => deadline.abort(), timeoutMs)
	const onCallerAbort = (): void => deadline.abort()
	if (callerSignal) {
		if (callerSignal.aborted) deadline.abort()
		else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
	}

	try {
		let response: Response
		try {
			response = await fetchImpl(`${baseUrl}/search`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: deadline.signal,
			})
		} catch (err) {
			if (callerSignal?.aborted) throw err // caller cancelled — propagate, no fallback
			if (deadline.signal.aborted)
				throw new RabbitHoleError('timeout', `RabbitHole: timed out after ${timeoutMs} ms before the response began`)
			throw new RabbitHoleError('http', `RabbitHole: request failed: ${err instanceof Error ? err.message : String(err)}`)
		}

		if (!response.ok || !response.body) {
			const detail = await safeResponseText(response)
			throw new RabbitHoleError('http', `RabbitHole: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`)
		}

		return await readRabbitHoleStream(response, {
			timeoutMs,
			callerSignal,
			deadline,
			indexOnly: Boolean(request.indexOnly),
			onProducts: options.onProducts,
		})
	} finally {
		clearTimeout(timeoutId)
		callerSignal?.removeEventListener('abort', onCallerAbort)
	}
}

async function safeResponseText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, 200)
	} catch {
		return ''
	}
}

interface StreamReadContext {
	timeoutMs: number
	callerSignal?: AbortSignal
	deadline: AbortController
	/** `indexOnly` streams return only the `search` frame and never an `outcome`. */
	indexOnly: boolean
	/** Progressive delivery — see {@link RabbitHoleSearchOptions.onProducts}. */
	onProducts?: RabbitHoleSearchOptions['onProducts']
}

/** One completed body read: a chunk, or the end of the stream. */
type ReadChunk = { done: boolean; value?: Uint8Array }

/**
 * Read the NDJSON body to its `outcome` frame, dispatching each line into a
 * `BrowseSearchResult`. A frame split mid-line across reads is reassembled by a
 * `lineBuffer` that carries the trailing partial line forward; a chunk holding
 * several frames yields them all. A `partial` verdict keeps its failed relays in
 * `pending` (the relay-failure state) and is never flattened into `eose`.
 */
async function readRabbitHoleStream(response: Response, ctx: StreamReadContext): Promise<BrowseSearchResult> {
	const { timeoutMs, callerSignal, deadline } = ctx
	const reader = response.body!.getReader()
	const decoder = new TextDecoder()

	// Relay verdict, first-seen order. The `outcome` frame is authoritative and
	// overrides the frame-derived state below; these let the indicator keep a
	// stable per-relay order.
	const relayOrder: string[] = []
	const relayState = new Map<string, RabbitHoleRelayState>()
	const noteRelay = (relay: string, state: RabbitHoleRelayState): void => {
		if (!relayState.has(relay)) relayOrder.push(relay)
		relayState.set(relay, state)
	}

	// The delivered events are collected raw and collapsed to one row per
	// family only after the stream ends — the group/relay correlation needs the
	// whole set, and a BrowseProduct no longer carries the tags to group by.
	// Progressive snapshots re-run the SAME collapse over what has arrived.
	const deliveredEvents: NostrEventLike[] = []
	// The `search` frame's hits, restated as events so they go through the SAME
	// mapper and collapse as the delivered payloads. They are collected BEFORE
	// any relay answers, which is what lets the grid paint at index time.
	const indexEvents: NostrEventLike[] = []
	const seenEventIds = new Set<string>()
	let outcome: RabbitHoleOutcomeFrame | null = null
	let lineBuffer = ''
	// The `search` frame's own statements: the service's facet list, and the
	// relays each index hit was seen on, keyed two ways so the later `event`
	// frame can carry them:
	//   - by `event_id` — the exact correlation; the hit's `event_id` is the
	//     delivered event's `id` (measured 20/20 on a live response);
	//   - by `coordinate` — a fallback for a provider that omits `event_id`.
	//     The service builds this coordinate from the listing's own `d` tag
	//     (`derivePointer`, ingestion), so it IS the canonical
	//     `30402:<pubkey>:<d>` form — which is how the hit is restated as an
	//     event. `event_id` is still preferred: a provider that slugs the
	//     coordinate would match nothing here, and only the id is exact.
	let suggested: BrowseFacet[] = []
	/**
	 * The frame's own buckets and truncation flag, carried out to the settled
	 * result. Without this the service computes them and the app never sees them
	 * — the whole feature dies at the seam with nothing erroring.
	 */
	// Named for the frame, NOT `truncated`: the block below declares its own
	// `const truncated` (the stream-error), and a same-named outer binding would
	// be in the temporal dead zone at the `indexOnly` return inside that block.
	let frameBuckets: RabbitHoleBucket[] | undefined
	let frameTruncated: boolean | undefined
	let frameScanned: number | undefined
	const relaysByEventId = new Map<string, string[]>()
	const relaysByCoordinate = new Map<string, string[]>()

	/** Relays that have answered so far, in first-seen wire order. */
	const relaysAnswered = (): string[] => relayOrder.filter((relay) => relayState.get(relay) === 'answered')

	/**
	 * Map delivered events to rows — ONE function for both the progressive
	 * snapshots and the settled result, so a streamed card and the settled card
	 * for the same event cannot disagree (same collapse, same mapper, same
	 * per-listing relays from the `search` frame's hits).
	 */
	const toProducts = (events: readonly NostrEventLike[]): BrowseProduct[] =>
		collapseProductFamilyEvents(events).map((product) => {
			const relays =
				relaysByEventId.get(product.eventId) ?? relaysByCoordinate.get(`30402:${product.pubkey}:${product.id}`)
			return relays ? { ...product, relays } : product
		})

	/**
	 * The events a card may be painted from: the index frame's rows FIRST, in
	 * the index's own ranking order, each one replaced IN PLACE by its delivered
	 * payload as that arrives; payloads the index did not name are appended.
	 *
	 * WHY in place rather than appended: the index order is the ranking the
	 * visitor is reading. A card that moved when its event landed would look
	 * like a different product, and one that was appended would push the ranked
	 * rows down the grid.
	 */
	const paintedEvents = (): readonly NostrEventLike[] => {
		if (indexEvents.length === 0) return deliveredEvents
		const deliveredById = new Map(deliveredEvents.map((event) => [event.id, event]))
		const placed = new Set<string>()
		const events: NostrEventLike[] = []
		for (const indexEvent of indexEvents) {
			const delivered = deliveredById.get(indexEvent.id)
			if (delivered) {
				// The full payload wins on every field the slim hit could not
				// state, and keeps the row's position.
				events.push(delivered)
				placed.add(delivered.id)
			} else {
				events.push(indexEvent)
			}
		}
		for (const event of deliveredEvents) if (!placed.has(event.id)) events.push(event)
		return events
	}

	/**
	 * The events the SETTLED result states.
	 *
	 * A caller that did not opt into progressive delivery (`onProducts`) gets
	 * exactly what it got before the index painted anything: the delivered
	 * payloads only. A caller that DID opt in keeps the rows it was shown —
	 * dropping an index row at the moment the read settles would make a card
	 * disappear from under the visitor's cursor, which is the gating this
	 * removes, merely moved to the end of the stream.
	 */
	const settledEvents = (): readonly NostrEventLike[] => (ctx.onProducts ? paintedEvents() : deliveredEvents)

	/**
	 * The rows a partial may honestly state: everything EXCEPT family rows.
	 * A family's row is not stable until its parent has been delivered — the
	 * collapse promotes the first child into the family row and then swaps it
	 * for the parent — so a partial states no family at all rather than
	 * flashing a child card that collapses into a parent card a frame later.
	 * The settled result states every family once.
	 */
	const toStreamedProducts = (): BrowseProduct[] =>
		toProducts(paintedEvents().filter((event) => !isProductFamilyEvent(event)))

	// Set by any frame that changes what a snapshot would say; flushed once per
	// chunk so a batch of frames costs one collapse, not one per frame.
	let progressDirty = false
	const emitProgress = (): void => {
		if (!progressDirty || !ctx.onProducts) return
		progressDirty = false
		ctx.onProducts(toStreamedProducts(), {
			eventsDelivered: deliveredEvents.length,
			relaysAnswered: relaysAnswered(),
			relaysSeen: [...relayOrder],
			complete: false,
		})
	}

	/**
	 * What to hand back with a read that stopped early. This is the SETTLED
	 * mapping (families included) over what arrived: the read is over, so a
	 * family row is as final as it will ever get, and the caller must show it
	 * as incomplete rather than discard it.
	 */
	const partialResult = (): RabbitHolePartialResult => ({
		products: toProducts(settledEvents()),
		eventsDelivered: deliveredEvents.length,
		relaysAnswered: relaysAnswered(),
		relaysSeen: [...relayOrder],
	})

	const dispatchLine = (line: string): void => {
		let frame: RabbitHoleFrame
		try {
			const parsed: unknown = JSON.parse(line)
			if (!isRabbitHoleFrame(parsed)) return // unknown type — ignore, not fatal
			frame = parsed
		} catch {
			throw new RabbitHoleError('stream-error', `RabbitHole: malformed NDJSON line: ${line.slice(0, 120)}`)
		}

		switch (frame.type) {
			case 'search':
				// The index hits are the fast first paint: they carry every
				// field a card shows, so they are restated as events and run
				// through the SAME mapper the delivered payloads use. The relay
				// events that follow then ENRICH these rows — same id, richer
				// payload — instead of gating the grid on the fan-out.
				// The frame's buckets and truncation flag, taken as stated. Nothing is
				// re-derived here: the service counted them over the full set's own
				// documents, and a second derivation at this layer could disagree
				// with the number the service already committed to.
				frameBuckets = frame.buckets
				frameTruncated = frame.truncated
				frameScanned = frame.scanned
				// The wire's suggestion shape restated as the seam's own facet type.
				suggested = (frame.suggested ?? []).map(
					(suggestion): BrowseFacet => ({
						field: suggestion.field,
						value: suggestion.value,
						count: suggestion.count,
						coverage: suggestion.coverage,
						filter: suggestion.filter,
					}),
				)
				for (const hit of frame.hits ?? []) {
					const indexEvent = indexHitToEvent(hit)
					if (indexEvent) indexEvents.push(indexEvent)
					if (!hit.relays_seen || hit.relays_seen.length === 0) continue
					if (hit.event_id) relaysByEventId.set(hit.event_id, [...hit.relays_seen])
					if (hit.coordinate) relaysByCoordinate.set(hit.coordinate, [...hit.relays_seen])
				}
				// Painted even when it is the only frame the read ever delivers
				// — a visitor sees the index's answer without waiting for a
				// relay to answer at all.
				if (indexEvents.length > 0) progressDirty = true
				break
			case 'relay':
				if (relayState.get(frame.relay) !== frame.state) progressDirty = true
				noteRelay(frame.relay, frame.state)
				break
			case 'event': {
				const event = frame.event
				if (event && event.id && !seenEventIds.has(event.id)) {
					seenEventIds.add(event.id)
					deliveredEvents.push(event)
					progressDirty = true
				}
				break
			}
			case 'dropped':
				// A discarded payload — the `outcome` frame's `eventsDeduped` /
				// `eventsExpired` counters are the source of truth.
				break
			case 'error':
				throw new RabbitHoleError('stream-error', `RabbitHole: ${frame.message ?? frame.code ?? 'error frame'}`)
			case 'outcome':
				outcome = frame
				break
		}
	}

	const readNext = async (): Promise<ReadChunk> => {
		const pending = reader.read()
		// Swallow the read's rejection so a cancelled (hung) read never becomes
		// an unhandled promise rejection once we race past it.
		pending.catch(() => {})
		const deadlineSignal = deadline.signal
		const deadlineHit = new Promise<'timeout' | 'aborted'>((resolve) => {
			if (deadlineSignal.aborted) return resolve(callerSignal?.aborted ? 'aborted' : 'timeout')
			deadlineSignal.addEventListener('abort', () => resolve(callerSignal?.aborted ? 'aborted' : 'timeout'), { once: true })
		})
		const winner = await Promise.race([pending, deadlineHit])
		if (typeof winner === 'string') {
			// The deadline tripped before the read completed; cancel to unblock it.
			await reader.cancel().catch(() => {})
			if (winner === 'aborted' && callerSignal?.aborted) throw new DOMException('Aborted', 'AbortError')
			throw new RabbitHoleError('timeout', `RabbitHole: timed out after ${timeoutMs} ms mid-stream`)
		}
		return winner
	}

	try {
		for (;;) {
			const chunk = await readNext()
			if (chunk.done) {
				// Flush a final line that arrived without a trailing newline.
				const tail = lineBuffer.replace(/\r$/, '').trim()
				lineBuffer = ''
				if (tail.length > 0) dispatchLine(tail)
				emitProgress()
				break
			}
			lineBuffer += decoder.decode(chunk.value ?? new Uint8Array(0), { stream: true })
			const segments = lineBuffer.split('\n')
			// The last segment is a partial line (the chunk did not end in
			// '\n'); carry it forward. Everything before it is complete.
			lineBuffer = segments.pop() ?? ''
			for (const segment of segments) {
				const line = segment.replace(/\r$/, '').trim()
				if (line.length > 0) dispatchLine(line)
			}
			// Hand everything this chunk delivered to the caller BEFORE the
			// `outcome` frame is acted on, so the UI paints on arrival.
			emitProgress()
			// The `outcome` frame is always last; stop reading once it arrived.
			if (outcome) break
		}
	} catch (err) {
		// A read that was UNDER WAY and lost its result to the cut (deadline,
		// connection) keeps what it had. The caller reports it as incomplete —
		// never as a settled count, and never by substituting another
		// provider's answer.
		if (err instanceof RabbitHoleError && (err.code === 'timeout' || err.code === 'truncated') && !err.partial) {
			err.partial = partialResult()
		}
		throw err
	} finally {
		await reader.cancel().catch(() => {})
	}

	// Collapse on the RAW events before mapping: one row per product family,
	// preferring the parent. Then attach each row's own relays, from its index
	// hit — correlated by `event_id` (exact), with the hit's canonical
	// coordinate as a fallback for a provider that omits `event_id`. Never the
	// search-level fan-out set. The collapse itself is presentation grouping,
	// not a second ranking pass. (The progressive snapshots ran this same
	// function; only the family withholding differs.)
	const products: BrowseProduct[] = toProducts(settledEvents())

	// `indexOnly` returns only the `search` frame and never an `outcome` (the
	// service never dials a relay), so an empty stream there is valid, not
	// truncated. Every other stream MUST end in its `outcome` frame.
	if (!outcome) {
		if (ctx.indexOnly)
			return {
				products,
				eose: [],
				pending: [],
				suggested,
				buckets: frameBuckets,
				truncated: frameTruncated,
				scanned: frameScanned,
			}
		const truncated = new RabbitHoleError('truncated', 'RabbitHole: stream ended without an outcome frame')
		truncated.partial = partialResult()
		throw truncated
	}
	return toBrowseSearchResult(outcome, products, relayOrder, relayState, suggested, {
		buckets: frameBuckets,
		truncated: frameTruncated,
		scanned: frameScanned,
	})
}

/**
 * Map the `outcome` verdict onto the seam's `BrowseSearchResult`.
 *
 * `outcome.outcome` is the authoritative relay state. When it is absent (a
 * degraded service), fall back to the `relay` frames observed on the wire.
 * Either way, failed relays go to `pending` — the relay-failure state — and are
 * never moved into `eose`. A `partial` verdict therefore always leaves its
 * failed relays in `pending`, never a plain `complete`-shaped result.
 */
function toBrowseSearchResult(
	outcome: RabbitHoleOutcomeFrame,
	products: BrowseProduct[],
	relayOrder: string[],
	relayState: Map<string, RabbitHoleRelayState>,
	suggested: BrowseFacet[],
	frame: { buckets?: RabbitHoleBucket[]; truncated?: boolean; scanned?: number },
): BrowseSearchResult {
	const verdict = outcome.outcome
	let eose: string[]
	let pending: string[]

	if (verdict) {
		eose = [...verdict.relaysAnswered]
		// Flattened to relay URLs: the seam's `pending` is the relay-failure STATE
		// (what the indicator renders), not the failure report. The reason is not
		// lost — the service keeps it — but it has nowhere to ride in this shape,
		// so it is dropped here rather than smuggled through as an object.
		pending = (verdict.relaysFailed ?? []).map((failure) =>
			typeof failure === 'string' ? failure : failure.relay,
		)
	} else {
		eose = []
		pending = []
		for (const relay of relayOrder) {
			if (relayState.get(relay) === 'answered') eose.push(relay)
			else pending.push(relay) // querying or failed — did not answer
		}
	}

	return {
		products,
		eose: orderBySeen(eose, relayOrder),
		pending: orderBySeen(pending, relayOrder),
		suggested,
		buckets: frame.buckets,
		truncated: frame.truncated,
		scanned: frame.scanned,
	}
}

/** Order a relay list by first-seen wire order; relays not seen on a `relay` frame keep their relative order at the end. */
function orderBySeen(relays: string[], relayOrder: string[]): string[] {
	const rank = (relay: string): number => {
		const index = relayOrder.indexOf(relay)
		return index === -1 ? relayOrder.length : index
	}
	return [...relays].sort((a, b) => rank(a) - rank(b))
}
