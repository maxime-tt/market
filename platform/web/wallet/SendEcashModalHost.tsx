/**
 * Send eCash — platform host.
 *
 * The retired `src/feature/wallet/components/SendEcashModal.tsx` split: this
 * host owns the cashu store subscription, the amount/mint fields, the generate
 * action, the clipboard copy and the toasts;
 * `@ui/wallet/send-ecash-modal-view` renders the props-only dialog.
 */
import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { SendEcashModalView, type SendEcashView } from '@ui/wallet/send-ecash-modal-view'

interface SendEcashModalHostProps {
	open: boolean
	onClose: () => void
}

/**
 * Maximum byte capacity for a QR code at version 40, error correction level L, byte mode.
 * Kept in step with the view's own threshold; used only for the pre-flight warning.
 */
const QR_MAX_BYTES = 2900

export function SendEcashModalHost({ open, onClose }: SendEcashModalHostProps) {
	const { mints, balances, totalBalance, status: cashuStatus } = useStore(cashuStore)

	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [generatedToken, setGeneratedToken] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [view, setView] = useState<SendEcashView>('form')

	// Sync selectedMint with defaultMint when modal opens or defaultMint changes
	useEffect(() => {
		if (open) {
			setSelectedMint(mints[0] ?? '')
			// Initialize cashu if not ready
			if (cashuStatus === 'idle') {
				cashuActions.initialize()
			}
		}
	}, [open, mints, cashuStatus])

	const handleGenerate = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		// Check balance at selected mint
		const mintBalance = selectedMint ? (balances[selectedMint] ?? 0) : totalBalance
		if (amountNum > mintBalance) {
			toast.error(`Insufficient balance at ${selectedMint ? getMintHostname(selectedMint) : 'wallet'}`)
			return
		}

		setIsGenerating(true)
		setError(null)
		try {
			// Check if coco has balance at the selected mint
			const cocoMintBalance = balances[selectedMint] ?? 0

			console.log('[SendEcash] Using coco for send')
			const token = await cashuActions.send(selectedMint, amountNum)

			if (token) {
				// Pre-flight check: warn if the token is likely too large for a QR code
				const tokenBytes = new Blob([token]).size
				if (tokenBytes > QR_MAX_BYTES) {
					console.warn(
						`[SendEcash] Token is ${tokenBytes} bytes, exceeds QR capacity (~${QR_MAX_BYTES} bytes). ` +
							`QR code may not render. Consider splitting into smaller amounts.`,
					)
					toast.warning('Token is large — QR code may not be scannable. You can still copy the token text.')
				}

				setGeneratedToken(token)
				setView('token')
				toast.success('eCash token generated!')
			} else {
				throw new Error('Failed to generate token')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to generate eCash token'
			setError(message)
			toast.error(message)
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopyToken = async () => {
		if (!generatedToken) return
		try {
			await navigator.clipboard.writeText(generatedToken)
			setCopied(true)
			toast.success('Token copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	const handleClose = () => {
		setAmount('')
		setGeneratedToken(null)
		setCopied(false)
		setError(null)
		setView('form')
		onClose()
	}

	// Get mints that have balance
	const mintsWithBalance = mints.filter((mint) => (balances[mint] ?? 0) > 0)

	return (
		<SendEcashModalView
			open={open}
			onClose={handleClose}
			view={view}
			amount={amount}
			onAmountChange={setAmount}
			selectedMint={selectedMint}
			onSelectedMintChange={setSelectedMint}
			mintsWithBalance={mintsWithBalance}
			balances={balances}
			totalBalance={totalBalance}
			isGenerating={isGenerating}
			generatedToken={generatedToken}
			copied={copied}
			onCopyToken={handleCopyToken}
			error={error}
			onGenerate={handleGenerate}
			onSendAnother={() => setView('form')}
			cashuInitializing={cashuStatus === 'initializing'}
		/>
	)
}
