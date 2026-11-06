import type { Ref } from 'react'
import { UiImage, UiLink } from '../provider/UiProvider'
import { cn } from '../utils/cn'

export interface PostViewPost {
	id: string
	author: string
	content: string
	createdAt: number
}

export interface PostViewAuthor {
	name?: string
	picture?: string
}

export interface PostViewProps {
	post: PostViewPost
	author: PostViewAuthor | null
	isLoadingAuthor: boolean
	permalinkHref: string
	showJson?: boolean
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * One Nostr text note (kind 1): avatar, display name, timestamp, body and a
 * permalink. Lifted out of `src/components/PostView.tsx` (D4 posts, fused
 * slice), which resolved the author through react-query and built the link
 * through the router. The host now owns both, so this view is props-only and
 * imports neither — the picture and the permalink go through the `ui/provider`
 * seams so a host can replace them.
 *
 * The legacy raw greys and blue map to semantic roles (`bg-surface-sunken`,
 * `bg-surface-sunken`, `text-text-mid`, `text-fill-ink`).
 */
export function PostView({ post, author, isLoadingAuthor, permalinkHref, showJson = false, className, ref }: PostViewProps) {
	return (
		<div ref={ref} data-slot="post-view" className={cn('rounded-lg border p-4', className)}>
			<div className="mb-3 flex items-center">
				{isLoadingAuthor ? (
					<div className="h-10 w-10 animate-pulse rounded-full bg-surface-sunken" />
				) : author?.picture ? (
					<UiImage src={author.picture} alt={author.name || 'Profile'} className="h-10 w-10 rounded-full object-cover" />
				) : (
					<div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-sunken text-text-mid">
						{author?.name?.[0]?.toUpperCase() || '?'}
					</div>
				)}
				<div className="ml-3">
					<div className="font-medium">
						{isLoadingAuthor ? (
							<div className="h-4 w-24 animate-pulse rounded bg-surface-sunken" />
						) : (
							author?.name || post.author.slice(0, 8) + '...'
						)}
					</div>
					<div className="text-xs text-text-mid">{new Date(post.createdAt * 1000).toLocaleString()}</div>
				</div>
			</div>
			<p>{post.content}</p>
			<UiLink href={permalinkHref} className="mt-2 mb-2 block text-sm text-fill-ink underline">
				{post.id.slice(0, 8)}...
			</UiLink>
			{showJson && <pre className="mt-4 rounded-lg bg-surface-sunken p-4 whitespace-pre-wrap">{JSON.stringify(post, null, 2)}</pre>}
		</div>
	)
}
