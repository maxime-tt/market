import { useState, type ReactNode } from 'react'

import {
	AdultContentGate,
	ProductLoadErrorState,
	ProductLoadingState,
	ProductNotFoundState,
	ProductPurchasePanel,
} from '@ui/products/product-page-views'
import { ProductCardView } from '@ui/products/product-card-view'
import { ProductDisplayView } from '@ui/products/product-display-view'
import { ProductFilters, defaultProductFilters } from '@ui/products/product-filters'
import { ProductSearchResults } from '@ui/products/product-search-results'
import { ProductSelectionList } from '@ui/products/product-selection-list'
import { CollectionCardView } from '@ui/products/collection-card-view'
import { CollectionDisplayView } from '@ui/products/collection-display-view'
import { CollectionWelcomeScreen } from '@ui/products/collection-welcome-screen'
import {
	ProductCategoryView,
	ProductImagesView,
	ProductPricingView,
	ProductShippingView,
	ProductSpecsView,
} from '@ui/products/product-editor-tabs'
import type { ProductFilterState } from '@ui/products/product-filters'
import type { ProductSelectionItem } from '@ui/products/product-selection-list'
import type { ProductStatus } from '@ui/products/product-editor-tabs'
import type { WidgetLibrary } from '../libraries'

/**
 * Products and collections views drained into ui/products.
 *
 * Registered in `../libraries.ts` and filled in by the T6.2 widget-book pass.
 * One entry per component, plus an extra entry per state worth reviewing
 * (variants, empty, error, loading, disabled). The library may only import
 * `ui/` and `sdk/`, so routing links are plain anchors and images are plain
 * `<img>` elements here.
 */

/** Offline, deterministic stand-in for a relay-provided product image. */
const IMAGE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23525252'/%3E%3Ccircle cx='100' cy='80' r='36' fill='%23888888'/%3E%3Crect x='60' y='128' width='80' height='14' fill='%23888888'/%3E%3C/svg%3E"

const SELLER_PUBKEY = 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782'

/** Smallest product event the discovery read model can render. */
const productEvent = {
	id: 'antminer-s21',
	pubkey: SELLER_PUBKEY,
	created_at: 1729500000,
	content: 'A quiet, efficient home miner in original packaging.',
	tags: [
		['d', 'antminer-s21'],
		['title', 'Antminer S21'],
		['price', '2100', 'SATS'],
		['image', IMAGE],
		['stock', '12'],
	],
}

/** Smallest collection event the collections read model can render. */
const collectionEvent = {
	pubkey: SELLER_PUBKEY,
	tags: [
		['d', 'autumn-drops'],
		['title', 'Autumn Drops'],
		['summary', 'Fresh hardware for the heating season.'],
		['image', IMAGE],
	],
}

/** Host-replaceable link, as a plain anchor — never a router link. */
function renderLink(children: ReactNode, collectionId: string, className?: string) {
	return (
		<a href={`/collection/${collectionId}`} className={className}>
			{children}
		</a>
	)
}

/** Host-replaceable image, as a plain `<img>`. */
function renderImage(imageUrl: string, title: string) {
	return <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
}

function renderSeller() {
	return <span className="text-xs font-medium">satoshi</span>
}

/** `ProductFilters` holds nothing itself, so the demo owns the filter state. */
function FiltersDemo() {
	const [filters, setFilters] = useState<ProductFilterState>(defaultProductFilters)
	return <ProductFilters filters={filters} onFiltersChange={setFilters} />
}

function PricingDemo() {
	const [currency, setCurrency] = useState('USD')
	const [fiatDisplayValue, setFiatDisplayValue] = useState('25.00')
	const [bitcoinUnit, setBitcoinUnit] = useState<'SATS' | 'BTC'>('SATS')
	const [bitcoinDisplayValue, setBitcoinDisplayValue] = useState('25000')
	const [currencyMode, setCurrencyMode] = useState<'sats' | 'fiat'>('fiat')
	const [quantity, setQuantity] = useState('100')
	const [status, setStatus] = useState<ProductStatus>('on-sale')
	const [isNSFW, setIsNSFW] = useState(false)

	return (
		<ProductPricingView
			currencies={['USD', 'EUR', 'SATS']}
			currency={currency}
			onCurrencyChange={setCurrency}
			fiatDisplayValue={fiatDisplayValue}
			onFiatPriceChange={setFiatDisplayValue}
			bitcoinUnit={bitcoinUnit}
			bitcoinDisplayValue={bitcoinDisplayValue}
			onBitcoinPriceChange={setBitcoinDisplayValue}
			onToggleBitcoinUnit={() => setBitcoinUnit((unit) => (unit === 'SATS' ? 'BTC' : 'SATS'))}
			currencyMode={currencyMode}
			onCurrencyModeChange={setCurrencyMode}
			quantity={quantity}
			onQuantityChange={setQuantity}
			status={status}
			onStatusChange={setStatus}
			isNSFW={isNSFW}
			onNSFWChange={setIsNSFW}
		/>
	)
}

