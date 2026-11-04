import { getNormalizedProfileDisplayName, type ProfileDisplayFields } from '@sdk/core/profile'
import { isSafeMediaSrc } from '@sdk/commerce/storefront/storefrontPage'
import { ProfileAvatarView } from '@ui/nostr/identity'
import { Media } from '@ui/shared/media'
import { cn } from '@ui/utils/cn'
import { BadgeAlert, BadgeCheck, Loader2 } from 'lucide-react'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection, alignClass, type StorefrontAlign } from './shared'

/**
 * The slice of the author's kind-0 identity the header renders, plus the
 * host-resolved NIP-05 verification state. The host reads the profile event
 * and the verification query; the view only renders it.
 */
export interface StorefrontProfileData {
	displayName?: string | null
	name?: string | null
	picture?: string | null
	banner?: string | null
	about?: string | null
	nip05?: string | null
	/** Host-resolved verification; `null`/absent renders the checking state. */
	nip05State?: 'loading' | 'verified' | 'invalid' | null
}

/** The document-facing configuration of the block (what the page event stores). */
export interface ProfileHeaderBlockProps {
	showBanner: boolean
	fullScreen: boolean
	showAbout: boolean
	showNip05: boolean
	align: StorefrontAlign
}

/** The props-only view contract: the block plus the author profile. */
export interface ProfileHeaderBlockViewProps extends ProfileHeaderBlockProps {
	profile: StorefrontProfileData | null
	isLoading: boolean
}

/**
 * The fork's `Nip05Badge` fetched the profile and the verification query
 * itself; neither has an exact props-only base equivalent with the badge
 * styling, so this small view renders a host-resolved state instead of
 * acquiring one. The elision helper is shared with `VerifiedBadge`
 * (`@ui/nostr/verified-badge`) so host and view agree on one implementation.
 */
function StorefrontNip05Badge({
	nip05,
	state,
	className,
}: {
	nip05: string
	state: NonNullable<StorefrontProfileData['nip05State']>
	className?: string
}) {
	const label = state === 'verified' ? 'NIP-05 verified' : state === 'invalid' ? 'NIP-05 not verified' : 'Checking NIP-05 verification'

	return (
		<div data-testid="storefront-nip05-badge" className={cn('flex items-end gap-1', className)} title={label}>
			{state === 'loading' ? (
				<Loader2 aria-hidden className="size-4 animate-spin" />
			) : (
				<span role="img" aria-label={label} className="inline-flex">
					{state === 'verified' ? (
						<BadgeCheck aria-hidden className="size-6 fill-fill-accent text-fill-accent" />
					) : (
						<BadgeAlert aria-hidden className="size-6 fill-error text-fill-accent" />
					)}
				</span>
			)}
			<span className="text-sm">{nip05.startsWith('_@') ? nip05.slice(2) : nip05}</span>
		</div>
	)
}

/**
 * The author's kind 0 identity, rendered as a page header.
 *
 * Nothing here is copied into the page document — name, picture, banner and
 * about are read from the profile the host passes in at render time. That is
 * the repo rule about preferring pubkeys over display text applied to layout:
 * the author updates their profile once and every page they have published
 * follows, and a stale page can never misrepresent who they are now.
 *
 * Colour mapping at port (token contract, ui/AGENTS.md § Tokens): the fork's
 * white text utilities over the banner become `text-on-media` and
 * `text-on-media/85`, and the avatar hairline/ring become the scheme-stable
 * `border-on-media` / `ring-on-media/10`. The banner scrim below stays raw —
 * a scrim over media has no ruled role (`parked-scrim` in the registry).
 */
export function ProfileHeaderBlock({
	showBanner,
	fullScreen,
	showAbout,
	showNip05,
	align,
	profile,
	isLoading,
}: ProfileHeaderBlockViewProps) {
	const { pubkey, isEditing } = useStorefrontContext()

	if (!pubkey) {
		return isEditing ? (
			<StorefrontSection>
				<StorefrontEditorHint>Your profile appears here once the page is opened by an author.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	const displayName = getNormalizedProfileDisplayName(profile as ProfileDisplayFields | null)
	const about = typeof profile?.about === 'string' ? profile.about.trim() : ''
	const banner = typeof profile?.banner === 'string' && isSafeMediaSrc(profile.banner) ? profile.banner : null
	const hasBanner = showBanner && !!banner

	return (
		<div
			data-testid="storefront-profile-header"
			data-full-screen={fullScreen}
			className={cn(
				'relative isolate flex min-h-[24rem] w-full flex-col justify-center overflow-hidden bg-gradient-to-br from-primary/10 via-background to-muted',
				fullScreen && 'min-h-[100svh]',
			)}
		>
			{hasBanner ? (
				<div className="absolute inset-0 -z-10" aria-hidden="true">
					<Media src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" video={false} />
					<div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/35 to-black/75" />
				</div>
			) : (
				<div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
					<div className="absolute -top-32 left-1/4 size-96 rounded-full bg-primary/15 blur-3xl" />
					<div className="absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-secondary/15 blur-3xl" />
				</div>
			)}

			<StorefrontSection
				className={cn(
					'relative flex flex-1 flex-col justify-center gap-5 py-16 sm:py-20',
					alignClass[align],
					fullScreen && 'py-24 sm:py-28',
				)}
			>
				<ProfileAvatarView
					name={displayName}
					picture={profile?.picture ?? null}
					isLoading={isLoading}
					className={cn(
						'size-28 border-4 shadow-2xl ring-4 ring-on-media/10 sm:size-36',
						hasBanner ? 'border-on-media' : 'border-background',
					)}
				/>

				<h1
					className={cn(
						'font-header text-4xl font-bold tracking-tight sm:text-6xl',
						hasBanner ? 'text-on-media drop-shadow-lg' : 'text-foreground',
					)}
				>
					{isLoading && !displayName ? 'Loading…' : displayName}
				</h1>

				{showNip05 && profile?.nip05 ? (
					<StorefrontNip05Badge
						nip05={profile.nip05}
						state={profile.nip05State ?? 'loading'}
						className={hasBanner ? 'text-on-media/85' : 'text-muted-foreground'}
					/>
				) : null}

				{showAbout && about.length > 0 && (
					<p
						className={cn(
							'max-w-2xl whitespace-pre-line text-base leading-relaxed sm:text-lg',
							hasBanner ? 'text-on-media/85' : 'text-muted-foreground',
							align === 'center' && 'mx-auto',
						)}
					>
						{about}
					</p>
				)}
			</StorefrontSection>
		</div>
	)
}
