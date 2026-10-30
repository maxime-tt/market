import { Check, Loader2, QrCode, ScanLine } from 'lucide-react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { Button } from '../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'

/**
 * Receive eCash — the presentational half of the retired
 * `src/feature/wallet/components/ReceiveEcashModal.tsx`.
 *
 * Props-only: the platform host owns the token field, the scanner toggle, the
 * receive action and the cashu store subscription. The raw amber/blue/green
 * palette of the original is mapped to semantic tones.
 */
export interface ReceiveEcashModalViewProps {
	open: boolean
	/** Called on overlay/escape/cancel/close; the host owns the state reset. */
	onClose: () => void
	token: string
	onTokenChange: (token: string) => void
	isReceiving: boolean
	isSuccess: boolean
	showScanner: boolean
	onShowScannerChange: (show: boolean) => void
	error: string | null
	/** Raw value of the first detected QR code; the host validates it. */
	onScan: (rawValue: string) => void
	onScannerError: (error: unknown) => void
	/** Runs the receive action; the host validates the token first. */
	onReceive: () => void
	cashuInitializing: boolean
}

export function ReceiveEcashModalView({
	open,
	onClose,
	token,
	onTokenChange,
	isReceiving,
	isSuccess,
	showScanner,
	onShowScannerChange,
	error,
	onScan,
	onScannerError,
	onReceive,
	cashuInitializing,
}: ReceiveEcashModalViewProps) {
	const handleScan = (detectedCodes: { rawValue: string }[]) => {
		const rawValue = detectedCodes?.[0]?.rawValue
		if (rawValue) onScan(rawValue)
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<QrCode className="w-5 h-5 text-info" />
						Receive eCash
					</DialogTitle>
					<DialogDescription>Scan or paste a Cashu token to receive eCash</DialogDescription>
				</DialogHeader>

				{isSuccess ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-success-muted flex items-center justify-center">
							<Check className="w-6 h-6 text-success" />
						</div>
						<p className="text-lg font-medium text-success">eCash Received!</p>
						<p className="text-sm text-muted-foreground mt-2">The tokens have been added to your wallet</p>
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
						<div className="space-y-2">
							<label className="text-sm font-medium">Cashu Token</label>
							<textarea
								value={token}
								onChange={(e) => onTokenChange(e.target.value)}
								placeholder="cashuA..."
								className="w-full px-3 py-2 text-sm border rounded-md bg-background font-mono resize-none h-24"
							/>
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
							<Button onClick={onReceive} disabled={isReceiving || !token.trim() || cashuInitializing}>
								{isReceiving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Receive
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
