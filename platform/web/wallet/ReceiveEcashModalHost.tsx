/**
 * Receive eCash — platform host.
 *
 * The retired `src/feature/wallet/components/ReceiveEcashModal.tsx` split: this
 * host owns the cashu store subscription, the token field, the scanner toggle,
 * the receive action and the toasts; `@ui/wallet/receive-ecash-modal-view`
 * renders the props-only dialog.
 */
import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { ReceiveEcashModalView } from '@ui/wallet/receive-ecash-modal-view'

interface ReceiveEcashModalHostProps {
	open: boolean
	onClose: () => void
}

export function ReceiveEcashModalHost({ open, onClose }: ReceiveEcashModalHostProps) {
	const { status: cashuStatus } = useStore(cashuStore)
	const [token, setToken] = useState('')
	const [isReceiving, setIsReceiving] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Initialize cashu when modal opens
	useEffect(() => {
		if (open && cashuStatus === 'idle') {
			cashuActions.initialize()
		}
	}, [open, cashuStatus])

	const handleReceive = async () => {
		if (!token.trim()) {
			toast.error('Please enter a Cashu token')
			return
		}

		// Basic validation for Cashu token
		const normalizedToken = token.trim()
		if (!normalizedToken.startsWith('cashuA') && !normalizedToken.startsWith('cashuB')) {
			toast.error('Invalid Cashu token format')
			return
		}

		setIsReceiving(true)
		setError(null)
		try {
			// Receive through coco's local wallet. Relay recovery of wallet state after a
			// device change goes away (see docs/adr/ADR-0010-cashu-wallet-deps-recovery-sync.md).
			await cashuActions.receive(normalizedToken)
			setIsSuccess(true)
			toast.success('eCash received successfully!')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to receive eCash'
			setError(message)
			toast.error(message)
		} finally {
			setIsReceiving(false)
		}
	}

	const handleScan = (rawValue: string) => {
		if (rawValue.startsWith('cashuA') || rawValue.startsWith('cashuB')) {
			setToken(rawValue)
			setShowScanner(false)
			toast.success('Token scanned')
		} else {
			toast.error('Invalid Cashu token')
		}
	}

	const handleClose = () => {
		setToken('')
		setIsSuccess(false)
		setShowScanner(false)
		setError(null)
		onClose()
	}

	return (
		<ReceiveEcashModalView
			open={open}
			onClose={handleClose}
			token={token}
			onTokenChange={setToken}
			isReceiving={isReceiving}
			isSuccess={isSuccess}
			showScanner={showScanner}
			onShowScannerChange={setShowScanner}
			error={error}
			onScan={handleScan}
			onScannerError={(err) => {
				console.error('Scanner error:', err)
				toast.error('Camera error')
			}}
			onReceive={handleReceive}
			cashuInitializing={cashuStatus === 'initializing'}
		/>
	)
}
