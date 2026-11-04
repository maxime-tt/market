/**
 * widget-book/libraries/browse.tsx — Browse foundation widget library (Batch 1).
 *
 * One entry per state of every new ui/ view.
 * Batch 1: browse-nav, search-field, art module.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { BrowseNav } from '@ui/browse/browse-nav'
import { SearchField } from '@ui/browse/search-field'
import { ProductArt, ProductSprite } from '@ui/browse/art'
import type { WidgetLibrary } from '../libraries'

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

// ---- Library ----

export const browse: WidgetLibrary = {
	name: 'browse',
	entries: [
		{ name: 'browse-nav-default', render: BrowseNavDefault },
		{ name: 'browse-nav-inactive', render: BrowseNavInactive },
		{ name: 'browse-nav-with-slots', render: BrowseNavWithSlots },
		{ name: 'search-field-empty', render: SearchFieldEmpty },
		{ name: 'search-field-with-value', render: SearchFieldWithValue },
		{ name: 'search-field-focused', render: SearchFieldFocused },
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
	],
}
