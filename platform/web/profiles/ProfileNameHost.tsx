/**
 * ProfileNameHost — the platform/web host for the ProfileName display.
 *
 * Reproduces `src/components/ProfileName.tsx` exactly, with zero `@/`
 * specifiers. The legacy component stays alive for its
 * `src/components/pages/ProfilePage.tsx` consumer; this host is the
 * platform/web replacement for the two re-pointed dashboard routes.
 */
import { useProfileName } from '@platform/web/profiles/profileQuery'
import { formatPubkeyShort } from '@sdk/core/nostr/pubkeyDisplay'
import { ProfileNameView } from '@ui/nostr/identity'

interface ProfileNameHostProps extends React.HTMLAttributes<HTMLSpanElement> {
	pubkey: string
	truncate?: boolean
	disableLink?: boolean
}

export function ProfileNameHost({ pubkey, ...props }: ProfileNameHostProps) {
	const { data: name, isLoading } = useProfileName(pubkey)
	return <ProfileNameView pubkey={pubkey} name={name} fallbackLabel={formatPubkeyShort(pubkey)} isLoading={isLoading} {...props} />
}
