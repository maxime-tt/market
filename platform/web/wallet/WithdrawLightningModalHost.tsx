/**
 * Withdraw to Lightning — platform host.
 *
 * The retired `src/feature/wallet/components/WithdrawLightningModal.tsx` split:
 * this host owns the cashu store subscription, the invoice and mint fields, the
 * scanner toggle, the melt action and the toasts;
 * `@ui/wallet/withdraw-lightning-modal-view` renders the props-only dialog.
 */
import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { WithdrawLightningModalView } from '@ui/wallet/withdraw-lightning-modal-view'

interface WithdrawLightningModalHostProps {
	open: boolean
	onClose: () => void
}

export function WithdrawLightningModalHost({ open, onClose }: WithdrawLightningModalHostProps) {
	const { mints, balances, totalBalance: balance, status: cashuStatus } = useStore(cashuStore)

	const [invoice, setInvoice] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isWithdrawing, setIsWithdrawing] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Sync selectedMint with defaultMint when modal opens
	useEffect(() => {
		if (open) {
			setSelectedMint(mints[0] ?? '')
			// Initialize cashu if not ready
			if (cashuStatus === 'idle') {
				cashuActions.initialize()
			}
		}
	}, [open, mints, cashuStatus])

	const handleWithdraw = async () => {
		if (!invoice.trim()) {
			toast.error('Please enter a Lightning invoice')
			return
		}

		// Basic validation for Lightning invoice
		const normalizedInvoice = invoice.toLowerCase().trim()
		if (!normalizedInvoice.startsWith('lnbc') && !normalizedInvoice.startsWith('lightning:')) {
			toast.error('Invalid Lightning invoice format')
			return
		}

		if (!selectedMint) {
			toast.error('Please select a mint')
			return
		}

		setIsWithdrawing(true)
		setError(null)
		try {
			// Remove lightning: prefix if present
			const cleanInvoice = invoice.replace(/^lightning:/i, '').trim()

			// Check if coco has balance at the selected mint
			const cashuMintBalance = balances[selectedMint] ?? 0

			console.log('[Withdraw] Using coco for melt')
			await cashuActions.melt(selectedMint, cleanInvoice)

			setIsSuccess(true)
			toast.success('Withdrawal successful!')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Withdrawal failed'
			setError(message)
			toast.error(message)
		} finally {
			setIsWithdrawing(false)
		}
	}

	const handleScan = (rawValue: string) => {
		// Remove lightning: prefix if present
		const cleanInvoice = rawValue.replace(/^lightning:/i, '').trim()
		setInvoice(cleanInvoice)
		setShowScanner(false)
		toast.success('Invoice scanned')
	}

	const handleClose = () => {
		setInvoice('')
		setSelectedMint('')
		setIsSuccess(false)
		setShowScanner(false)
		setError(null)
		onClose()
	}

	// Get mints that have balance
	const mintsWithBalance = mints.filter((mint) => (balances[mint] ?? 0) > 0)

	return (
		<WithdrawLightningModalView
			open={open}
			onClose={handleClose}
			invoice={invoice}
			onInvoiceChange={setInvoice}
			selectedMint={selectedMint}
			onSelectedMintChange={setSelectedMint}
			mintsWithBalance={mintsWithBalance}
			balances={balances}
			totalBalance={balance}
			isWithdrawing={isWithdrawing}
			isSuccess={isSuccess}
			showScanner={showScanner}
			onShowScannerChange={setShowScanner}
			error={error}
			onScan={handleScan}
			onScannerError={(err) => {
				console.error('Scanner error:', err)
				toast.error('Camera error')
			}}
			onWithdraw={handleWithdraw}
			cashuInitializing={cashuStatus === 'initializing'}
		/>
	)
}
