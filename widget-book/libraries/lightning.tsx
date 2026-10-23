import { useState } from 'react'
import { IncompleteInvoicesBanner } from '@ui/lightning/incomplete-invoices-banner'
import { LightningPaymentView } from '@ui/lightning/lightning-payment-view'
import { V4VRecipientsCard } from '@ui/lightning/v4v-recipients-card'
import { WalletSetupGuide } from '@ui/lightning/wallet-setup-guide'
import { ZapDialogView, type ZapDialogStep } from '@ui/lightning/zap-dialog-view'
import type { WidgetLibrary } from '../libraries'

/**
 * Zap, V4V and wallet views drained into ui/lightning.
 *
 * The zap dialog is closed at rest and driven from a trigger, because a mounted
 * open modal hides the whole catalogue from the accessibility tree (see
 * `shared.tsx`). The invoice step composes `LightningPaymentView`, exactly as
 * the host does through `renderPaymentProcessor`.
 */

const invoice = 'lnbc2100n1pj3ym2dpp5wqzhkunnjm6hs030k4xc7hd6ppuvqx60awz8zcsscq7eu3sphp6sdp6f'
const preimageInvoice = 'lnbc1100n1pj4fakeinvoicevaluefortheseconddemocardqsp5hx2rcw'

function LightningPaymentDemo() {
	return (
		<div className="w-full max-w-md">
			<LightningPaymentView
				title="Pay for your order"
				invoice={invoice}
				isGeneratingInvoice={false}
				isPaymentInProgress={false}
				isCheckingForReceipt
				capabilities={{ hasNwc: false, hasCashuWallet: true, hasWebLn: false, canManualVerify: true }}
				manualPreimage=""
				onManualPreimageChange={() => {}}
				onPayCashuWallet={() => {}}
				onPayNwc={() => {}}
				onPayWebLn={() => {}}
				onVerifyPreimage={() => {}}
				onCopyInvoice={() => {}}
				onSkip={() => {}}
				skippable
				onCancel={() => {}}
				navigation={{ currentIndex: 0, total: 2, onNavigate: () => {} }}
			/>
		</div>
	)
}

function LightningPaymentGeneratingDemo() {
	return (
		<div className="w-full max-w-md">
			<LightningPaymentView
				invoice={null}
				isGeneratingInvoice
				isPaymentInProgress={false}
				isCheckingForReceipt={false}
				capabilities={{ hasNwc: true, hasCashuWallet: true, hasWebLn: true, canManualVerify: false }}
				manualPreimage=""
				onManualPreimageChange={() => {}}
				onPayCashuWallet={() => {}}
				onPayNwc={() => {}}
				onPayWebLn={() => {}}
				onVerifyPreimage={() => {}}
				onCopyInvoice={() => {}}
				skippable={false}
			/>
		</div>
	)
}

function LightningPaymentUnavailableDemo() {
	return (
		<div className="w-full max-w-md">
			<LightningPaymentView
				invoice={null}
				isGeneratingInvoice={false}
				isPaymentInProgress={false}
				isCheckingForReceipt={false}
				capabilities={{ hasNwc: false, hasCashuWallet: false, hasWebLn: false, canManualVerify: false }}
				manualPreimage=""
				onManualPreimageChange={() => {}}
				onPayCashuWallet={() => {}}
				onPayNwc={() => {}}
				onPayWebLn={() => {}}
				onVerifyPreimage={() => {}}
				onCopyInvoice={() => {}}
				onSkip={() => {}}
				skippable
			/>
		</div>
	)
}

function ZapDialogDemo({ step = 'amount' }: { step?: ZapDialogStep }) {
	const [open, setOpen] = useState(false)
	const [amount, setAmount] = useState(step === 'generateInvoice' ? '1000' : '')
	const [zapMessage, setZapMessage] = useState('Great product!')
	const [isAnonymous, setIsAnonymous] = useState(false)

	return (
		<div className="min-h-20 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
			<button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
				{step === 'generateInvoice' ? 'Open zap dialog (invoice step)' : 'Open zap dialog'}
			</button>
			<ZapDialogView
				open={open}
				onOpenChange={setOpen}
				isLoading={false}
				recipientName="satoshi"
				lightningAddress="satoshi@plebeian.market"
				step={step}
				presets={[
					{ displayText: '100', amount: 100 },
					{ displayText: '1k', amount: 1000 },
					{ displayText: '5k', amount: 5000 },
				]}
				amount={amount}
				onAmountChange={setAmount}
				zapMessage={zapMessage}
				onZapMessageChange={setZapMessage}
				isAnonymous={isAnonymous}
				onAnonymousChange={setIsAnonymous}
				support={{ canReceiveZaps: true, hasNip57: true, hasNip61: true }}
				hasCashuWallet
				hasNwc={false}
				isSubmittingNutzap={false}
				onSendNutzap={() => {}}
				onContinueToPayment={() => setOpen(false)}
				renderPaymentProcessor={() => (
					<LightningPaymentView
						invoice={preimageInvoice}
						isGeneratingInvoice={false}
						isPaymentInProgress={false}
						isCheckingForReceipt={false}
						capabilities={{ hasNwc: false, hasCashuWallet: true, hasWebLn: false, canManualVerify: false }}
						manualPreimage=""
						onManualPreimageChange={() => {}}
						onPayCashuWallet={() => {}}
						onPayNwc={() => {}}
						onPayWebLn={() => {}}
						onVerifyPreimage={() => {}}
						onCopyInvoice={() => {}}
						skippable={false}
					/>
				)}
			/>
		</div>
	)
}

export const lightning: WidgetLibrary = {
	name: 'lightning',
	entries: [
		{
			name: 'IncompleteInvoicesBanner',
			render: () => (
				<div className="w-full max-w-lg">
					<IncompleteInvoicesBanner count={3} onRefresh={() => {}} />
				</div>
			),
		},
		{
			name: 'IncompleteInvoicesBannerSingle',
			render: () => (
				<div className="w-full max-w-lg">
					<IncompleteInvoicesBanner count={1} onRefresh={() => {}} />
				</div>
			),
		},
		{
			name: 'LightningPaymentView',
			render: () => <LightningPaymentDemo />,
		},
		{
			name: 'LightningPaymentViewGenerating',
			render: () => <LightningPaymentGeneratingDemo />,
		},
		{
			name: 'LightningPaymentViewUnavailable',
			render: () => <LightningPaymentUnavailableDemo />,
		},
		{
			name: 'V4VRecipientsCard',
			render: () => (
				<div className="w-full max-w-md">
					<V4VRecipientsCard
						shares={[
							{ name: 'Podcast host', percentage: 0.2 },
							{ name: 'Co-host', percentage: 0.1 },
							{ name: 'Editor', percentage: 0.05 },
						]}
					/>
				</div>
			),
		},
		{
			name: 'WalletSetupGuide',
			render: () => <WalletSetupGuide />,
		},
		{
			name: 'ZapDialogView',
			render: () => <ZapDialogDemo />,
		},
		{
			name: 'ZapDialogViewInvoiceStep',
			render: () => <ZapDialogDemo step="generateInvoice" />,
		},
	],
}
