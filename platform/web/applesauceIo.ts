/**
 * platform/web/applesauceIo.ts — the web host's applesauce Nostr I/O port,
 * moved verbatim out of the retired `src/lib/nostr/{io-types,io-applesauce}.ts`
 * seam (J-0, ADR-0002's 2026-10-29 R3 amendment).
 *
 * This is the platform adapter over the app's single shared applesauce
 * `RelayPool`. It is the pool's OWNER; the SDK seam beside it
 * (`platform/web/sdkNostrIo.ts` → `sdk/core/nostr-io`, protected — adopt, do
 * not edit) wraps the SAME pool via `relayPoolAdapter`, so the two seams share
 * connections. New relay I/O routes through the SDK seam; this legacy-shaped
 * port (per-call relay overrides, `sign`/`getUser`) survives only because the
 * auction publish family and the read adapters still speak its shapes — it
 * retires as those consumers drain.
 *
 * `sign`/`getUser` are wired through an **injected signer source** (A3.1): the
 * composition root (`platform/web/boot.ts`) registers a
 * `() => SignerCapability | null` resolver at boot, and this module never
 * statically imports the auth store — `authStore` → `readContext` →
 * `applesauceIo` would be a real cycle, so the source arrives by registration
 * instead. Unregistered access fails closed with a typed refusal rather than
 * falling back to any bridge.
 */
import { RelayGroup, RelayPool, type Relay } from 'applesauce-relay'
import type { GroupReqMessage } from 'applesauce-relay'
import { normalizeURL } from 'applesauce-core/helpers/url'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools'
import type { CaughtUpRefusal, EventStreamItem } from '@sdk/core/event-store'
import type { SignerCapability } from '@sdk/core/signer'

import { getMainRelay, getWriteRelays, isAppRelayWritesOnly, ndkStore } from '@platform/web/ndk/ndkStore'

// ---------------------------------------------------------------------------
// The port's contract — moved verbatim from the retired `io-types.ts`.
// ---------------------------------------------------------------------------

export type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
export type NostrFilter = Filter

export interface NostrUser {
	pubkey: string
}

export interface FetchOptions {
	/** Abort the fetch after this many milliseconds (default: ~8s). */
	timeoutMs?: number
	/** Restrict the fetch to these relay URLs. Default: adapter's configured relays. */
	relayUrls?: string[]
}

export interface SubscribeOptions {
	/**
	 * Close the subscription once relays reach EOSE. Default: false.
	 *
	 * Caveat (applesauce 5.2): applesauce 5.2's req() emitted a virtual
	 * EOSE after ~10s as a backstop when a relay never sent one; 6.x only
	 * surfaces the relay's own EOSE. A closeOnEose: true subscription can
	 * therefore hang open on a never-EOSE relay — callers that need bounded
	 * lifetime should add their own timeout.
	 */
	closeOnEose?: boolean
	/** Restrict the subscription to these relay URLs. Default: adapter's configured relays. */
	relayUrls?: string[]
	/**
	 * Boundary notification, fired once. NOT a stop signal — the subscription
	 * stays open unless `closeOnEose` is set. Used by callers that buffer events
	 * until the initial page has arrived.
	 *
	 * Semantics (review 2026-09-18, item 6): fires when the subscription's
	 * relays have all settled (their own EOSE, or a terminal CLOSED/ERROR).
	 * Callers that need a hard "every relay settled" boundary get exactly that.
	 */
	onEose?: () => void
}

export interface PublishOptions {
	/** Restrict publishing to these relay URLs. Default: adapter's write relays. */
	relayUrls?: string[]
}

/**
 * Result of a publish. `publishedRelays` holds only the relay URLs that
 * acknowledged (ACKed) the event — an empty set means no relay accepted it,
 * which callers must treat as a publish failure rather than a success.
 */
export interface PublishResult {
	publishedRelays: ReadonlySet<string>
}

