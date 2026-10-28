/**
 * platform/web/auth/AuthKeyDialogsHost.tsx — the host for the two auth key dialogs.
 *
 * Fused retirement (I.1c): `src/components/auth/MigratePrivateKeyDialog.tsx` and
 * `src/components/auth/DecryptPasswordDialog.tsx` were 15/16-LOC wrappers that only
 * read two auth flags and forwarded two actions. The presentation already lives in
 * `@ui/auth/auth-key-dialogs`; this host supplies the state (via `useAuthState`) and
 * the actions (via `authBinding`), so both legacy wrappers are deleted.
 *
 * Zero `@/` specifiers (D3D4-CONTRACT rev 2.4 §2).
 */
import { authBinding, useAuthState } from '@platform/web/auth/authBinding'
import { DecryptPasswordDialogView, MigratePrivateKeyDialogView } from '@ui/auth/auth-key-dialogs'

export function AuthKeyDialogsHost() {
	const { needsMigration, needsDecryptionPassword } = useAuthState()

	return (
		<>
			<MigratePrivateKeyDialogView
				open={needsMigration}
				minPasswordLength={process.env.NODE_ENV === 'production' ? 8 : 0}
				onEncrypt={(password) => authBinding.actions.migrateToEncryptedKey(password)}
			/>
			<DecryptPasswordDialogView
				open={needsDecryptionPassword}
				onDecrypt={(password) => authBinding.actions.decryptAndLogin(password)}
				// Clears stored keys; the dialog closes once needsDecryptionPassword flips.
				onLogout={() => authBinding.actions.logout()}
			/>
		</>
	)
}
