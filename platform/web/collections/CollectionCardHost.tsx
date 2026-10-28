import { uiActions } from '@sdk/config/ui'
import { Media } from '@ui/shared/media'
import { Link, useLocation } from '@tanstack/react-router'
import { UserCardHost } from '@platform/web/profiles/userCardHosts'
import { CollectionCardView } from '@ui/products/collection-card-view'
import type { CollectionReadEvent } from '@sdk/commerce/collections'

/**
 * Host for `@ui/products/collection-card-view`: records the source path for the
 * collection navigation on click, injects the router link, and resolves the
 * seller to `UserCardHost`. Reproduces the retiring
 * `src/components/CollectionCard.tsx`; the legacy component stays alive for its
 * remaining `src/` consumers.
 */
export function CollectionCardHost({ collection, className }: { collection: CollectionReadEvent } & React.HTMLAttributes<HTMLDivElement>) {
	const location = useLocation()

	const handleCollectionClick = () => {
		// Store the current path as the source path
		// This will also store it as originalResultsPath if not already set
		uiActions.setCollectionSourcePath(location.pathname)
	}
	return (
		<CollectionCardView
			collection={collection}
			className={className}
			renderLink={(children, collectionId, linkClassName) => (
				<Link to={`/collection/${collectionId}`} className={linkClassName} onClick={handleCollectionClick}>
					{children}
				</Link>
			)}
			renderImage={(src, alt) => (
				<Media
					src={src}
					alt={alt}
					className="h-full w-full rounded-t-[calc(var(--radius)-1px)] object-cover transition-transform duration-200 hover:scale-105"
				/>
			)}
			renderSeller={<UserCardHost pubkey={collection.pubkey} size="xs" />}
			data-testid="collection-card"
		/>
	)
}
