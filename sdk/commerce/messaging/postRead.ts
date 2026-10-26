import { readThroughStore, type EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'

export const TEXT_NOTE_KIND = 1

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type PostFilter = {
	kinds?: number[]
	ids?: string[]
	limit?: number
}

export type NostrPost = {
	id: string
	content: string
	author: string
	createdAt: number
}

export function buildRecentPostsFilter(): PostFilter {
	return { kinds: [TEXT_NOTE_KIND], limit: 20 }
}

export function buildPostByIdFilter(id: string): PostFilter {
	return { ids: [id] }
}

export function parsePost(event: NostrEventLike): NostrPost {
	return {
		id: event.id,
		content: event.content,
		author: event.pubkey,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
	}
}

/** Newest first; sorts in place. */
export function sortPostsNewestFirst(posts: NostrPost[]): NostrPost[] {
	return posts.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Discovery read: the most recent kind-1 text notes, merged through the host's `EventReadContext`
 * so author-deleted notes never surface.
 */
export async function readRecentPostsWorkflow<E extends NostrEventLike>(context: EventReadContext<E>): Promise<NostrPost[]> {
	const events = await readThroughStore(context, [buildRecentPostsFilter()])
	return sortPostsNewestFirst(events.map(parsePost))
}

/** Single-note read by id; a missing note (or one its author deleted) is an error. */
export async function readPostWorkflow<E extends NostrEventLike>(context: EventReadContext<E>, id: string): Promise<NostrPost> {
	const events = await readThroughStore(context, [buildPostByIdFilter(id)])
	const event = events[0]

	if (!event) {
		throw new Error('Post not found')
	}

	return parsePost(event)
}
