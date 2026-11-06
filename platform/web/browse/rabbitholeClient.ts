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

import { mapProduct, type BrowseFacet, type BrowseProduct, type BrowseSearchResult } from './browseProductMap'
import { getProductCoordinates } from '@sdk/commerce/discovery'
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

interface RabbitHoleSearchFrame {
	type: 'search'
	configHash?: string
	query?: string
	candidateCount?: number
	hits?: RabbitHoleHit[]
	suggested?: RabbitHoleSuggestion[]
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
	relaysFailed: string[]
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

/** The service's own relay dial timeout is 8000 ms; a stalled stream beyond that is ours to cut. */
export const RABBITHOLE_DEFAULT_TIMEOUT_MS = 8000

/** The loopback API (the service binds to loopback; public exposure is a reverse-proxy decision for the owner). */
export const RABBITHOLE_DEFAULT_BASE = 'http://127.0.0.1:7711'

export interface RabbitHoleSearchOptions {
	/** The `fetch` to use (stubbed in tests). Defaults to the global fetch. */
	fetchImpl?: typeof fetch
	/** Per-request deadline in ms. Defaults to {@link RABBITHOLE_DEFAULT_TIMEOUT_MS}. */
	timeoutMs?: number
	/** The caller's abort signal (e.g. the react-query context signal). */
	signal?: AbortSignal
	/** API base, e.g. `http://127.0.0.1:7711`. Defaults to {@link RABBITHOLE_DEFAULT_BASE}. */
	baseUrl?: string
}

/**
 * Thrown for a bad request, an HTTP-level failure, a mid-stream `error` frame,
 * a timeout, or a truncated stream. The caller falls back to the local stream.
 */
export class RabbitHoleError extends Error {
	/** A machine-readable code: `bad-request`, `http`, `stream-error`, `timeout`, `truncated`. */
	readonly code: 'bad-request' | 'http' | 'stream-error' | 'timeout' | 'truncated'
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

		return await readRabbitHoleStream(response, { timeoutMs, callerSignal, deadline, indexOnly: Boolean(request.indexOnly) })
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

	const products: BrowseProduct[] = []
	const seenEventIds = new Set<string>()
	let outcome: RabbitHoleOutcomeFrame | null = null
	let lineBuffer = ''
	// The `search` frame's own statements: the service's facet list, and the
	// relays each index hit was seen on (keyed by the listing's coordinate, so
	// the later `event` frame for that coordinate can carry them).
	let suggested: BrowseFacet[] = []
	const relaysByCoordinate = new Map<string, string[]>()

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
				// The index hits are the fast first paint; the canonical product
				// data is the `event` frames that follow. Hits whose event never
				// arrives are not products.
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
					if (hit.coordinate && hit.relays_seen && hit.relays_seen.length > 0) {
						relaysByCoordinate.set(hit.coordinate, [...hit.relays_seen])
					}
				}
				break
			case 'relay':
				noteRelay(frame.relay, frame.state)
				break
			case 'event': {
				const event = frame.event
				if (event && event.id && !seenEventIds.has(event.id)) {
					seenEventIds.add(event.id)
					const product = mapProduct(event)
					if (product) {
						// The listing's own relays, from its index hit — correlated
						// by coordinate, never the search-level fan-out set.
						const relays = relaysByCoordinate.get(getProductCoordinates(event))
						products.push(relays ? { ...product, relays } : product)
					}
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
			// The `outcome` frame is always last; stop reading once it arrived.
			if (outcome) break
		}
	} finally {
		await reader.cancel().catch(() => {})
	}

	// `indexOnly` returns only the `search` frame and never an `outcome` (the
	// service never dials a relay), so an empty stream there is valid, not
	// truncated. Every other stream MUST end in its `outcome` frame.
	if (!outcome) {
		if (ctx.indexOnly) return { products, eose: [], pending: [], suggested }
		throw new RabbitHoleError('truncated', 'RabbitHole: stream ended without an outcome frame')
	}
	return toBrowseSearchResult(outcome, products, relayOrder, relayState, suggested)
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
): BrowseSearchResult {
	const verdict = outcome.outcome
	let eose: string[]
	let pending: string[]

	if (verdict) {
		eose = [...verdict.relaysAnswered]
		pending = [...verdict.relaysFailed]
	} else {
		eose = []
		pending = []
		for (const relay of relayOrder) {
			if (relayState.get(relay) === 'answered') eose.push(relay)
			else pending.push(relay) // querying or failed — did not answer
		}
	}

	return { products, eose: orderBySeen(eose, relayOrder), pending: orderBySeen(pending, relayOrder), suggested }
}

/** Order a relay list by first-seen wire order; relays not seen on a `relay` frame keep their relative order at the end. */
function orderBySeen(relays: string[], relayOrder: string[]): string[] {
	const rank = (relay: string): number => {
		const index = relayOrder.indexOf(relay)
		return index === -1 ? relayOrder.length : index
	}
	return [...relays].sort((a, b) => rank(a) - rank(b))
}
