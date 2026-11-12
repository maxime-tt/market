import { EventMemory, type IAsyncEventDatabase } from 'applesauce-core/event-store'
import type { Filter } from 'applesauce-core/helpers'
import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import type { NostrEventLike } from '../nostr/eventLike'
import { createApplesauceEventStore } from './applesauceEventStore'

let counter = 0
const event = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `id-${++counter}`,
	pubkey: 'seller',
	kind: 1,
	created_at: 100,
	content: '',
	tags: [],
	...overrides,
})

const product = (createdAt: number, d = 'mug', overrides: Partial<NostrEventLike> = {}) =>
	event({ kind: 30402, created_at: createdAt, tags: [['d', d]], ...overrides })

/** Minimal async `IAsyncEventDatabase` double wrapping applesauce's in-memory `EventMemory` that records add calls. */
class RecordingDatabase implements IAsyncEventDatabase {
	recorded: string[] = []
	private memory = new EventMemory()
	async add(event: NostrEvent): Promise<NostrEvent> {
		this.recorded.push(event.id)
		return this.memory.add(event)
	}
	async remove(event: string | NostrEvent): Promise<boolean> {
		return this.memory.remove(event)
	}
	async removeByFilters(filters: Filter | Filter[]): Promise<number> {
		return this.memory.removeByFilters(filters)
	}
	async hasEvent(id: string): Promise<boolean> {
		return this.memory.hasEvent(id)
	}
	async getEvent(id: string): Promise<NostrEvent | undefined> {
		return this.memory.getEvent(id)
	}
	async hasReplaceable(kind: number, pubkey: string, identifier?: string): Promise<boolean> {
		return this.memory.hasReplaceable(kind, pubkey, identifier)
	}
	async getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent | undefined> {
		return this.memory.getReplaceable(kind, pubkey, identifier)
	}
	async getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent[] | undefined> {
		return this.memory.getReplaceableHistory(kind, pubkey, identifier)
	}
	async getByFilters(filters: Filter | Filter[]): Promise<NostrEvent[]> {
		return this.memory.getByFilters(filters)
	}
	async getTimeline(filters: Filter | Filter[]): Promise<NostrEvent[]> {
		return this.memory.getTimeline(filters)
	}
	update(event: NostrEvent): void {
		this.memory.update(event)
	}
}

