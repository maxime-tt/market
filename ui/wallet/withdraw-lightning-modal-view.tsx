import { Check, Loader2, ScanLine, Zap } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { Button } from '../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'

/**
 * Withdraw to Lightning — the presentational half of the retired
 * `src/feature/wallet/components/WithdrawLightningModal.tsx`.
 *
 * Props-only: the host owns the invoice field, the scanner toggle, the withdraw
 * action and the cashu store subscription. The raw orange/green palette of the
 * original is mapped to semantic tones.
 */
export interface WithdrawLightningModalViewProps {
	open: boolean
	/** Called on overlay/escape/cancel/close; the host owns the state reset. */
	onClose: () => void
	invoice: string
	onInvoiceChange: (invoice: string) => void
	selectedMint: string
	onSelectedMintChange: (mint: string) => void
	mintsWithBalance: readonly string[]
	balances: Record<string, number>
	totalBalance: number
	isWithdrawing: boolean
	isSuccess: boolean
	showScanner: boolean
	onShowScannerChange: (show: boolean) => void
	error: string | null
	/** Raw value of the first detected QR code; the host normalises it. */
	onScan: (rawValue: string) => void
	onScannerError: (error: unknown) => void
	onWithdraw: () => void
	cashuInitializing: boolean
}

export function WithdrawLightningModalView({
	open,
	onClose,
	invoice,
	onInvoiceChange,
	selectedMint,
	onSelectedMintChange,
	mintsWithBalance,
	balances,
	totalBalance,
	isWithdrawing,
	isSuccess,
	showScanner,
	onShowScannerChange,
	error,
	onScan,
	onScannerError,
	onWithdraw,
	cashuInitializing,
}: WithdrawLightningModalViewProps) {
	const handleScan = (detectedCodes: { rawValue: string }[]) => {
		const rawValue = detectedCodes?.[0]?.rawValue
		if (rawValue) onScan(rawValue)
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-warning" />
						Withdraw to Lightning
					</DialogTitle>
					<DialogDescription>Pay a Lightning invoice using your eCash (Balance: {totalBalance.toLocaleString()} sats)</DialogDescription>
				</DialogHeader>

				{isSuccess ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-success-muted flex items-center justify-center">
							<Check className="w-6 h-6 text-success" />
						</div>
						<p className="text-lg font-medium text-success">Withdrawal Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">Your Lightning invoice has been paid</p>
						<Button onClick={onClose} className="mt-4">
							Done
						</Button>
					</div>
				) : showScanner ? (
					<div className="space-y-4">
						<div className="relative w-full aspect-square overflow-hidden rounded-lg">
							<Scanner onScan={handleScan} onError={onScannerError} constraints={{ facingMode: 'environment' }} />
						</div>
						<div className="flex justify-end">
							<Button variant="outline" onClick={() => onShowScannerChange(false)}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{mintsWithBalance.length > 0 && (
							<div className="space-y-2">
								<label className="text-sm font-medium">From Mint</label>
								<select
									value={selectedMint}
									onChange={(e) => onSelectedMintChange(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{mintsWithBalance.map((mint) => (
										<option key={mint} value={mint}>
											{new URL(mint).hostname} ({(balances[mint] ?? 0).toLocaleString()} sats)
										</option>
									))}
								</select>
							</div>
						)}

						<div className="space-y-2">
							<label className="text-sm font-medium">Lightning Invoice</label>
							<div className="flex gap-2">
								<textarea
									value={invoice}
									onChange={(e) => onInvoiceChange(e.target.value)}
									placeholder="lnbc..."
									className="flex-1 px-3 py-2 text-sm border rounded-md bg-background font-mono resize-none h-24"
								/>
							</div>
							<div className="flex justify-end">
								<Button variant="ghost" size="sm" onClick={() => onShowScannerChange(true)} className="gap-2">
									<ScanLine className="w-4 h-4" />
									Scan QR
								</Button>
							</div>
						</div>

						{cashuInitializing && (
							<p className="text-sm text-muted-foreground flex items-center gap-2">
								<Loader2 className="w-4 h-4 animate-spin" />
								Initializing wallet...
							</p>
						)}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={onClose}>
								Cancel
							</Button>
							<Button onClick={onWithdraw} disabled={isWithdrawing || !invoice.trim() || !selectedMint || cashuInitializing}>
								{isWithdrawing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Withdraw
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
