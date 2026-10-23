import { useAuth, authActions } from '@/lib/stores/auth'
import { DecryptPasswordDialogView } from '@ui/auth/auth-key-dialogs'

export function DecryptPasswordDialog() {
	const { needsDecryptionPassword } = useAuth()

	return (
		<DecryptPasswordDialogView
			open={needsDecryptionPassword}
			onDecrypt={(password) => authActions.decryptAndLogin(password)}
			// Clears stored keys; the dialog closes once needsDecryptionPassword flips.
			onLogout={() => authActions.logout()}
		/>
	)
}
