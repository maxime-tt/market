/**
 * Deposit Lightning — platform host.
 *
 * The retired `src/feature/wallet/components/DepositLightningModal.tsx` split:
 * every state machine, effect, `useRef` latch and store subscription stays
 * here, and `@ui/wallet/deposit-lightning-modal-view` renders the props-only
 * dialog. Behaviour is carried over verbatim — in particular the
 * evidence-gated `deposit_outcome_uncertain` classification and the
 * open→closed reset — so the money path is unchanged by the split.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import { useWallets, walletActions } from '@platform/web/config/walletStore'
import { classifyDepositTerminalErrorOutcome, type AuctionBidFundingFailureReason } from '@platform/web/auctions/useAuctionBidFunding'
import { normalizeMintUrl } from '@sdk/commerce/payments/display'
import { DepositLightningModalView } from '@ui/wallet/deposit-lightning-modal-view'

const isValidMintUrl = (mintUrl: string): boolean => {
	const normalizedMintUrl = normalizeMintUrl(mintUrl)
	if (!normalizedMintUrl) return false
	try {
		new URL(normalizedMintUrl)
		return true
	} catch {
		return false
	}
}

const normalizeValidMintUrl = (mintUrl: string): string | null => {
	const normalizedMintUrl = normalizeMintUrl(mintUrl)
	return isValidMintUrl(normalizedMintUrl) ? normalizedMintUrl : null
}

interface DepositLightningModalHostProps {
	open: boolean
	onClose: () => void
	initialAmount?: number
	preferredMint?: string
	allowedMints?: string[]
	onSuccess?: () => void
	onInvoiceCreated?: (invoice: string) => void
	onPaymentAcknowledged?: () => void
	onFundingFailed?: (reason: AuctionBidFundingFailureReason) => void
	/**
	 * 'bid' renders the compact "Bid with lightning" quick-pay view: fixed
	 * (non-editable) amount and auto-generated QR once a mint resolves.
	 * The user pays the exact bid amount; no manual top-up mode.
	 */
	variant?: 'bid' | 'topup'
}

type NwcDepositPaymentStatus = 'idle' | 'paying' | 'sent'

