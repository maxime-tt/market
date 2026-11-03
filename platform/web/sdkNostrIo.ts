import { createRelayStream, getApplesauceRelayPool } from '@platform/web/applesauceIo'
import { getWriteRelays, ndkStore } from '@platform/web/ndk/ndkStore'
import { createPoolRelayPort, type NostrFilter, type NostrRelayPort } from '@sdk/core'
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

export function createWebRelayPort(options: { deadlineMs?: number } = {}): NostrRelayPort<Event> {
	return createPoolRelayPort(getWebPoolPort(), options)
}

/** Read context over the SDK seam with explicit relays; pair it with a store from `ndkReadContext`/`applesauceReadContext`. */
export function createWebRelayReadContext(
	store: EventStorePort<Event>,
	relayUrls: readonly string[] = webRelayPolicy('query'),
	options: { deadlineMs?: number } = { deadlineMs: 8000 },
): EventReadContext<Event> {
	return createEventReadContext({
		store,
		stream: createStoreStream({
			store,
			source: (filters, opts) => {
				if (opts?.bounded) {
					const port = createWebRelayPort(options)
					return (async function* () {
						for (const event of await port.fetchEvents(filters as readonly NostrFilter[], relayUrls))
							yield { type: 'event' as const, event }
						yield { type: 'caught-up' as const, info: { eose: [], pending: [], complete: true } }
					})()
				}
				return createRelayStream(filters as unknown as Parameters<typeof createRelayStream>[0], {
					relayUrls,
					timeoutMs: options.deadlineMs,
					signal: opts?.signal,
				})
			},
		}),
	})
}
