import { useState } from 'react'
import { BunkerConnectView } from '@ui/auth/bunker-connect-view'
import { DecryptPasswordDialogView, MigratePrivateKeyDialogView } from '@ui/auth/auth-key-dialogs'
import { LoginDialogView } from '@ui/auth/login-dialog-view'
import { NostrConnectQRView } from '@ui/auth/nostr-connect-qr-view'
import { PrivateKeyLoginView, type PrivateKeyLoginStep } from '@ui/auth/private-key-login-view'
import type { WidgetLibrary } from '../libraries'

/**
 * Login and key-management views drained into ui/auth.
 *
 * Every dialog is closed at rest and driven from a trigger, because a mounted
 * open modal hides the whole catalogue from the accessibility tree (see
 * `shared.tsx`). Panels that the host composes into `LoginDialogView` are
 * rendered here as literal-prop demo components.
 */

/** Literal `nostrconnect://` URI — the host builds this from its local signer. */
const nostrConnectUri =
	'nostrconnect://d943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c78?relay=wss%3A%2F%2Frelay.plebeian.market&secret=deadbeef'

/** The demo host always rejects, so submitting shows the inline error path. */
function DecryptPasswordDialogDemo() {
	const [open, setOpen] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open decrypt dialog
			</button>
			<DecryptPasswordDialogView open={open} onDecrypt={() => Promise.reject(new Error('bad password'))} onLogout={() => setOpen(false)} />
		</div>
	)
}

/** Same trick: the demo host always rejects the encrypt call. */
function MigratePrivateKeyDialogDemo() {
	const [open, setOpen] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				Open migration dialog
			</button>
			<MigratePrivateKeyDialogView open={open} minPasswordLength={8} onEncrypt={() => Promise.reject(new Error('demo'))} />
		</div>
	)
}

function BunkerConnectDemo({ authUrl }: { authUrl: string | null }) {
	return (
		<div className="w-96 max-w-full">
			<BunkerConnectView
				bunkerUrl={authUrl ? 'bunker://example.com/signer?token=abc' : ''}
				onBunkerUrlChange={() => {}}
				error={null}
				authUrl={authUrl}
				isConnecting={false}
				onConnect={() => {}}
				onScanned={() => {}}
			/>
		</div>
	)
}

function NostrConnectQRDemo({ connected = false }: { connected?: boolean }) {
	return (
		<div className="w-96 max-w-full">
			<NostrConnectQRView
				relays={[{ value: 'wss://relay.plebeian.market', label: 'plebeian.market' }]}
				selectedRelay="wss://relay.plebeian.market"
				onRelayChange={() => {}}
				customRelay=""
				onCustomRelayChange={() => {}}
				isGenerating={false}
				isConnected={connected}
				hasError={false}
				isListening={!connected}
				connectionUrl={connected ? null : nostrConnectUri}
				onCopyConnectionUrl={() => {}}
			/>
		</div>
	)
}

/** All three controlled steps side by side; the host normally swaps them. */
const privateKeySteps: Array<{ step: PrivateKeyLoginStep; caption: string }> = [
	{ step: 'enter-key', caption: 'enter-key (freshly generated key)' },
	{ step: 'stored-key', caption: 'stored-key (wrong password)' },
	{ step: 'set-password', caption: 'set-password' },
]

function PrivateKeyLoginDemo() {
	return (
		<div className="grid gap-6 lg:grid-cols-3">
			{privateKeySteps.map(({ step, caption }) => (
				<div key={step} className="min-w-0 rounded-md border p-3">
					<p className="mb-2 text-xs text-muted-foreground">{caption}</p>
					<PrivateKeyLoginView
						step={step}
						isLoading={false}
						storedPubkey="d943e96d0c7828b0e0c2b2d1f0a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c78"
						privateKey={step === 'enter-key' ? 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' : ''}
						onPrivateKeyChange={() => {}}
						keyError={null}
						password=""
						onPasswordChange={() => {}}
						confirmPassword=""
						onConfirmPasswordChange={() => {}}
						passwordError={step === 'stored-key' ? 'Incorrect password' : ''}
						isGeneratedKey={step === 'enter-key'}
						onGenerateKey={() => {}}
						onContinue={() => {}}
						onEncryptAndStore={() => {}}
						onStoredKeyLogin={() => {}}
						onClearStoredKey={() => {}}
					/>
				</div>
			))}
		</div>
	)
}

function LoginDialogDemo({ extensionError = null }: { extensionError?: string | null }) {
	const [open, setOpen] = useState(false)
	const [autoLogin, setAutoLogin] = useState(true)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				{extensionError ? 'Open login dialog (extension error)' : 'Open login dialog'}
			</button>
			<LoginDialogView
				open={open}
				onOpenChange={setOpen}
				privateKeyPanel={
					<PrivateKeyLoginView
						step="enter-key"
						isLoading={false}
						storedPubkey={null}
						privateKey=""
						onPrivateKeyChange={() => {}}
						keyError={null}
						password=""
						onPasswordChange={() => {}}
						confirmPassword=""
						onConfirmPasswordChange={() => {}}
						passwordError=""
						isGeneratedKey={false}
						onGenerateKey={() => {}}
						onContinue={() => {}}
						onEncryptAndStore={() => {}}
						onStoredKeyLogin={() => {}}
						onClearStoredKey={() => {}}
					/>
				}
				nostrConnectQrPanel={
					<NostrConnectQRView
						relays={[{ value: 'wss://relay.plebeian.market', label: 'plebeian.market' }]}
						selectedRelay="wss://relay.plebeian.market"
						onRelayChange={() => {}}
						customRelay=""
						onCustomRelayChange={() => {}}
						isGenerating={false}
						isConnected={false}
						hasError={false}
						isListening
						connectionUrl={nostrConnectUri}
						onCopyConnectionUrl={() => {}}
					/>
				}
				bunkerPanel={
					<BunkerConnectView
						bunkerUrl=""
						onBunkerUrlChange={() => {}}
						error={null}
						authUrl={null}
						isConnecting={false}
						onConnect={() => {}}
						onScanned={() => {}}
					/>
				}
				extensionError={extensionError}
				onConnectExtension={() => {}}
				autoLogin={autoLogin}
				onAutoLoginChange={setAutoLogin}
			/>
		</div>
	)
}

export const auth: WidgetLibrary = {
	name: 'auth',
	entries: [
		{
			name: 'DecryptPasswordDialogView',
			render: () => <DecryptPasswordDialogDemo />,
		},
		{
			name: 'MigratePrivateKeyDialogView',
			render: () => <MigratePrivateKeyDialogDemo />,
		},
		{
			name: 'BunkerConnectView',
			render: () => <BunkerConnectDemo authUrl={null} />,
		},
		{
			name: 'BunkerConnectViewChallenge',
			render: () => <BunkerConnectDemo authUrl="https://signer.example.com/approve?challenge=abc123" />,
		},
		{
			name: 'LoginDialogView',
			render: () => <LoginDialogDemo />,
		},
		{
			name: 'LoginDialogViewExtensionError',
			render: () => <LoginDialogDemo extensionError="No Nostr extension found. Install Alby or nos2x." />,
		},
		{
			name: 'NostrConnectQRView',
			render: () => <NostrConnectQRDemo />,
		},
		{
			name: 'NostrConnectQRViewConnected',
			render: () => <NostrConnectQRDemo connected />,
		},
		{
			name: 'PrivateKeyLoginView',
			render: () => <PrivateKeyLoginDemo />,
		},
	],
}