export function DepositLightningModalHost({
	open,
	onClose,
	initialAmount,
	preferredMint,
	allowedMints,
	onSuccess,
	onInvoiceCreated,
	onPaymentAcknowledged,
	onFundingFailed,
	variant = 'topup',
}: DepositLightningModalHostProps) {
	const { mints, defaultMint, depositInvoice, depositStatus, error: depositError } = useStore(cashuStore)
	const { wallets, isInitialized: walletsInitialized, isLoading: walletsLoading, initialize: initializeWallets } = useWallets()
	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [copied, setCopied] = useState(false)
	const [selectedNwcWalletId, setSelectedNwcWalletId] = useState('')
	const [nwcPaymentStatus, setNwcPaymentStatus] = useState<NwcDepositPaymentStatus>('idle')
	const [showClassicTopUp, setShowClassicTopUp] = useState(false)
	const [isCheckingDeposit, setIsCheckingDeposit] = useState(false)
	const isBidQuickView = variant === 'bid' && !showClassicTopUp
	const autoGenerateAttemptedKeyRef = useRef<string | null>(null)
	const wasOpenRef = useRef(false)
	const sentNwcInvoiceRef = useRef<string | null>(null)
	const nwcPaymentSentForCurrentInvoice = !!depositInvoice && sentNwcInvoiceRef.current === depositInvoice
	const isPayingWithNwc = nwcPaymentStatus === 'paying'
	const needsConfirmationRetry = depositStatus === 'awaiting_confirmation_retry'
	const nwcPaymentSent = nwcPaymentStatus === 'sent' || nwcPaymentSentForCurrentInvoice
	const nwcPaymentAttempted = nwcPaymentStatus !== 'idle' || nwcPaymentSentForCurrentInvoice
	const successNotifiedRef = useRef(false)
	const paymentAcknowledgedRef = useRef(false)
	const failureNotifiedRef = useRef(false)
	const notifiedInvoiceRef = useRef<string | null>(null)
	// #1235 round-3 B3: whether an invoice was notified for THIS deposit
	// session. Unlike `notifiedInvoiceRef` (cleared as soon as `depositInvoice`
	// clears — which happens in the SAME store update that lands a terminal
	// 'error', so the error effect can never observe it), this latches for the
	// whole session and only resets on modal close. It is the evidence gate for
	// classifying a terminal deposit error as 'deposit_outcome_uncertain': a
	// payment could have been made only if an invoice existed.
	const sessionInvoiceExistedRef = useRef(false)
	const filteredMints = useMemo(() => {
		const normalizedWalletMints = mints.map(normalizeValidMintUrl).filter((mintUrl): mintUrl is string => mintUrl !== null)
		const normalizedAllowedMints = allowedMints?.map(normalizeValidMintUrl).filter((mintUrl): mintUrl is string => mintUrl !== null) ?? []

		if (!allowedMints?.length) return normalizedWalletMints

		const allowedMintSet = new Set(normalizedAllowedMints)
		return normalizedWalletMints.filter((mint) => allowedMintSet.has(mint))
	}, [allowedMints, mints])
	const hasAllowedMints = filteredMints.length > 0

	const savedNwcWallets = useMemo(() => wallets.filter((wallet) => !!wallet.nwcUri), [wallets])

	const resetNwcPaymentState = useCallback(() => {
		setNwcPaymentStatus('idle')
	}, [])

	useEffect(() => {
		if (!open) {
			wasOpenRef.current = false
			return
		}

		const normalizedPreferredMint = normalizeValidMintUrl(preferredMint ?? '')
		const normalizedDefaultMint = normalizeValidMintUrl(defaultMint ?? '')
		const preferred = normalizedPreferredMint ? filteredMints.find((mint) => mint === normalizedPreferredMint) : ''
		const defaultAllowedMint = normalizedDefaultMint ? filteredMints.find((mint) => mint === normalizedDefaultMint) : ''
		const nextSelectedMint = preferred || defaultAllowedMint || filteredMints[0] || ''

		if (!wasOpenRef.current) {
			wasOpenRef.current = true
			setSelectedMint(nextSelectedMint)
			if (typeof initialAmount === 'number' && Number.isFinite(initialAmount) && initialAmount > 0) {
				setAmount(String(Math.ceil(initialAmount)))
			}
			return
		}

		setSelectedMint((currentMint) => {
			const normalizedCurrentMint = normalizeValidMintUrl(currentMint)
			if (normalizedCurrentMint && filteredMints.includes(normalizedCurrentMint)) {
				return currentMint
			}
			return nextSelectedMint
		})
	}, [open, defaultMint, filteredMints, initialAmount, preferredMint])

	useEffect(() => {
		if (open && !walletsInitialized && !walletsLoading) {
			void initializeWallets()
		}
	}, [open, walletsInitialized, walletsLoading, initializeWallets])

	useEffect(() => {
		if (!depositInvoice || savedNwcWallets.length === 0) {
			setSelectedNwcWalletId('')
			return
		}

		const selectedWalletStillAvailable = savedNwcWallets.some((wallet) => wallet.id === selectedNwcWalletId)
		if (!selectedWalletStillAvailable) {
			setSelectedNwcWalletId(savedNwcWallets[0].id)
		}
	}, [depositInvoice, savedNwcWallets, selectedNwcWalletId])

	useEffect(() => {
		if (depositStatus === 'success' || depositStatus === 'error' || (!depositInvoice && depositStatus !== 'pending')) {
			sentNwcInvoiceRef.current = null
			resetNwcPaymentState()
		}
	}, [depositInvoice, depositStatus, resetNwcPaymentState])

	useEffect(() => {
		if (!depositInvoice || depositStatus !== 'pending') {
			if (!depositInvoice) notifiedInvoiceRef.current = null
			return
		}
		if (notifiedInvoiceRef.current === depositInvoice) return
		notifiedInvoiceRef.current = depositInvoice
		sessionInvoiceExistedRef.current = true
		onInvoiceCreated?.(depositInvoice)
	}, [depositInvoice, depositStatus, onInvoiceCreated])

	useEffect(() => {
		if (nwcPaymentStatus !== 'sent' && !nwcPaymentSentForCurrentInvoice) return
		paymentAcknowledgedRef.current = true
		// Only acknowledge payment here. The minting_started → ecash_minted
		// progression is driven by the deposit-success path (handleFundingSuccess
		// walks forward through the intermediate states), since neither the NWC
		// nor the QR path can observe a distinct 'minting started' event.
		onPaymentAcknowledged?.()
	}, [nwcPaymentSentForCurrentInvoice, nwcPaymentStatus, onPaymentAcknowledged])

	useEffect(() => {
		if (depositStatus !== 'error') return
		if (failureNotifiedRef.current) return
		// #1235 round-3 B3 — evidence-gated classification. A terminal deposit
		// error is 'deposit_outcome_uncertain' ONLY when an invoice existed for
		// this session (a payment could have been made — NDK emits 'error' only
		// AFTER mintProofs() returned proofs when the wallet-state update
		// fails). Pre-invoice errors (invalid amount / no mint / quote failure)
		// created nothing: NO classification — the lifecycle stays put, the
		// error still renders below, and a close cleanly cancels.
		const outcome = classifyDepositTerminalErrorOutcome({ invoiceExisted: sessionInvoiceExistedRef.current })
		if (!outcome) return
		failureNotifiedRef.current = true
		onFundingFailed?.(outcome)
	}, [depositStatus, onFundingFailed])

	useEffect(() => {
		if (depositStatus !== 'success') {
			successNotifiedRef.current = false
			return
		}

		if (successNotifiedRef.current) return
		successNotifiedRef.current = true
		failureNotifiedRef.current = false
		onSuccess?.()
	}, [depositStatus, onSuccess])

	// Bid quick view has no "Generate Invoice" button — once a mint resolves
	// (auto-picked from preferredMint/defaultMint/filteredMints), immediately
	// start the deposit so the QR appears without an extra click.
	useEffect(() => {
		if (!isBidQuickView || !open || !selectedMint) return
		if (depositInvoice || depositStatus === 'pending' || depositStatus === 'success') return

		const amountNum = parseInt(amount, 10)
		if (!Number.isFinite(amountNum) || amountNum <= 0) return

		const genKey = `${selectedMint}:${amountNum}`
		if (autoGenerateAttemptedKeyRef.current === genKey) return
		autoGenerateAttemptedKeyRef.current = genKey

		setIsGenerating(true)
		resetNwcPaymentState()
		void cashuActions
			.startDeposit(amountNum, selectedMint, { includeFeePadding: !!allowedMints?.length })
			.finally(() => setIsGenerating(false))
	}, [isBidQuickView, open, selectedMint, depositInvoice, depositStatus, amount, allowedMints, resetNwcPaymentState])

	const handleConfirmCheckNow = async () => {
		setIsCheckingDeposit(true)
		try {
			await cashuActions.checkDepositNow()
		} finally {
			setIsCheckingDeposit(false)
		}
	}

	const handleGenerateInvoice = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		if (!selectedMint) {
			toast.error('Please select a mint')
			return
		}

		setIsGenerating(true)
		resetNwcPaymentState()
		try {
			await cashuActions.startDeposit(amountNum, selectedMint, {
				includeFeePadding: !!allowedMints?.length,
			})
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopyInvoice = async () => {
		if (!depositInvoice) return
		try {
			await navigator.clipboard.writeText(depositInvoice)
			setCopied(true)
			toast.success('Invoice copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy invoice')
		}
	}

	const handlePayWithNwc = async () => {
		if (!depositInvoice || nwcPaymentStatus !== 'idle' || nwcPaymentSentForCurrentInvoice) return

		const selectedWallet = savedNwcWallets.find((wallet) => wallet.id === selectedNwcWalletId)
		if (!selectedWallet?.nwcUri) {
			toast.error('Could not pay invoice with connected wallet')
			return
		}

		const signer = getActiveSignerCapability()
		if (!signer) {
			toast.error('Connected wallet is not authorized')
			return
		}

		const invoiceBeingPaid = depositInvoice
		setNwcPaymentStatus('paying')
		try {
			await walletActions.payInvoiceWithNwc(selectedWallet.nwcUri, invoiceBeingPaid, signer)
			sentNwcInvoiceRef.current = invoiceBeingPaid
			setNwcPaymentStatus('sent')
			toast.success('Payment sent. Waiting for mint confirmation...')
		} catch (error) {
			setNwcPaymentStatus('idle')
			toast.error(error instanceof Error ? error.message : 'Could not pay invoice with connected wallet')
		}
	}

	const handleRetryConfirmation = () => {
		cashuActions.retryDepositConfirmation()
	}

	// #1235 Blocking 2 / round-3 B3 — classify a pending deposit close as
	// OUTCOME-UNCERTAIN. A QR payer's payment is unobservable by the app, and
	// even an NWC "sent" acknowledgement is not settlement — the app must
	// claim neither "paid" nor "unpaid" without evidence. The close preserves
	// the deposit's recovery so the SAME Lightning payment stays reconcilable
	// and a late success can still continue the flow. Shared by the
	// user-driven close path (handleClose) and the open→closed effect's
	// fallback so every close path classifies before the funding session is
	// torn down.
	const notifyFundingFailureForPendingDeposit = useCallback(() => {
		const isPendingDeposit = depositStatus === 'pending' || depositStatus === 'awaiting_confirmation_retry'
		if (!isPendingDeposit || failureNotifiedRef.current) return
		failureNotifiedRef.current = true
		onFundingFailed?.('deposit_outcome_uncertain')
	}, [depositStatus, onFundingFailed])

	// Root-cause reset: when the modal closes — whether by user action
	// (overlay/escape → handleClose → onClose) or programmatically (parent
	// sets open={false}, e.g. submitPreparedBid after bid_published) — the
	// global deposit state and all local refs must be reset so the next
	// open starts fresh. Radix UI's onOpenChange does NOT fire for
	// controlled prop changes, so we cannot rely on handleClose alone.
	const prevOpenRef = useRef(false)
	useEffect(() => {
		if (!prevOpenRef.current && !open) return // was closed, still closed
		if (prevOpenRef.current && !open) {
			// Transition: open → closed — reset everything.
			// Fallback classification for close paths that did not go through
			// handleClose (e.g. a future programmatic close with a deposit still
			// pending); user-driven closes already classified in handleClose.
			notifyFundingFailureForPendingDeposit()
			// #1235 Blocking 3 seam (fix-nip60 contract): preserve the deposit
			// identity for paid-or-uncertain closes so the SAME Lightning payment
			// can still be reconciled (retryDepositConfirmation /
			// checkDepositNow) after the modal closes — only the transient UI
			// status resets. A settled/failed/never-started deposit is fully
			// cleared as before.
			const isPendingDeposit = depositStatus === 'pending' || depositStatus === 'awaiting_confirmation_retry'
			const paidOrUnknown = paymentAcknowledgedRef.current || !nwcPaymentAttempted
			cashuActions.cancelDeposit(isPendingDeposit && paidOrUnknown ? { preserveRecovery: true } : undefined)

			setAmount('')
			setCopied(false)
			resetNwcPaymentState()
			successNotifiedRef.current = false
			paymentAcknowledgedRef.current = false
			failureNotifiedRef.current = false
			notifiedInvoiceRef.current = null
			sessionInvoiceExistedRef.current = false
			sentNwcInvoiceRef.current = null
			setShowClassicTopUp(false)
			setIsCheckingDeposit(false)
			autoGenerateAttemptedKeyRef.current = null
		}
		prevOpenRef.current = open
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps — only fires on open transition

	const handleClose = () => {
		if (isPayingWithNwc) return
		// #1235 Blocking 2 — classify BEFORE canceling. The parent's
		// handleDepositModalClose runs synchronously on onClose and would
		// transition the lifecycle to funding_canceled (clearing the pending
		// submission) before this modal's open→closed effect could classify;
		// the state machine would then reject the reclaimable transition.
		// Classifying first lands the lifecycle in the reclaimable failure
		// state while the session is still intact.
		notifyFundingFailureForPendingDeposit()
		onClose()
	}

	return (
		<DepositLightningModalView
			open={open}
			onClose={handleClose}
			variant={variant}
			isBidQuickView={isBidQuickView}
			amount={amount}
			onAmountChange={setAmount}
			selectedMint={selectedMint}
			onSelectedMintChange={setSelectedMint}
			filteredMints={filteredMints}
			hasAllowedMints={hasAllowedMints}
			allowedMints={allowedMints}
			depositInvoice={depositInvoice}
			depositStatus={depositStatus}
			depositError={depositError}
			isGenerating={isGenerating}
			copied={copied}
			onCopyInvoice={handleCopyInvoice}
			savedNwcWallets={savedNwcWallets}
			selectedNwcWalletId={selectedNwcWalletId}
			onSelectedNwcWalletChange={setSelectedNwcWalletId}
			isPayingWithNwc={isPayingWithNwc}
			nwcPaymentSent={nwcPaymentSent}
			nwcPaymentAttempted={nwcPaymentAttempted}
			needsConfirmationRetry={needsConfirmationRetry}
			onRetryConfirmation={handleRetryConfirmation}
			onConfirmCheckNow={handleConfirmCheckNow}
			isCheckingDeposit={isCheckingDeposit}
			onPayWithNwc={handlePayWithNwc}
			onGenerateInvoice={handleGenerateInvoice}
		/>
	)
}
