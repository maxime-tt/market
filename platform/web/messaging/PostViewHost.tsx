import { useQuery } from '@tanstack/react-query'
import { authorQueryOptions, type NostrAuthor } from '@platform/web/profiles/authorQuery'
import type { NostrPost } from '@sdk/commerce/messaging'
import { PostView as PostViewView } from '@ui/community/post-view'

interface PostViewHostProps {
	post: NostrPost
	showJson?: boolean
}

/**
 * `platform/web/messaging/PostViewHost.tsx` — the React binding for the post
 * row (D4 posts, fused slice). Resolves the author profile and the permalink
 * the presentation view cannot reach, and passes them down.
 */
export function PostViewHost({ post, showJson = false }: PostViewHostProps) {
	const { data, isLoading: isLoadingAuthor } = useQuery(authorQueryOptions(post.author))
	const author: NostrAuthor | null = data ?? null

	return (
		<PostViewView post={post} author={author} isLoadingAuthor={isLoadingAuthor} permalinkHref={`/posts/${post.id}`} showJson={showJson} />
	)
}
