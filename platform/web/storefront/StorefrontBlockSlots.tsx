import { ProductCardHost } from '@platform/web/products/ProductCardHost'
import { nip05ValidationQueryOptions, getNormalizedProfileDisplayName, useProfile, useProfileNames } from '@platform/web/profiles/profileQuery'
import { productsByPubkeyQueryOptions } from '@platform/web/products/productQuery'
// The live blocks' data: ONE browse index feed (the same streamed read the
// browse home paints) and the feed's own strip builder.
import { feedStrips, useBrowseIndexFeed } from '@platform/web/browse/browseIndexFeed'
import { materialForPubkey, symbolForPubkey, type BrowseProduct } from '@platform/web/browse/browseProductMap'
import { ProductCard } from '@ui/browse/product-card'
import type { NDKEvent } from '@platform/web/readContext'
import { getReadContext } from '@platform/web/readContext'
import {
	BrowseFeedBlock,
	BrowseStatsBlock,
	CategoriesBlock,
	FeaturedProductBlock,
	ProfileHeaderBlock,
	ProductGridBlock,
	ProductRowBlock,
	ProductStripsBlock,
	SearchBlock,
	type BrowseFeedBlockProps,
	type BrowseFeedRow,
	type BrowseStatsBlockProps,
	type CategoriesBlockBlockProps,
	type FeaturedProductBlockProps,
	type ProfileHeaderBlockProps,
	type ProductGridBlockProps,
	type ProductRowBlockProps,
	type ProductStripsBlockProps,
	type SearchBlockProps,
	type StorefrontDataSlots,
	type StorefrontProfileData,
} from '@ui/storefront'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
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

/**
 * The hand-picked product row.
 *
 * The block stores explicit `d` tags of listings the editor chose, and a home
 * page is authored by the app key — which owns no listings. Resolving the row
 * against the author's own set would therefore always be empty, so the read is
 * the explicit addresses themselves: one `#d` query for exactly the tags in the
 * document. The page can only show what the editor named, which is the property
 * that matters; it is not a free-form query.
 */
