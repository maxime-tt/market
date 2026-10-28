import { useAuthState } from '@platform/web/auth/authBinding'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useProfile } from '@platform/web/profiles/profileQuery'
import { ProfileWalletCheckView } from '@ui/settings/profile-wallet-check-view'

/**
 * platform/web/account/ProfileWalletCheckHost.tsx — the host for the receiving-payments
 * wallet check (D4 leaf retirement). Reproduces the legacy derivation exactly, with the
 * auth read moved from the legacy store to the platform auth binding.
 *
 * Legacy `src/` leaf derivation (retired in this commit), quoted as evidence:
 *
 *   const authState = useStore(authStore)                    -> useAuthState()
 *   const { data, isPending, fetchStatus } = useProfile(authState.user?.pubkey)
 *   const { data: config } = useConfigQuery()
 *   const instanceName = config?.displayName || config?.name || 'Marketplace'
 *   const profile = data?.profile ?? null
 *   if (isPending && fetchStatus === 'fetching') { ...the "checking" card }
 *   const hasLud16 = profile?.lud16 && profile.lud16.trim().length > 0
 *   if (hasLud16) { ...the green card, lud16 = profile.lud16 }
 *   ...the amber card, interpolating instanceName
 *
 * No `@/` specifiers by design (D3D4-CONTRACT rev 2.4 §2: M2 is a hard pre-filter).
 */
export function ProfileWalletCheckHost() {
	const authState = useAuthState()
	const { data, isPending, fetchStatus } = useProfile(authState.user?.pubkey)
	const { data: config } = useConfigQuery()
	const instanceName = config?.displayName || config?.name || 'Marketplace'
	const profile = data?.profile ?? null

	const isLoading = isPending && fetchStatus === 'fetching'
	const hasLud16 = !!profile?.lud16 && profile.lud16.trim().length > 0
	const lud16 = hasLud16 ? (profile!.lud16 as string) : null

	return <ProfileWalletCheckView isLoading={isLoading} hasLud16={hasLud16} lud16={lud16} instanceName={instanceName} />
}
