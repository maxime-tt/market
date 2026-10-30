import { Check, Copy, Loader2, Zap } from 'lucide-react'
import type { CashuDepositStatus } from '@sdk/config/cashu'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { Button } from '../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'
import { QRCode } from '../primitives/qr-code'

/**
 * Deposit Lightning — the presentational half of the retired
 * `src/feature/wallet/components/DepositLightningModal.tsx`.
 *
 * The host owns every effect and ref (mint selection, NWC payment, the terminal
 * outcome classification, the open→closed reset); this view only renders the
 * four states the host projects: success, the bid quick-pay QR, the invoice
 * view, and the amount/mint form.
 */
export interface DepositLightningModalViewProps {
	open: boolean
	/** Overlay/escape/cancel/close; the host runs the reclaim classification first. */
	onClose: () => void
	variant: 'bid' | 'topup'
	/** `variant === 'bid'` with the classic top-up form not forced open. */
	isBidQuickView: boolean
	amount: string
	onAmountChange: (amount: string) => void
	selectedMint: string
	onSelectedMintChange: (mint: string) => void
	filteredMints: readonly string[]
	hasAllowedMints: boolean
	allowedMints?: string[]
	depositInvoice: string | null
	depositStatus: CashuDepositStatus
	depositError: string | null
	isGenerating: boolean
	copied: boolean
	onCopyInvoice: () => void
	savedNwcWallets: readonly { id: string; name: string }[]
	selectedNwcWalletId: string
	onSelectedNwcWalletChange: (id: string) => void
	isPayingWithNwc: boolean
	nwcPaymentSent: boolean
	nwcPaymentAttempted: boolean
	needsConfirmationRetry: boolean
	onRetryConfirmation: () => void
	onConfirmCheckNow: () => void
	isCheckingDeposit: boolean
	onPayWithNwc: () => void
	onGenerateInvoice: () => void
}

