import type { AuthUser } from '../auth'

/**
 * The identity seam the role checks take: the signed-in user comes from the SDK auth machine
 * (`AuthState.user`, `AuthUser = { pubkey }`) and is handed in — never fetched here.
 *
 * `ndk.activeUser` is permanently undefined in this tree (since A3.5 the signer is the SDK signer
 * capability), so reading a relay-client identity made every role check fail closed. This is the
 * pure mapping half of that seam: a `''` pubkey stays `''` and the predicates then refuse it.
 */
export function resolveUserPubkey(user: AuthUser | null | undefined): string | undefined {
	return user?.pubkey
}
