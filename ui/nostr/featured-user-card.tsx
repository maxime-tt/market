import { Fragment, type ReactNode, type Ref } from 'react'
import { Card } from '../primitives/card'
import { cn } from '../utils/cn'

/** One product tile in the featured strip. */
export interface FeaturedUserCardProduct {
	/** Stable key for the tile. */
	id: string
	/** Router href the tile links to. */
	href: string
	/** Tile image; a placeholder is rendered when absent. */
	imageUrl?: string | null
}

/** Renders one navigable element. The host supplies its router link. */
export type FeaturedUserCardRenderLink = (args: { href: string; className?: string; children: ReactNode }) => ReactNode

export interface FeaturedUserCardViewProps {
	/** Router href for the featured profile. */
	profileHref: string
	/** Already-resolved display name; the host falls back to a short npub. */
	displayName: string
	about?: string | null
	/** Already-resolved avatar URL; the host supplies the placeholder. */
	picture?: string | null
	/** Total number of products, shown under the name. */
	productCount: number
	/** Up to four tiles; a missing slot renders the placeholder. */
	products?: readonly FeaturedUserCardProduct[]
	isLoadingProducts?: boolean
	/** Injected link rendering, so `ui/` never imports the router. */
	renderLink: FeaturedUserCardRenderLink
	className?: string
	ref?: Ref<HTMLDivElement>
}

/** The product strip always renders this many tiles. */
export const FEATURED_USER_CARD_SLOTS = 4

/**
 * Featured-seller card: avatar, name, blurb, product count and a four-tile
 * product strip. Presentation only — the host resolves the profile, the
 * products and their image URLs, and injects link rendering.
 *
 * Note the count is the creator's **total** products, not the number of tiles
 * rendered. The previous inline version printed `userProducts.length` after
 * slicing to four, so any seller with more than four products read "4
 * products".
 */
export function FeaturedUserCardView({
	profileHref,
	displayName,
	about,
	picture,
	productCount,
	products = [],
	isLoadingProducts = false,
	renderLink,
	className,
	ref,
}: FeaturedUserCardViewProps) {
	return (
		<Card
			ref={ref}
			data-slot="featured-user-card"
			className={cn('hover:shadow-lg h-50 bg-background overflow-hidden py-0 transition-shadow', className)}
		>
			<div className="flex h-full">
				{/* Avatar on the left */}
				<div className="h-full w-50 shrink-0">
					{renderLink({
						href: profileHref,
						children: <img src={picture ?? undefined} alt={displayName} className="h-full w-full object-cover" />,
					})}
				</div>

				{/* User info and products */}
				<div className="flex min-w-0 flex-col justify-between p-4">
					<div className="min-w-0 flex-1">
						{renderLink({
							href: profileHref,
							className: 'block',
							children: (
								<>
									<h3 className="truncate font-semibold text-foreground/90 transition-colors hover:text-fill-accent">{displayName}</h3>
									{about && <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{about}</p>}
									<p className="mt-1 text-xs text-foreground/70">{productCount} products</p>
								</>
							),
						})}
					</div>

					{/* Product grid at the bottom */}
					<div className="mt-2 shrink-0">
						{isLoadingProducts ? (
							<div className="flex flex-row gap-1">
								{Array.from({ length: FEATURED_USER_CARD_SLOTS }).map((_, index) => (
									<div key={index} className="h-12 w-12 animate-pulse rounded bg-background/80" />
								))}
							</div>
						) : (
							<div className="flex flex-row gap-1">
								{Array.from({ length: FEATURED_USER_CARD_SLOTS }).map((_, index) => {
									const product = products[index]
									if (!product) {
										return (
											<div key={index} className="flex h-12 w-12 items-center justify-center rounded bg-background/90">
												<span className="text-xs text-foreground/70">•</span>
											</div>
										)
									}
									return (
										<Fragment key={product.id}>
											{renderLink({
												href: product.href,
												className: 'block',
												children: (
													<img
														src={product.imageUrl || '/images/placeholder.png'}
														alt="Product"
														className="h-12 w-12 rounded object-cover transition-opacity hover:opacity-80"
													/>
												),
											})}
										</Fragment>
									)
								})}
							</div>
						)}
					</div>
				</div>
			</div>
		</Card>
	)
}
