import { Component, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Loader2, Send } from 'lucide-react'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { Button } from '../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'
import { QRCode } from '../primitives/qr-code'

/**
 * Maximum byte capacity for a QR code at version 40, error correction level L, byte mode.
 * Using a conservative threshold slightly below the theoretical 2,953 to account for
 * mode indicators and character count overhead in the QR encoding.
 */
const QR_MAX_BYTES = 2900

export type SendEcashView = 'form' | 'token'

/**
 * Error Boundary to catch "code length overflow" errors thrown by the QR primitive during render.
 * Without this, a token that exceeds QR capacity will crash the entire modal.
 */
class QRErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
	state = { hasError: false }

	static getDerivedStateFromError(): { hasError: boolean } {
		return { hasError: true }
	}

	componentDidCatch(error: Error): void {
		console.error('[QRCode] Render error:', error)
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback
		}
		return this.props.children
	}
}

/**
 * Send eCash — the presentational half of the retired
 * `src/feature/wallet/components/SendEcashModal.tsx`.
 *
 * Props-only: the host owns the amount/mint fields, the generate action, the
 * copy state and the cashu store subscription. The token-mode QR is rendered
 * through the white-backed `@ui/primitives/qr-code` wrapper (the parked
 * scheme-white surface lives in the generated primitive, not here).
 */
export interface SendEcashModalViewProps {
	open: boolean
	/** Called on overlay/escape/cancel/done; the host owns the state reset. */
	onClose: () => void
	view: SendEcashView
	amount: string
	onAmountChange: (amount: string) => void
	selectedMint: string
	onSelectedMintChange: (mint: string) => void
	mintsWithBalance: readonly string[]
	balances: Record<string, number>
	totalBalance: number
	isGenerating: boolean
	generatedToken: string | null
	copied: boolean
	onCopyToken: () => void
	error: string | null
	onGenerate: () => void
	/** Returns the dialog to the amount form for another token. */
	onSendAnother: () => void
	cashuInitializing: boolean
}

export function SendEcashModalView({
	open,
	onClose,
	view,
	amount,
	onAmountChange,
	selectedMint,
	onSelectedMintChange,
	mintsWithBalance,
	balances,
	totalBalance,
	isGenerating,
	generatedToken,
	copied,
	onCopyToken,
	error,
	onGenerate,
	onSendAnother,
	cashuInitializing,
}: SendEcashModalViewProps) {
	// Check if token exceeds QR capacity for conditional UI
	const tokenTooLargeForQR = generatedToken !== null && new Blob([generatedToken]).size > QR_MAX_BYTES

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Send className="w-5 h-5 text-fill-accent" />
						Send eCash
					</DialogTitle>
					<DialogDescription>Generate a Cashu token to send eCash (Balance: {totalBalance.toLocaleString()} sats)</DialogDescription>
				</DialogHeader>

				{view === 'token' && generatedToken ? (
					<div className="space-y-4">
						{/* QR Code with Error Boundary — if rendering fails (overflow), show fallback */}
						{!tokenTooLargeForQR ? (
							<div className="flex justify-center">
								<div className="p-4 bg-surface-raised rounded-lg">
									<QRErrorBoundary
										fallback={
											<div className="flex flex-col items-center gap-2 p-8 text-center">
												<AlertTriangle className="w-8 h-8 text-warning" />
												<p className="text-sm text-text-mid">
													QR code is too dense to render. Use the copy button below to share the token.
												</p>
											</div>
										}
									>
										<QRCode value={generatedToken} size={360} includeMargin level="L" />
									</QRErrorBoundary>
								</div>
							</div>
						) : (
							<div className="flex flex-col items-center gap-2 p-6 text-center border rounded-lg bg-surface-sunken/50">
								<AlertTriangle className="w-8 h-8 text-warning" />
								<p className="text-sm font-medium">Token too large for QR code</p>
								<p className="text-xs text-text-mid">
									This token exceeds QR code capacity. Use copy/paste to share it, or try sending a smaller amount.
								</p>
							</div>
						)}

						<div className="space-y-2">
							<p className="text-sm font-medium">Cashu Token</p>
							<div className="flex gap-2">
								<textarea
									value={generatedToken}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-surface-sunken rounded-md font-mono resize-none h-24"
								/>
							</div>
							<div className="flex justify-end">
								<Button variant="outline" size="sm" onClick={onCopyToken} className="gap-2">
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
									{copied ? 'Copied!' : 'Copy Token'}
								</Button>
							</div>
						</div>
						<p className="text-sm text-text-mid text-center">Share this token with the recipient. It can only be redeemed once.</p>
						<p className="text-xs text-text-mid text-center">
							Token saved to pending list. You can reclaim it if the recipient doesn't claim it.
						</p>
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={onSendAnother}>
								Send Another
							</Button>
							<Button onClick={onClose}>Done</Button>
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
								className="w-full px-3 py-2 text-sm border rounded-md bg-bg"
								min="1"
								max={totalBalance}
							/>
						</div>

						{mintsWithBalance.length > 0 && (
							<div className="space-y-2">
								<label className="text-sm font-medium">From Mint</label>
								<select
									value={selectedMint}
									onChange={(e) => onSelectedMintChange(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-bg"
								>
									{mintsWithBalance.map((mint) => (
										<option key={mint} value={mint}>
											{getMintHostname(mint)} ({(balances[mint] ?? 0).toLocaleString()} sats)
										</option>
									))}
								</select>
							</div>
						)}

						{cashuInitializing && (
							<p className="text-sm text-text-mid flex items-center gap-2">
								<Loader2 className="w-4 h-4 animate-spin" />
								Initializing wallet...
							</p>
						)}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={onClose}>
								Cancel
							</Button>
							<Button onClick={onGenerate} disabled={isGenerating || !amount || !selectedMint || cashuInitializing}>
								{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Generate Token
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
