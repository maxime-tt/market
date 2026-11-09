import { StorefrontProvider, useStorefrontContext } from '@ui/storefront/StorefrontContext'
import { StorefrontLink } from '@ui/storefront/StorefrontLink'
import { MiniMarkdown } from '@ui/storefront/MiniMarkdown'
import { StorefrontBlockView, StorefrontRenderer, type StorefrontDataSlots } from '@ui/storefront/StorefrontRenderer'
import { HeroBlock } from '@ui/storefront/blocks/HeroBlock'
import { TextBlock } from '@ui/storefront/blocks/TextBlock'
import { ImageBlock } from '@ui/storefront/blocks/ImageBlock'
import { LinkListBlock } from '@ui/storefront/blocks/LinkListBlock'
import { DividerBlock, SpacerBlock } from '@ui/storefront/blocks/SpacingBlocks'
import { ProductGridBlock } from '@ui/storefront/blocks/ProductGridBlock'
import { FeaturedProductBlock } from '@ui/storefront/blocks/FeaturedProductBlock'
import { ProfileHeaderBlock } from '@ui/storefront/blocks/ProfileHeaderBlock'
import { ThemePaletteStrip, ThemeSwatchGrid, ThemeStudio, ThemeTunePanel } from '@ui/storefront/ThemePickerField'
import { ProductCardView } from '@ui/products/product-card-view'
import type { ProductReadEvent } from '@sdk/commerce/discovery'
import { STOREFRONT_TUNE_DEFAULTS, type StorefrontBlock, type StorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { STOREFRONT_THEME_LIST } from '@sdk/config/storefront/storefrontThemes'
import { useState } from 'react'
import type { ProductCardViewEvent } from '@ui/products/product-card-view'
import type { WidgetLibrary } from '../libraries'

/**
 * Storefront blocks and renderer (CMS theme-studio port).
 *
 * The views are props-only, so every entry is a literal render. The three
 * data-bound block types (ProductGrid, FeaturedProduct, ProfileHeader) are
 * shown through the same `StorefrontDataSlots` seam the platform host uses:
 * the slot here wires literal data into the props-only view, exactly what the
 * batch-3 host will do over the read seam.
 */

/** Offline, deterministic stand-in for a relay-provided image. */
const IMAGE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='260'%3E%3Crect width='400' height='260' fill='%23525252'/%3E%3Ccircle cx='200' cy='110' r='48' fill='%23888888'/%3E%3Crect x='120' y='180' width='160' height='20' fill='%23888888'/%3E%3C/svg%3E"

const AUTHOR = 'd943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c782'

/**
 * A safe-media-src image URL that stays on the harness origin (the server
 * answers `/*` with the catalogue document, so the element degrades to the
 * shared Media fallback — deterministic, and no external host is contacted,
 * per the e2e isolation rule).
 */
const LOCAL_IMAGE = '/kiln.svg'

const productEvent: ProductReadEvent = {
	pubkey: AUTHOR,
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

const plateEvent: ProductReadEvent = {
	pubkey: AUTHOR,
	created_at: 1729500100,
	content: 'A stoneware plate, fired in the community kiln.',
	tags: [
		['d', 'stoneware-plate'],
		['title', 'Stoneware Plate'],
		['price', '800', 'SATS'],
		['image', IMAGE],
		['stock', '5'],
	],
}

/** Literal props-only card, as the batch-3 host will wire `ProductCardView`. */
function renderCard(product: ProductReadEvent) {
	return (
		<ProductCardView
			product={{ ...product, id: product.tags.find((tag) => tag[0] === 'd')?.[1] ?? '' } as ProductCardViewEvent}
			isOwnProduct={false}
			isInCart={false}
			cartQuantity={0}
			isAddingToCart={false}
			showConfirmation={false}
			onAddToCart={() => {}}
		/>
	)
}

function Editing({ children }: { children: React.ReactNode }) {
	return <StorefrontProvider value={{ pubkey: AUTHOR, isEditing: true }}>{children}</StorefrontProvider>
}

/** A page document assembled from literal blocks; the schema shape, not a parse. */
function page(...blocks: StorefrontBlock[]): StorefrontPage {
	return {
		version: 1,
		enabled: true,
		root: { props: { title: 'Satoshi’s shop', theme: 'default', palette: '', tune: STOREFRONT_TUNE_DEFAULTS } },
		content: blocks,
	}
}

const heroBlock: StorefrontBlock = {
	type: 'Hero',
	props: {
		id: 'hero',
		title: 'Handmade Goods',
		subtitle: 'Mugs, plates and smallBatch ceramics, shipped worldwide.',
		imageUrl: LOCAL_IMAGE,
		ctaLabel: 'Shop the kiln',
		ctaHref: 'https://example.com/shop',
		align: 'center',
		minHeight: 360,
	},
}

const textBlock: StorefrontBlock = {
	type: 'Text',
	props: {
		id: 'text',
		markdown:
			'# From the kiln\n\nEvery piece is **thrown by hand** and fired once. See the [schedule](https://example.com/kiln).\n\n- stoneware\n- porcelain',
		align: 'left',
		width: 'normal',
	},
}

const linkListBlock: StorefrontBlock = {
	type: 'LinkList',
	props: {
		id: 'links',
		title: 'Elsewhere',
		links: [
			{ label: 'Nostr', href: 'https://nostr.example' },
			{ label: 'Studio diary', href: '/posts' },
		],
		layout: 'row',
	},
}

const slots: StorefrontDataSlots = {
	ProductGrid: (props) => (
		<ProductGridBlock {...props} products={[productEvent, plateEvent]} isLoading={false} isError={false} renderProduct={renderCard} />
	),
	FeaturedProduct: (props) => (
		<FeaturedProductBlock {...props} products={[productEvent]} isLoading={false} isError={false} renderProduct={renderCard} />
	),
	ProfileHeader: (props) => (
		<ProfileHeaderBlock
			{...props}
			profile={{
				displayName: 'Satoshi Nakamoto',
				picture: IMAGE,
				banner: LOCAL_IMAGE,
				about: 'Building bitcoin things from a small studio.',
				nip05: 'satoshi@nakamoto.org',
				nip05State: 'verified',
			}}
			isLoading={false}
		/>
	),
}

/** The layout the picker entries start on: the registry's first declared theme. */
const STUDIO_THEME = STOREFRONT_THEME_LIST[0]

/**
 * `ThemeStudio` keeps no state of its own — the caller owns the three values —
 * so the demo holds them locally, mirroring the setup wizard's control.
 */
function ThemeStudioDemo() {
	const [value, setValue] = useState({
		theme: STUDIO_THEME.id,
		palette: STUDIO_THEME.palettes[0].key,
		tune: { ...STUDIO_THEME.tune },
	})
	return (
		<div className="max-w-md">
			<ThemeStudio {...value} onChange={setValue} />
		</div>
	)
}

export const storefront: WidgetLibrary = {
	name: 'storefront',
	entries: [
		{
			name: 'StorefrontRenderer',
			render: () => (
				<StorefrontRenderer
					pubkey={AUTHOR}
					page={page(
						heroBlock,
						textBlock,
						{ type: 'Image', props: { id: 'img', url: LOCAL_IMAGE, alt: 'Kiln shelf', width: 'normal', rounded: true, href: '' } },
						linkListBlock,
						{ type: 'Divider', props: { id: 'div' } },
						{ type: 'Spacer', props: { id: 'space', size: 'md' } },
					)}
				/>
			),
		},
		{
			name: 'StorefrontRendererWithSlots',
			render: () => (
				<StorefrontRenderer
					pubkey={AUTHOR}
					slots={slots}
					page={page(
						{
							type: 'ProfileHeader',
							props: { id: 'ph', showBanner: true, fullScreen: false, showAbout: true, showNip05: true, align: 'center' },
						},
						{
							type: 'ProductGrid',
							props: {
								id: 'pg',
								title: 'From the workshop',
								source: 'all',
								collectionDTag: '',
								limit: 12,
								columns: 3,
								emptyMessage: 'No products yet.',
							},
						},
						{ type: 'FeaturedProduct', props: { id: 'fp', productDTag: 'antminer-s21' } },
					)}
				/>
			),
		},
		{
			name: 'StorefrontLink',
			render: () => (
				<div className="flex flex-col gap-2 text-sm">
					<StorefrontLink href="https://example.com">External (noopener, new tab)</StorefrontLink>
					<StorefrontLink href="/products">Internal (same tab)</StorefrontLink>
					<StorefrontLink href="javascript:alert(1)">Unsafe (renders inert)</StorefrontLink>
				</div>
			),
		},
		{
			name: 'MiniMarkdown',
			render: () => (
				<MiniMarkdown
					source={'# Title\n\nA **bold** and *soft* [link](https://example.com) and `code`.\n\n- one\n- two\n\n> quoted wisdom'}
				/>
			),
		},
		{
			name: 'MiniMarkdownEmpty',
			// An empty source renders null — the marker keeps the zero-height state
			// visible and assertable in the catalogue.
			render: () => (
				<div>
					<p className="text-xs text-muted-foreground">Empty source renders nothing (marker below is the surrounding slot):</p>
					<div className="border border-dashed p-2">{<MiniMarkdown source="   " />}</div>
				</div>
			),
		},
		{
			name: 'HeroBlock',
			render: () => (
				<HeroBlock
					title="Handmade Goods"
					subtitle="Mugs and plates, shipped worldwide."
					imageUrl={LOCAL_IMAGE}
					ctaLabel="Shop the kiln"
					ctaHref="https://example.com/shop"
					align="center"
					minHeight={360}
				/>
			),
		},
		{
			name: 'HeroBlockNoImage',
			render: () => (
				<HeroBlock title="Plain hero" subtitle="No background image." imageUrl="" ctaLabel="" ctaHref="" align="left" minHeight={240} />
			),
		},
		{
			name: 'HeroBlockEmpty',
			render: () => (
				<Editing>
					<HeroBlock title="" subtitle="" imageUrl="" ctaLabel="" ctaHref="" align="center" minHeight={360} />
				</Editing>
			),
		},
		{
			name: 'TextBlock',
			render: () => <TextBlock markdown="## About the studio\n\nWe fire once a month." align="left" width="normal" />,
		},
		{
			name: 'TextBlockEmpty',
			render: () => (
				<Editing>
					<TextBlock markdown="" align="left" width="normal" />
				</Editing>
			),
		},
		{
			name: 'ImageBlock',
			render: () => <ImageBlock url={LOCAL_IMAGE} alt="Kiln shelf" width="normal" rounded href="" />,
		},
		{
			name: 'ImageBlockInvalid',
			render: () => (
				<Editing>
					<ImageBlock url="ftp://not-allowed" alt="" width="normal" rounded href="" />
				</Editing>
			),
		},
		{
			name: 'LinkListBlock',
			render: () => (
				<LinkListBlock
					title="Elsewhere"
					links={[
						{ label: 'Nostr', href: 'https://nostr.example' },
						{ label: 'Studio diary', href: '/posts' },
					]}
					layout="row"
				/>
			),
		},
		{
			name: 'LinkListBlockColumn',
			render: () => <LinkListBlock title="Elsewhere" links={[{ label: 'Nostr', href: 'https://nostr.example' }]} layout="column" />,
		},
		{
			name: 'LinkListBlockEmpty',
			render: () => (
				<Editing>
					<LinkListBlock title="Elsewhere" links={[]} layout="row" />
				</Editing>
			),
		},
		{
			name: 'SpacerDividerBlocks',
			render: () => (
				<div className="border border-dashed p-4">
					<DividerBlock />
					<SpacerBlock size="md" />
				</div>
			),
		},
		{
			name: 'ProductGridBlockFilled',
			render: () => (
				<ProductGridBlock
					title="From the workshop"
					source="all"
					collectionDTag=""
					limit={12}
					columns={2}
					emptyMessage="No products yet."
					products={[productEvent, plateEvent]}
					isLoading={false}
					isError={false}
					renderProduct={renderCard}
				/>
			),
		},
		{
			name: 'ProductGridBlockLoading',
			render: () => (
				<ProductGridBlock
					title="From the workshop"
					source="all"
					collectionDTag=""
					limit={12}
					columns={2}
					emptyMessage="No products yet."
					products={null}
					isLoading
					isError={false}
					renderProduct={renderCard}
				/>
			),
		},
		{
			name: 'ProductGridBlockError',
			render: () => (
				<ProductGridBlock
					title="From the workshop"
					source="all"
					collectionDTag=""
					limit={12}
					columns={2}
					emptyMessage="No products yet."
					products={null}
					isLoading={false}
					isError
					renderProduct={renderCard}
				/>
			),
		},
		{
			name: 'ProductGridBlockEmpty',
			render: () => (
				<ProductGridBlock
					title="From the workshop"
					source="all"
					collectionDTag=""
					limit={12}
					columns={2}
					emptyMessage="Nothing listed here yet."
					products={[]}
					isLoading={false}
					isError={false}
					renderProduct={renderCard}
				/>
			),
		},
		{
			name: 'FeaturedProductBlockFilled',
			render: () => (
				<FeaturedProductBlock
					productDTag="antminer-s21"
					products={[productEvent]}
					isLoading={false}
					isError={false}
					renderProduct={renderCard}
				/>
			),
		},
		{
			name: 'FeaturedProductBlockLoading',
			render: () => (
				<FeaturedProductBlock productDTag="antminer-s21" products={null} isLoading isError={false} renderProduct={renderCard} />
			),
		},
		{
			name: 'FeaturedProductBlockMissing',
			render: () => (
				<Editing>
					<FeaturedProductBlock productDTag="gone" products={[]} isLoading={false} isError={false} renderProduct={renderCard} />
				</Editing>
			),
		},
		{
			name: 'ProfileHeaderBlock',
			render: () => (
				<StorefrontProvider value={{ pubkey: AUTHOR, isEditing: false }}>
					<ProfileHeaderBlock
						showBanner
						fullScreen={false}
						showAbout
						showNip05
						align="center"
						profile={{
							displayName: 'Satoshi Nakamoto',
							picture: IMAGE,
							about: 'Building bitcoin things from a small studio.',
							nip05: 'satoshi@nakamoto.org',
							nip05State: 'verified',
						}}
						isLoading={false}
					/>
				</StorefrontProvider>
			),
		},
		{
			name: 'ProfileHeaderBlockBanner',
			render: () => (
				<StorefrontProvider value={{ pubkey: AUTHOR, isEditing: false }}>
					<ProfileHeaderBlock
						showBanner
						fullScreen={false}
						showAbout
						showNip05
						align="center"
						profile={{
							displayName: 'Satoshi Nakamoto',
							picture: IMAGE,
							banner: LOCAL_IMAGE,
							about: 'Building bitcoin things from a small studio.',
							nip05: '_@nakamoto.org',
							nip05State: 'invalid',
						}}
						isLoading={false}
					/>
				</StorefrontProvider>
			),
		},
		{
			name: 'ProfileHeaderBlockLoading',
			render: () => (
				<StorefrontProvider value={{ pubkey: AUTHOR, isEditing: false }}>
					<ProfileHeaderBlock showBanner fullScreen={false} showAbout showNip05 align="center" profile={null} isLoading />
				</StorefrontProvider>
			),
		},
		{
			name: 'StorefrontBlockViewCanvas',
			render: () => {
				// Renders one block through the same switch the builder canvas uses.
				function CanvasDemo() {
					const { isEditing } = useStorefrontContext()
					return (
						<div>
							<p className="mb-2 text-xs text-muted-foreground">isEditing: {String(isEditing)}</p>
							<StorefrontBlockView block={linkListBlock} />
						</div>
					)
				}
				return (
					<Editing>
						<CanvasDemo />
					</Editing>
				)
			},
		},
		{
			name: 'ThemeSwatchGrid',
			render: () => (
				<div className="max-w-md">
					<ThemeSwatchGrid value={STUDIO_THEME.id} onChange={() => {}} />
				</div>
			),
		},
		{
			name: 'ThemePaletteStrip',
			render: () => (
				<div className="max-w-md">
					<ThemePaletteStrip themeId={STUDIO_THEME.id} value={STUDIO_THEME.palettes[0].key} onChange={() => {}} />
				</div>
			),
		},
		{
			name: 'ThemeTunePanel',
			render: () => (
				<div className="max-w-md">
					<ThemeTunePanel themeId={STUDIO_THEME.id} onChange={() => {}} />
				</div>
			),
		},
		{
			name: 'ThemeStudio',
			render: () => <ThemeStudioDemo />,
		},
	],
}
