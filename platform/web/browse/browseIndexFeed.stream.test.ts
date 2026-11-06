/**
 * platform/web/browse/browseIndexFeed.stream.test.ts — the index feed's
 * progressive paint.
 *
 * The home used to wait for the whole bounded stream (the caught-up marker) and
 * render everything at once — measured on the live instance, the strips appeared
 * ~24 s after load. `fetchBrowseIndexFeed` now publishes a snapshot as listings
 * arrive; these tests hold the stream open *before* the marker and prove that a
 * snapshot has already been delivered, with the rows, the products and the
 * measured stats counting only what landed.
 *
 * The read seam is stubbed before the module import (per-file under
 * `bun test --isolate`, matching `browseQuery.test.ts`'s pattern).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import type { EventFilter } from '@sdk/core/event-store/filter'
import type { EventStreamItem } from '@sdk/core/event-store/read'
import type { BrowseIndexFeed } from './browseIndexFeed'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

/** The items the current test's stream will yield, in order. */
let streamItems: EventStreamItem<NostrEventLike>[] = []
/** The index whose next iteration the stream blocks on. */
let pauseAfter: number | null = null
/** The gate the blocked iteration awaits; the test opens it to finish the read. */
let pauseGate: Promise<void> = Promise.resolve()
let openPauseGate: (() => void) | null = null

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

import { fetchBrowseIndexFeed } from './browseIndexFeed'

function listing(id: string, title: string, category: string, pubkey: string): NostrEventLike {
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
			['t', category],
		],
	}
}

function event(item: NostrEventLike): EventStreamItem<NostrEventLike> {
	return { type: 'event', event: item }
}

const CAUGHT_UP: EventStreamItem<NostrEventLike> = {
	type: 'caught-up',
	info: { eose: ['wss://local'], pending: [], complete: true },
}

/** The resolver the next `onPartial` call reports to. */
let reportPartial: ((feed: BrowseIndexFeed) => void) | null = null

/** The next partial the read publishes. */
function nextPartial(): Promise<BrowseIndexFeed> {
	const { promise, resolve } = Promise.withResolvers<BrowseIndexFeed>()
	reportPartial = resolve
	return promise
}

beforeEach(() => {
	streamItems = []
	pauseAfter = null
	pauseGate = Promise.resolve()
	openPauseGate = null
	reportPartial = null
})

describe('fetchBrowseIndexFeed — progressive', () => {
	test('publishes the listings the stream delivered without waiting for the marker', async () => {
		const first = listing('ceramic-ball', 'Handcrafted Ceramic Ball', 'Art', PUBKEY_A)
		const second = listing('pour-over', 'Ceramic Pour-Over Set', 'Bitcoin', PUBKEY_B)

		streamItems = [event(first), event(second), CAUGHT_UP]
		// Hold the stream open between the first listing and the rest: the marker
		// is still far away in the live case, and the home must already have paint.
		pauseAfter = 0
		const gate = Promise.withResolvers<void>()
		pauseGate = gate.promise
		openPauseGate = gate.resolve

		const partials: BrowseIndexFeed[] = []
		const done = fetchBrowseIndexFeed(200, (feed) => {
			partials.push(feed)
			reportPartial?.(feed)
		})

		const partial = await nextPartial()

		// The first listing is on screen while the rest of the stream is in flight.
		expect(partial.products.map((product) => product.id)).toEqual(['ceramic-ball'])
		expect(partial.rows.map((row) => row.category)).toEqual(['Art'])
		expect(partial.rows[0]?.items.map((item) => item.id)).toEqual(['ceramic-ball'])

		// The measured stats count only what has landed — the wording's promise —
		// and a relay verdict this read does not have yet is not invented.
		expect(partial.stats.products).toBe(1)
		expect(partial.stats.sellers).toBe(1)
		expect(partial.stats.relays).toBeUndefined()
		expect(partial.eose).toEqual([])

		// Nothing had resolved yet when the snapshot was taken.
		let settled = false
		void done.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		openPauseGate?.()
		const final = await done

		// The final set is the whole read, with the relay verdict.
		expect(final.products.map((product) => product.id)).toEqual(['ceramic-ball', 'pour-over'])
		expect(final.rows.map((row) => row.category)).toEqual(['Bitcoin', 'Art'])
		expect(final.stats.products).toBe(2)
		expect(final.stats.sellers).toBe(2)
		expect(final.stats.relays).toBe(1)
		expect(final.eose).toEqual(['wss://local'])
		expect(partials.length).toBeGreaterThanOrEqual(1)
	})

	test('the category rows grow with the stream, not at the marker', async () => {
		const art = listing('first-art', 'First Art', 'Art', PUBKEY_A)
		const bitcoin = listing('later-bitcoin', 'Later Bitcoin', 'Bitcoin', PUBKEY_B)

		streamItems = [event(art), event(bitcoin), CAUGHT_UP]
		pauseAfter = 0
		const gate = Promise.withResolvers<void>()
		pauseGate = gate.promise
		openPauseGate = gate.resolve

		const partialPromise = nextPartial()
		void fetchBrowseIndexFeed(200, (feed) => reportPartial?.(feed))
		const partial = await partialPromise

		expect(partial.rows.map((row) => row.category)).toEqual(['Art'])
		expect(partial.rows[0]?.items.map((item) => item.id)).toEqual(['first-art'])
		// The second category's row does not exist until its listing lands.
		expect(partial.rows.some((row) => row.category === 'Bitcoin')).toBe(false)

		openPauseGate?.()
	})
})