function CategoryDemo() {
	const [mainCategory, setMainCategory] = useState('Electronics')
	const [subCategories, setSubCategories] = useState([
		{ key: 'sub-0', name: 'Bitcoin Miners' },
		{ key: 'sub-1', name: 'Accessories' },
	])

	return (
		<div className="max-w-md">
			<ProductCategoryView
				mainCategories={['Electronics', 'Home & Garden']}
				mainCategory={mainCategory}
				onMainCategoryChange={setMainCategory}
				subCategories={subCategories}
				onSubCategoryNameChange={(index, name) =>
					setSubCategories((current) => current.map((category, i) => (i === index ? { ...category, name } : category)))
				}
				onRemoveSubCategory={(index) => setSubCategories((current) => current.filter((_, i) => i !== index))}
				onAddSubCategory={() => setSubCategories((current) => [...current, { key: `sub-${current.length}`, name: '' }])}
			/>
		</div>
	)
}

function SpecsDemo() {
	const [specs, setSpecs] = useState([
		{ key: 'Material', value: 'Aluminium' },
		{ key: 'Weight', value: '2kg' },
	])

	return (
		<div className="max-w-lg">
			<ProductSpecsView
				specs={specs}
				onSpecChange={(index, field, value) =>
					setSpecs((current) => current.map((spec, i) => (i === index ? { ...spec, [field]: value } : spec)))
				}
				onAddSpec={() => setSpecs((current) => [...current, { key: '', value: '' }])}
				onRemoveSpec={(index) => setSpecs((current) => current.filter((_, i) => i !== index))}
			/>
		</div>
	)
}

const selectionItems: readonly ProductSelectionItem[] = [
	{ id: 'antminer-s21', title: 'Antminer S21', coordinates: `30402:${SELLER_PUBKEY}:antminer-s21`, imageUrl: IMAGE },
	{ id: 'bitaxe-gamma', title: 'Bitaxe Gamma', coordinates: `30402:${SELLER_PUBKEY}:bitaxe-gamma` },
]

