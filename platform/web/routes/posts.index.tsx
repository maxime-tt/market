import { postsQueryOptions } from '@platform/web/messaging/postQuery'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { PostViewHost as PostView } from '@platform/web/messaging/PostViewHost'

export const Route = createFileRoute('/posts/')({
	loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(postsQueryOptions),
	component: PostsRoute,
})

function PostsRoute() {
	const postsQuery = useSuspenseQuery(postsQueryOptions)
	const posts = postsQuery.data

	return (
		<div className="p-4">
			<h1 className="text-2xl font-bold mb-4">Nostr Posts</h1>
			<div className="space-y-4">
				{posts.map((post) => (
					<PostView key={post.id} post={post} />
				))}
			</div>
		</div>
	)
}