function ProductRowSlot(props: ProductRowBlockProps) {
	const { data, isLoading, isError } = useQuery({
		queryKey: ['storefront', 'product-row', props.productDTags.join(',')],
		enabled: props.productDTags.length > 0,
		queryFn: async () => {
			const context = getReadContext()
			return await context.fetch([{ kinds: [30402], '#d': props.productDTags }])
		},
	})

	return (
		<ProductRowBlock
			{...props}
			products={(data ?? null) as never}
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

/**
 * The `Search` block, wired to the app's own search state.
 *
 * The block is presentational (`ui/` is props-only); the host owns the query
 * state and the navigation, and it navigates to the one URL the browse surface
 * actually reads — `/?q=` — so a page cannot invent a search destination.
 */
function SearchSlot({ placeholder, size }: SearchBlockProps) {
	const navigate = useNavigate()
	const [query, setQuery] = useState('')
	const go = () => {
		const term = query.trim()
		if (term.length === 0) return
		navigate({ to: '/', search: { q: term } })
	}
	return (
		<SearchBlock
			placeholder={placeholder}
			size={size}
			query={query}
			onChange={setQuery}
			onGo={go}
			onClear={() => setQuery('')}
		/>
	)
}

/**
 * The `Categories` block. Each entry is an author-chosen label plus a key; the
 * host resolves the key to the one browse URL a category means today — a
 * keyword search — so the block stays flat and the taxonomy stays out of the
 * front end.
 */
function CategoriesSlot({ categories, title }: CategoriesBlockBlockProps) {
	const navigate = useNavigate()
	return (
		<CategoriesBlock
			categories={categories}
			title={title}
			categoryToPath={(key: string) => `/?q=${encodeURIComponent(key)}`}
		/>
	)
}

/**
 * The card the live feed renders: the browse read-model mapped onto the
 * presentational `ProductCard`.
 *
 * There is no `onSelect` here on purpose. On a CMS page a click follows the
 * tile's real deep link (`/?p=<id>`), which is the browser's own behaviour —
 * hover previews and middle-click work, and there is no in-place panel for a
 * host callback to open.
 */
function BrowseFeedCardHost({ product, sellerName }: { product: BrowseProduct; sellerName?: string }) {
	return (
		<ProductCard
			id={product.id}
			title={product.title}
			seller={sellerName ?? product.pubkey.slice(0, 8)}
			sellerPubkey={product.pubkey}
			sellerName={sellerName}
			image={product.image}
			price={product.price}
			priceCurrency={product.currency}
			material={materialForPubkey(product.pubkey)}
			symbolId={symbolForPubkey(product.pubkey)}
			href={`/?p=${encodeURIComponent(product.id)}`}
			sellerHref={`/profile/${encodeURIComponent(product.pubkey)}`}
		/>
	)
}

/**
 * The live wall strips. One feed, read through the SAME `useBrowseIndexFeed`
 * the browse home uses — this is not a second read. The strip items come from
 * the feed's own `feedStrips`, with seller names resolved through the batched
 * profile read the browse cards use, so a tile states the seller's name and
 * never a pubkey prefix when one exists.
 */
function ProductStripsSlot({ title, limit, reverse }: ProductStripsBlockProps) {
	const { data: feed, isLoading, isError } = useBrowseIndexFeed()
	const products = (feed?.products ?? []).slice(0, limit)
	const sellerNames = useProfileNames(products.map((product) => product.pubkey))
	const items = feedStrips(products, limit, (pubkey) => sellerNames.get(pubkey))

	return (
		<ProductStripsBlock
			title={title}
			limit={limit}
			reverse={reverse}
			items={feed ? items : null}
			isLoading={isLoading}
			isError={isError}
		/>
	)
}

/**
 * The measured facts line, fed by the feed's own `stats` — the numbers the
 * browse hero already states. No literal ever reaches the block.
 */
function BrowseStatsSlot({ align }: BrowseStatsBlockProps) {
	const { data: feed, isLoading, isError } = useBrowseIndexFeed()
	return <BrowseStatsBlock align={align} stats={feed?.stats} isLoading={isLoading} isError={isError} />
}

/**
 * The live browse feed — the streamed grid. The rows are the feed's loaded
 * listings; each is rendered through the browse card above.
 */
function BrowseFeedSlot({ title, limit, columns, emptyMessage }: BrowseFeedBlockProps) {
	const { data: feed, isLoading, isError } = useBrowseIndexFeed()
	const products = (feed?.products ?? []).slice(0, limit)
	const sellerNames = useProfileNames(products.map((product) => product.pubkey))

	return (
		<BrowseFeedBlock
			title={title}
			limit={limit}
			columns={columns}
			emptyMessage={emptyMessage}
			products={feed ? products : null}
			isLoading={isLoading}
			isError={isError}
			renderProduct={(row: BrowseFeedRow) => {
				const product = row as BrowseProduct
				return <BrowseFeedCardHost product={product} sellerName={sellerNames.get(product.pubkey)} />
			}}
		/>
	)
}

/** The slot map handed to `StorefrontRenderer` on the published-page mounts. */
export const storefrontBlockSlots: StorefrontDataSlots = {
	ProductGrid: (props) => <ProductGridSlot {...props} />,
	FeaturedProduct: (props) => <FeaturedProductSlot {...props} />,
	ProfileHeader: (props) => <ProfileHeaderSlot {...props} />,
	ProductRow: (props) => <ProductRowSlot {...props} />,
	Search: (props) => <SearchSlot {...props} />,
	Categories: (props) => <CategoriesSlot {...props} />,
	ProductStrips: (props) => <ProductStripsSlot {...props} />,
	BrowseStats: (props) => <BrowseStatsSlot {...props} />,
	BrowseFeed: (props) => <BrowseFeedSlot {...props} />,
}
