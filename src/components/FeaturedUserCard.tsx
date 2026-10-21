import { getProductImages, productsByPubkeyQueryOptions } from '@/queries/products'
import { profileQueryOptions } from '@/queries/profiles'
import { FeaturedUserCardView, type FeaturedUserCardProduct } from '@ui/nostr/featured-user-card'
import { truncateNpub } from '@ui/nostr/npub-display'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { safeNpubEncode } from '@/lib/utils'

interface FeaturedUserCardProps extends React.HTMLAttributes<'div'> {
	userPubkey: string
}

/** How many product tiles the strip shows. */
const PRODUCT_TILES = 4

/**
 * Host for `@ui/nostr/featured-user-card`: resolves the profile and the
 * product strip, resolves the avatar and per-product image URLs, and injects
 * the router link. The view owns all markup.
 */
export function FeaturedUserCard({ userPubkey, className }: FeaturedUserCardProps) {
	const pubkeyString = userPubkey.toString()
	const npub = safeNpubEncode(pubkeyString)
	const isValidPubkey = npub !== null

	const { data: profile } = useQuery({
		...profileQueryOptions(npub ?? ''),
		enabled: isValidPubkey,
	})

	const productOptions = productsByPubkeyQueryOptions(pubkeyString)
	const { data: userProductsData, isLoading: isLoadingProducts } = useQuery({
		...productOptions,
		enabled: productOptions.enabled,
	})

	const allProducts = userProductsData ?? []
	// Profile fields are not guaranteed to be strings (`name` is typed `string | number`),
	// which is why the previous inline version called `.toString()` at the call site.
	const displayName = String(
		profile?.name || profile?.display_name || (isValidPubkey ? truncateNpub(npub, { head: 12, tail: 0 }) : 'Unknown'),
	)

	const products: FeaturedUserCardProduct[] = allProducts.slice(0, PRODUCT_TILES).map((product) => ({
		id: product.id,
		href: `/product/${product.id}`,
		imageUrl: getProductImages(product)?.[0]?.[1],
	}))

	return (
		<FeaturedUserCardView
			profileHref={`/profile/${pubkeyString}`}
			displayName={displayName}
			about={profile?.about}
			picture={profile?.picture || `https://robohash.org/${pubkeyString}?set=set4&size=200x200`}
			productCount={allProducts.length}
			products={products}
			isLoadingProducts={isLoadingProducts}
			className={className}
			renderLink={({ href, className: linkClassName, children }) => (
				<Link to={href as never} className={linkClassName}>
					{children}
				</Link>
			)}
		/>
	)
}
