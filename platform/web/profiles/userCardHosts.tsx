import {
	getNormalizedProfileDisplayName,
	getNormalizedProfileNip05,
	getNormalizedProfilePicture,
	normalizeOptionalPubkey,
	normalizeOptionalString,
	nip05ValidationQueryOptions,
	useProfile,
} from '@platform/web/profiles/profileQuery'
import { useBreakpoint } from '@platform/web/app/useBreakpoint'
import { isValidHexKey, isValidNpub } from '@sdk/core/utils/utils'
import { VerifiedBadge } from '@ui/nostr/verified-badge'
import { ProfileAvatarView } from '@ui/nostr/identity'
import { UserCardView, type UserCardSize } from '@ui/nostr/user-card'
import { useQuery } from '@tanstack/react-query'
import { nip19 } from 'nostr-tools'

/**
 * Encodes a hex pubkey (or passes an existing npub through) to an npub string.
 * Moved verbatim from the retiring `src/components/UserCard.tsx` so
 * `UserCardHost` keeps the exact identifier rule its legacy consumer relied on.
 */
export function encodeIdentifierToNpub(identifier: string | undefined): string | null {
	const trimmedIdentifier = identifier?.trim()
	if (!trimmedIdentifier) return null

	if (isValidNpub(trimmedIdentifier)) {
		return trimmedIdentifier
	}

	if (!isValidHexKey(trimmedIdentifier)) {
		return null
	}

	return nip19.npubEncode(trimmedIdentifier)
}

interface Nip05BadgeHostProps {
	pubkey?: string
	className?: string
	showAddress?: boolean
}

/**
 * Host for the presentational `@ui/nostr/verified-badge`. It resolves the
 * profile and its NIP-05 validation state and renders nothing when the pubkey
 * has no NIP-05 address — the "no badge, no text" case stays here because it
 * depends on query results, not on presentation. Reproduces the retiring
 * `src/components/Nip05Badge.tsx`.
 */
export function Nip05BadgeHost({ pubkey, className = '', showAddress = true }: Nip05BadgeHostProps) {
	const safePubkey = pubkey ?? ''
	const { data: profile } = useProfile(safePubkey)
	const nip05 = profile?.profile?.nip05
	const shouldValidate = Boolean(safePubkey && nip05 && nip05.length > 0)

	const { data: isVerified, isLoading } = useQuery({
		...nip05ValidationQueryOptions(safePubkey),
		enabled: shouldValidate,
	})

	if (!safePubkey || profile == null || nip05 == null || nip05.length == 0) {
		return null
	}

	return (
		<VerifiedBadge
			state={isLoading ? 'loading' : isVerified ? 'verified' : 'invalid'}
			nip05={nip05}
			showAddress={showAddress}
			className={className}
		/>
	)
}

interface UserCardHostProps {
	pubkey?: string
	className?: string
	size?: UserCardSize
	subtitle?: 'npub' | 'nip-05' | 'none'
	onPress?: 'profile' | 'copy-npub' | 'none'
}

/**
 * The first reusable identity host of D4. It wires the profile read, the
 * NIP-05 validation host, the avatar and the pure `@ui/nostr/user-card` view,
 * reproducing the retiring `src/components/UserCard.tsx` (and folding in the
 * two-line `src/components/AvatarUser.tsx` read). The rest of the identity kit
 * adopts this host; `src/components/UserCard.tsx` stays alive for its remaining
 * src/ consumers.
 */
export function UserCardHost({ pubkey, className = '', size = 'md', subtitle = 'nip-05', onPress = 'profile' }: UserCardHostProps) {
	const safePubkey = normalizeOptionalPubkey(pubkey)
	const { data: profileData, isLoading } = useProfile(safePubkey)
	const { profile, user } = profileData || {}

	const breakpoint = useBreakpoint()
	const userNpub = normalizeOptionalString(user?.npub)
	const npub = userNpub && isValidNpub(userNpub) ? userNpub : encodeIdentifierToNpub(safePubkey)

	return (
		<UserCardView
			renderAvatar={(avatarClassName) => (
				<ProfileAvatarView
					name={getNormalizedProfileDisplayName(profile)}
					picture={getNormalizedProfilePicture(profile)}
					isLoading={isLoading}
					className={avatarClassName}
				/>
			)}
			isLoading={isLoading}
			displayName={getNormalizedProfileDisplayName(profile)}
			nip05={getNormalizedProfileNip05(profile)}
			npub={npub}
			renderNip05Badge={
				safePubkey
					? ({ className: badgeClassName, showAddress }) => (
							<Nip05BadgeHost pubkey={safePubkey} className={badgeClassName} showAddress={showAddress} />
						)
					: undefined
			}
			profileHref={onPress === 'profile' && safePubkey ? `/profile/${safePubkey}` : undefined}
			compact={breakpoint === 'md' || breakpoint === 'sm'}
			className={className}
			size={size}
			subtitle={subtitle}
			copyNpub={onPress !== 'none'}
		/>
	)
}
