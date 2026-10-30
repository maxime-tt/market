import { describe, expect, test } from 'bun:test'
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PendingToken } from '@sdk/commerce/payments/wallet'
import { Nip60WalletView, type Nip60WalletViewProps } from './nip60-wallet-view'
import { ReceiveEcashModalView, type ReceiveEcashModalViewProps } from './receive-ecash-modal-view'
import { SendEcashModalView, type SendEcashModalViewProps } from './send-ecash-modal-view'
import { WithdrawLightningModalView, type WithdrawLightningModalViewProps } from './withdraw-lightning-modal-view'
import { DepositLightningModalView, type DepositLightningModalViewProps } from './deposit-lightning-modal-view'

/**
 * The five wallet views drained out of `src/feature/wallet/components/**`.
 *
 * The modal views render nothing while closed (Radix `Dialog`), so the copy for
 * their open states is asserted by walking the element tree the view returns for
 * `open: true` — the same technique `ui/shared/confirm-dialog.test.tsx` uses.
 * The NIP-60 panel renders a plain surface and is asserted as static markup.
 */

/** Collects every string in an element tree (component functions are not rendered). */
function collectText(node: ReactNode): string {
	return collectRaw(node).replace(/\s+/g, ' ')
}

function collectRaw(node: ReactNode): string {
	if (node == null || typeof node === 'boolean') return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(collectRaw).join(' ')
	if (isValidElement(node)) {
		const props = node.props as { children?: ReactNode; title?: ReactNode }
		return `${collectRaw(props.children)} ${collectRaw(props.title)}`
	}
	return ''
}

const MINT = 'https://mint.example.test'
const INVOICE = 'lnbc1000n1pjexampleinvoice'

const receiveBase: ReceiveEcashModalViewProps = {
	open: true,
	onClose: () => {},
	token: '',
	onTokenChange: () => {},
	isReceiving: false,
	isSuccess: false,
	showScanner: false,
	onShowScannerChange: () => {},
	error: null,
	onScan: () => {},
	onScannerError: () => {},
	onReceive: () => {},
	cashuInitializing: false,
}

describe('ReceiveEcashModalView', () => {
	test('renders nothing while closed', () => {
		expect(renderToStaticMarkup(<ReceiveEcashModalView {...receiveBase} open={false} />)).toBe('')
	})

	test('shows the token form with a disabled receive button', () => {
		const text = collectText(ReceiveEcashModalView(receiveBase))
		expect(text).toContain('Receive eCash')
		expect(text).toContain('Scan or paste a Cashu token to receive eCash')
		expect(text).toContain('Scan QR')
	})

	test('shows the success state, the scanner state and an error', () => {
		expect(collectText(ReceiveEcashModalView({ ...receiveBase, isSuccess: true }))).toContain('eCash Received!')
		expect(collectText(ReceiveEcashModalView({ ...receiveBase, showScanner: true }))).toContain('Cancel')
		expect(collectText(ReceiveEcashModalView({ ...receiveBase, error: 'Invalid Cashu token' }))).toContain('Invalid Cashu token')
	})
})

const sendBase: SendEcashModalViewProps = {
	open: true,
	onClose: () => {},
	view: 'form',
	amount: '',
	onAmountChange: () => {},
	selectedMint: MINT,
	onSelectedMintChange: () => {},
	mintsWithBalance: [MINT],
	balances: { [MINT]: 2_000 },
	totalBalance: 3_000,
	isGenerating: false,
	generatedToken: null,
	copied: false,
	onCopyToken: () => {},
	error: null,
	onGenerate: () => {},
	onSendAnother: () => {},
	cashuInitializing: false,
}

describe('SendEcashModalView', () => {
	test('renders nothing while closed', () => {
		expect(renderToStaticMarkup(<SendEcashModalView {...sendBase} open={false} />)).toBe('')
	})

	test('shows the amount form with the wallet balance and mint hostname', () => {
		const text = collectText(SendEcashModalView(sendBase))
		expect(text).toContain('Send eCash')
		expect(text).toContain('Balance: 3,000 sats')
		expect(text).toContain('mint.example.test')
		expect(text).toContain('Generate Token')
	})

	test('shows the generated token state', () => {
		const text = collectText(SendEcashModalView({ ...sendBase, view: 'token', generatedToken: 'cashuAexample' }))
		expect(text).toContain('Cashu Token')
		expect(text).toContain('Copy Token')
		expect(text).toContain('Send Another')
		expect(text).toContain('Token saved to pending list')
	})

	test('names the insufficient-balance / error message', () => {
		expect(collectText(SendEcashModalView({ ...sendBase, error: 'Failed to generate eCash token' }))).toContain(
			'Failed to generate eCash token',
		)
	})
})