export interface NostrIo {
	/**
	 * Fetch events matching `filter` (a single filter, or several OR-ed filters).
	 *
	 * Contract — callers may rely on these:
	 *   - the result is a flat collection of raw nostr-tools events;
	 *   - **events are unique by `id`.** An event that matches more than one of
	 *     the supplied filters is returned exactly once. Downstream semantic
	 *     layers treat a repeated event as two distinct inputs — e.g.
	 *     `computeValidatedBids` flags a duplicated bid as proof reuse — so
	 *     uniqueness is load-bearing, not cosmetic.
	 */
	fetchEvents(filter: NostrFilter | NostrFilter[], opts?: FetchOptions): Promise<NostrEvent[]>
	subscribe(filter: NostrFilter | NostrFilter[], onEvent: (event: NostrEvent) => void, opts?: SubscribeOptions): () => void
	publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResult>
	sign(template: EventTemplate): Promise<NostrEvent>
	getUser(): Promise<NostrUser | null>
}

// ---------------------------------------------------------------------------
// The injected signer source (A3.1): registration API, never a static import.
// ---------------------------------------------------------------------------

/** Resolves the active signer capability, or null while logged out. */
export type SignerSource = () => SignerCapability | null

let signerSource: SignerSource | null = null

/**
 * Register the source of the active signer capability. Called once at
 * composition (`platform/web/boot.ts`); passing null unregisters (tests).
 */
export function setSignerSource(source: SignerSource | null): void {
	signerSource = source
}

/** The registered signer source, or null when no composition registered one yet. */
export function getRegisteredSignerSource(): SignerSource | null {
	return signerSource
}

function requireSignerSource(): SignerSource {
	if (!signerSource) {
		throw new Error(
			'applesauceIo: no signer source registered — platform/web/boot.ts must call setSignerSource(getActiveSignerCapability) at composition',
		)
	}
	return signerSource
}

// ---------------------------------------------------------------------------
// The shared pool and the adapter.
// ---------------------------------------------------------------------------

let pool: RelayPool | null = null

function getPool(): RelayPool {
	if (!pool) pool = new RelayPool()
	return pool
}

/** The shared pool, for platform adapters that wrap it; callers must not close it. */
export const getApplesauceRelayPool = getPool

/** Resolve target relays: explicit override wins, else mirror NDK's configured relays. */
function relayUrls(override?: string[]): string[] {
	if (override && override.length > 0) return override
	return ndkStore.state.explicitRelayUrls
}

function writeRelayUrls(override?: string[]): string[] {
	// A write-locked instance never publishes past its own relay, even when a
	// caller names other relays.
	if (isAppRelayWritesOnly()) {
		const main = getMainRelay()
		return main ? [main] : []
	}
	if (override && override.length > 0) return override
	return getWriteRelays()
}

function asFilters(filter: NostrFilter | NostrFilter[]): NostrFilter[] {
	return Array.isArray(filter) ? filter : [filter]
}

// ---------------------------------------------------------------------------
// The relay-group seam `createRelayStream` subscribes through.
// ---------------------------------------------------------------------------

/** The part of an RxJS observable the live source uses. */
export interface ObservableLike<T> {
	subscribe(observer: { next: (value: T) => void; error: (error: unknown) => void; complete: () => void }): {
		unsubscribe(): void
	}
}

/**
 * The one call the live source makes on a relay pool — `RelayPool.req`. Typed
 * structurally (not as `RelayPool`) so a host that is not the app's shared pool
 * can be handed to the source: a test drives per-relay messages without a socket
 * (ADR-0005: unit tests make no network calls).
 */
export interface RelayRequestGroup {
	req(relays: string[], filters: NostrFilter[], options: unknown): ObservableLike<GroupReqMessage>
}

