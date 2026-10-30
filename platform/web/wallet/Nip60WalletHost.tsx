/**
 * NIP-60 wallet panel — platform host.
 *
 * The retired `src/feature/wallet/components/Nip60Wallet.tsx` split: this host
 * owns the auth/cashu store subscriptions, every wallet action and the four
 * ecash/lightning modal hosts; `@ui/wallet/nip60-wallet-view` renders the
 * props-only panel and the two pending-token dialogs.
 */
import { useEffect, useState, useMemo } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { authStore } from '@platform/web/auth/authStore'
import { cashuActions, cashuStore, type PendingToken } from '@platform/web/wallet/cashuStore'
import { walletOps, type WalletDevAuctionBidResult, type WalletTestMintResult } from '@platform/web/wallet/walletOps'
import { Nip60WalletView, type Nip60WalletModalType } from '@ui/wallet/nip60-wallet-view'
import { DepositLightningModalHost } from './DepositLightningModalHost'
import { ReceiveEcashModalHost } from './ReceiveEcashModalHost'
import { SendEcashModalHost } from './SendEcashModalHost'
import { WithdrawLightningModalHost } from './WithdrawLightningModalHost'

export function Nip60WalletHost() {
	const { isAuthenticated, user } = useStore(authStore)
	const { status, totalBalance, balances, mints, error, pendingTokens } = useStore(cashuStore)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [openModal, setOpenModal] = useState<Nip60WalletModalType | null>(null)
	const [openSection, setOpenSection] = useState<'mints' | 'pending' | null>(null)
	const [viewingToken, setViewingToken] = useState<PendingToken | null>(null)
	const [isReclaiming, setIsReclaiming] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [devMintAmount, setDevMintAmount] = useState('1000')
	const [devBidAmount, setDevBidAmount] = useState('')
	const [isDevMinting, setIsDevMinting] = useState(false)
	const [isDevBidding, setIsDevBidding] = useState(false)
	const [lastDevMint, setLastDevMint] = useState<WalletTestMintResult | null>(null)
	const [lastDevBid, setLastDevBid] = useState<WalletDevAuctionBidResult | null>(null)
	// Dev-only tools are gated on the bundler's dev flag. It is read defensively
	// because reading `.DEV` off a missing `import.meta.env` would throw at
	// module load (Bun does not define `import.meta.env` in its client bundle).
	const walletDevMode = Boolean(import.meta.env && import.meta.env.DEV)
	const [tokenPendingRemoval, setTokenPendingRemoval] = useState<PendingToken | null>(null)

	// Pending tokens coco has generated but the recipient has not claimed.
	const activePendingTokens: PendingToken[] = useMemo(
		() => pendingTokens.filter((t) => t.status === 'pending').sort((a, b) => b.createdAt - a.createdAt),
		[pendingTokens],
	)

	useEffect(() => {
		if (!isAuthenticated || !user?.pubkey) {
			return
		}

		// Initialize wallet if not already initialized
		if (status === 'idle') {
			cashuActions.initialize()
		}
	}, [isAuthenticated, user?.pubkey, status])

	const handleRefresh = async () => {
		setIsRefreshing(true)
		try {
			// Re-read balances from coco
			await cashuActions.refreshBalances()
		} finally {
			setIsRefreshing(false)
		}
	}

	const handleAddMint = async () => {
		const mintUrl = newMintUrl.trim()
		if (!mintUrl) return
		try {
			await cashuActions.addMint(mintUrl)
			setNewMintUrl('')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to add mint')
		}
	}

	const handleCopyToken = async (tokenString: string) => {
		try {
			await navigator.clipboard.writeText(tokenString)
			setCopied(true)
			toast.success('Token copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	const handleReclaim = async (pendingToken: PendingToken) => {
		setIsReclaiming(pendingToken.id)
		try {
			const success = await cashuActions.reclaimToken(pendingToken.id)
			if (success) {
				toast.success('Token reclaimed! Funds returned to wallet.')
			} else {
				toast.info('Token already claimed by recipient')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to reclaim token'
			toast.error(message)
		} finally {
			setIsReclaiming(null)
		}
	}

	const handleRemovePendingToken = (token: PendingToken) => {
		cashuActions.removePendingToken(token.id)
		toast.success('Token removed from history')
	}

	const handleDevMintTestEcash = async () => {
		const amount = Math.floor(parseInt(devMintAmount || '0', 10))
		if (!Number.isFinite(amount) || amount <= 0) {
			toast.error('Mint amount must be a positive number')
			return
		}

		setIsDevMinting(true)
		try {
			const result = await walletOps.mintTestEcash(amount, mints[0])
			setLastDevMint(result)
			toast.success(`Minted ${result.amount.toLocaleString()} sats from ${getMintHostname(result.mintUrl)}`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to mint test ecash')
		} finally {
			setIsDevMinting(false)
		}
	}

	const handleDevBidSeededAuction = async () => {
		const preferredBidAmount = devBidAmount.trim() ? parseInt(devBidAmount.trim(), 10) : undefined
		if (preferredBidAmount !== undefined && (!Number.isFinite(preferredBidAmount) || preferredBidAmount <= 0)) {
			toast.error('Bid amount must be a positive number')
			return
		}

		setIsDevBidding(true)
		try {
			const result = await walletOps.placeDevBidOnSeededAuction({ preferredBidAmount, preferredMintUrl: mints[0] })
			setLastDevBid(result)
			toast.success(`Bid placed: ${result.bidAmount.toLocaleString()} sats on "${result.auctionTitle}"`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to place dev bid')
		} finally {
			setIsDevBidding(false)
		}
	}

	const handleConfirmRemovePendingToken = () => {
		if (!tokenPendingRemoval) return
		handleRemovePendingToken(tokenPendingRemoval)
		setTokenPendingRemoval(null)
	}

	const handleClaimFirst = async () => {
		if (!tokenPendingRemoval) return
		const token = tokenPendingRemoval
		setTokenPendingRemoval(null)
		await handleReclaim(token)
	}

	return (
		<>
			<Nip60WalletView
				isAuthenticated={isAuthenticated}
				status={status}
				error={error}
				totalBalance={totalBalance}
				balances={balances}
				mints={mints}
				activePendingTokens={activePendingTokens}
				isRefreshing={isRefreshing}
				onRefresh={handleRefresh}
				onOpenModal={setOpenModal}
				openSection={openSection}
				onOpenSectionChange={setOpenSection}
				newMintUrl={newMintUrl}
				onNewMintUrlChange={setNewMintUrl}
				onAddMint={handleAddMint}
				viewingToken={viewingToken}
				onViewingTokenChange={setViewingToken}
				isReclaiming={isReclaiming}
				onReclaim={handleReclaim}
				copied={copied}
				onCopyToken={handleCopyToken}
				tokenPendingRemoval={tokenPendingRemoval}
				onTokenPendingRemovalChange={setTokenPendingRemoval}
				onConfirmRemovePendingToken={handleConfirmRemovePendingToken}
				onClaimFirst={handleClaimFirst}
				walletDevMode={walletDevMode}
				devMintAmount={devMintAmount}
				onDevMintAmountChange={setDevMintAmount}
				devBidAmount={devBidAmount}
				onDevBidAmountChange={setDevBidAmount}
				isDevMinting={isDevMinting}
				isDevBidding={isDevBidding}
				lastDevMint={lastDevMint}
				lastDevBid={lastDevBid}
				onDevMintTestEcash={handleDevMintTestEcash}
				onDevBidSeededAuction={handleDevBidSeededAuction}
			/>

			{/* Modals */}
			<DepositLightningModalHost open={openModal === 'deposit'} onClose={() => setOpenModal(null)} />
			<WithdrawLightningModalHost open={openModal === 'withdraw'} onClose={() => setOpenModal(null)} />
			<SendEcashModalHost open={openModal === 'send'} onClose={() => setOpenModal(null)} />
			<ReceiveEcashModalHost open={openModal === 'receive'} onClose={() => setOpenModal(null)} />
		</>
	)
}