const withdrawBase: WithdrawLightningModalViewProps = {
	open: true,
	onClose: () => {},
	invoice: '',
	onInvoiceChange: () => {},
	selectedMint: MINT,
	onSelectedMintChange: () => {},
	mintsWithBalance: [MINT],
	balances: { [MINT]: 2_000 },
	totalBalance: 2_000,
	isWithdrawing: false,
	isSuccess: false,
	showScanner: false,
	onShowScannerChange: () => {},
	error: null,
	onScan: () => {},
	onScannerError: () => {},
	onWithdraw: () => {},
	cashuInitializing: false,
}

describe('WithdrawLightningModalView', () => {
	test('renders nothing while closed', () => {
		expect(renderToStaticMarkup(<WithdrawLightningModalView {...withdrawBase} open={false} />)).toBe('')
	})

	test('shows the invoice form, the mint and the balance', () => {
		const text = collectText(WithdrawLightningModalView(withdrawBase))
		expect(text).toContain('Withdraw to Lightning')
		expect(text).toContain('Balance: 2,000 sats')
		expect(text).toContain('mint.example.test')
		expect(text).toContain('Lightning Invoice')
	})

	test('shows the success state and the error', () => {
		expect(collectText(WithdrawLightningModalView({ ...withdrawBase, isSuccess: true }))).toContain('Withdrawal Successful!')
		expect(collectText(WithdrawLightningModalView({ ...withdrawBase, error: 'Withdrawal failed' }))).toContain('Withdrawal failed')
	})
})

const depositBase: DepositLightningModalViewProps = {
	open: true,
	onClose: () => {},
	variant: 'topup',
	isBidQuickView: false,
	amount: '',
	onAmountChange: () => {},
	selectedMint: MINT,
	onSelectedMintChange: () => {},
	filteredMints: [MINT],
	hasAllowedMints: true,
	depositInvoice: null,
	depositStatus: 'idle',
	depositError: null,
	isGenerating: false,
	copied: false,
	onCopyInvoice: () => {},
	savedNwcWallets: [{ id: 'nwc-1', name: 'Coinos' }],
	selectedNwcWalletId: 'nwc-1',
	onSelectedNwcWalletChange: () => {},
	isPayingWithNwc: false,
	nwcPaymentSent: false,
	nwcPaymentAttempted: false,
	needsConfirmationRetry: false,
	onRetryConfirmation: () => {},
	onConfirmCheckNow: () => {},
	isCheckingDeposit: false,
	onPayWithNwc: () => {},
	onGenerateInvoice: () => {},
}

describe('DepositLightningModalView', () => {
	test('renders nothing while closed', () => {
		expect(renderToStaticMarkup(<DepositLightningModalView {...depositBase} open={false} />)).toBe('')
	})

	test('shows the amount/mint form', () => {
		const text = collectText(DepositLightningModalView(depositBase))
		expect(text).toContain('Deposit Lightning')
		expect(text).toContain('Generate a Lightning invoice to mint eCash')
		expect(text).toContain('mint.example.test')
		expect(text).toContain('Generate Invoice')
	})

	test('shows the invoice state with the NWC wallet picker', () => {
		const text = collectText(DepositLightningModalView({ ...depositBase, depositInvoice: INVOICE, depositStatus: 'pending' }))
		expect(text).toContain('Lightning Invoice')
		expect(text).toContain('Pay with connected wallet')
		expect(text).toContain('Coinos')
		expect(text).toContain('Waiting for payment...')
	})

	test('shows the bid quick-pay view and the success state', () => {
		const bid = collectText(
			DepositLightningModalView({
				...depositBase,
				variant: 'bid',
				isBidQuickView: true,
				depositInvoice: INVOICE,
				depositStatus: 'pending',
				amount: '1000',
			}),
		)
		expect(bid).toContain('Bid with lightning')
		expect(bid).toContain('1,000 sats')
		expect(bid).not.toContain('Generate Invoice')

		const success = collectText(DepositLightningModalView({ ...depositBase, depositStatus: 'success' }))
		expect(success).toContain('Deposit Successful!')
	})

	test('surfaces the terminal error and the reclaimable retry', () => {
		expect(
			collectText(DepositLightningModalView({ ...depositBase, depositStatus: 'error', depositError: 'Failed to generate invoice' })),
		).toContain('Failed to generate invoice')
		expect(
			collectText(
				DepositLightningModalView({
					...depositBase,
					depositInvoice: INVOICE,
					depositStatus: 'awaiting_confirmation_retry',
					needsConfirmationRetry: true,
				}),
			),
		).toContain('Retry confirmation')
	})
})

