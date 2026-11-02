import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core'
import { createMemoryEventStore } from '@sdk/core/event-store'
import { productKeys } from '@sdk/core/query/queryKeyFactory'
import { syncEventStoresToQueryClient } from './eventStoreQuerySync'

let counter = 0
const deletion = (overrides: Partial<NostrEventLike>): NostrEventLike => ({
	id: `del-${++counter}`,
	pubkey: 'seller',
	kind: 5,
	created_at: Math.floor(Date.now() / 1000),
	content: '',
	tags: [],
	...overrides,
})

function createQueryClient(): { queryClient: QueryClient; invalidated: unknown[] } {
	const invalidated: unknown[] = []
	const queryClient = {
		invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
			invalidated.push(queryKey)
		},
	} as unknown as QueryClient
	return { queryClient, invalidated }
}

describe('syncEventStoresToQueryClient', () => {
	test('invalidates the affected list root when a fresh kind-5 deletion arrives', async () => {
		const store = createMemoryEventStore<NostrEventLike>()
		const { queryClient, invalidated } = createQueryClient()

		const stop = syncEventStoresToQueryClient(queryClient, [store])
		await store.add(deletion({ tags: [['a', '30402:seller:mug']] }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(invalidated).toEqual([productKeys.all])
		stop()
	})

	test('ignores deletions older than the session and id-only deletions', async () => {
		const store = createMemoryEventStore<NostrEventLike>()
		const { queryClient, invalidated } = createQueryClient()

		const stop = syncEventStoresToQueryClient(queryClient, [store])
		// older than the session start: the read lookup already applied it
		await store.add(deletion({ created_at: Math.floor(Date.now() / 1000) - 3600, tags: [['a', '30402:seller:mug']] }))
		// an id-only deletion carries no coordinate, so no list root is affected
		await store.add(deletion({ tags: [['e', 'abc']] }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(invalidated).toEqual([])
		stop()
	})

	test('stops invalidating after unsubscribe', async () => {
		const store = createMemoryEventStore<NostrEventLike>()
		const { queryClient, invalidated } = createQueryClient()

		const stop = syncEventStoresToQueryClient(queryClient, [store])
		stop()
		await store.add(deletion({ tags: [['a', '30402:seller:mug']] }))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(invalidated).toEqual([])
	})
})
