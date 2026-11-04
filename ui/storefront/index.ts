/**
 * Storefront blocks and renderer, ported from the CMS theme-studio branch as
 * props-only views. No data hooks, no routing, no raw palette — data-bound
 * block types reach their data through `StorefrontDataSlots`, supplied by the
 * platform host.
 */
export { StorefrontProvider, useStorefrontContext, type StorefrontContextValue } from './StorefrontContext'
export { StorefrontLink } from './StorefrontLink'
export { MiniMarkdown } from './MiniMarkdown'
export {
	StorefrontRoot,
	StorefrontBlockView,
	StorefrontRenderer,
	type StorefrontDataSlots,
	type StorefrontRendererProps,
} from './StorefrontRenderer'
export { HeroBlock, type HeroBlockProps } from './blocks/HeroBlock'
export { TextBlock, type TextBlockProps } from './blocks/TextBlock'
export { ImageBlock, type ImageBlockProps } from './blocks/ImageBlock'
export { LinkListBlock, type LinkListBlockProps } from './blocks/LinkListBlock'
export { DividerBlock, SpacerBlock, type SpacerBlockProps } from './blocks/SpacingBlocks'
export { ProductGridBlock, type ProductGridBlockProps, type ProductGridBlockViewProps } from './blocks/ProductGridBlock'
export { FeaturedProductBlock, type FeaturedProductBlockProps, type FeaturedProductBlockViewProps } from './blocks/FeaturedProductBlock'
export {
	ProfileHeaderBlock,
	type ProfileHeaderBlockProps,
	type ProfileHeaderBlockViewProps,
	type StorefrontProfileData,
} from './blocks/ProfileHeaderBlock'
export {
	StorefrontSection,
	StorefrontEditorHint,
	StorefrontSectionTitle,
	alignClass,
	widthClass,
	type StorefrontAlign,
	type StorefrontWidth,
} from './blocks/shared'