const pendingToken: PendingToken = {
	id: 'pending-1',
	token: 'cashuAexample',
	amount: 1_000,
	mintUrl: MINT,
	createdAt: 1_700_000_000_000,
	status: 'pending',
}

const nip60Base: Nip60WalletViewProps = {
	isAuthenticated: true,
	status: 'ready',
	error: null,
	totalBalance: 3_000,
	balances: { [MINT]: 3_000 },
	mints: [MINT],
	activePendingTokens: [pendingToken],
	isRefreshing: false,
	onRefresh: () => {},
	onOpenModal: () => {},
	openSection: 'mints',
	onOpenSectionChange: () => {},
	newMintUrl: '',
	onNewMintUrlChange: () => {},
	onAddMint: () => {},
	viewingToken: null,
	onViewingTokenChange: () => {},
	isReclaiming: null,
	onReclaim: () => {},
	copied: false,
	onCopyToken: () => {},
	tokenPendingRemoval: null,
	onTokenPendingRemovalChange: () => {},
	onConfirmRemovePendingToken: () => {},
	onClaimFirst: () => {},
	walletDevMode: false,
	devMintAmount: '1000',
	onDevMintAmountChange: () => {},
	devBidAmount: '',
	onDevBidAmountChange: () => {},
	isDevMinting: false,
	isDevBidding: false,
	lastDevMint: null,
	lastDevBid: null,
	onDevMintTestEcash: () => {},
	onDevBidSeededAuction: () => {},
}

describe('Nip60WalletView', () => {
	test('renders the wallet panel with balance, actions and mints', () => {
		const markup = renderToStaticMarkup(<Nip60WalletView {...nip60Base} />)
		expect(markup).toContain('Balance')
		expect(markup).toContain('3,000 sats')
		expect(markup).toContain('Deposit')
		expect(markup).toContain('Withdraw')
		expect(markup).toContain('Receive eCash')
		expect(markup).toContain('Send eCash')
		expect(markup).toContain('mint.example.test')
		// The dark panel uses the semantic ink surface, not a raw palette class.
		expect(markup).toContain('bg-fill-ink')
		expect(markup).not.toContain('text-white')
		expect(markup).not.toContain('bg-gray-')
	})

	test('gates the dev tools on the dev flag', () => {
		expect(renderToStaticMarkup(<Nip60WalletView {...nip60Base} />)).not.toContain('Auction Test Tools')
		expect(renderToStaticMarkup(<Nip60WalletView {...nip60Base} walletDevMode />)).toContain('Auction Test Tools')
	})

	test('renders the unauthenticated and error states', () => {
		expect(renderToStaticMarkup(<Nip60WalletView {...nip60Base} isAuthenticated={false} />)).toContain('Please log in to view your wallet')
		expect(renderToStaticMarkup(<Nip60WalletView {...nip60Base} status="error" error="Wallet failed" />)).toContain('Wallet failed')
		expect(renderToStaticMarkup(<Nip60WalletView {...nip60Base} status="initializing" />)).toContain('animate-spin')
	})

	test('lists the pending tokens when the pending section is open', () => {
		const markup = renderToStaticMarkup(<Nip60WalletView {...nip60Base} openSection="pending" />)
		expect(markup).toContain('1,000 sats')
		expect(markup).toContain('mint.example.test')
	})
})
