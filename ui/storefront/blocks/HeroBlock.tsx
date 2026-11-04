import { Button } from '@ui/primitives/button'
import { isSafeMediaSrc } from '@sdk/commerce/storefront/storefrontPage'
import { cn } from '@ui/utils/cn'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, alignClass, type StorefrontAlign } from './shared'
import { StorefrontLink } from '../StorefrontLink'

export interface HeroBlockProps {
	title: string
	subtitle: string
	imageUrl: string
	ctaLabel: string
	ctaHref: string
	align: StorefrontAlign
	minHeight: number
}

/**
 * Full-width banner with an optional background image and call to action.
 *
 * The background is applied as a CSS `background-image` on a URL the schema has
 * already gated to `https:` or an in-app path, and re-gated here. A
 * `background-image` is the one place a bad URL would be the most tempting to
 * wave through, since it cannot execute script on its own — but it can still
 * beacon the visitor's IP to an arbitrary host, which is exactly what a
 * marketplace visitor did not consent to.
 *
 * Colour mapping at port (token contract, ui/AGENTS.md § Tokens): the fork's
 * white text utilities over the photograph become `text-on-media` and
 * `text-on-media/85` — the scheme-stable ink for text on imagery. The two
 * surface utilities that remain below are recorded missing roles: the
 * letterbox must not invert with the theme (`parked-scheme-black`), and no
 * scrim role has been ruled (`parked-scrim`).
 */
export function HeroBlock({ title, subtitle, imageUrl, ctaLabel, ctaHref, align, minHeight }: HeroBlockProps) {
	const { isEditing } = useStorefrontContext()
	const image = isSafeMediaSrc(imageUrl) && imageUrl.length > 0 ? imageUrl : null
	const hasCta = ctaLabel.trim().length > 0 && ctaHref.trim().length > 0
	const isEmpty = title.trim().length === 0 && subtitle.trim().length === 0 && !image && !hasCta

	if (isEmpty) {
		return isEditing ? (
			<StorefrontSection className="py-4">
				<StorefrontEditorHint>Give this hero a title, a background image, or a button.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	return (
		<div
			data-testid="storefront-hero"
			className={cn('relative flex w-full items-center overflow-hidden', image ? 'bg-black text-on-media' : 'bg-muted text-foreground')}
			style={{
				minHeight: `${minHeight}px`,
				backgroundImage: image ? `url("${encodeURI(image)}")` : undefined,
				backgroundSize: 'cover',
				backgroundPosition: 'center',
			}}
		>
			// Letterbox below is scheme-stable (parked-scheme-black); the scrim // keeps text legible over an arbitrary photograph without asking
			// the author to think about contrast (parked-scrim).
			{image && <div className="absolute inset-0 bg-black/45" aria-hidden />}
			<StorefrontSection className={cn('relative flex flex-col gap-4 py-16', alignClass[align])}>
				{title.trim().length > 0 && <h1 className="font-header text-4xl font-bold sm:text-5xl">{title}</h1>}
				{subtitle.trim().length > 0 && (
					<p className={cn('max-w-2xl text-lg', image ? 'text-on-media/85' : 'text-muted-foreground')}>{subtitle}</p>
				)}
				{hasCta && (
					<StorefrontLink href={ctaHref}>
						<Button size="lg" className="mt-2">
							{ctaLabel}
						</Button>
					</StorefrontLink>
				)}
			</StorefrontSection>
		</div>
	)
}