export const products: WidgetLibrary = {
	name: 'products',
	entries: [
		{
			name: 'ProductCardView',
			render: () => (
				<div className="w-72">
					<ProductCardView
						product={productEvent}
						isOwnProduct={false}
						isInCart={false}
						cartQuantity={0}
						isAddingToCart={false}
						showConfirmation={false}
						onAddToCart={() => {}}
						renderImage={renderImage}
					/>
				</div>
			),
		},
		{
			name: 'ProductCardViewInCart',
			render: () => (
				<div className="w-72">
					<ProductCardView
						product={productEvent}
						isOwnProduct={false}
						isInCart
						cartQuantity={2}
						isAddingToCart={false}
						showConfirmation={false}
						onAddToCart={() => {}}
						renderImage={renderImage}
						renderSecondaryAction={
							<button type="button" className="rounded-lg border px-3 text-sm">
								Buy now
							</button>
						}
					/>
				</div>
			),
		},
		{
			name: 'ProductDisplayView',
			render: () => (
				<div className="w-[28rem]">
					<ProductDisplayView
						product={productEvent}
						productId="antminer-s21"
						index={0}
						isLoading={false}
						onMoveUp={() => {}}
						onMoveDown={() => {}}
						canMoveUp={false}
						canMoveDown
						onRemove={() => {}}
						isRemoving={false}
						renderImage={renderImage}
					/>
				</div>
			),
		},
		{
			name: 'ProductDisplayViewLoading',
			render: () => (
				<div className="w-[28rem]">
					<ProductDisplayView product={null} productId="" index={1} isLoading onRemove={() => {}} isRemoving={false} />
				</div>
			),
		},
		{
			name: 'ProductFilters',
			render: () => <FiltersDemo />,
		},
		{
			name: 'ProductSearchResults',
			render: () => (
				<div className="w-96">
					<ProductSearchResults
						products={[productEvent]}
						isLoading={false}
						onSelect={() => {}}
						onShowAll={() => {}}
						renderImage={renderImage}
						renderSeller={renderSeller}
					/>
				</div>
			),
		},
		{
			name: 'ProductSearchResultsEmpty',
			render: () => (
				<div className="w-96">
					<ProductSearchResults products={[]} isLoading={false} onSelect={() => {}} onShowAll={() => {}} />
				</div>
			),
		},
		{
			name: 'ProductSelectionList',
			render: () => (
				<div className="w-96">
					<ProductSelectionList
						items={selectionItems}
						selectedCoordinates={[selectionItems[0].coordinates]}
						isLoading={false}
						onToggle={() => {}}
						renderImage={renderImage}
					/>
				</div>
			),
		},
		{
			name: 'ProductSelectionListEmpty',
			render: () => (
				<div className="w-96">
					<ProductSelectionList items={[]} selectedCoordinates={[]} isLoading={false} onToggle={() => {}} />
				</div>
			),
		},
		{
			name: 'CollectionCardView',
			render: () => (
				<div className="w-72">
					<CollectionCardView
						collection={collectionEvent}
						renderLink={renderLink}
						renderImage={renderImage}
						renderSeller={renderSeller()}
					/>
				</div>
			),
		},
		{
			name: 'CollectionDisplayView',
			render: () => (
				<div className="w-[28rem]">
					<CollectionDisplayView
						collection={collectionEvent}
						collectionId="autumn-drops"
						index={0}
						isLoading={false}
						onMoveUp={() => {}}
						onMoveDown={() => {}}
						canMoveUp={false}
						canMoveDown
						onRemove={() => {}}
						isRemoving={false}
						renderImage={renderImage}
					/>
				</div>
			),
		},
		{
			name: 'CollectionWelcomeScreen',
			render: () => (
				<div className="h-96 w-80 rounded-lg border p-4">
					<CollectionWelcomeScreen onGetStarted={() => {}} />
				</div>
			),
		},
		{
			name: 'ProductCategoryView',
			render: () => <CategoryDemo />,
		},
		{
			name: 'ProductImagesView',
			render: () => (
				<div className="w-96">
					<ProductImagesView hasImages={false}>
						<div className="flex h-32 items-center justify-center rounded-lg border-2 border-dashed text-sm text-text-mid">
							Drop images here
						</div>
					</ProductImagesView>
				</div>
			),
		},
		{
			name: 'ProductPricingView',
			render: () => <PricingDemo />,
		},
		{
			name: 'ProductShippingView',
			render: () => (
				<div className="w-[32rem]">
					<ProductShippingView
						selected={[
							{
								shippingRef: 'ship-01',
								extraCost: '5.00',
								option: { id: 'ship-01', name: 'Worldwide Tracked', cost: 20000, currency: 'SATS', service: 'express' },
							},
						]}
						available={[{ id: 'ship-02', name: 'Digital Delivery', cost: 0, currency: 'SATS', service: 'digital' }]}
						hasValidShipping
						isLoading={false}
						isFetched
						onExtraCostChange={() => {}}
						onRemove={() => {}}
						onAdd={() => {}}
						templates={[]}
						onQuickCreate={() => {}}
						isCreating={false}
						showPickupForm={false}
						pickupAddress={{ street: '', city: '', state: '', postalCode: '', country: '' }}
						onPickupAddressChange={() => {}}
						onPickupCancel={() => {}}
						onPickupSubmit={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'ProductShippingViewTemplates',
			render: () => (
				<div className="w-[32rem]">
					<ProductShippingView
						selected={[]}
						available={[]}
						hasValidShipping={false}
						isLoading={false}
						isFetched
						onExtraCostChange={() => {}}
						onRemove={() => {}}
						onAdd={() => {}}
						templates={[
							{ name: 'Digital delivery', description: 'No physical shipment', icon: 'digital' },
							{ name: 'Worldwide shipping', description: 'Flat-rate tracked shipping', icon: 'worldwide' },
							{ name: 'Local pickup', description: 'Customers collect in person', icon: 'pickup' },
						]}
						onQuickCreate={() => {}}
						isCreating={false}
						showPickupForm={false}
						pickupAddress={{ street: '', city: '', state: '', postalCode: '', country: '' }}
						onPickupAddressChange={() => {}}
						onPickupCancel={() => {}}
						onPickupSubmit={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'ProductSpecsView',
			render: () => <SpecsDemo />,
		},
		{
			name: 'AdultContentGate',
			render: () => <AdultContentGate onEnable={() => {}} />,
		},
		{
			name: 'ProductLoadErrorState',
			render: () => <ProductLoadErrorState message="The relays are quiet. Check your connection and try again." onRetry={() => {}} />,
		},
		{
			name: 'ProductLoadingState',
			render: () => <ProductLoadingState />,
		},
		{
			name: 'ProductNotFoundState',
			render: () => <ProductNotFoundState />,
		},
		{
			name: 'ProductPurchasePanel',
			render: () => (
				<div className="w-80 space-y-3">
					<ProductPurchasePanel
						visibility="on-sale"
						stock={12}
						productType={{ product: 'simple', delivery: 'digital' }}
						quantity={1}
						onQuantityChange={() => {}}
						isOutOfStock={false}
						canAddToCart
						canEdit
						onAddToCart={() => {}}
						onEdit={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'ProductPurchasePanelPreorder',
			render: () => (
				<div className="w-80 space-y-3">
					<ProductPurchasePanel
						visibility="pre-order"
						stock={undefined}
						productType={null}
						quantity={1}
						onQuantityChange={() => {}}
						isOutOfStock={false}
						canAddToCart
						canEdit={false}
						onAddToCart={() => {}}
						onEdit={() => {}}
					/>
				</div>
			),
		},
	],
}
