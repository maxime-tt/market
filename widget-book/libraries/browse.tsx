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
import { SellerProfileHeader, SellerProfileView } from '@ui/browse/seller-profile'
import { EmptyState } from '@ui/shared/empty-state'
import { Button } from '@ui/primitives/button'
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

// ---- search provider — compare both providers on the same query ----
//
// The browse search has ONE query path with a provider switch (local by default,
// or RabbitHole). Both answer the SAME query and render the SAME products; the
// difference is the relay verdict. The RabbitHole `partial` verdict (a relay
// failed) reaches the UI as the relay-failure state — the `RelayIndicator`
// shows the failed relay in `pending` — and is never flattened into a plain
// result. These are literals (the harness is props-only) rendered through the
// same `ui/` components the app host uses.

const COMPARE_QUERY = 'ceramic mug'

// The three products both providers return for the shared query (same query →
// same set; the panels differ only in their relay verdict).
const COMPARE_CARDS = [
	{
		id: 'cmp-1',
		title: 'Speckled Stoneware Mug',
		seller: 'kiln-and-co',
		sellerPubkey: '234567',
		price: 12900,
		stockNote: '40 in stock',
		material: 'm7' as const,
		symbolId: 'p-mug' as const,
	},
	{
		id: 'cmp-2',
		title: 'Hand-thrown Tumbler, 300 ml',
		seller: 'atelier-norte',
		sellerPubkey: 'abcdef01',
		price: 15500,
		stockNote: '12 left',
		material: 'm1' as const,
		symbolId: 'p-mug' as const,
	},
	{
		id: 'cmp-3',
		title: 'Glazed Tea Cup, 120 ml',
		seller: 'terra-studio',
		sellerPubkey: '9f8e7d',
		price: 9800,
		stockNote: '7 in stock',
		material: 'm5' as const,
		symbolId: 'p-jar' as const,
	},
]

function CompareGrid() {
	return (
		<SearchResultsGrid>
			{COMPARE_CARDS.map((c) => (
				<ProductCard
					key={c.id}
					id={c.id}
					title={c.title}
					seller={c.seller}
					sellerPubkey={c.sellerPubkey}
					price={c.price}
					stockNote={c.stockNote}
					material={c.material}
					symbolId={c.symbolId}
					onSelect={() => {}}
				/>
			))}
		</SearchResultsGrid>
	)
}

const SearchProviderCompare = () => (
	<div className="w-[960px] max-w-full">
		{/* The shared query both providers answer. */}
		<SearchField value={COMPARE_QUERY} onChange={() => {}} onGo={() => {}} submitted />

		<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
			{/* local provider — the default: a complete verdict, no failed relays */}
			<div className="border border-border-default rounded p-3">
				<div className="text-[10.5px] tracking-[0.14em] uppercase text-text-mid">
					local · <span className="text-text-high">complete</span>
				</div>
				{/* complete → every relay answered, so no indicator (nothing to flag) */}
				<RelayIndicator
					responded={3}
					totalProducts={COMPARE_CARDS.length}
					relays={[
						{ relay: 'nostr.wine', status: 'responded' },
						{ relay: 'relay.damus.io', status: 'responded' },
						{ relay: 'nos.lol', status: 'responded' },
					]}
				/>
				<CompareGrid />
			</div>

			{/* RabbitHole provider — a partial verdict (a relay failed) reaches the
			    UI as the relay-failure state: the failed relay is in `pending`. */}
			<div className="border border-border-default rounded p-3">
				<div className="text-[10.5px] tracking-[0.14em] uppercase text-text-mid">
					rabbithole · <span className="text-text-high">partial — relay failure</span>
				</div>
				<RelayIndicator
					responded={2}
					totalProducts={COMPARE_CARDS.length}
					relays={[
						{ relay: 'nostr.wine', status: 'responded' },
						{ relay: 'relay.damus.io', status: 'responded' },
						{ relay: 'relay.nostr.band', status: 'pending' },
					]}
				/>
				<CompareGrid />
			</div>
		</div>
	</div>
)

const SearchProviderRabbitholeDead = () => (
	<div className="w-[960px] max-w-full">
		{/* The shared query, answered by RabbitHole, where every relay failed —
		    the dead-search state (the strongest form of the relay-failure state). */}
		<SearchField value={COMPARE_QUERY} onChange={() => {}} onGo={() => {}} submitted />
		<div className="mt-4">
			<RelayIndicator
				responded={0}
				totalProducts={0}
				relays={[
					{ relay: 'nostr.wine', status: 'pending' },
					{ relay: 'relay.damus.io', status: 'pending' },
				]}
			/>
			<DeadSearchError
				totalRelays={2}
				pendingCount={2}
				message="All relays failed. The search fell back to the local index."
				onRetry={() => {}}
			/>
		</div>
	</div>
)

// ---- seller profile (frame YcjyRPZbVo) ----
//
// The frame's seller page. Two of its parts are deliberately absent from every
// entry, because the seam cannot supply them and the harness must not pretend
// otherwise: the Follow control (no contact-list read/write exists) and the
// trades / zapped-sats facts (orders are gift-wrapped to the seller; there is
// no zap-receipt read). `facts` shows exactly what a read returns.

