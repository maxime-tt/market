import { describe, expect, test } from 'bun:test'
import { createMemoryReadMarkPort, createStorageReadMarkPort, ReadMarkError } from './read-mark'
import type { KeyValueStoragePort } from './storage'

/** A stub `KeyValueStoragePort` that records the keys it is asked for, and can be made to reject. */
function createStubStorage(initial: Record<string, string> = {}, failure: { get?: Error; set?: Error } = {}) {
	const values = new Map<string, string>(Object.entries(initial))
	const reads: string[] = []
	const writes: { key: string; value: string }[] = []
	const port: KeyValueStoragePort = {
		get: async (key) => {
			reads.push(key)
			if (failure.get) throw failure.get
			return values.get(key) ?? null
		},
		set: async (key, value) => {
			if (failure.set) throw failure.set
			writes.push({ key, value })
			values.set(key, value)
		},
		remove: async (key) => {
			values.delete(key)
		},
	}
	return { port, values, reads, writes }
}

describe('createStorageReadMarkPort', () => {
	test('a stream with no mark reads null', async () => {
		const { port } = createStubStorage()
		expect(await createStorageReadMarkPort(port).get('conv:1')).toBeNull()
	})

	test('round-trips a mark through the storage port and namespaces the key', async () => {
		const { port, writes } = createStubStorage()
		const marks = createStorageReadMarkPort(port)

		await marks.set('conv:1', 1000)

		expect(writes).toEqual([{ key: 'read-mark:conv:1', value: '1000' }])
		expect(await marks.get('conv:1')).toBe(1000)
	})

	test('keeps streams independent and honours a custom namespace', async () => {
		const { port, reads } = createStubStorage()
		const marks = createStorageReadMarkPort(port, { namespace: 'user:42:read-mark:' })

		await marks.set('conv:1', 10)
		await marks.set('conv:2', 20)

		expect(await marks.get('conv:1')).toBe(10)
		expect(await marks.get('conv:2')).toBe(20)
		expect(reads).toContain('user:42:read-mark:conv:1')
		expect(reads).toContain('user:42:read-mark:conv:2')
	})

	test('is monotonic: a lower or equal mark is ignored, a higher one is stored', async () => {
		const { port, writes } = createStubStorage()
		const marks = createStorageReadMarkPort(port)

		await marks.set('conv:1', 1000)
		await marks.set('conv:1', 500)
		await marks.set('conv:1', 1000)
		await marks.set('conv:1', 2000)

		expect(await marks.get('conv:1')).toBe(2000)
		expect(writes).toEqual([
			{ key: 'read-mark:conv:1', value: '1000' },
			{ key: 'read-mark:conv:1', value: '2000' },
		])
	})

	test('refuses a negative or non-finite mark with invalid-mark', async () => {
		const { port, writes } = createStubStorage()
		const marks = createStorageReadMarkPort(port)

		for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			const error = await marks.set('conv:1', bad).catch((e: unknown) => e)
			expect(error).toBeInstanceOf(ReadMarkError)
			expect((error as ReadMarkError).code).toBe('invalid-mark')
		}
		expect(writes).toHaveLength(0)
	})

	test('reads a corrupt stored value as no mark rather than throwing', async () => {
		const { port } = createStubStorage({ 'read-mark:conv:1': 'not a number' })
		expect(await createStorageReadMarkPort(port).get('conv:1')).toBeNull()
	})

	test('wraps a rejecting storage port as storage-failure, preserving the cause', async () => {
		const boom = new Error('quota exceeded')
		const { port: getPort } = createStubStorage({}, { get: boom })
		const { port: setPort } = createStubStorage({}, { set: boom })

		const readError = await createStorageReadMarkPort(getPort)
			.get('conv:1')
			.catch((e: unknown) => e)
		expect(readError).toBeInstanceOf(ReadMarkError)
		expect((readError as ReadMarkError).code).toBe('storage-failure')
		expect((readError as ReadMarkError).cause).toBe(boom)

		const writeError = await createStorageReadMarkPort(setPort)
			.set('conv:1', 1)
			.catch((e: unknown) => e)
		expect(writeError).toBeInstanceOf(ReadMarkError)
		expect((writeError as ReadMarkError).code).toBe('storage-failure')
		expect((writeError as ReadMarkError).cause).toBe(boom)
	})
})

describe('createMemoryReadMarkPort', () => {
	test('reads null with no mark and round-trips a mark', async () => {
		const marks = createMemoryReadMarkPort()
		expect(await marks.get('conv:1')).toBeNull()
		await marks.set('conv:1', 42)
		expect(await marks.get('conv:1')).toBe(42)
		expect(await marks.get('conv:2')).toBeNull()
	})

	test('is monotonic, like the storage-backed port', async () => {
		const marks = createMemoryReadMarkPort()
		await marks.set('conv:1', 1000)
		await marks.set('conv:1', 500)
		expect(await marks.get('conv:1')).toBe(1000)
	})

	test('refuses a negative or non-finite mark with invalid-mark', async () => {
		const marks = createMemoryReadMarkPort()
		const error = await marks.set('conv:1', -5).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(ReadMarkError)
		expect((error as ReadMarkError).code).toBe('invalid-mark')
		expect(await marks.get('conv:1')).toBeNull()
	})
})
