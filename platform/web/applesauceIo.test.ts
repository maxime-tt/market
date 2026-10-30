/**
 * Adapter tests for the web host's applesauce Nostr I/O port
 * (`platform/web/applesauceIo.ts`), moved from the retired
 * `src/lib/__tests__/io.test.ts` (J-0). Relay round-trip behaviour is
 * exercised in Wave A1 against the local nak relay; these tests pin the
 * in-process contract and edge cases.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

// Stub the NDK singleton so the port's store reads resolve without the full
// NDK graph. These handles are mutable so tests can reconfigure the
// store/actions per case (e.g. flip relays on/off).
const stubRawEvent = {
	id: 'evt-1',
	pubkey: 'pk-1',
	created_at: 1,
	kind: 1,
	tags: [],
	content: 'hello',
	sig: 'sig-1',
}
const stubRawEvent2 = { ...stubRawEvent, id: 'evt-2' }

function normalizeTestRelayUrl(url: string): string {
	return url.endsWith('/') ? url : `${url}/`
}

const mockNdkStore = {
	state: {
		ndk: null as unknown,
		explicitRelayUrls: [] as string[],
		writeRelayUrls: [] as string[],
	},
}
const mockNdkActions = {
	fetchEventsWithTimeout: mock(async () => new Set()),
	publishEvent: mock(async () => new Set()),
	getSigner: () => undefined,
	getUser: mock(async () => null as { pubkey: string } | null),
}
const mockGetWriteRelays = mock(() => mockNdkStore.state.writeRelayUrls)

const ndkStoreMock = () => ({
	getWriteRelays: mockGetWriteRelays,
	ndkActions: mockNdkActions,
	ndkStore: mockNdkStore,
})
mock.module('@platform/web/ndk/ndkStore', ndkStoreMock) // E1b: src shim specifier retired

// Controllable RelayPool stub for the adapter. The port caches a single pool
// instance (`let pool`), so the controllers below are module-level bindings
// the cached instance reads through its closures — reassigning them
// reconfigures behaviour for the next call without recreating the pool.
type ReqHandlers = { next: (e: typeof stubRawEvent) => void; complete: () => void; error: (e: unknown) => void }
let poolRequestController = (_h: ReqHandlers, _urls: string[], _filters: unknown, _opts?: unknown): { unsubscribe: () => void } => ({
	unsubscribe: () => {},
})
let poolSubscriptionController = (
	_cb: (msg: unknown) => void,
	_urls: string[],
	_filters: unknown,
	_opts: unknown,
): { unsubscribe: () => void } => ({ unsubscribe: () => {} })
let poolPublishController = async (_urls: string[], _event: unknown): Promise<unknown> => []

// Sentinel returned by the RelayGroup.completeOnAllEose() stub — the adapter
// must forward it as request()'s `complete` option so fetchEvents waits for
// every relay's EOSE instead of applesauce 6.2's first-relay-EOSE default.
const completeOnAllEoseOperator = { marker: 'completeOnAllEose' }

mock.module('applesauce-relay', () => ({
	RelayPool: class MockRelayPool {
		request = (urls: string[], filters: unknown, opts?: unknown) => ({
			subscribe: (h: ReqHandlers) => poolRequestController(h, urls, filters, opts),
		})
		req = (urls: string[], filters: unknown, opts: unknown) => ({
			subscribe: (cb: (msg: unknown) => void) => poolSubscriptionController(cb, urls, filters, opts),
		})
		publish = async (urls: string[], event: unknown) => poolPublishController(urls, event)
	},
	RelayGroup: {
		completeOnAllEose: () => completeOnAllEoseOperator,
	},
}))

import { applesauceIo, setSignerSource } from './applesauceIo'

function resetNdkState() {
	mockNdkStore.state.ndk = null
	mockNdkStore.state.explicitRelayUrls = []
	mockNdkStore.state.writeRelayUrls = []
	mockNdkActions.getUser.mockImplementation(async () => null)
	mockNdkActions.fetchEventsWithTimeout.mockImplementation(async () => new Set())
	mockNdkActions.fetchEventsWithTimeout.mockClear()
	mockNdkActions.publishEvent.mockClear()
	mockGetWriteRelays.mockClear()
}

describe('applesauce adapter (platform/web/applesauceIo)', () => {
	afterEach(resetNdkState)
	// A3.1: the injected signer source is registration state — unregister
	// after every test so the not-registered refusal probes stay isolated.
	afterEach(() => setSignerSource(null))

	test('fetchEvents resolves [] when no relays are configured (short-circuit)', async () => {
		mockNdkStore.state.explicitRelayUrls = []
		await expect(applesauceIo.fetchEvents({ kinds: [1] })).resolves.toEqual([])
	})

	test('fetchEvents collects events until the observable completes', async () => {
		// Explicit relay override exercises the relay pool path without the store.
		poolRequestController = (h) => {
			h.next(stubRawEvent)
			h.next(stubRawEvent2)
			h.complete()
			return { unsubscribe: () => {} }
		}
		const events = await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://relay.example'] })
		expect(events).toEqual([stubRawEvent, stubRawEvent2])
	})

	test('fetchEvents rejects when the observable errors', async () => {
		poolRequestController = (h) => {
			h.error(new Error('relay down'))
			return { unsubscribe: () => {} }
		}
		await expect(applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://relay.example'] })).rejects.toThrow('relay down')
	})

	test('fetchEvents returns whatever was collected before the timeout elapses', async () => {
		poolRequestController = (h) => {
			// One event arrives, but the observable never completes -> timeout must fire.
			h.next(stubRawEvent)
			return { unsubscribe: mock(() => {}) }
		}
		const events = await applesauceIo.fetchEvents(
			{ kinds: [1] },
			{
				relayUrls: ['wss://relay.example'],
				timeoutMs: 15,
			},
		)
		expect(events).toEqual([stubRawEvent])
	})

	test('subscribe is a no-op when no relays are configured (short-circuit)', () => {
		mockNdkStore.state.explicitRelayUrls = []
		const stop = applesauceIo.subscribe({ kinds: [1] }, () => {})
		expect(typeof stop).toBe('function')
		expect(() => stop()).not.toThrow()
	})

	test('subscribe forwards relay events, skips EOSE markers, and stop() unsubscribes', () => {
		const unsubscribe = mock(() => {})
		poolSubscriptionController = (cb) => {
			cb({ type: 'EVENT', from: 'wss://relay.example', id: 'sub-1', event: stubRawEvent })
			cb({ type: 'EOSE', from: 'wss://relay.example', id: 'sub-1' }) // control marker — must be filtered out, not handed to onEvent
			cb({ type: 'EVENT', from: 'wss://relay.example', id: 'sub-1', event: stubRawEvent2 })
			return { unsubscribe }
		}
		const seen: unknown[] = []
		const stop = applesauceIo.subscribe({ kinds: [1] }, (e) => seen.push(e), { relayUrls: ['wss://relay.example'] })

		expect(seen).toEqual([stubRawEvent, stubRawEvent2])
		stop()
		expect(unsubscribe).toHaveBeenCalledTimes(1)
	})

	test('subscribe with closeOnEose unsubscribes on EOSE without forwarding it', () => {
		const unsubscribe = mock(() => {})
		const onEvent = mock(() => {})
		// Capture the message callback and emit EOSE only after .subscribe()
		// returns. Production reaches the post-subscribe path because the pool
		// defers req() behind relay readiness, so the synchronous variant only
		// exercised the stopAfterSubscribe branch production can't reach.
		let emit: ((msg: unknown) => void) | undefined
		poolSubscriptionController = (cb) => {
			emit = cb
			return { unsubscribe }
		}

		const stop = applesauceIo.subscribe({ kinds: [1] }, onEvent, {
			closeOnEose: true,
			relayUrls: ['wss://relay.example'],
		})

		emit?.({ type: 'EOSE', from: 'wss://relay.example', id: 'sub-1' })

		expect(onEvent).not.toHaveBeenCalled()
		expect(unsubscribe).toHaveBeenCalledTimes(1)
		stop()
		expect(unsubscribe).toHaveBeenCalledTimes(1)
	})

	test('subscribe without closeOnEose skips EOSE and stays active until cleanup', () => {
		const unsubscribe = mock(() => {})
		const onEvent = mock(() => {})
		poolSubscriptionController = (cb) => {
			cb({ type: 'EOSE', from: 'wss://relay.example', id: 'sub-1' })
			return { unsubscribe }
		}

		const stop = applesauceIo.subscribe({ kinds: [1] }, onEvent, { relayUrls: ['wss://relay.example'] })

		expect(onEvent).not.toHaveBeenCalled()
		expect(unsubscribe).not.toHaveBeenCalled()
		stop()
		expect(unsubscribe).toHaveBeenCalledTimes(1)
	})

	test('subscribe warns on per-relay CLOSED and ERROR messages without forwarding them', () => {
		const unsubscribe = mock(() => {})
		const onEvent = mock(() => {})
		const warns: unknown[][] = []
		const warn = console.warn
		console.warn = (...args: unknown[]) => warns.push(args)
		try {
			let emit: ((msg: unknown) => void) | undefined
			poolSubscriptionController = (cb) => {
				emit = cb
				return { unsubscribe }
			}
			const stop = applesauceIo.subscribe({ kinds: [1] }, onEvent, { relayUrls: ['wss://relay.example'] })
			// CLOSED/ERROR are surfaced but never forwarded to onEvent; events still flow.
			emit?.({ type: 'CLOSED', from: 'wss://relay.example', id: 'sub-1', reason: 'rate-limited' })
			emit?.({ type: 'ERROR', from: 'wss://relay.example', id: 'sub-1', error: new Error('conn fail') })
			emit?.({ type: 'EVENT', from: 'wss://relay.example', id: 'sub-1', event: stubRawEvent })
			expect(warns.length).toBe(2)
			expect(onEvent).toHaveBeenCalledTimes(1)
			stop()
			expect(unsubscribe).toHaveBeenCalledTimes(1)
		} finally {
			console.warn = warn
		}
	})

	test('publish throws when no relays are configured', async () => {
		mockNdkStore.state.writeRelayUrls = []
		await expect(applesauceIo.publish(stubRawEvent as never)).rejects.toThrow('No relays configured for publish')
	})

	test('publish forwards the event to the relay pool using write relays by default', async () => {
		mockNdkStore.state.writeRelayUrls = ['wss://write.example']
		poolPublishController = mock(async () => [
			{ ok: true, from: 'wss://write.example' },
			{ ok: false, from: 'wss://down.example', message: 'relay error' },
		])

		const result = await applesauceIo.publish(stubRawEvent as never)

		expect(poolPublishController).toHaveBeenCalledWith(['wss://write.example'], stubRawEvent)
		// Only ok responses are ACKs; a relay that rejected the event is not published.
		expect(result.publishedRelays).toEqual(new Set(['wss://write.example']))
	})

	test('publish honors explicit relayUrls over write relays', async () => {
		mockNdkStore.state.writeRelayUrls = ['wss://write.example']
		poolPublishController = mock(async () => [{ ok: true, from: 'wss://override.example' }])

		const result = await applesauceIo.publish(stubRawEvent as never, { relayUrls: ['wss://override.example'] })

		expect(poolPublishController).toHaveBeenCalledWith(['wss://override.example'], stubRawEvent)
		expect(result.publishedRelays).toEqual(new Set(['wss://override.example']))
	})

	test('sign rejects before boot registers a signer source (typed refusal, never a cycle)', async () => {
		await expect(applesauceIo.sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).rejects.toThrow('no signer source registered')
	})

	test('sign signs through the registered capability and returns the full raw event', async () => {
		const signEvent = mock(async () => ({ ...stubRawEvent, id: 'evt-signed', sig: 'sig-raw' }))
		setSignerSource(() => ({ getPublicKey: async () => 'pk-1', signEvent: signEvent as never }))

		const template = { kind: 30408, content: 'claim', tags: [['t', 'x']], created_at: 1736000000 }
		const signed = await applesauceIo.sign(template)

		expect(signEvent).toHaveBeenCalledWith(template)
		expect(signed).toEqual({ ...stubRawEvent, id: 'evt-signed', sig: 'sig-raw' })
	})

	test('sign throws the No signer available refusal when the source reports logged out', async () => {
		setSignerSource(() => null)
		await expect(applesauceIo.sign({ kind: 1, content: 'c', tags: [], created_at: 1 })).rejects.toThrow('No signer available')
	})

	test('getUser resolves null while logged out and the capability pubkey while active', async () => {
		// Unregistered is a composition error (same typed refusal as sign).
		await expect(applesauceIo.getUser()).rejects.toThrow('no signer source registered')

		setSignerSource(() => null)
		await expect(applesauceIo.getUser()).resolves.toBeNull()

		setSignerSource(() => ({ getPublicKey: async () => 'pk-active', signEvent: async () => stubRawEvent as never }))
		await expect(applesauceIo.getUser()).resolves.toEqual({ pubkey: 'pk-active' })
	})

	test('explicit relayUrls override wins; an empty override falls back to the store', async () => {
		// Override wins over the (empty) store configuration.
		let captured: string[] = []
		poolRequestController = (h, urls) => {
			captured = urls
			h.complete()
			return { unsubscribe: () => {} }
		}
		await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://override'] })
		expect(captured).toEqual(['wss://override'])

		// An empty override must NOT short-circuit to [] — it falls back to the store.
		mockNdkStore.state.explicitRelayUrls = ['wss://from-store']
		await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: [] })
		expect(captured).toEqual(['wss://from-store'])
	})

	test('fetchEvents pins request() to all-relay EOSE completion (not the 6.2 first-EOSE default)', async () => {
		// applesauce-relay 6.2's request() default completes via
		// completeOnAny(completeAfterFirstRelay(5s), completeOnAllEose()) — the
		// first relay's EOSE starts a 5s fuse that can end the fetch before
		// slower relays deliver. The adapter must pass the group-completion
		// operator explicitly.
		let capturedOpts: { complete?: unknown } | undefined
		poolRequestController = (h, _urls, _filters, opts) => {
			capturedOpts = opts as { complete?: unknown }
			h.complete()
			return { unsubscribe: () => {} }
		}
		await applesauceIo.fetchEvents({ kinds: [1] }, { relayUrls: ['wss://relay.example'] })
		expect(capturedOpts?.complete).toBe(completeOnAllEoseOperator)
	})

	test('subscribe passes a bounded reconnect policy to req() (1 initial + 3 retries, no resetOnSuccess)', () => {
		// 6.2's `reconnect: true` maps to RxJS retry() with NO count (unbounded)
		// and its synthetic OPEN markers (relay.js:537-541) would reset a
		// `resetOnSuccess` counter on every resubscribe. The adapter must pin
		// the bounded 5.2-style policy instead.
		let capturedOpts: { reconnect?: unknown } | undefined
		poolSubscriptionController = (cb, _urls, _filters, opts) => {
			capturedOpts = opts as { reconnect?: unknown }
			return { unsubscribe: () => {} }
		}
		const stop = applesauceIo.subscribe({ kinds: [1] }, () => {}, { relayUrls: ['wss://relay.example'] })
		expect(capturedOpts?.reconnect).toEqual({ count: 3, delay: 1000 })
		stop()
	})

	test('closeOnEose waits for every relay to settle before unsubscribing (not just the first EOSE)', () => {
		// The maximotodev review scenario, at the adapter wiring level: with two
		// relays, the FIRST relay's EOSE must not unsubscribe the group — only
		// once both relays have settled (EOSE or terminal CLOSED/ERROR) may
		// stop() run. Relay URL comparison is by normalized `from` count, so
		// both stubs below use distinct relay URLs.
		const unsubscribe = mock(() => {})
		let emit: ((msg: unknown) => void) | undefined
		poolSubscriptionController = (cb) => {
			emit = cb
			return { unsubscribe }
		}

		const onEvent = mock(() => {})
		const stop = applesauceIo.subscribe({ kinds: [1] }, onEvent, {
			closeOnEose: true,
			relayUrls: ['wss://relay-a.example', 'wss://relay-b.example'],
		})

		// First relay EOSEs — the group is NOT settled yet: no teardown.
		emit?.({ type: 'EOSE', from: 'wss://relay-a.example/', id: 'sub-1' })
		expect(unsubscribe).toHaveBeenCalledTimes(0)

		// A late event from the second relay still arrives.
		emit?.({ type: 'EVENT', from: 'wss://relay-b.example/', id: 'sub-1', event: stubRawEvent })
		expect(onEvent).toHaveBeenCalledTimes(1)

		// Second relay settles via terminal CLOSED — NOW the group stops.
		emit?.({ type: 'CLOSED', from: 'wss://relay-b.example/', id: 'sub-1', reason: 'rate-limited: no' })
		expect(unsubscribe).toHaveBeenCalledTimes(1)

		stop()
		// stop() after group teardown is idempotent.
		expect(unsubscribe).toHaveBeenCalledTimes(1)
	})

	test('onEose fires exactly once, and only after every relay settles', () => {
		// Callers that buffer events until the initial page arrives (the auction
		// bid stream) need a single EOSE boundary. It must not fire on the first
		// relay's EOSE while a slower relay is still pending, and must not fire
		// again on a duplicate/late EOSE.
		const unsubscribe = mock(() => {})
		let emit: ((msg: unknown) => void) | undefined
		poolSubscriptionController = (cb) => {
			emit = cb
			return { unsubscribe }
		}

		const onEose = mock(() => {})
		applesauceIo.subscribe({ kinds: [1] }, () => {}, {
			onEose,
			relayUrls: ['wss://relay-a.example', 'wss://relay-b.example'],
		})

		// First relay settles — the group is incomplete: no boundary yet.
		emit?.({ type: 'EOSE', from: 'wss://relay-a.example/', id: 'sub-1' })
		expect(onEose).toHaveBeenCalledTimes(0)

		// Second relay settles — the boundary fires exactly once.
		emit?.({ type: 'EOSE', from: 'wss://relay-b.example/', id: 'sub-1' })
		expect(onEose).toHaveBeenCalledTimes(1)

		// A duplicate/late EOSE must not fire it again.
		emit?.({ type: 'EOSE', from: 'wss://relay-b.example/', id: 'sub-1' })
		expect(onEose).toHaveBeenCalledTimes(1)
	})
})
