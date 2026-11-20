import { createRelayStream, getApplesauceRelayPool, relayConnectionState, type RelayRequestGroup } from '@platform/web/applesauceIo'
import { getWriteRelays, ndkStore } from '@platform/web/ndk/ndkStore'
import { createNostrIo, relayPoolAdapter, type Event, type NostrIo, type PoolPort, type RelayPolicy } from '@sdk/core/nostr-io'
import { createEventReadContext, createStoreStream, type EventReadContext, type EventStorePort } from '@sdk/core/event-store'

/** Same relay choice as the app's applesauce adapter: configured relays to read, write relays to publish. */
export const webRelayPolicy: RelayPolicy = (operation) => (operation === 'publish' ? getWriteRelays() : ndkStore.state.explicitRelayUrls)

let sharedPoolPort: PoolPort | null = null

// One adapter over the app's single applesauce pool, so the SDK seam shares its connections.
function getWebPoolPort(): PoolPort {
	if (!sharedPoolPort) sharedPoolPort = relayPoolAdapter(getApplesauceRelayPool())
	return sharedPoolPort
}

/** The SDK nostr-io seam for the web host. Do not call `close()`: it would close the app's shared pool. */
export function createWebNostrIo(): NostrIo {
	return createNostrIo({ pool: getWebPoolPort(), policy: webRelayPolicy })
}

export interface WebRelayReadOptions {
	/** The read's own hard deadline, in ms. Default 8000. */
	deadlineMs?: number
	/**
	 * The relay group the read subscribes through. Defaults to the app's shared
	 * applesauce pool. Injectable so a unit test can drive per-relay messages
	 * without a socket (ADR-0005).
	 */
	group?: RelayRequestGroup
}

/**
 * Whether one relay's socket is open **right now** — the app pool's own truth,
 * the same one the transport's settle bound reads. `null` means the pool holds
 * no relay for that URL, which is no verdict at all — never "unreachable".
 *
 * This is the read-context seam's answer to a read that owns a deadline of its
 * own (the arena read's `relayConnected`): asked once, synchronously, when that
 * deadline fires, so a relay whose socket never opened is a settled `no`
 * instead of `pending` while the transport's own bound is still in the future.
 */
export function webRelayConnected(url: string): boolean | null {
	return relayConnectionState(url)?.connected ?? null
}

/**
 * Read context over the app's relay group, with explicit relays; pair it with a
 * store from `ndkReadContext`/`applesauceReadContext`.
 *
 * **A bounded read ends only when every named relay has settled.** The bounded
 * `fetch` path this replaces went through the SDK seam's `query` →
 * `relayPoolAdapter.request`, which maps a relay's `CLOSED`/`ERROR` to a throw on
 * the group's own stream (`sdk/core/nostr-io/ts/relay-adapter.ts:134-140`), so the
 * first relay to refuse ends the whole read (`sdk/core/nostr-io/ts/index.ts`, the
 * `error` arm of `query`). Measured live 2026-11-19: two of the seven configured
 * relays refuse in milliseconds (`sendit.nosflare.com` NOTICE-denied,
 * `relay.damus.io` 503), and the read resolved in ~15 ms with zero events — 167 ms
 * before `relay.playday.it`'s first kind-1448 EVENT. The live source
 * (`createRelayStream`) tracks each named relay's own EOSE/CLOSED/ERROR and emits
 * its caught-up marker only when all of them have settled — with the read's
 * deadline (`timeoutMs`, and the caller's own `AbortSignal`) as the hard bound,
 * so a read over several relays cannot be ended by one of them settling.
 */
export function createWebRelayReadContext(
	store: EventStorePort<Event>,
	relayUrls: readonly string[] = webRelayPolicy('query'),
	options: WebRelayReadOptions = { deadlineMs: 8000 },
): EventReadContext<Event> {
	return createEventReadContext({
		store,
		stream: createStoreStream({
			store,
			source: (filters, opts) =>
				createRelayStream(filters as unknown as Parameters<typeof createRelayStream>[0], {
					relayUrls,
					timeoutMs: options.deadlineMs,
					signal: opts?.signal,
					group: options.group,
				}),
		}),
	})
}
