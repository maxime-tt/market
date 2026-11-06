/**
 * platform/web/browse/browseIndexFeed.render.test.tsx — the progressive feed
 * reaches the screen, not just the cache.
 *
 * `browseIndexFeed.stream.test.ts` proves the read publishes a partial set.
 * This file proves the home's consumer of it *renders* that set while the rest
 * of the stream is still in flight: the hook writes each snapshot into the
 * query's own cache entry, so a mounted `useBrowseIndexFeed` observer paints the
 * listings the relays already delivered — no wait for the caught-up marker.
 *
 * The renderer is a real DOM (`happy-dom`, installed below before `react-dom`
 * is evaluated), the read seam is stubbed with a stream the test holds open,
 * and the query cache is the source of the assertions. Before the streaming
 * hook existed, the held stream meant no data at all and the probe rendered
 * nothing.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import type { Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { EventFilter } from '@sdk/core/event-store/filter'
import type { EventStreamItem } from '@sdk/core/event-store/read'

// Query notifications are scheduled through a zero-delay timer by default. In
// this file they are delivered synchronously, so `act` owns the commit and the
// assertions never wait on wall-clock time.
notifyManager.setScheduler((callback) => callback())

// ---------------------------------------------------------------------------
// The read seam — a stream the test can hold open
// ---------------------------------------------------------------------------

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

let streamItems: EventStreamItem<NostrEventLike>[] = []
/** The index whose next iteration the stream blocks on. */
let pauseAfter: number | null = null
/** The gate the blocked iteration awaits; the test opens it to finish the read. */
let pauseGate: Promise<void> = Promise.resolve()

mock.module('@platform/web/readContext', () => ({
	getReadContext: () => ({
		stream: async function* (_filters: readonly EventFilter[]): AsyncIterable<EventStreamItem<NostrEventLike>> {
			for (const [index, item] of streamItems.entries()) {
				yield item
				if (pauseAfter === index) await pauseGate
			}
		},
		fetch: async () => [],
		store: {
			add: async (event: NostrEventLike) => ({ status: 'added' as const, event }),
			isDeleted: () => false,
		},
	}),
}))

// ---------------------------------------------------------------------------
// A DOM for this file — installed before any DOM-touching module is imported
// ---------------------------------------------------------------------------

/**
 * The slice of happy-dom's `Window` this file uses. Named structurally rather
 * than imported from the package: happy-dom's own declarations add errors to
 * `tsc`'s program that the repository's baseline does not carry, and this is a
 * test-only renderer.
 */
interface HappyWindow {
	Event: typeof globalThis.Event
	HTMLInputElement: new () => object
}

/** happy-dom is in the lockfile as the `@tiptap/html` peer; it is not a direct dependency. */
const HAPPY_DOM = 'happy-dom'

const { Window } = (await import(HAPPY_DOM)) as { Window: new (options: { url: string }) => HappyWindow }

const win = new Window({ url: 'http://localhost/' })
const globals = globalThis as Record<string, unknown>
const installedGlobals: string[] = []

globals.IS_REACT_ACT_ENVIRONMENT = true

for (const key of Object.getOwnPropertyNames(win)) {
	if (key in globalThis) continue
	try {
		Object.defineProperty(globalThis, key, {
			value: Reflect.get(win, key),
			configurable: true,
			writable: true,
		})
		installedGlobals.push(key)
	} catch {
		// A window property Bun already owns (timers, fetch, …) stays Bun's.
	}
}

const doc = globals.document as Document

// Dynamic on purpose: the DOM globals must exist before `react-dom` is
// evaluated, and the `mock.module` registration above must be in place before
// the feed's own imports resolve. Static imports are hoisted above both.
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { browseIndexFeedKeys, useBrowseIndexFeed } = await import('./browseIndexFeed')

afterAll(() => {
	for (const key of installedGlobals) delete globals[key]
	delete globals.IS_REACT_ACT_ENVIRONMENT
})