describe('createApplesauceEventStore', () => {
	// The eight shared conformance cases, mirroring memoryEventStore.test.ts expectations exactly.
	test('keeps only the latest version of an addressable event', async () => {
		const store = createApplesauceEventStore()
		const v1 = product(100)
		const v2 = product(200)

		expect(await store.add(v1)).toEqual({ status: 'added' })
		expect(await store.add(v2)).toEqual({ status: 'added' })
		expect(await store.add(product(150))).toEqual({ status: 'superseded' })
		expect((await store.getReplaceable(30402, 'seller', 'mug'))?.id).toBe(v2.id)
		expect(await store.get(v1.id)).toBeUndefined()
		expect(await store.query({ kinds: [30402] })).toHaveLength(1)
	})

	test('rejects duplicates by id', async () => {
		const store = createApplesauceEventStore()
		const note = event({})
		await store.add(note)
		expect(await store.add(note)).toEqual({ status: 'duplicate' })
	})

	test('coordinate deletions remove older versions but allow newer republishes', async () => {
		const store = createApplesauceEventStore()
		const v1 = product(100)
		await store.add(v1)

		await store.add(event({ kind: 5, created_at: 150, tags: [['a', '30402:seller:mug']] }))
		expect(await store.getReplaceable(30402, 'seller', 'mug')).toBeUndefined()
		expect(await store.add(product(120))).toEqual({ status: 'deleted' })

		const republished = product(200)
		expect(await store.add(republished)).toEqual({ status: 'added' })
		expect((await store.getReplaceable(30402, 'seller', 'mug'))?.id).toBe(republished.id)
	})

	test('ignores deletion requests from other authors', async () => {
		const store = createApplesauceEventStore()
		const v1 = product(100)
		await store.add(v1)
		await store.add(
			event({
				kind: 5,
				pubkey: 'attacker',
				created_at: 150,
				tags: [
					['e', v1.id],
					['a', '30402:seller:mug'],
				],
			}),
		)
		expect(await store.get(v1.id)).toBeDefined()
	})

	test('deletes regular events by id', async () => {
		const store = createApplesauceEventStore()
		const note = event({ kind: 1 })
		await store.add(note)
		await store.add(event({ kind: 5, created_at: 200, tags: [['e', note.id]] }))
		expect(await store.get(note.id)).toBeUndefined()
		expect(store.isDeleted(note)).toBe(true)
	})

	test('admission rejects events the kind parser refuses', async () => {
		const store = createApplesauceEventStore({
			admission: { 30402: (candidate) => (candidate.tags.some((tag) => tag[0] === 'price') ? true : 'missing price tag') },
		})
		expect(await store.add(product(100))).toEqual({ status: 'rejected', reason: 'missing price tag' })
		expect(
			await store.add(
				product(100, 'priced', {
					tags: [
						['d', 'priced'],
						['price', '10', 'SATS'],
					],
				}),
			),
		).toEqual({ status: 'added' })
	})

	test('queries by tag, author and limit, newest first', async () => {
		const store = createApplesauceEventStore()
		await store.add(event({ kind: 1, created_at: 1, tags: [['t', 'bitcoin']] }))
		const newest = event({ kind: 1, created_at: 3, tags: [['t', 'bitcoin']] })
		await store.add(newest)
		await store.add(event({ kind: 1, created_at: 2, tags: [['t', 'nostr']] }))

		const result = await store.query({ kinds: [1], '#t': ['bitcoin'], limit: 1 })
		expect(result.map((e) => e.id)).toEqual([newest.id])
	})

	test('subscribers hear events that become current', async () => {
		const store = createApplesauceEventStore()
		const heard: string[] = []
		const unsubscribe = store.subscribe({ kinds: [30402] }, (e) => heard.push(e.id))

		const v1 = product(100)
		await store.add(v1)
		await store.add(product(50))
		unsubscribe()
		await store.add(product(300))

		expect(heard).toEqual([v1.id])
	})

	// applesauce-specific behaviour.
	test('default construction uses applesauce EventMemory as its database', async () => {
		const addedThroughMemory: string[] = []
		const original = EventMemory.prototype.add
		EventMemory.prototype.add = function (this: EventMemory, event: NostrEvent) {
			addedThroughMemory.push(event.id)
			return original.call(this, event)
		}
		try {
			const store = createApplesauceEventStore()
			const note = event({})
			expect(await store.add(note)).toEqual({ status: 'added' })
			expect(addedThroughMemory).toContain(note.id)
			expect(await store.get(note.id)).toBeDefined()
		} finally {
			EventMemory.prototype.add = original
		}
	})

	test('a custom IAsyncEventDatabase is actually used and its pre-existing events are visible', async () => {
		const database = new RecordingDatabase()
		const preExisting = event({ kind: 1 })
		database.add(preExisting as unknown as NostrEvent)
		database.recorded = []

		const store = createApplesauceEventStore({ database })
		const note = event({ kind: 1 })
		expect(await store.add(note)).toEqual({ status: 'added' })
		expect(database.recorded).toEqual([note.id])

		expect((await store.get(preExisting.id))?.id).toBe(preExisting.id)
		expect((await store.query({ kinds: [1] })).map((e) => e.id)).toContain(preExisting.id)
	})

	test('isDeleted is true after a coordinate kind-5 deletion', async () => {
		const store = createApplesauceEventStore()
		const v1 = product(100)
		await store.add(v1)

		await store.add(event({ kind: 5, created_at: 150, tags: [['a', '30402:seller:mug']] }))
		expect(store.isDeleted(v1)).toBe(true)
		expect(store.isDeleted(product(200))).toBe(false)
	})

	test('admits synthetic events with invalid signatures (permissive verifyEvent)', async () => {
		const store = createApplesauceEventStore()
		const synthetic = event({ sig: 'not-a-valid-signature' })
		expect(await store.add(synthetic)).toEqual({ status: 'added' })
		expect(await store.get(synthetic.id)).toBeDefined()
	})

	test('miss-fetches through eventLoader, deduplicated across concurrent gets', async () => {
		const target = event({ kind: 1 })
		let loads = 0
		const store = createApplesauceEventStore({
			eventLoader: async (pointer) => {
				loads += 1
				await new Promise((resolve) => setTimeout(resolve, 5))
				return 'id' in pointer && pointer.id === target.id ? target : undefined
			},
		})

		const [a, b] = await Promise.all([store.get(target.id), store.get(target.id)])
		expect(a?.id).toBe(target.id)
		expect(b?.id).toBe(target.id)
		// one in-flight load shared by both misses; the second get now hits the warmed store
		expect(loads).toBe(1)
		expect((await store.get(target.id))?.id).toBe(target.id)
		expect(loads).toBe(1)
	})
})
