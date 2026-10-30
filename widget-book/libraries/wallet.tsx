import { useState, type ReactNode } from 'react'
import type { PendingToken } from '@sdk/commerce/payments/wallet'
import { Nip60WalletView } from '@ui/wallet/nip60-wallet-view'
import { ReceiveEcashModalView } from '@ui/wallet/receive-ecash-modal-view'
import { SendEcashModalView, type SendEcashView } from '@ui/wallet/send-ecash-modal-view'
import { WithdrawLightningModalView } from '@ui/wallet/withdraw-lightning-modal-view'
import { DepositLightningModalView } from '@ui/wallet/deposit-lightning-modal-view'
import type { WidgetLibrary } from '../libraries'

/**
 * Wallet library — the NIP-60 panel, the four ecash/Lightning modal views, and
 * their key states, drained out of `src/feature/wallet/components/**`.
 *
 * The modal views are closed at rest and driven from a trigger, because a
 * mounted open modal hides the whole catalogue from the accessibility tree
 * (see `shared.tsx`).
 */

const MINT_ONE = 'https://mint.one.example'
const MINT_TWO = 'https://mint.two.example'
const INVOICE = 'lnbc2100n1pj3ym2dpp5wqzhkunnjm6hs030k4xc7hd6ppuvqx60awz8zcsscq7eu3sphp6sdp6f'

const pendingToken: PendingToken = {
	id: 'pending-1',
	token: 'cashuAeyJ0b2tlbiI6W3siYW1vdW50IjoxMDAwfV19',
	amount: 1_000,
	mintUrl: MINT_ONE,
	createdAt: 1_700_000_000_000,
	status: 'pending',
}

const settledToken: PendingToken = {
	id: 'pending-2',
	token: 'cashuAeyJ0b2tlbiI6W3siYW1vdW50IjoyMDAwfV19',
	amount: 2_000,
	mintUrl: MINT_TWO,
	createdAt: 1_699_000_000_000,
	status: 'claimed',
}

function WalletReadyDemo({ walletDevMode = false }: { walletDevMode?: boolean }) {
	return (
		<div className="w-full max-w-sm">
			<Nip60WalletView
				isAuthenticated
				status="ready"
				error={null}
				totalBalance={3_000}
				balances={{ [MINT_ONE]: 1_000, [MINT_TWO]: 2_000 }}
				mints={[MINT_ONE, MINT_TWO]}
				activePendingTokens={[pendingToken]}
				isRefreshing={false}
				onRefresh={() => {}}
				onOpenModal={() => {}}
				openSection="mints"
				onOpenSectionChange={() => {}}
				newMintUrl=""
				onNewMintUrlChange={() => {}}
				onAddMint={() => {}}
				viewingToken={null}
				onViewingTokenChange={() => {}}
				isReclaiming={null}
				onReclaim={() => {}}
				copied={false}
				onCopyToken={() => {}}
				tokenPendingRemoval={null}
				onTokenPendingRemovalChange={() => {}}
				onConfirmRemovePendingToken={() => {}}
				onClaimFirst={() => {}}
				walletDevMode={walletDevMode}
				devMintAmount="1000"
				onDevMintAmountChange={() => {}}
				devBidAmount=""
				onDevBidAmountChange={() => {}}
				isDevMinting={false}
				isDevBidding={false}
				lastDevMint={null}
				lastDevBid={null}
				onDevMintTestEcash={() => {}}
				onDevBidSeededAuction={() => {}}
			/>
		</div>
	)
}

function ModalTrigger({ label, children }: { label: string; children: (open: boolean, setOpen: (open: boolean) => void) => ReactNode }) {
	const [open, setOpen] = useState(false)
	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				{label}
			</button>
			{children(open, setOpen)}
		</div>
	)
}

function ReceiveEcashDemo() {
	return (
		<ModalTrigger label="Open receive eCash">
			{(open, setOpen) => (
				<ReceiveEcashModalView
					open={open}
					onClose={() => setOpen(false)}
					token=""
					onTokenChange={() => {}}
					isReceiving={false}
					isSuccess={false}
					showScanner={false}
					onShowScannerChange={() => {}}
					error={null}
					onScan={() => {}}
					onScannerError={() => {}}
					onReceive={() => {}}
					cashuInitializing={false}
				/>
			)}
		</ModalTrigger>
	)
}

