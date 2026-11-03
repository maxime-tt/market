import { queryOptions, useQuery } from '@tanstack/react-query'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { createNdkReadContext } from '@platform/web/readContext'
import {
	buildCommentThreads,
	getCommentTargetKey,
	readProductCommentsWorkflow,
	type CommentRecord,
	type CommentThreadRecord,
} from '@sdk/commerce/messaging'
import { commentKeys } from '@sdk/core/query/queryKeyFactory'

/**
 * platform/web/messaging/commentQuery.ts — the React binding for the NIP-22 comment read
 * (store drain D1, slice 2).
 *
 * The read logic is framework-free (`readProductCommentsWorkflow`, `sdk/commerce/messaging`); this
 * file owns the react-query binding and resolves its port from `platform/web/readContext.ts`,
 * so no part of the read imports `@/lib/stores/ndk`. The query key is literal-identical to the
 * pre-drain value (and to the publish side's invalidation target in `src/publish/comments.tsx`).
 */

export { MAX_COMMENT_THREAD_DEPTH } from '@sdk/commerce/messaging'

export type Comment = CommentRecord

export type CommentThread = CommentThreadRecord

/**
 * Fetches NIP-22 comments for a product
 * @param event - The event (product listing, comment, …) the comments target
 */
export const fetchProductComments = async (event: NostrEventLike): Promise<Comment[]> =>
	readProductCommentsWorkflow(createNdkReadContext(), event)

export const transformCommentsMapIntoThreads = (comments: Comment[]): CommentThread[] => buildCommentThreads(comments)

/**
 * Hook to fetch comments for a product
 */
export const useComments = (event: NostrEventLike) => {
	const targetCoordinates = getCommentTargetKey(event)

	return useQuery(
		queryOptions({
			queryKey: commentKeys.byProduct(targetCoordinates),
			queryFn: () => fetchProductComments(event),
			enabled: !!targetCoordinates,
		}),
	)
}
