import { ProductCardHost } from '@platform/web/products/ProductCardHost'
import { nip05ValidationQueryOptions, getNormalizedProfileDisplayName, useProfile } from '@platform/web/profiles/profileQuery'
import { productsByPubkeyQueryOptions } from '@platform/web/products/productQuery'
import type { NDKEvent } from '@platform/web/readContext'
import {
	FeaturedProductBlock,
	ProfileHeaderBlock,
	ProductGridBlock,
	ProductRowBlock,
	type FeaturedProductBlockProps,
	type ProfileHeaderBlockProps,
	type ProductGridBlockProps,
	type ProductRowBlockProps,
	type StorefrontDataSlots,
	type StorefrontProfileData,
} from '@ui/storefront'
import { useQuery } from '@tanstack/react-query'
import { useStorefrontContext } from '@ui/storefront/StorefrontContext'

/**
 * The platform's data-bound slot map for the storefront renderer (batch 2's
 * `StorefrontDataSlots` seam). `ui/` is props-only, so the four data-bound
 * block types resolve their reads here, over the existing platform queries:
 *
 *   ProductGrid / FeaturedProduct / ProductRow → `productsByPubkeyQueryOptions` (kind 30402)
 *   ProfileHeader                              → `useProfile` (kind 0) + NIP-05 validation
 *
 * Author anchoring is the fork's security property, preserved by construction:
 * every slot takes the pubkey from `useStorefrontContext()` — the value
 * `StorefrontRenderer` sets from the *page event's* author — and never from the
 * page document. The `StorefrontPage` schema has no field that could name
 * another pubkey, so a page can only ever point its product references at the
 * author's own listing set (the `productsByPubkey` read is relay-scoped to
 * `authors: [pubkey]`, and `FeaturedProduct`/`ProductRow` match `d` tags
 * within that set).
 *
 * A missing or erroring read degrades to the props-only view's empty/error
 * state — a slot never throws its query failure into the page.
 */

function ProductGridSlot(props: ProductGridBlockProps) {
	const { pubkey } = useStorefrontContext()
	const { data: products, isLoading, isError } = useQuery(productsByPubkeyQueryOptions(pubkey))

	return (
		<ProductGridBlock
			{...props}
			products={products ?? null}
			isLoading={isLoading}
			isError={isError}
			// The query's rows are NDKEvents; the view's callback types them as the
			// read-model shape they satisfy. The card host takes the full event.
			renderProduct={(product) => <ProductCardHost product={product as NDKEvent} />}
		/>
	)
}

function FeaturedProductSlot(props: FeaturedProductBlockProps) {
	const { pubkey } = useStorefrontContext()
	const { data: products, isLoading, isError } = useQuery(productsByPubkeyQueryOptions(pubkey))

	return (
		<FeaturedProductBlock
			{...props}
			products={products ?? null}
			isLoading={isLoading}
			isError={isError}
			renderProduct={(product) => <ProductCardHost product={product as NDKEvent} />}
		/>
	)
}

function ProductRowSlot(props: ProductRowBlockProps) {
	const { pubkey } = useStorefrontContext()
	const { data: products, isLoading, isError } = useQuery(productsByPubkeyQueryOptions(pubkey))

	return (
		<ProductRowBlock
			{...props}
			products={products ?? null}
			isLoading={isLoading}
			isError={isError}
			renderProduct={(product) => <ProductCardHost product={product as NDKEvent} />}
		/>
	)
}

function ProfileHeaderSlot(props: ProfileHeaderBlockProps) {
	const { pubkey } = useStorefrontContext()
	const { data: profileData, isLoading } = useProfile(pubkey)
	const profile = profileData?.profile ?? null

	// Same rule as `Nip05BadgeHost`: validate only when an address is claimed,
	// and surface checking / verified / invalid from the validation query.
	const nip05 = profile?.nip05 ?? null
	const shouldValidate = Boolean(pubkey && nip05 && nip05.length > 0)
	const { data: isVerified, isLoading: nip05IsLoading } = useQuery({
		...nip05ValidationQueryOptions(pubkey),
		enabled: shouldValidate,
	})
	const nip05State: StorefrontProfileData['nip05State'] = !shouldValidate
		? null
		: nip05IsLoading
			? 'loading'
			: isVerified
				? 'verified'
				: 'invalid'

	const data: StorefrontProfileData | null = profile
		? {
				displayName: getNormalizedProfileDisplayName(profile),
				name: profile.name ?? null,
				picture: profile.picture ?? null,
				banner: profile.banner ?? null,
				about: profile.about ?? null,
				nip05,
				nip05State,
			}
		: null

	return <ProfileHeaderBlock {...props} profile={data} isLoading={isLoading} />
}

/** The slot map handed to `StorefrontRenderer` on the published-page mounts. */
export const storefrontBlockSlots: StorefrontDataSlots = {
	ProductGrid: (props) => <ProductGridSlot {...props} />,
	FeaturedProduct: (props) => <FeaturedProductSlot {...props} />,
	ProfileHeader: (props) => <ProfileHeaderSlot {...props} />,
	ProductRow: (props) => <ProductRowSlot {...props} />,
}
