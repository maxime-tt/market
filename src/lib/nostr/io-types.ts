/**
 * The Nostr I/O port's *contract* — the types of `./io`, kept in their own
 * module.
 *
 * `./io` imports both adapters (`io-ndk.ts` to register the default and
 * `io-applesauce.ts` to re-export it). If the adapters imported their own
 * contract back from `./io`, the three files would form a cycle with no seam
 * through it. They import this module instead; `./io` re-exports everything
 * here, so callers still have one import path for the port and its types.
 */
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools'

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
	 * Caveat (applesauce adapter): applesauce 5.2's req() emitted a virtual
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
	 * Adapter-scoped semantics (review 2026-09-18, item 6):
	 *   - applesauce adapter: fires when the subscription's relays have all
	 *     settled (their own EOSE).
	 *   - NDK bridge (`io-ndk.ts`): forwards NDK's own `eose`, which is a QUORUM
	 *     heuristic (`eosesSeen.size >= 2 && >=50% of relays EOSE`, plus a ~1s
	 *     quiet timer) and does not count a terminal CLOSED relay as settled, so
	 *     it can fire with relays still pending — or never fire when a relay
	 *     closes. Callers that need a hard "every relay settled" boundary must
	 *     not rely on the NDK bridge and should add their own timeout (as the
	 *     auctions bid stream does).
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
	 * Contract — both adapters MUST honour these, and callers may rely on them:
	 *   - the result is a flat collection of raw nostr-tools events;
	 *   - **events are unique by `id`.** An event that matches more than one of
	 *     the supplied filters is returned exactly once. (NDK's event set
	 *     deduplicated by `deduplicationKey()`; the applesauce adapter must
	 *     deduplicate by `id` to match.) Downstream semantic layers treat a
	 *     repeated event as two distinct inputs — e.g. `computeValidatedBids`
	 *     flags a duplicated bid as proof reuse — so uniqueness is load-bearing,
	 *     not cosmetic.
	 */
	fetchEvents(filter: NostrFilter | NostrFilter[], opts?: FetchOptions): Promise<NostrEvent[]>
	subscribe(filter: NostrFilter | NostrFilter[], onEvent: (event: NostrEvent) => void, opts?: SubscribeOptions): () => void
	publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResult>
	sign(template: EventTemplate): Promise<NostrEvent>
	getUser(): Promise<NostrUser | null>
}
