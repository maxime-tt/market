/**
 * Tests for the first-party publish bridge (`nostrPublishBridge` /
 * `publishNostrEvent` in `platform/web/ndkPublishContext.ts`), moved from the
 * retired `src/lib/nostr/io-ndk.ts` adapter tests (J-0). The publish half of
 * the former default adapter keeps its NDK path here: `ndkActions.publishEvent`
 * with an optional relay-set override, and the ACKed relay URLs surfaced
 * truthfully so callers can fail closed on zero.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

const stubRawEvent = {
	id: 'evt-1',
	pubkey: 'pk-1',
	created_at: 1,
	kind: 1,
	tags: [],
	content: 'hello',
	sig: 'sig-1',
}

function normalizeTestRelayUrl(url: string): string {
	return url.endsWith('/') ? url : `${url}/`
}

function makeMockNdk(relayUrls: string[] = []) {
	const relays = new Map(
		relayUrls.map((url) => {
			const relay = { url: normalizeTestRelayUrl(url), status: 5, connect: mock(() => {}) }
			return [relay.url, relay] as const
		}),
	)
	return {
		subscribe: mock(() => ({ stop: mock(() => {}) })),
		pool: {
			relays,
			useTemporaryRelay: mock((relay: { url: string }) => {
				relays.set(relay.url, relay as never)
			}),
		},
		debug: { extend: () => () => {} },
	}
}

function relaySetUrls(relaySet: unknown): string[] {
	return Array.from((relaySet as { relays: Set<{ url: string }> }).relays).map((relay) => relay.url)
}

const mockNdkStore = {
	state: {
		ndk: null as ReturnType<typeof makeMockNdk> | null,
		explicitRelayUrls: [] as string[],
		writeRelayUrls: [] as string[],
	},
}
const mockNdkActions = {
	publishEvent: mock(async (_event?: unknown, _relaySet?: unknown) => new Set([{ url: 'wss://relay.example' }])),
}
const mockGetWriteRelays = mock(() => mockNdkStore.state.writeRelayUrls)

const ndkStoreMock = () => ({
	getWriteRelays: mockGetWriteRelays,
	ndkActions: mockNdkActions,
	ndkStore: mockNdkStore,
})
mock.module('@/lib/stores/ndk', ndkStoreMock)
mock.module('@platform/web/ndk/ndkStore', ndkStoreMock)

import { publishNostrEvent } from './ndkPublishContext'

function resetNdkState() {
	mockNdkStore.state.ndk = null
	mockNdkStore.state.explicitRelayUrls = []
	mockNdkStore.state.writeRelayUrls = []
	mockNdkActions.publishEvent.mockImplementation(async () => new Set([{ url: 'wss://relay.example' }]))
	mockNdkActions.publishEvent.mockClear()
	mockGetWriteRelays.mockClear()
}

describe('NDK publish bridge (ndkPublishContext.publishNostrEvent)', () => {
	afterEach(resetNdkState)

	test('publish throws "NDK not initialized" when the singleton is absent', async () => {
		mockNdkStore.state.ndk = null
		await expect(publishNostrEvent(stubRawEvent as never)).rejects.toThrow('NDK not initialized')
		expect(mockNdkActions.publishEvent).not.toHaveBeenCalled()
	})

	test('publish passes an NDK relay set when relayUrls are provided', async () => {
		mockNdkStore.state.ndk = makeMockNdk(['wss://publish.example'])
		await publishNostrEvent(stubRawEvent as never, { relayUrls: ['wss://publish.example'] })

		const [[event, relaySet]] = mockNdkActions.publishEvent.mock.calls
		expect((event as { rawEvent(): unknown }).rawEvent()).toEqual(stubRawEvent)
		expect(relaySetUrls(relaySet)).toEqual(['wss://publish.example/'])
	})

	test('publish preserves default write-relay behavior when relayUrls are omitted', async () => {
		mockNdkStore.state.ndk = makeMockNdk()
		await publishNostrEvent(stubRawEvent as never)

		const [[event, relaySet]] = mockNdkActions.publishEvent.mock.calls
		expect((event as { rawEvent(): unknown }).rawEvent()).toEqual(stubRawEvent)
		expect(relaySet).toBeUndefined()
	})

	test('publish returns the relay URLs that ACKed the event', async () => {
		mockNdkStore.state.ndk = makeMockNdk()
		mockNdkActions.publishEvent.mockImplementationOnce(
			async () => new Set([{ url: 'wss://ack-a.example' }, { url: 'wss://ack-b.example' }]),
		)

		const result = await publishNostrEvent(stubRawEvent as never)

		expect(result.publishedRelays).toEqual(new Set(['wss://ack-a.example', 'wss://ack-b.example']))
	})

	test('publish returns an empty set when no relay ACKed', async () => {
		mockNdkStore.state.ndk = makeMockNdk()
		mockNdkActions.publishEvent.mockImplementationOnce(async () => new Set())

		const result = await publishNostrEvent(stubRawEvent as never)

		expect(result.publishedRelays.size).toBe(0)
	})

	test('publish treats empty relayUrls as no override', async () => {
		mockNdkStore.state.ndk = makeMockNdk()
		await publishNostrEvent(stubRawEvent as never, { relayUrls: [] })

		const [[event, relaySet]] = mockNdkActions.publishEvent.mock.calls
		expect((event as { rawEvent(): unknown }).rawEvent()).toEqual(stubRawEvent)
		expect(relaySet).toBeUndefined()
	})
})