/**
 * Bounded connection-retry policy for raw `req()` subscriptions.
 *
 * Restores the applesauce 5.2 `subscription()` default of retrying connection
 * errors up to 3 times with a ~1s linear backoff. Two v6 subtleties make the
 * config explicit rather than `reconnect: true`:
 *
 * - `reconnect: true` maps to RxJS `retry()` with NO count, i.e. unbounded.
 *   A relay that stays down would retry forever, keeping the subscription
 *   (and its WebSocket reconnect timer) alive with no give-up path.
 * - `resetOnSuccess: true` (5.2's default) must be dropped: v6's `req()`
 *   emits an OPEN message per relay on every resubscribe attempt, which the
 *   retry operator would treat as "success" and re-arm the counter, making
 *   the bound unreachable for a relay that fails right after opening.
 */
const SUBSCRIBE_RECONNECT = {
	count: 3,
	delay: 1000,
} as const

export const applesauceIo: NostrIo = {
	fetchEvents(filter, opts?: FetchOptions) {
		const urls = relayUrls(opts?.relayUrls)
		if (urls.length === 0) return Promise.resolve([])
		const filters = asFilters(filter)
		const collected: NostrEvent[] = []
		// Deduplicate by event id.
		//
		// `RelayPool.request(urls, filters)` delivers an event once per matching
		// filter, so a request with several filters (e.g. fetchAuctionBids sends
		// `#e` AND `#a`) emits any event carrying both tags more than once. The
		// NDK adapter this port replaced returned a `Set` (deduplicated by
		// `deduplicationKey()`), and the `NostrIo` port documents a single
		// collection of matching events. Callers rely on that: duplicate bids
		// make `computeValidatedBids`' M5 same-bidder proof-reuse screen flag a
		// legitimate bid as invalid, which aborts a settlement publish.
		//
		// Uniqueness is therefore part of the port contract and is enforced here,
		// at the seam, so every caller gets it.
		const seenIds = new Set<string>()
		return new Promise<NostrEvent[]>((resolve, reject) => {
			let subscription: { unsubscribe(): void } | undefined
			const timer = setTimeout(() => {
				subscription?.unsubscribe()
				resolve(collected)
			}, opts?.timeoutMs ?? 8000)
			subscription = getPool()
				.request(urls, filters, {
					// v6 request() defaults to completeOnAny(completeAfterFirstRelay(5s), completeOnAllEose()):
					// the FIRST relay's EOSE starts a 5s fuse that can end the request before slower relays
					// deliver their events. Pin all-EOSE completion so every relay's events are collected
					// within our own timeoutMs window instead.
					complete: RelayGroup.completeOnAllEose(),
				})
				.subscribe({
					next: (event) => {
						const raw = event as NostrEvent
						const id = raw?.id
						if (id) {
							if (seenIds.has(id)) return
							seenIds.add(id)
						}
						collected.push(raw)
					},
					complete: () => {
						clearTimeout(timer)
						resolve(collected)
					},
					error: (err) => {
						clearTimeout(timer)
						reject(err)
					},
				})
		})
	},

	subscribe(filter, onEvent, opts?: SubscribeOptions) {
		const urls = relayUrls(opts?.relayUrls)
		if (urls.length === 0) return () => {}
		const filters = asFilters(filter)
		let subscription: { unsubscribe(): void } | undefined
		let stopAfterSubscribe = false
		let stopped = false
		const stop = () => {
			if (stopped) return
			stopped = true
			subscription?.unsubscribe()
		}
		// Track per-relay EOSE so closeOnEose only stops the GROUP once every
		// relay has finished sending — the first relay's EOSE must not tear
		// down subscriptions that still have events incoming from other relays.
		// CLOSED/ERROR are terminal for that relay (resubscribe: false), so they
		// settle it too — this matches 5.2, which surfaced a failed relay as a
		// virtual EOSE instead of letting it hold the group open forever.
		const settled = new Set<string>()
		const settledTarget = urls.length
		const groupSettled = () => settled.size >= settledTarget
		// Fire the caller's EOSE boundary exactly once, when the whole group has
		// settled. Without this, a caller that buffers events until the initial
		// page arrives has no seam-level signal and must fall back to a timeout.
		let eoseFired = false
		const fireEose = () => {
			if (eoseFired || !groupSettled()) return
			eoseFired = true
			opts?.onEose?.()
		}
		// Emitted before the observable is assigned; unsubscribes right after subscribe() returns.
		const stopIfCloseOnEose = () => {
			if (!opts?.closeOnEose || stopped || !groupSettled()) return
			if (subscription) stop()
			else {
				stopped = true
				stopAfterSubscribe = true
			}
		}
		subscription = getPool()
			.req(urls, filters, {
				resubscribe: false,
				// Bounded 3-retry policy (see SUBSCRIBE_RECONNECT) — NOT the unbounded
				// `reconnect: true` that v6's raw req() would otherwise expand to.
				reconnect: SUBSCRIBE_RECONNECT,
			})
			.subscribe((message) => {
				if (message.type === 'EOSE') {
					settled.add(message.from)
					fireEose()
					stopIfCloseOnEose()
					return
				}
				// Surface per-relay failures instead of dropping them silently:
				// with resubscribe: false a CLOSED or ERROR permanently removes
				// that relay from this subscription, and there is no other trace
				// of why its events stopped arriving.
				if (message.type === 'CLOSED' || message.type === 'ERROR') {
					console.warn('[nostr:subscribe] relay subscription issue:', message)
					settled.add(message.from)
					fireEose()
					stopIfCloseOnEose()
					return
				}
				if (message.type === 'EVENT' && !stopped) onEvent(message.event as NostrEvent)
			})
		if (stopAfterSubscribe) subscription.unsubscribe()
		return stop
	},

	async publish(event, opts?: PublishOptions): Promise<PublishResult> {
		const urls = writeRelayUrls(opts?.relayUrls)
		if (urls.length === 0) throw new Error('No relays configured for publish')
		// RelayPool.publish resolves with one PublishResponse per relay that
		// answered (errors are mapped to ok:false responses). Only ok responses
		// are ACKs; surface those URLs so callers can fail closed on zero.
		const responses = await getPool().publish(urls, event)
		return { publishedRelays: new Set(responses.filter((response) => response.ok).map((response) => response.from)) }
	},

	async sign(template: EventTemplate): Promise<NostrEvent> {
		const capability = requireSignerSource()()
		if (!capability) throw new Error('No signer available')
		// The capability signs the whole template and returns the full signed
		// event — exactly the raw event shape this port is defined over.
		return (await capability.signEvent(template)) as NostrEvent
	},

	async getUser(): Promise<NostrUser | null> {
		const capability = requireSignerSource()()
		// Logged out (or no active session) is null, matching the retired NDK
		// bridge's `user?.pubkey ? { pubkey } : null` — not an error.
		if (!capability) return null
		return { pubkey: await capability.getPublicKey() }
	},
}