const SELLER_NPUB = 'npub18x2s4kzqgsu37ykmq5g6m3h3qfqr8r3rjy3t9x3q4k3q8v4w4s9qj5s7k0'

const SELLER_LISTINGS = [
	{
		id: 'seller-1',
		title: 'Handcrafted Ceramic Ball',
		category: 'pottery',
		price: 21000,
		stockNote: '14 in stock',
		material: 'm1' as const,
		symbolId: 'p-bowl' as const,
	},
	{
		id: 'seller-2',
		title: 'Ceramic Pour-Over Dripper',
		category: 'tableware',
		price: 34500,
		stockNote: '5 in stock',
		material: 'm3' as const,
		symbolId: 'p-jar' as const,
	},
	{
		id: 'seller-3',
		title: 'Hand-thrown Mug, 350 ml',
		category: 'pottery',
		price: 12900,
		stockNote: '22 in stock',
		material: 'm5' as const,
		symbolId: 'p-mug' as const,
	},
]

const SELLER_STATUS = (
	<RelayIndicator
		responded={2}
		totalProducts={SELLER_LISTINGS.length}
		productsLabel="products from this seller"
		relays={[
			{ relay: 'nostr.wine', status: 'responded' },
			{ relay: 'relay.damus.io', status: 'responded' },
			{ relay: 'relay.nostr.band', status: 'pending' },
		]}
	/>
)

const SellerProfileHeaderDefault = () => (
	<div className="w-[1040px] max-w-full bg-background p-4">
		<SellerProfileHeader
			name="atelier-norte"
			category="pottery"
			npub={SELLER_NPUB}
			facts={['Joined Mar 2024']}
			shipsFrom="Vila Nova de Gaia, PT"
			onContact={() => {}}
			affordances={
				<Button variant="outline" className="rounded-full">
					Share
				</Button>
			}
		/>
	</div>
)

const SellerProfileHeaderMinimal = () => (
	<div className="w-[1040px] max-w-full bg-background p-4">
		{/* Nothing the reads did not return: no reputation line, no ships-from,
		    no Follow control. The header has to look like this — not like a
		    zeroed-out version of the frame — when the seam has nothing to say. */}
		<SellerProfileHeader name="kiln-and-co" />
	</div>
)

const SellerProfileViewDefault = () => (
	<div className="w-[1040px] max-w-full bg-background p-4">
		<SellerProfileView
			status={SELLER_STATUS}
			name="atelier-norte"
			category="pottery"
			npub={SELLER_NPUB}
			facts={['Joined Mar 2024']}
			shipsFrom="Vila Nova de Gaia, PT"
			onContact={() => {}}
		>
			{SELLER_LISTINGS.map((listing) => (
				<ProductCard
					key={listing.id}
					id={listing.id}
					title={listing.title}
					category={listing.category}
					seller="atelier-norte · ships from PT"
					sellerPubkey="abcdef01"
					price={listing.price}
					stockNote={listing.stockNote}
					material={listing.material}
					symbolId={listing.symbolId}
					onSelect={() => {}}
				/>
			))}
		</SellerProfileView>
	</div>
)

const SellerProfileViewLoading = () => (
	<div className="w-[1040px] max-w-full bg-background p-4">
		<SellerProfileView name="atelier-norte" category="pottery" npub={SELLER_NPUB} loading={<SkeletonGrid rows={6} columns={3} />} />
	</div>
)

const SellerProfileViewEmpty = () => (
	<div className="w-[1040px] max-w-full bg-background p-4">
		<SellerProfileView
			name="kiln-and-co"
			empty={<EmptyState title="No listings yet" description="This seller has nothing listed right now." />}
		/>
	</div>
)

const ProductCardWithCategory = () => (
	<div className="w-[320px]">
		<ProductCard
			id="evt-cat-1"
			title="Handcrafted Ceramic Ball"
			category="pottery"
			seller="atelier-norte"
			sellerPubkey="abcdef01"
			price={21000}
			stockNote="14 in stock"
			material="m1"
			symbolId="p-bowl"
			onSelect={() => {}}
		/>
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
		// search provider — compare both providers on the same query
		{ name: 'search-provider-compare', render: SearchProviderCompare },
		{ name: 'search-provider-rabbithole-dead', render: SearchProviderRabbitholeDead },
		// product-card category chip (the seller-profile card's title row)
		{ name: 'product-card-with-category', render: ProductCardWithCategory },
		// seller profile (frame YcjyRPZbVo)
		{ name: 'seller-profile-header-default', render: SellerProfileHeaderDefault },
		{ name: 'seller-profile-header-minimal', render: SellerProfileHeaderMinimal },
		{ name: 'seller-profile-view-default', render: SellerProfileViewDefault },
		{ name: 'seller-profile-view-loading', render: SellerProfileViewLoading },
		{ name: 'seller-profile-view-empty', render: SellerProfileViewEmpty },
	],
}
