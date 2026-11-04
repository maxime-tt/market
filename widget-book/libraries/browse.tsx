/**
 * widget-book/libraries/browse.tsx — Browse foundation widget library.
 *
 * One entry per state of every new ui/ view.
 * Covers: browse-nav, search-field, art module, product-card, product-strip.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductArt, ProductSprite } from '@ui/browse/art'
import { ProductCard, ProductContextMenu } from '@ui/browse/product-card'
import { ProductStrip } from '@ui/browse/product-strip'
import type { WidgetLibrary } from '../libraries'

// ---- Mock data ----

const PRODUCTS = [
	{ id: 'evt-1', title: 'Handcrafted Ceramic Ball', seller: 'atelier-norte', sellerPubkey: 'abcdef01', price: 21000, stock: '76 in stock', material: 'm1', symbol: 'p-bowl' as const },
	{ id: 'evt-2', title: 'Ceramic Pour-Over Set', seller: 'kiln-and-co', sellerPubkey: '234567', price: 34500, stock: '12 left', material: 'm5', symbol: 'p-jar' as const },
	{ id: 'evt-3', title: 'Hand-thrown Tumbler, 300 ml', seller: 'atelier-norte', sellerPubkey: 'abcdef01', price: 12900, stock: '40 in stock', material: 'm7', symbol: 'p-mug' as const },
	{ id: 'evt-4', title: 'Stoneware Planter, Matte White', seller: 'terra-studio', sellerPubkey: '89abcdef', price: 28400, stock: '9 left', material: 'm2', symbol: 'p-bottle' as const },
]

const STRIP_ITEMS = PRODUCTS.slice(0, 6).map((p, i) => ({
	id: `strip-${i}`,
	title: p.title,
	seller: p.seller,
	material: p.material,
	symbolId: p.symbol,
}))

// ---- browse-nav entries ----

const BrowseNavDefault = () => (
	<BrowseNav active={true} onNavigateHome={() => {}} onNavigateFeatured={() => {}} />
)

const BrowseNavInactive = () => (
	<BrowseNav active={false} onNavigateHome={() => {}} onNavigateFeatured={() => {}} />
)

const BrowseNavWithSlots = () => {
	const [query, setQuery] = useState('ceramic')
	return (
		<BrowseNav
			active={true}
			onNavigateHome={() => {}}
			onNavigateFeatured={() => {}}
			searchSlot={<SearchField value={query} onChange={setQuery} onGo={() => {}} />}
			accountSlot={
				<div data-testid="widget-browse-nav-account" className="flex items-center gap-2 text-sm text-text-mid">
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
	const [value, setValue] = useState('')
	return (
		<div className="focus-within:ring-2 focus-within:ring-focus-ring">
			<SearchField value={value} onChange={setValue} onGo={() => {}} />
		</div>
	)
}

// ---- art module entries ----

const ArtSprite = () => (
	<div className="relative w-0 h-0 overflow-hidden">
		<ProductSprite />
	</div>
)

const ArtM1 = () => <ProductArt material="m1" data-testid="widget-art-m1" />
const ArtM2 = () => <ProductArt material="m2" data-testid="widget-art-m2" />
const ArtM3 = () => <ProductArt material="m3" data-testid="widget-art-m3" />
const ArtM4 = () => <ProductArt material="m4" data-testid="widget-art-m4" />
const ArtM5 = () => <ProductArt material="m5" data-testid="widget-art-m5" />
const ArtM6 = () => <ProductArt material="m6" data-testid="widget-art-m6" />
const ArtM7 = () => <ProductArt material="m7" data-testid="widget-art-m7" />
const ArtM8 = () => <ProductArt material="m8" data-testid="widget-art-m8" />

const ArtAllMaterials = () => (
	<div className="grid grid-cols-4 gap-2">
		<ProductArt material="m1" data-testid="widget-art-all-m1" />
		<ProductArt material="m2" data-testid="widget-art-all-m2" />
		<ProductArt material="m3" data-testid="widget-art-all-m3" />
		<ProductArt material="m4" data-testid="widget-art-all-m4" />
		<ProductArt material="m5" data-testid="widget-art-all-m5" />
		<ProductArt material="m6" data-testid="widget-art-all-m6" />
		<ProductArt material="m7" data-testid="widget-art-all-m7" />
		<ProductArt material="m8" data-testid="widget-art-all-m8" />
	</div>
)

const ArtSquareRatio = () => <ProductArt material="m3" ratio="1/1" data-testid="widget-art-square" />

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

const ProductStripDefault = () => (
	<ProductStrip items={STRIP_ITEMS} onSelect={() => {}} />
)

const ProductStripSingleItem = () => (
	<ProductStrip items={[STRIP_ITEMS[0]]} onSelect={() => {}} />
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
	],
}