/**
 * The connection truth of one relay, as the transport's own pool can see it.
 * Used at the settle bound to tell a relay that never connected (unreachable)
 * from one that connected and stayed silent (pending).
 */
export interface RelayConnectorState {
	/** The relay's socket is open. */
	connected: boolean
	/** The last connection error the pool recorded, or null. */
	error: unknown
}

/**
 * A `NOTICE` that says the relay will not serve the REQ — as opposed to a
 * courtesy notice ("welcome", an upgrade hint), which is not an answer either
 * way. Deliberately narrow: a notice that matches settles the relay `refused`.
 * Measured live 2026-11-19: `relay.minibits.cash` answers a `#auction` REQ with
 * `NOTICE ["ERROR: bad req: unindexed tag filter"]` and never CLOSEs.
 */
const RELAY_REFUSAL_NOTICE = /bad req|unindexed|does not (?:accept|request)|\bdenied\b|\brestricted\b|not (?:allowed|supported)/i

/** The last relay-refusal notice per relay, or null. Injectable; defaults to the shared pool's relay. */
export type RelayNoticeSource = (url: string) => ObservableLike<string> | null

/**
 * The live relay source behind `EventReadContext.stream`.
 *
 * One `req()` to the group: emits each EVENT as it arrives and a single `caught-up` marker when every relay
 * has settled — its own EOSE, a terminal CLOSED/ERROR, or the never-EOSE timeout (`timeoutMs`, default 8s).
 * The stream stays open after the marker (a live read); the consumer closes it (a bounded `fetch` closes at
 * the marker). Events are admitted by the consumer (`createStoreStream`), so duplicates are dropped at the
 * store's admission point — `req()` (the only group call that surfaces per-relay EOSE messages) does not
 * take an `eventStore` dedup param, so the `asAsyncEventStoreActions` facade is not used on this path.
 *
 * ## A relay that cannot serve the REQ is settled, not pending
 *
 * The marker's `pending` keeps its original meaning — every relay that did not
 * reach EOSE — but two of those are **settled facts**, not silence, and are
 * named so a consumer can account for them rather than wait:
 *
 * - `refused`: the relay answered with a refusal (a `CLOSED` with a reason, or a
 *   relay-refusal `ERROR`/`NOTICE`). Measured live 2026-11-19:
 *   `sendit.nosflare.com` → `restricted: this relay does not accept REQs`,
 *   `relay.nostr.net` → `bad req: error parsing #auction: unindexed tag filter`,
 *   `relay.minibits.cash` → a refusal `NOTICE` and no CLOSE.
 * - `unreachable`: the connection failed or never established — the pool
 *   reported a connection error, or, at the settle bound, the relay's own
 *   socket is not connected. Measured live 2026-11-19: `relay.damus.io` 503s its
 *   upgrade, and `nostr.mom` / `nos.lol` never open a socket.
 *
 * A relay that is connected at the bound but has said nothing stays in `pending`
 * — it may still answer, so the consumer must keep waiting for it. This is the
 * transport's own classification, kept a margin under the read's deadline by
 * the caller (`createWebArenaAuctionRead`), so a consumer sees it before it
 * gives up on the read.
 */