function ReceiveEcashSuccessDemo() {
	return (
		<ModalTrigger label="Open received eCash">
			{(open, setOpen) => (
				<ReceiveEcashModalView
					open={open}
					onClose={() => setOpen(false)}
					token="cashuA..."
					onTokenChange={() => {}}
					isReceiving={false}
					isSuccess
					showScanner={false}
					onShowScannerChange={() => {}}
					error={null}
					onScan={() => {}}
					onScannerError={() => {}}
					onReceive={() => {}}
					cashuInitializing={false}
				/>
			)}
		</ModalTrigger>
	)
}

function SendEcashDemo({ view = 'form' }: { view?: SendEcashView }) {
	return (
		<ModalTrigger label={view === 'token' ? 'Open send eCash (token)' : 'Open send eCash'}>
			{(open, setOpen) => (
				<SendEcashModalView
					open={open}
					onClose={() => setOpen(false)}
					view={view}
					amount={view === 'token' ? '1000' : ''}
					onAmountChange={() => {}}
					selectedMint={MINT_TWO}
					onSelectedMintChange={() => {}}
					mintsWithBalance={[MINT_TWO]}
					balances={{ [MINT_TWO]: 2_000 }}
					totalBalance={3_000}
					isGenerating={false}
					generatedToken={view === 'token' ? 'cashuAeyJ0b2tlbiI6W3siYW1vdW50IjoxMDAwfV19' : null}
					copied={false}
					onCopyToken={() => {}}
					error={null}
					onGenerate={() => {}}
					onSendAnother={() => {}}
					cashuInitializing={false}
				/>
			)}
		</ModalTrigger>
	)
}

function WithdrawLightningDemo({ isSuccess = false }: { isSuccess?: boolean }) {
	return (
		<ModalTrigger label="Open withdraw">
			{(open, setOpen) => (
				<WithdrawLightningModalView
					open={open}
					onClose={() => setOpen(false)}
					invoice={isSuccess ? INVOICE : ''}
					onInvoiceChange={() => {}}
					selectedMint={MINT_TWO}
					onSelectedMintChange={() => {}}
					mintsWithBalance={[MINT_TWO]}
					balances={{ [MINT_TWO]: 2_000 }}
					totalBalance={2_000}
					isWithdrawing={false}
					isSuccess={isSuccess}
					showScanner={false}
					onShowScannerChange={() => {}}
					error={null}
					onScan={() => {}}
					onScannerError={() => {}}
					onWithdraw={() => {}}
					cashuInitializing={false}
				/>
			)}
		</ModalTrigger>
	)
}

function DepositLightningDemo({ variant, invoice = false }: { variant: 'topup' | 'bid'; invoice?: boolean }) {
	const isBid = variant === 'bid'
	return (
		<ModalTrigger label={isBid ? 'Open bid funding' : 'Open deposit'}>
			{(open, setOpen) => (
				<DepositLightningModalView
					open={open}
					onClose={() => setOpen(false)}
					variant={variant}
					isBidQuickView={isBid}
					amount={isBid || invoice ? '1000' : ''}
					onAmountChange={() => {}}
					selectedMint={MINT_ONE}
					onSelectedMintChange={() => {}}
					filteredMints={[MINT_ONE, MINT_TWO]}
					hasAllowedMints
					depositInvoice={invoice || isBid ? INVOICE : null}
					depositStatus={invoice || isBid ? 'pending' : 'idle'}
					depositError={null}
					isGenerating={false}
					copied={false}
					onCopyInvoice={() => {}}
					savedNwcWallets={[{ id: 'nwc-1', name: 'Coinos' }]}
					selectedNwcWalletId="nwc-1"
					onSelectedNwcWalletChange={() => {}}
					isPayingWithNwc={false}
					nwcPaymentSent={false}
					nwcPaymentAttempted={false}
					needsConfirmationRetry={false}
					onRetryConfirmation={() => {}}
					onConfirmCheckNow={() => {}}
					isCheckingDeposit={false}
					onPayWithNwc={() => {}}
					onGenerateInvoice={() => {}}
				/>
			)}
		</ModalTrigger>
	)
}

