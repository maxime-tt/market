/**
 * widget-book/libraries/browse.tsx — Browse foundation widget library.
 *
 * One entry per state of every new ui/ view.
 * Covers: browse-nav, search-field, art module, product-card, product-strip,
 * account-pane, list-row, list-detail, relay-indicator, dead-search-error.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductArt, ProductSprite } from '@ui/browse/art'
import { ProductCard, ProductContextMenu } from '@ui/browse/product-card'
import { ProductStrip } from '@ui/browse/product-strip'
import { AccountPane } from '@ui/browse/account-pane'
import { ListDetail, ListRow } from '@ui/browse/list-views'
import { RelayIndicator, DeadSearchError } from '@ui/browse/relay-error'
import { BrowseIdle } from '@ui/browse/browse-idle'
import { SkeletonGrid } from '@ui/browse/skeleton-grid'
import { EmptyStateBrowse } from '@ui/browse/empty-state-browse'
import { SearchResultsGrid } from '@ui/browse/search-results-grid'
import { TagFilterBadge } from '@ui/browse/relay-error'
import type { WidgetLibrary } from '../libraries'
import type { StripItem } from '@ui/browse/product-strip'

// ---- Mock data ----

const PRODUCTS = [
	{
		id: 'evt-1',
		title: 'Handcrafted Ceramic Ball',
		seller: 'atelier-norte',
		sellerPubkey: 'abcdef01',
		price: 21000,
		stock: '76 in stock',
		material: 'm1' as const,
		symbol: 'p-bowl' as const,
	},
	{
		id: 'evt-2',
		title: 'Ceramic Pour-Over Set',
		seller: 'kiln-and-co',
		sellerPubkey: '234567',
		price: 34500,
		stock: '12 left',
		material: 'm5' as const,
		symbol: 'p-jar' as const,
	},
	{
		id: 'evt-3',
		title: 'Hand-thrown Tumbler, 300 ml',
		seller: 'atelier-norte',
		sellerPubkey: 'abcdef01',
		price: 12900,
		stock: '40 in stock',
		material: 'm7' as const,
		symbol: 'p-mug' as const,
	},
	{
		id: 'evt-4',
		title: 'Stoneware Planter, Matte White',
		seller: 'terra-studio',
		sellerPubkey: '89abcdef',
		price: 28400,
		stock: '9 left',
		material: 'm2' as const,
		symbol: 'p-bottle' as const,
	},
]

const STRIP_ITEMS = PRODUCTS.slice(0, 6).map((p, i) => ({
	id: `strip-${i}`,
	title: p.title,
	seller: p.seller,
	material: p.material,
	symbolId: p.symbol,
}))

// ---- browse-nav entries ----

const BrowseNavDefault = () => <BrowseNav active={true} onNavigateHome={() => {}} onNavigateFeatured={() => {}} />

const BrowseNavInactive = () => <BrowseNav active={false} onNavigateHome={() => {}} onNavigateFeatured={() => {}} />

const BrowseNavWithSlots = () => {
	const [query, setQuery] = useState('ceramic')
	return (
		<BrowseNav
			active={true}
			onNavigateHome={() => {}}
			onNavigateFeatured={() => {}}
			searchSlot={<SearchField value={query} onChange={setQuery} onGo={() => {}} />}
			accountSlot={
				<div className="flex items-center gap-2 text-sm text-text-mid">
					<div className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">M</div>
					Maxime
				</div>
			}
		/>
	)
}

// ---- search-field entries ----

const SearchFieldEmpty = () => {
	const [value, setValue] = useState('')
	return <SearchField value={value} onChange={setValue} onGo={() => {}} />
}

const SearchFieldWithValue = () => {
	const [value, setValue] = useState('ceramic bowl')
	return <SearchField value={value} onChange={setValue} onGo={() => {}} />
}

const SearchFieldFocused = () => {
	return (
		<div className="focus-within:ring-2 focus-within:ring-focus-ring">
			<SearchField value="ceramic" onChange={() => {}} onGo={() => {}} submitted />
		</div>
	)
}

// ---- art module entries ----

const ArtSprite = () => (
	<div className="relative w-16 h-16 border border-dashed border-gray-300">
		<ProductSprite />
	</div>
)

const ArtM1 = () => <ProductArt material="m1" />
const ArtM2 = () => <ProductArt material="m2" />
const ArtM3 = () => <ProductArt material="m3" />
const ArtM4 = () => <ProductArt material="m4" />
const ArtM5 = () => <ProductArt material="m5" />
const ArtM6 = () => <ProductArt material="m6" />
const ArtM7 = () => <ProductArt material="m7" />
const ArtM8 = () => <ProductArt material="m8" />

const ArtAllMaterials = () => (
	<div className="grid grid-cols-4 gap-2">
		<ProductArt material="m1" />
		<ProductArt material="m2" />
		<ProductArt material="m3" />
		<ProductArt material="m4" />
		<ProductArt material="m5" />
		<ProductArt material="m6" />
		<ProductArt material="m7" />
		<ProductArt material="m8" />
	</div>
)

const ArtSquareRatio = () => <ProductArt material="m3" ratio="1/1" />

// ---- product-card entries ----

const ProductCardDefault = () => (
	<ProductCard
		id="evt-1"
		title="Handcrafted Ceramic Ball"
		seller="atelier-norte"
		sellerPubkey="abcdef01"
		price={21000}
		stockNote="76 in stock"
		material="m1"
		symbolId="p-bowl"
		onHeart={() => {}}
		onThreeDots={() => {}}
		onAddToList={() => {}}
		onCopyLink={() => {}}
		onReport={() => {}}
	/>
)

const ProductCardInList = () => (
	<ProductCard
		id="evt-2"
		title="Ceramic Pour-Over Set"
		seller="kiln-and-co"
		sellerPubkey="234567"
		price={34500}
		stockNote="12 left"
		material="m5"
		symbolId="p-jar"
		inList={true}
		onHeart={() => {}}
		onThreeDots={() => {}}
	/>
)

const ProductCardAuction = () => (
	<ProductCard
		id="evt-5"
		title="Raku Vase, one of one"
		seller="Auction · ends 18:00"
		sellerPubkey="abcd1234"
		price={88000}
		stockNote="2h 14m left"
		material="m1"
		symbolId="p-candle"
		bidCount={18}
		onHeart={() => {}}
		onThreeDots={() => {}}
	/>
)

const ProductCardMenuOpen = () => {
	const [menuOpen, setMenuOpen] = useState(true)
	return (
		<ProductCard
			id="evt-3"
			title="Hand-thrown Tumbler, 300 ml"
			seller="atelier-norte"
			sellerPubkey="abcdef01"
			price={12900}
			stockNote="40 in stock"
			material="m7"
			symbolId="p-mug"
			menuOpen={menuOpen}
			onHeart={() => {}}
			onThreeDots={() => setMenuOpen(!menuOpen)}
			onAddToList={() => {}}
			onCopyLink={() => {}}
			onReport={() => {}}
		/>
	)
}

// ---- product-strip entries ----

const ProductStripDefault = () => <ProductStrip items={STRIP_ITEMS} onSelect={() => {}} />

const ProductStripSingleItem = () => <ProductStrip items={[STRIP_ITEMS[0]]} onSelect={() => {}} />

// ---- account-pane entries ----

const AccountPaneDefault = () => (
	<AccountPane
		name="Maxime"
		npub="npub1q…7f3k"
		avatarInitial="M"
		signedInWith="Signed in with extension signer, remote signer or nsec"
		balance={128400}
		onTopUp={() => {}}
		onWithdraw={() => {}}
		onTransactions={() => {}}
		onConnectNWC={() => {}}
		onOrders={() => {}}
		onNotifications={() => {}}
		onSavedLists={() => {}}
		onSignOut={() => {}}
	/>
)

// ---- list-row / list-detail entries ----

const ListRowDefault = () => (
	<ListRow
		item={{
			id: 'list-1',
			name: 'Want to buy',
			itemCount: 12,
			privacy: 'private',
			note: 'For the studio wall — nothing over 40,000 sats, no glazed blues.',
		}}
	/>
)

const ListDetailDefault = () => (
	<ListDetail
		name="Want to buy"
		privacyLabel="Private"
		owner="Maxime"
		ownerNpub="npub1q…7f3k"
		itemCount={12}
		privacy="private"
		note="For the studio wall — nothing over 40,000 sats, no glazed blues."
		shownItems={8}
		totalItems={12}
	/>
)

// ---- relay-indicator entries ----

const RelayIndicatorDefault = () => (
	<RelayIndicator
		responded={3}
		totalProducts={1208}
		relays={[
			{ relay: 'nostr.wine', status: 'responded' },
			{ relay: 'relay.damus.io', status: 'responded' },
			{ relay: 'nos.lol', status: 'responded' },
			{ relay: 'relay.nostr.band', status: 'pending' },
		]}
	/>
)

const DeadSearchErrorDefault = () => (
	<DeadSearchError totalRelays={4} pendingCount={1} message="All relays failed. Check your connection and try again." onRetry={() => {}} />
)
// ---- Phase 2: idle wall strips ----

const IDLE_ITEMS: StripItem[] = [
	{ id: 'idle-1', title: 'Speckled Bowl, 6 in', seller: 'ATELIER-NORTE', material: 'm1' as const, symbolId: 'p-bowl' },
	{ id: 'idle-2', title: 'Amber Dropper, 30 ml', seller: 'GLASSWORKS', material: 'm2' as const, symbolId: 'p-bottle' },
	{ id: 'idle-3', title: 'Stoneware Mug, 400 ml', seller: 'CLAYHOUSE', material: 'm3' as const, symbolId: 'p-mug' },
	{ id: 'idle-4', title: 'Pendant Lantern', seller: 'FORGE', material: 'm4' as const, symbolId: 'p-lamp' },
	{ id: 'idle-5', title: 'Botanical Print Folio', seller: 'PRESS', material: 'm5' as const, symbolId: 'p-books' },
	{ id: 'idle-6', title: 'Nesting Crates (3)', seller: 'JOINERY', material: 'm6' as const, symbolId: 'p-crate' },
]

const BrowseIdleDefault = () => (
	<div className="h-[500px]">
		<BrowseIdle query="" onSearchChange={() => {}} onSearchGo={() => {}} stripsAbove={IDLE_ITEMS} stripsBelow={IDLE_ITEMS} />
	</div>
)

const BrowseIdleWithSearch = () => {
	const [query, setQuery] = useState('ceramic')
	return (
		<div className="h-[500px]">
			<BrowseIdle
				query={query}
				onSearchChange={setQuery}
				onSearchGo={() => {}}
				active={false}
				onNavigateHome={() => {}}
				onNavigateFeatured={() => {}}
				accountSlot={
					<div className="flex items-center gap-2 text-sm text-text-mid">
						<div className="size-7 rounded-full bg-fill-ink text-on-fill-ink grid place-items-center text-xs font-bold">M</div>
					</div>
				}
			/>
		</div>
	)
}

// ---- Phase 2: skeleton-grid ----

const SkeletonGridDefault = () => (
	<div className="h-[400px]">
		<SkeletonGrid rows={8} columns={3} />
	</div>
)

// ---- Phase 2: empty-state-browse ----

const EmptyStateBrowseDefault = () => (
	<div className="max-w-[600px] mx-auto py-8">
		<EmptyStateBrowse query="ceramic" />
	</div>
)

// ---- Phase 2: tag-filtered-badge ----

const TagFilterBadgeDefault = () => (
	<div className="flex flex-wrap gap-2">
		<TagFilterBadge label="All" count={1208} active={true} />
		<TagFilterBadge label="Handmade" count={214} />
		<TagFilterBadge label="Pottery" count={168} />
		<TagFilterBadge label="Stoneware" count={96} />
		<TagFilterBadge label="Wood-fired" count={61} />
		<TagFilterBadge label="Tableware" count={44} />
	</div>
)

// ---- Phase 2: relay-indicator expanded popover ----

const RelayIndicatorExpanded = () => (
	<RelayIndicator
		responded={3}
		totalProducts={40}
		relays={[
			{ relay: 'relay.damus.io', status: 'responded' },
			{ relay: 'nostr.wine', status: 'responded' },
			{ relay: 'nos.lol', status: 'responded' },
			{ relay: 'relay.nostr.band', status: 'pending' },
			{ relay: 'relay.foliax.xyz', status: 'pending' },
			{ relay: 'relay.opennoderelay.net', status: 'pending' },
		]}
	/>
)

// ---- Search results grid ----

const SearchResultsGridDefault = () => (
	<div className="w-[960px]">
		<SearchResultsGrid
			facets={[
				{ label: 'All', count: 1208, active: true },
				{ label: 'Handmade', count: 214 },
				{ label: 'Pottery', count: 168 },
				{ label: 'Stoneware', count: 96 },
				{ label: 'Wood-fired', count: 61 },
				{ label: 'Tableware', count: 44 },
			]}
		>
			<ProductCard
				id="evt-1"
				title="Handcrafted Ceramic Ball"
				seller="atelier-norte"
				sellerPubkey="abcdef01"
				price={21000}
				stockNote="76 in stock"
				material="m1"
				symbolId="p-bowl"
				inList={true}
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-2"
				title="Ceramic Pour-Over Set"
				seller="kiln-and-co"
				sellerPubkey="234567"
				price={34500}
				stockNote="12 left"
				material="m5"
				symbolId="p-jar"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-3"
				title="Hand-thrown Tumbler, 300 ml"
				seller="atelier-norte"
				sellerPubkey="abcdef01"
				price={12900}
				stockNote="40 in stock"
				material="m7"
				symbolId="p-mug"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-4"
				title="Stoneware Planter, Matte White"
				seller="terra-studio"
				sellerPubkey="89abcdef"
				price={28400}
				stockNote="9 left"
				material="m2"
				symbolId="p-bottle"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-5"
				title="Wood-fired Tea Bowl"
				seller="kiln-and-co"
				sellerPubkey="234567"
				price={46000}
				stockNote="1 of 3"
				material="m6"
				symbolId="p-bowl"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-6"
				title="Raku Vase, one of one"
				seller="Auction · ends 18:00"
				sellerPubkey="abcdef01"
				price={88000}
				stockNote="2h 14m left"
				material="m1"
				symbolId="p-candle"
				bidCount={18}
				onSelect={() => {}}
			/>
		</SearchResultsGrid>
	</div>
)

const SearchResultsGridActiveFacet = () => (
	<div className="w-[960px]">
		<SearchResultsGrid
			facets={[
				{ label: 'All', count: 1208 },
				{ label: 'Handmade', count: 214, active: true },
				{ label: 'Pottery', count: 168 },
				{ label: 'Stoneware', count: 96 },
				{ label: 'Wood-fired', count: 61 },
				{ label: 'Tableware', count: 44 },
			]}
		>
			<ProductCard
				id="evt-1"
				title="Handcrafted Ceramic Ball"
				seller="atelier-norte"
				sellerPubkey="abcdef01"
				price={21000}
				stockNote="76 in stock"
				material="m1"
				symbolId="p-bowl"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-2"
				title="Ceramic Pour-Over Set"
				seller="kiln-and-co"
				sellerPubkey="234567"
				price={34500}
				stockNote="12 left"
				material="m5"
				symbolId="p-jar"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-3"
				title="Hand-thrown Tumbler, 300 ml"
				seller="atelier-norte"
				sellerPubkey="abcdef01"
				price={12900}
				stockNote="40 in stock"
				material="m7"
				symbolId="p-mug"
				onSelect={() => {}}
			/>
		</SearchResultsGrid>
	</div>
)

const SearchResultsGridNoFacets = () => (
	<div className="w-[960px]">
		<SearchResultsGrid>
			<ProductCard
				id="evt-1"
				title="Handcrafted Ceramic Ball"
				seller="atelier-norte"
				sellerPubkey="abcdef01"
				price={21000}
				stockNote="76 in stock"
				material="m1"
				symbolId="p-bowl"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-2"
				title="Ceramic Pour-Over Set"
				seller="kiln-and-co"
				sellerPubkey="234567"
				price={34500}
				stockNote="12 left"
				material="m5"
				symbolId="p-jar"
				onSelect={() => {}}
			/>
			<ProductCard
				id="evt-3"
				title="Hand-thrown Tumbler, 300 ml"
				seller="atelier-norte"
				sellerPubkey="abcdef01"
				price={12900}
				stockNote="40 in stock"
				material="m7"
				symbolId="p-mug"
				onSelect={() => {}}
			/>
		</SearchResultsGrid>
	</div>
)

// ---- Library ----

export const browse: WidgetLibrary = {
	name: 'browse',
	entries: [
		// browse-nav
		{ name: 'browse-nav-default', render: BrowseNavDefault },
		{ name: 'browse-nav-inactive', render: BrowseNavInactive },
		{ name: 'browse-nav-with-slots', render: BrowseNavWithSlots },
		// search-field
		{ name: 'search-field-empty', render: SearchFieldEmpty },
		{ name: 'search-field-with-value', render: SearchFieldWithValue },
		{ name: 'search-field-focused', render: SearchFieldFocused },
		// art module
		{ name: 'art-sprite', render: ArtSprite },
		{ name: 'art-m1', render: ArtM1 },
		{ name: 'art-m2', render: ArtM2 },
		{ name: 'art-m3', render: ArtM3 },
		{ name: 'art-m4', render: ArtM4 },
		{ name: 'art-m5', render: ArtM5 },
		{ name: 'art-m6', render: ArtM6 },
		{ name: 'art-m7', render: ArtM7 },
		{ name: 'art-m8', render: ArtM8 },
		{ name: 'art-all-materials', render: ArtAllMaterials },
		{ name: 'art-square-ratio', render: ArtSquareRatio },
		// product-card
		{ name: 'product-card-default', render: ProductCardDefault },
		{ name: 'product-card-in-list', render: ProductCardInList },
		{ name: 'product-card-auction', render: ProductCardAuction },
		{ name: 'product-card-menu-open', render: ProductCardMenuOpen },
		// product-strip
		{ name: 'product-strip-default', render: ProductStripDefault },
		{ name: 'product-strip-single', render: ProductStripSingleItem },
		// account-pane
		{ name: 'account-pane-default', render: AccountPaneDefault },
		// list-views
		{ name: 'list-row-default', render: ListRowDefault },
		{ name: 'list-detail-default', render: ListDetailDefault },
		// relay-indicator
		{ name: 'relay-indicator-default', render: RelayIndicatorDefault },
		// dead-search-error
		{ name: 'dead-search-error-default', render: DeadSearchErrorDefault },
		// phase 2: idle wall strips
		{ name: 'browse-idle-default', render: BrowseIdleDefault },
		{ name: 'browse-idle-with-search', render: BrowseIdleWithSearch },
		// phase 2: skeleton-grid
		{ name: 'skeleton-grid-default', render: SkeletonGridDefault },
		// phase 2: empty-state-browse
		{ name: 'empty-state-browse-default', render: EmptyStateBrowseDefault },
		// phase 2: tag-filtered-badge
		{ name: 'tag-filtered-badge-default', render: TagFilterBadgeDefault },
		// phase 2: relay-indicator expanded
		{ name: 'relay-indicator-expanded', render: RelayIndicatorExpanded },
		// search results grid
		{ name: 'search-results-grid-default', render: SearchResultsGridDefault },
		{ name: 'search-results-grid-active-facet', render: SearchResultsGridActiveFacet },
		{ name: 'search-results-grid-no-facets', render: SearchResultsGridNoFacets },
	],
}