export function DepositLightningModalView({
	open,
	onClose,
	variant,
	isBidQuickView,
	amount,
	onAmountChange,
	selectedMint,
	onSelectedMintChange,
	filteredMints,
	hasAllowedMints,
	allowedMints,
	depositInvoice,
	depositStatus,
	depositError,
	isGenerating,
	copied,
	onCopyInvoice,
	savedNwcWallets,
	selectedNwcWalletId,
	onSelectedNwcWalletChange,
	isPayingWithNwc,
	nwcPaymentSent,
	nwcPaymentAttempted,
	needsConfirmationRetry,
	onRetryConfirmation,
	onConfirmCheckNow,
	isCheckingDeposit,
	onPayWithNwc,
	onGenerateInvoice,
}: DepositLightningModalViewProps) {
	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-warning" />
						{isBidQuickView ? 'Bid with lightning' : 'Deposit Lightning'}
					</DialogTitle>
					<DialogDescription>
						{isBidQuickView ? 'Pay this invoice to lock your bid.' : 'Generate a Lightning invoice to mint eCash'}
					</DialogDescription>
				</DialogHeader>

				{depositStatus === 'success' ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-success-muted flex items-center justify-center">
							<Check className="w-6 h-6 text-success" />
						</div>
						<p className="text-lg font-medium text-success">Deposit Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">Your eCash has been minted</p>
						<Button onClick={onClose} className="mt-4">
							Done
						</Button>
					</div>
				) : isBidQuickView ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="w-[216px] h-[216px] flex items-center justify-center rounded-lg p-4">
								{depositInvoice ? (
									<button type="button" onClick={onCopyInvoice} className="cursor-pointer outline-none" title="Click to copy invoice">
										<QRCode value={depositInvoice} size={184} includeMargin={false} showBorder={false} />
									</button>
								) : (
									<div className="text-xs text-muted-foreground text-center px-2">
										{selectedMint || isGenerating ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : 'No mint selected yet'}
									</div>
								)}
							</div>
						</div>

						<p className="text-center text-2xl font-bold">
							{Number.isFinite(parseInt(amount, 10)) ? parseInt(amount, 10).toLocaleString() : 0} sats
						</p>

						{depositInvoice && (
							<div className="space-y-2">
								<p className="text-sm font-medium">Lightning Invoice</p>
								<div className="flex gap-2">
									<input
										type="text"
										value={depositInvoice}
										readOnly
										className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono truncate"
									/>
									<Button variant="outline" size="icon" onClick={onCopyInvoice} title="Copy invoice">
										{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
									</Button>
								</div>
							</div>
						)}

						{copied && <p className="text-xs text-center text-muted-foreground">Invoice copied to clipboard</p>}

						{depositStatus === 'error' && (
							<p className="text-sm text-destructive text-center">{depositError || 'Failed to generate invoice. Please try again.'}</p>
						)}
						{!hasAllowedMints && !depositInvoice && (
							<p className="text-sm text-destructive text-center">No accepted auction mints are available in this wallet.</p>
						)}

						{/* Payment status indicator */}
						{depositInvoice && (depositStatus === 'pending' || depositStatus === 'awaiting_confirmation_retry') && (
							<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
								{needsConfirmationRetry ? (
									<>
										<span className="text-warning">Confirmation timed out.</span>
										<Button type="button" variant="outline" size="sm" onClick={onRetryConfirmation}>
											Retry check
										</Button>
									</>
								) : nwcPaymentSent ? (
									<span>Payment sent. Waiting for mint confirmation...</span>
								) : (
									<span>Waiting for payment...</span>
								)}
							</div>
						)}

						<div className="flex items-center justify-between gap-2 pt-1">
							<Button type="button" variant="outline" onClick={onClose} disabled={isPayingWithNwc}>
								Cancel
							</Button>
							{depositInvoice && depositStatus === 'pending' && !needsConfirmationRetry && (
								<Button type="button" variant="ghost" size="sm" onClick={onConfirmCheckNow} disabled={isCheckingDeposit}>
									{isCheckingDeposit ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
									Check payment
								</Button>
							)}
						</div>
					</div>
				) : depositInvoice ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="p-4 rounded-lg">
								<QRCode value={depositInvoice} size={200} includeMargin={false} showBorder={false} />
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Lightning Invoice</p>
							<div className="flex gap-2">
								<input
									type="text"
									value={depositInvoice}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono truncate"
								/>
								<Button variant="outline" size="icon" onClick={onCopyInvoice}>
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
								</Button>
							</div>
						</div>
						{savedNwcWallets.length > 0 && (
							<div className="space-y-2 rounded-md border p-3">
								<label className="text-sm font-medium" htmlFor="deposit-nwc-wallet">
									Pay with connected wallet
								</label>
								<select
									id="deposit-nwc-wallet"
									value={selectedNwcWalletId}
									onChange={(e) => onSelectedNwcWalletChange(e.target.value)}
									disabled={isPayingWithNwc || nwcPaymentAttempted}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{savedNwcWallets.map((wallet) => (
										<option key={wallet.id} value={wallet.id}>
											{wallet.name}
										</option>
									))}
								</select>
								<Button
									type="button"
									className="w-full"
									onClick={onPayWithNwc}
									disabled={isPayingWithNwc || nwcPaymentAttempted || !selectedNwcWalletId}
								>
									{isPayingWithNwc ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
									Pay invoice with NWC
								</Button>
							</div>
						)}
						<p className="text-sm text-muted-foreground text-center">
							{needsConfirmationRetry
								? 'Confirmation timed out. Retry to check the mint again.'
								: nwcPaymentSent
									? 'Payment sent. Waiting for mint confirmation...'
									: 'Waiting for payment...'}
						</p>
						{needsConfirmationRetry ? (
							<div className="flex justify-center">
								<Button type="button" onClick={onRetryConfirmation}>
									Retry confirmation
								</Button>
							</div>
						) : (
							<div className="flex justify-center">
								<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
							</div>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={onClose} disabled={isPayingWithNwc}>
								{nwcPaymentAttempted ? 'Close' : 'Cancel'}
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Amount (sats)</label>
							<input
								type="number"
								value={amount}
								onChange={(e) => onAmountChange(e.target.value)}
								placeholder="Enter amount in sats"
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								min="1"
							/>
						</div>

						<div className="space-y-2">
							<label className="text-sm font-medium">Mint</label>
							{hasAllowedMints ? (
								<select
									value={selectedMint}
									onChange={(e) => onSelectedMintChange(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{filteredMints.map((mint) => (
										<option key={mint} value={mint}>
											{getMintHostname(mint)}
										</option>
									))}
								</select>
							) : (
								<p className="text-sm text-destructive">
									{allowedMints?.length ? 'No accepted auction mints are available in this wallet.' : 'No mints available.'}
								</p>
							)}
						</div>

						{depositStatus === 'error' && (
							<p className="text-sm text-destructive">{depositError || 'Failed to generate invoice. Please try again.'}</p>
						)}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={onClose}>
								Cancel
							</Button>
							<Button onClick={onGenerateInvoice} disabled={isGenerating || !amount || !selectedMint || !hasAllowedMints}>
								{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Generate Invoice
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