export const wallet: WidgetLibrary = {
	name: 'wallet',
	entries: [
		{ name: 'Nip60WalletView', render: () => <WalletReadyDemo /> },
		{ name: 'Nip60WalletViewDevTools', render: () => <WalletReadyDemo walletDevMode /> },
		{
			name: 'Nip60WalletViewUnauthenticated',
			render: () => (
				<div className="w-full max-w-sm">
					<Nip60WalletView
						isAuthenticated={false}
						status="idle"
						error={null}
						totalBalance={0}
						balances={{}}
						mints={[]}
						activePendingTokens={[]}
						isRefreshing={false}
						onRefresh={() => {}}
						onOpenModal={() => {}}
						openSection={null}
						onOpenSectionChange={() => {}}
						newMintUrl=""
						onNewMintUrlChange={() => {}}
						onAddMint={() => {}}
						viewingToken={null}
						onViewingTokenChange={() => {}}
						isReclaiming={null}
						onReclaim={() => {}}
						copied={false}
						onCopyToken={() => {}}
						tokenPendingRemoval={null}
						onTokenPendingRemovalChange={() => {}}
						onConfirmRemovePendingToken={() => {}}
						onClaimFirst={() => {}}
						walletDevMode={false}
						devMintAmount="1000"
						onDevMintAmountChange={() => {}}
						devBidAmount=""
						onDevBidAmountChange={() => {}}
						isDevMinting={false}
						isDevBidding={false}
						lastDevMint={null}
						lastDevBid={null}
						onDevMintTestEcash={() => {}}
						onDevBidSeededAuction={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'Nip60WalletViewError',
			render: () => (
				<div className="w-full max-w-sm">
					<Nip60WalletView
						isAuthenticated
						status="error"
						error="Failed to initialize the wallet"
						totalBalance={0}
						balances={{}}
						mints={[]}
						activePendingTokens={[pendingToken, settledToken]}
						isRefreshing={false}
						onRefresh={() => {}}
						onOpenModal={() => {}}
						openSection="pending"
						onOpenSectionChange={() => {}}
						newMintUrl=""
						onNewMintUrlChange={() => {}}
						onAddMint={() => {}}
						viewingToken={null}
						onViewingTokenChange={() => {}}
						isReclaiming={null}
						onReclaim={() => {}}
						copied={false}
						onCopyToken={() => {}}
						tokenPendingRemoval={null}
						onTokenPendingRemovalChange={() => {}}
						onConfirmRemovePendingToken={() => {}}
						onClaimFirst={() => {}}
						walletDevMode={false}
						devMintAmount="1000"
						onDevMintAmountChange={() => {}}
						devBidAmount=""
						onDevBidAmountChange={() => {}}
						isDevMinting={false}
						isDevBidding={false}
						lastDevMint={null}
						lastDevBid={null}
						onDevMintTestEcash={() => {}}
						onDevBidSeededAuction={() => {}}
					/>
				</div>
			),
		},
		{ name: 'ReceiveEcashModalView', render: () => <ReceiveEcashDemo /> },
		{ name: 'ReceiveEcashModalViewSuccess', render: () => <ReceiveEcashSuccessDemo /> },
		{ name: 'SendEcashModalView', render: () => <SendEcashDemo /> },
		{ name: 'SendEcashModalViewToken', render: () => <SendEcashDemo view="token" /> },
		{ name: 'WithdrawLightningModalView', render: () => <WithdrawLightningDemo /> },
		{ name: 'WithdrawLightningModalViewSuccess', render: () => <WithdrawLightningDemo isSuccess /> },
		{ name: 'DepositLightningModalView', render: () => <DepositLightningDemo variant="topup" /> },
		{ name: 'DepositLightningModalViewInvoice', render: () => <DepositLightningDemo variant="topup" invoice /> },
		{ name: 'DepositLightningModalViewBid', render: () => <DepositLightningDemo variant="bid" /> },
	],
}
