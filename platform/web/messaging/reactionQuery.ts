import { useQuery } from '@tanstack/react-query'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { createNdkReadContext } from '@platform/web/readContext'
import {
	filterForLatestReactionsOnly as filterForLatestReactionsOnlySdk,
	groupReactionsByContent as groupReactionsByContentSdk,
	readEventReactionsWorkflow,
	sortReactionsIntoGroups as sortReactionsIntoGroupsSdk,
	type ReactionRecord,
} from '@sdk/commerce/messaging'
import { reactionKeys } from '@sdk/core/query/queryKeyFactory'

/**
 * platform/web/messaging/reactionQuery.ts — the React binding for the reaction read
 * (store drain D1, slice 2).
 *
 * The read logic is framework-free (`readEventReactionsWorkflow`, `sdk/commerce/messaging`); this
 * file owns the react-query hook and resolves its port from `platform/web/readContext.ts`, so no
 * part of the read imports `@/lib/stores/ndk`. The query key is literal-identical to the pre-drain
 * value (and to the publish side's invalidation target in `src/publish/reactions.tsx`).
 */

export type Reaction = ReactionRecord

export const filterForLatestReactionsOnly = (reactions: Reaction[]): Reaction[] => filterForLatestReactionsOnlySdk(reactions)

export const groupReactionsByContent = (reactions: Reaction[]): Map<string, Reaction[]> => groupReactionsByContentSdk(reactions)

export const sortReactionsIntoGroups = (reactions: Reaction[]): Map<string, Reaction[]> => sortReactionsIntoGroupsSdk(reactions)

/**
 * Fetches reactions for a specific event (kind 1 text notes)
 * @param event - The event to fetch reactions for
 * @returns Reactions, latest per author/emoji, without author-deleted ones
 */
export const fetchEventReactions = async (event: NostrEventLike): Promise<Reaction[]> =>
	readEventReactionsWorkflow(createNdkReadContext(), event)

/**
 * Hook to fetch reactions for an event
 */
export const useEventReactions = (event: NostrEventLike) => {
	return useQuery({
		queryKey: reactionKeys.byEvent(event.id, event.pubkey),
		queryFn: () => fetchEventReactions(event),
		enabled: !!event,
	})
}
