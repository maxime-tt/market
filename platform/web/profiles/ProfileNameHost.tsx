/**
 * ProfileNameHost — the platform/web host for the ProfileName display.
 *
 * Reproduces `src/components/ProfileName.tsx` exactly, with zero `@/`
 * specifiers. The legacy component retired in batch 2 lane D; its
 * `src/components/pages/ProfilePage.tsx` consumer imports this host now.
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