// ---------------------------------------------------------------------------
// Harness — the hook under the provider the app gives it
// ---------------------------------------------------------------------------

const KEY = browseIndexFeedKeys.feed(200)

/** What the home reads: the loaded products, in the order the stream admitted them. */
function Probe() {
	const { data, isLoading } = useBrowseIndexFeed()
	return createElement(
		'p',
		{ 'data-testid': 'probe', 'data-loading': String(isLoading) },
		data?.products.map((product) => product.title).join(' | ') ?? 'none',
	)
}

let queryClient: QueryClient
let container: HTMLDivElement
let root: Root

/**
 * Whatever the cache collects next. API-neutral: `notify` fires on the cache's
 * own update events, so the test waits for the actual data condition instead of
 * a guessed duration.
 */
function when(predicate: () => boolean): Promise<void> {
	if (predicate()) return Promise.resolve()
	const { promise, resolve } = Promise.withResolvers<void>()
	const unsubscribe = queryClient.getQueryCache().subscribe(() => {
		if (!predicate()) return
		unsubscribe()
		resolve()
	})
	return promise
}

function listing(id: string, title: string, pubkey: string): NostrEventLike {
	return {
		id,
		pubkey,
		kind: 30402,
		created_at: Math.floor(Date.now() / 1000),
		content: '',
		tags: [
			['d', id],
			['title', title],
			['price', '21000', 'SATS'],
			['stock', '5'],
			['t', 'Art'],
		],
	}
}

const FIRST = listing('ceramic-ball', 'Handcrafted Ceramic Ball', PUBKEY_A)
const SECOND = listing('pour-over', 'Ceramic Pour-Over Set', PUBKEY_B)

beforeEach(async () => {
	streamItems = [
		{ type: 'event', event: FIRST },
		{ type: 'event', event: SECOND },
		{ type: 'caught-up', info: { eose: ['wss://local'], pending: [], complete: true } },
	]
	pauseAfter = 0
	pauseGate = Promise.resolve()

	doc.body.innerHTML = ''
	container = doc.createElement('div')
	doc.body.appendChild(container)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	root = createRoot(container)
})

describe('useBrowseIndexFeed — progressive render', () => {
	test('renders the listings already delivered while the stream is still open', async () => {
		const gate = Promise.withResolvers<void>()
		pauseGate = gate.promise

		await act(async () => {
			root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))
		})

		// The stream is held after its first listing: the probe must already show
		// it (and must not show the one that has not arrived).
		await act(async () => {
			await when(() => (queryClient.getQueryData(KEY)?.products.length ?? 0) > 0)
		})
		expect(container.textContent).toContain('Handcrafted Ceramic Ball')
		expect(container.textContent).not.toContain('Ceramic Pour-Over Set')
		// A partial read is not "loading" in the placeholder sense any more.
		expect(container.querySelector('[data-testid="probe"]')?.getAttribute('data-loading')).toBe('false')

		// Release the marker: the rest of the read lands in the same tree.
		gate.resolve()
		await act(async () => {
			await when(() => (queryClient.getQueryData(KEY)?.eose.length ?? 0) > 0)
		})
		expect(container.textContent).toContain('Handcrafted Ceramic Ball | Ceramic Pour-Over Set')
	})

	test('a second query under the same key does not re-read: the cache is the feed', async () => {
		const gate = Promise.withResolvers<void>()
		pauseGate = gate.promise

		await act(async () => {
			root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))
		})
		await act(async () => {
			await when(() => (queryClient.getQueryData(KEY)?.products.length ?? 0) > 0)
		})

		// The partial is the query's data, not a side channel: the key carries it.
		expect(queryClient.getQueryData(KEY)?.products.map((product) => product.id)).toEqual(['ceramic-ball'])

		gate.resolve()
		await act(async () => {
			await when(() => (queryClient.getQueryData(KEY)?.eose.length ?? 0) > 0)
		})
	})
})
