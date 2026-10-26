import { queryOptions } from '@tanstack/react-query'
import { createNdkReadContext } from '@platform/web/ndkReadContext'
import { readPostWorkflow, readRecentPostsWorkflow, type NostrPost } from '@sdk/commerce/messaging'
import { postKeys } from '@sdk/core/query/queryKeyFactory'

/**
 * platform/web/messaging/postQuery.ts — the React binding for the post reads
 * (store drain D1, slice 2).
 *
 * The read logic is framework-free (`readRecentPostsWorkflow` / `readPostWorkflow`,
 * `sdk/commerce/messaging`); this file owns the react-query options and resolves the port from
 * `platform/web/ndkReadContext.ts`, so no part of the read imports `@/lib/stores/ndk`. The query
 * keys are literal-identical to the pre-drain values.
 */

export type { NostrPost }

export const fetchPosts = async (): Promise<NostrPost[]> => readRecentPostsWorkflow(createNdkReadContext())

export const fetchPost = async (id: string): Promise<NostrPost> => readPostWorkflow(createNdkReadContext(), id)

export const postQueryOptions = (id: string) =>
	queryOptions({
		queryKey: postKeys.details(id),
		queryFn: () => fetchPost(id),
	})

export const postsQueryOptions = queryOptions({
	queryKey: postKeys.all,
	queryFn: fetchPosts,
})
