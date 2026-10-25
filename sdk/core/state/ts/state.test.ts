import { describe, expect, test } from 'bun:test'
import { createStateStore, StateError } from './index'
import type { KeyValueStoragePort } from '../../ports/storage'

/** A minimal reference port: a Map, countable writes, controllable reads. */
function stubPort(initial: Record<string, string> = {}) {
	const values = new Map<string, string>(Object.entries(initial))
	let writes = 0
	const port: KeyValueStoragePort = {
		get: async (key) => values.get(key) ?? null,
		set: async (key, value) => {
			writes += 1
			values.set(key, value)
		},
		remove: async (key) => {
			values.delete(key)
		},
	}
	return {
		port,
		values,
		get writes() {
			return writes
		},
	}
}

describe('createStateStore — get and set', () => {
	test('get returns the initial state', () => {
		const store = createStateStore({ initial: { n: 1 } })
		expect(store.get()).toEqual({ n: 1 })
	})

	test('set replaces the state with a value', () => {
		const store = createStateStore<{ n: number }>({ initial: { n: 1 } })
		store.set({ n: 2 })
		expect(store.get()).toEqual({ n: 2 })
	})

	test('set accepts a functional updater', () => {
		const store = createStateStore({ initial: { n: 1 } })
		store.set((previous) => ({ n: previous.n + 41 }))
		expect(store.get()).toEqual({ n: 42 })
	})
})

describe('createStateStore — subscribe', () => {
	test('does not fire on subscribe', () => {
		const store = createStateStore<number>({ initial: 0 })
		const seen: number[] = []
		store.subscribe((state) => seen.push(state))
		expect(seen).toEqual([])
	})

	test('fires on every change and stops after unsubscribe', () => {
		const store = createStateStore<number>({ initial: 0 })
		const seen: number[] = []
		const unsubscribe = store.subscribe((state) => seen.push(state))
		store.set(1)
		store.set((previous) => previous + 1)
		unsubscribe()
		store.set(99)
		expect(seen).toEqual([1, 2])
	})

	test('a throwing listener does not break the others', () => {
		const store = createStateStore<number>({ initial: 0 })
		const seen: number[] = []
		store.subscribe(() => {
			throw new Error('boom')
		})
		store.subscribe((state) => seen.push(state))
		store.set(7)
		expect(seen).toEqual([7])
	})
})

describe('createStateStore — equality no-op', () => {
	test('set with the same reference is a no-op (no notify, no write)', () => {
		const stub = stubPort()
		const store = createStateStore<{ n: number }>({ initial: { n: 1 }, storage: stub.port, storageKey: 'k' })
		const seen: number[] = []
		store.subscribe((state) => seen.push(state.n))
		const same = store.get()
		store.set(same)
		expect(seen).toEqual([])
		expect(stub.writes).toBe(0)
	})

	test('a functional updater that returns its own argument is a no-op', () => {
		const store = createStateStore<number>({ initial: 5 })
		const seen: number[] = []
		store.subscribe((state) => seen.push(state))
		store.set((previous) => previous)
		expect(seen).toEqual([])
	})

	test('a value-equal but distinct object is NOT a no-op (equality is referential)', () => {
		const store = createStateStore<{ n: number }>({ initial: { n: 1 } })
		const seen: number[] = []
		store.subscribe((state) => seen.push(state.n))
		store.set({ n: 1 })
		expect(seen).toEqual([1])
	})
})

describe('createStateStore — persistence', () => {
	test('with no port the store is memory-only and persist/restore are no-ops', async () => {
		const store = createStateStore<{ n: number }>({ initial: { n: 1 } })
		store.set({ n: 2 })
		await store.persist()
		await store.restore()
		expect(store.get()).toEqual({ n: 2 })
	})

	test('write-through on change and a round-trip through a port', async () => {
		const stub = stubPort()
		const a = createStateStore<{ n: number }>({ initial: { n: 1 }, storage: stub.port, storageKey: 'state' })
		a.set({ n: 2 })
		await a.persist()
		expect(stub.writes).toBe(2) // one write-through, one explicit persist

		const b = createStateStore<{ n: number }>({ initial: { n: 0 }, storage: stub.port, storageKey: 'state' })
		await b.restore()
		expect(b.get()).toEqual({ n: 2 })
	})

	test('restore leaves the current state untouched when the key is absent', async () => {
		const { port } = stubPort()
		const store = createStateStore<{ n: number }>({ initial: { n: 1 }, storage: port, storageKey: 'missing' })
		await store.restore()
		expect(store.get()).toEqual({ n: 1 })
	})

	test('a corrupt stored payload is ignored, not thrown', async () => {
		const { port } = stubPort({ state: '{ not json' })
		const store = createStateStore<{ n: number }>({ initial: { n: 1 }, storage: port, storageKey: 'state' })
		await store.restore()
		expect(store.get()).toEqual({ n: 1 })
	})

	test('a custom serialize/deserialize pair is used', async () => {
		const { port, values } = stubPort()
		const store = createStateStore<number>({
			initial: 0,
			storage: port,
			storageKey: 'state',
			serialize: (state) => `#${state}`,
			deserialize: (raw) => (raw ? Number(raw.slice(1)) : null),
		})
		store.set(9)
		await store.persist()
		expect(values.get('state')).toBe('#9')
		const other = createStateStore<number>({
			initial: 0,
			storage: port,
			storageKey: 'state',
			serialize: (state) => `#${state}`,
			deserialize: (raw) => (raw ? Number(raw.slice(1)) : null),
		})
		await other.restore()
		expect(other.get()).toBe(9)
	})
})

describe('createStateStore — configuration refusal', () => {
	test('a storage port without a storage key is refused fail-closed', () => {
		const { port } = stubPort()
		let caught: unknown
		try {
			createStateStore<number>({ initial: 0, storage: port })
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(StateError)
		expect((caught as StateError).code).toBe('state_configuration')
	})
})
