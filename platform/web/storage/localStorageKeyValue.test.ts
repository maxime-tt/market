import { afterEach, describe, expect, test } from 'bun:test'
import { createLocalStorageKeyValuePort } from './localStorageKeyValue'

/** A minimal `Storage` shape backed by a Map — enough for the port, no real DOM. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
	const entries = new Map<string, string>(Object.entries(initial))
	return {
		get length() {
			return entries.size
		},
		clear: () => entries.clear(),
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => {
			entries.delete(key)
		},
		setItem: (key, value) => {
			entries.set(key, value)
		},
	}
}

const original = globalThis.localStorage

afterEach(() => {
	// Restore whatever the runtime had, including "nothing".
	if (original === undefined) {
		;(globalThis as { localStorage?: Storage }).localStorage = undefined
	} else {
		;(globalThis as { localStorage?: Storage }).localStorage = original
	}
})

describe('createLocalStorageKeyValuePort', () => {
	test('round-trips a set through get', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage()
		const storage = createLocalStorageKeyValuePort()

		await storage.set('sdk.key', 'value-1')

		expect(await storage.get('sdk.key')).toBe('value-1')
	})

	test('returns null for a missing key', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage()
		const storage = createLocalStorageKeyValuePort()

		expect(await storage.get('absent')).toBeNull()
	})

	test('remove deletes a previously stored value', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = fakeStorage({ 'sdk.key': 'value-1' })
		const storage = createLocalStorageKeyValuePort()

		expect(await storage.get('sdk.key')).toBe('value-1')
		await storage.remove('sdk.key')
		expect(await storage.get('sdk.key')).toBeNull()
	})

	test('with no localStorage the port is an empty store and never throws', async () => {
		;(globalThis as { localStorage?: Storage }).localStorage = undefined
		const storage = createLocalStorageKeyValuePort()

		expect(await storage.get('sdk.key')).toBeNull()
		await expect(storage.set('sdk.key', 'value-1')).resolves.toBeUndefined()
		await expect(storage.remove('sdk.key')).resolves.toBeUndefined()
		// Still an empty store afterwards.
		expect(await storage.get('sdk.key')).toBeNull()
	})

	test('a throwing store degrades to an empty store instead of rejecting', async () => {
		const hostile: Storage = {
			...fakeStorage(),
			getItem: () => {
				throw new Error('security error: storage disabled')
			},
			setItem: () => {
				throw new Error('quota exceeded')
			},
			removeItem: () => {
				throw new Error('security error: storage disabled')
			},
		}
		;(globalThis as { localStorage?: Storage }).localStorage = hostile
		const storage = createLocalStorageKeyValuePort()

		expect(await storage.get('sdk.key')).toBeNull()
		await expect(storage.set('sdk.key', 'value-1')).resolves.toBeUndefined()
		await expect(storage.remove('sdk.key')).resolves.toBeUndefined()
	})
})
