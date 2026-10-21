import { nip05ValidationQueryOptions, useProfile } from '@/queries/profiles'
import { useQuery } from '@tanstack/react-query'
import { VerifiedBadge } from '@ui/nostr/verified-badge'

interface Nip05BadgeProps {
	pubkey?: string
	className?: string
	showAddress?: boolean
}

/**
 * Host for the presentational `@ui/nostr/verified-badge`. It resolves the
 * profile and its NIP-05 validation state and renders nothing when the pubkey
 * has no NIP-05 address — the "no badge, no text" case stays here because it
 * depends on query results, not on presentation.
 */
export function Nip05Badge({ pubkey, className = '', showAddress = true }: Nip05BadgeProps) {
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
