import { getStorefrontPalette, getStorefrontTheme, storefrontThemeCssVars } from '@sdk/config/storefront/storefrontThemes'
import { cn } from '@ui/utils/cn'
import type { StorefrontBlock, StorefrontPage, StorefrontRootProps } from '@sdk/commerce/storefront/storefrontPage'
import type { ReactNode } from 'react'
import { StorefrontProvider, useStorefrontContext } from './StorefrontContext'

// The tune variables this wrapper sets are consumed here and nowhere else.
import './storefront-theme.css'
import { FeaturedProductBlock, type FeaturedProductBlockProps } from './blocks/FeaturedProductBlock'
import { HeroBlock } from './blocks/HeroBlock'
import { ImageBlock } from './blocks/ImageBlock'
import { LinkListBlock } from './blocks/LinkListBlock'
import { ProductGridBlock, type ProductGridBlockProps } from './blocks/ProductGridBlock'
import { ProductRowBlock, type ProductRowBlockProps } from './blocks/ProductRowBlock'
import { SearchBlock, type SearchBlockProps } from './blocks/SearchBlock'
import { CategoriesBlock, type CategoriesBlockProps } from './blocks/CategoriesBlock'
import { ProfileHeaderBlock, type ProfileHeaderBlockProps } from './blocks/ProfileHeaderBlock'
import { TextBlock } from './blocks/TextBlock'
import { DividerBlock, SpacerBlock } from './blocks/SpacingBlocks'

/**
 * Turns a validated page document into elements.
 *
 * This is the only place a block type becomes a component, and the switch is
 * exhaustive over the schema's discriminated union — adding a block type
 * without a case here is a TypeScript error, not a blank space on somebody's
 * storefront.
 *
 * The same renderer draws the published page and the builder canvas. That is
 * deliberate: an editor with its own preview implementation drifts from
 * production, and the author discovers the difference after publishing.
 */

/**
 * The data-slot seam.
 *
 * Three block types are data-bound: `ProductGrid` and `FeaturedProduct` need
 * the author's listings, `ProfileHeader` needs the author's kind-0 profile.
 * `ui/` is props-only (ui/AGENTS.md hard boundary — no queries, no relay I/O),
 * so the renderer does NOT resolve them. Instead the caller supplies a slot
 * per data-bound block type: a render function that receives the block's
 * document-facing props and returns the element, having resolved the data
 * itself (batch 3's `platform/web/storefront/**` host). Everything the
 * document stores — and nothing it does not — reaches the slot.
 *
 * Every other block renders directly from the page document. A slot left
 * unfilled falls back to the props-only view in its "no data yet" state, so a
 * host that forgets one degrades visibly instead of throwing.
 */
export interface StorefrontDataSlots {
	ProductGrid?: (props: ProductGridBlockProps) => ReactNode
	FeaturedProduct?: (props: FeaturedProductBlockProps) => ReactNode
	ProfileHeader?: (props: ProfileHeaderBlockProps) => ReactNode
	ProductRow?: (props: ProductRowBlockProps) => ReactNode
	Search?: (props: SearchBlockProps) => ReactNode
	Categories?: (props: CategoriesBlockProps) => ReactNode
}

/**
 * Root-level page styling. Exported so every surface that renders a page —
 * the published page, the builder canvas, and the setup wizard's template/theme
 * previews — wraps its children in the identical element. Without this, a
 * theme the author picks would look different in each place, which is
 * exactly the preview drift this design exists to prevent.
 *
 * The theme is applied as CSS custom properties on this wrapper (ADR-0006
 * §"Theme Integration"), not as a Tailwind class switch: every block already
 * styles itself with token classes (`bg-card`, `text-primary`, …), so
 * overriding the token *values* here is enough — no block needs to know a
 * theme exists.
 */
export function StorefrontRoot({
	props,
	children,
	className,
	/** False for compact previews (wizard cards) that must not claim the viewport height they're scaled inside. */
	fullHeight = true,
}: {
	props: StorefrontRootProps
	children: ReactNode
	className?: string
	fullHeight?: boolean
}) {
	const { isEditing } = useStorefrontContext()
	const theme = getStorefrontTheme(props.theme)
	const palette = getStorefrontPalette(theme, props.palette)
	return (
		<div
			// Only the live page carries the marker. The editor canvas and wizard
			// previews render the same element, and a test asserting "the visitor
			// sees a storefront" must not be satisfied by either of those.
			data-testid={isEditing ? undefined : 'storefront-page'}
			data-storefront-theme={theme.id}
			data-storefront-palette={palette.key}
			className={cn('w-full bg-background text-foreground', fullHeight && 'min-h-screen', className)}
			style={storefrontThemeCssVars(theme, props.palette, props.tune)}
		>
			{children}
		</div>
	)
}

export function StorefrontBlockView({ block, slots }: { block: StorefrontBlock; slots?: StorefrontDataSlots }) {
	switch (block.type) {
		case 'ProfileHeader':
			return slots?.ProfileHeader ? (
				slots.ProfileHeader(block.props)
			) : (
				<ProfileHeaderBlock {...block.props} profile={null} isLoading={false} />
			)
		case 'Hero':
			return <HeroBlock {...block.props} />
		case 'Text':
			return <TextBlock {...block.props} />
		case 'ProductGrid':
			return slots?.ProductGrid ? (
				slots.ProductGrid(block.props)
			) : (
				<ProductGridBlock {...block.props} products={null} isLoading={false} isError={false} renderProduct={() => null} />
			)
		case 'FeaturedProduct':
			return slots?.FeaturedProduct ? (
				slots.FeaturedProduct(block.props)
			) : (
				<FeaturedProductBlock {...block.props} products={null} isLoading={false} isError={false} renderProduct={() => null} />
			)
		case 'LinkList':
			return <LinkListBlock {...block.props} />
		case 'Image':
			return <ImageBlock {...block.props} />
		case 'Divider':
			return <DividerBlock />
		case 'Spacer':
			return <SpacerBlock {...block.props} />
		case 'ProductRow':
			return slots?.ProductRow ? (
				slots.ProductRow(block.props)
			) : (
				<ProductRowBlock {...block.props} products={null} isLoading={false} isError={false} renderProduct={() => null} />
			)
		case 'Search':
			return slots?.Search ? (
				slots.Search(block.props)
			) : (
				<SearchBlock {...block.props} query="" onChange={() => {}} onGo={() => {}} />
			)
		case 'Categories':
			return slots?.Categories ? (
				slots.Categories(block.props)
			) : (
				<CategoriesBlock {...block.props} categoryToPath={(key: string) => `/?q=${encodeURIComponent(key)}`} />
			)
		default: {
			// Unreachable while the switch matches the union. The assignment
			// makes that a compile-time guarantee; the `null` keeps a page that
			// somehow reached here rendering its other blocks at runtime.
			const exhaustive: never = block
			void exhaustive
			return null
		}
	}
}

export interface StorefrontRendererProps {
	page: StorefrontPage
	/** The page author. Data-bound slots resolve their reads against this pubkey. */
	pubkey: string
	className?: string
	/** Data-bound block renderers supplied by the host; see `StorefrontDataSlots`. */
	slots?: StorefrontDataSlots
}

export function StorefrontRenderer({ page, pubkey, className, slots }: StorefrontRendererProps) {
	return (
		<StorefrontProvider value={{ pubkey, isEditing: false }}>
			<StorefrontRoot props={page.root.props} className={className}>
				{page.content.map((block) => (
					<StorefrontBlockView key={block.props.id} block={block} slots={slots} />
				))}
			</StorefrontRoot>
		</StorefrontProvider>
	)
}
