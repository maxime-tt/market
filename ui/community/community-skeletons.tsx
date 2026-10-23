import type { HTMLAttributes, Ref } from 'react'
import { Skeleton } from '../primitives/skeleton'
import { cn } from '../utils/cn'

/**
 * Grid placeholders for the community page's collections and merchants feeds,
 * lifted out of `platform/web/routes/community.index.tsx`. The route is an
 * assembler and must not define components.
 *
 * These are deliberately not generic: the `data-testid`s are the contract the
 * community progressive-loading suite asserts on, and the two grids differ in
 * the last skeleton's width to mirror their card aspect ratios.
 */

export interface CommunitySkeletonGridProps extends HTMLAttributes<HTMLDivElement> {
	/** Number of placeholder cards to render. */
	count?: number
	ref?: Ref<HTMLDivElement>
}

function SkeletonCard({ testId, lastWidth, className, ...props }: HTMLAttributes<HTMLDivElement> & { testId: string; lastWidth: string }) {
	return (
		<div className={cn('flex flex-col gap-3', className)} data-testid={testId} {...props}>
			<Skeleton className="h-40 w-full rounded-lg" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className={cn('h-3', lastWidth)} />
		</div>
	)
}

/** Placeholder grid for the collections feed. */
export function CollectionSkeletons({ count = 12 }: CommunitySkeletonGridProps) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<SkeletonCard key={i} testId="community-collections-skeleton" lastWidth="w-1/2" />
			))}
		</>
	)
}

/** Placeholder grid for the merchants feed. */
export function MerchantSkeletons({ count = 6 }: CommunitySkeletonGridProps) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<SkeletonCard key={i} testId="community-merchants-skeleton" lastWidth="w-3/4" />
			))}
		</>
	)
}