export function createRelayStream(
	filters: NostrFilter | NostrFilter[],
	options: {
		relayUrls?: readonly string[]
		timeoutMs?: number
		signal?: AbortSignal
		group?: RelayRequestGroup
		/** Connection truth for the settle bound. Defaults to the shared pool's relay when no `group` is injected. */
		relayState?: (url: string) => RelayConnectorState | null
		/** Per-relay NOTICE stream. Defaults to the shared pool's relay when no `group` is injected. */
		notices?: RelayNoticeSource
	} = {},
): AsyncIterable<EventStreamItem<NostrEvent>> {
	const urls = [...(options.relayUrls ?? relayUrls())]
	const list = asFilters(filters)
	const timeoutMs = options.timeoutMs ?? 8000
	const group = options.group ?? getPool()
	// The pool's Relay instance is only reachable when this stream owns the pool
	// (`group` defaults to it). A test hands its own `group` and, if it wants the
	// classification, its own probes — reaching into the real pool from a test
	// would open a socket (ADR-0005).
	const poolRelay = (url: string): Relay | null => {
		const pool = getPool() as unknown as { relay?: (u: string) => Relay }
		return typeof pool.relay === 'function' ? pool.relay(url) : null
	}
	const relayState =
		options.relayState ??
		(options.group === undefined
			? (url: string) => {
					const relay = poolRelay(url)
					return relay === null ? null : { connected: relay.connected, error: relay.error$.value }
				}
			: null)
	const notices = options.notices ?? (options.group === undefined ? (url: string) => poolRelay(url)?.notice$ ?? null : null)
	// The pool reports `from` normalized (a trailing slash); a consumer knows the
	// configured URL. Map back so a refusal names the relay the consumer asked for.
	const canonical = new Map(urls.map((url) => [normalizeURL(url), url]))
	const asKnown = (from: string): string => {
		try {
			return canonical.get(normalizeURL(from)) ?? from
		} catch {
			return from
		}
	}
	return {
		async *[Symbol.asyncIterator]() {
			if (urls.length === 0) {
				yield { type: 'caught-up', info: { eose: [], pending: [], complete: true } }
				return
			}
			const queue: EventStreamItem<NostrEvent>[] = []
			let wake: (() => void) | null = null
			let finished = false
			const settled = new Set<string>()
			const eose: string[] = []
			const pending: string[] = []
			const refused: CaughtUpRefusal[] = []
			const unreachable: string[] = []
			let caughtUp = false
			const push = (item: EventStreamItem<NostrEvent>) => {
				queue.push(item)
				wake?.()
				wake = null
			}
			const markSettled = (url: string, status: 'eose' | 'refused' | 'unreachable' | 'pending', reason = '') => {
				if (settled.has(url)) return
				settled.add(url)
				if (status === 'eose') eose.push(url)
				// `pending` keeps its contract: every relay that did not reach EOSE.
				else pending.push(url)
				if (status === 'refused') refused.push({ relay: url, reason })
				if (status === 'unreachable') unreachable.push(url)
				if (!caughtUp && settled.size >= urls.length) {
					caughtUp = true
					push({
						type: 'caught-up',
						info: { eose: [...eose], pending: [...pending], complete: false, refused: [...refused], unreachable: [...unreachable] },
					})
				}
			}
			const noticeSubscriptions: { unsubscribe(): void }[] = []
			const subscription = group.req(urls, list, { resubscribe: false, reconnect: SUBSCRIBE_RECONNECT }).subscribe({
				next: (message) => {
					if (message.type === 'EVENT') push({ type: 'event', event: message.event as NostrEvent })
					else if (message.type === 'EOSE') markSettled(asKnown(message.from), 'eose')
					else if (message.type === 'CLOSED') markSettled(asKnown(message.from), 'refused', message.reason)
					else if (message.type === 'ERROR') {
						// The group maps a relay's per-REQ `CLOSED`-derived error to
						// `ERROR` (a relay answering "no"), and a connection failure to a
						// generic error. Only the former is a refusal.
						const error = message.error
						const name = (error as { name?: string } | null)?.name
						if (name === 'RelayClosedError' || name === 'AuthRequiredError') {
							markSettled(asKnown(message.from), 'refused', error instanceof Error ? error.message : String(error))
						} else markSettled(asKnown(message.from), 'unreachable')
					}
				},
				error: () => {
					for (const url of urls) if (!settled.has(url)) markSettled(url, 'unreachable')
					finished = true
					wake?.()
					wake = null
				},
				complete: () => {
					for (const url of urls) if (!settled.has(url)) markSettled(url, 'unreachable')
					finished = true
					wake?.()
					wake = null
				},
			})
			// A refusal NOTICE is an answer: the relay will not serve this REQ.
			if (notices !== null) {
				for (const url of urls) {
					const source = notices(url)
					if (source === null) continue
					noticeSubscriptions.push(
						source.subscribe({
							next: (text) => {
								if (RELAY_REFUSAL_NOTICE.test(text)) markSettled(url, 'refused', text)
							},
							error: () => {},
							complete: () => {},
						}),
					)
				}
			}
			// Never-EOSE fallback: settle the remaining relays so a bounded read cannot hang,
			// naming the ones that never connected (unreachable) apart from the ones that did
			// and stayed silent (pending — a relay that could still answer).
			const timer = setTimeout(() => {
				if (caughtUp) return
				for (const url of urls) {
					if (settled.has(url)) continue
					const state = relayState?.(url) ?? null
					if (state !== null && state.connected === false) markSettled(url, 'unreachable')
					else markSettled(url, 'pending')
				}
			}, timeoutMs)
			const onAbort = () => {
				finished = true
				wake?.()
				wake = null
			}
			options.signal?.addEventListener('abort', onAbort)
			try {
				while (true) {
					if (queue.length > 0) {
						yield queue.shift()!
						continue
					}
					if (finished) return
					await new Promise<void>((resolve) => {
						wake = resolve
					})
				}
			} finally {
				clearTimeout(timer)
				options.signal?.removeEventListener('abort', onAbort)
				subscription.unsubscribe()
				for (const notice of noticeSubscriptions) notice.unsubscribe()
			}
		},
	}
}
