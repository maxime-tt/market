/**
 * Wallet panel — platform host.
 *
 * The wallet UI is a **Coco wallet host, not a NIP-60 wallet**. This host composes the app's
 * `CocoWalletHost` (`sdk/core/cashu-wrapper` through `@platform/web/wallet/cocoWalletHost`) over the same
 * coco `Manager` the payment rails run — the engine source, account identity, preferred mint, reconcilers
 * and durable stores declared once in `@platform/web/wallet/cocoWalletEngine` — and the panel's balance is
 * that host's own projection (`host.balance(account)`), never a total the UI derives for itself.
 *
 * It owns the auth/cashu store subscriptions, every wallet action and the four ecash/lightning modal
 * hosts; `@ui/wallet/nip60-wallet-view` renders the props-only panel and the two pending-token dialogs.
 *
 * ## What the host boundary does not model (and therefore stays on `cashuActions`/`walletOps`)
 *
 * `CocoWalletHost`'s operations are `balance`, `run`, `advance`, `get`, `list`, `recover`, `resume`,
 * `cancel`, `disposeAccount`, `dispose`. Its one leg is the melt; its runtime hands an adapter the melt
 * operations only. A mint quote (deposit), a token send, a token receive and the ecash pending-token
 * ledger are not operations it can express, so this host keeps calling the app's coco manager directly
 * through `cashuActions` for exactly those flows:
 *
 * - `cashuActions.initialize`         — the app's wallet bring-up (`initializeCoco`); the host's engine
 *                                       source delegates to it too, and cannot replace it.
 * - `cashuActions.refreshBalances`    — keeps the store's cache (which the send/withdraw modals read)
 *                                       current; the panel's own numbers come from `host.balance`.
 * - `cashuActions.addMint`            — mint configuration (`manager.mint.addMint`).
 * - `cashuActions.send`               — token minting + the pending-token ledger entry.
 * - `cashuActions.reclaimToken`       — reclaim of an unclaimed pending token.
 * - `cashuActions.removePendingToken` — pending-token history (localStorage).
 * - `walletOps.mintTestEcash`         — dev-only seeded-mint helper.
 * - `walletOps.placeDevBidOnSeededAuction` — dev-only seeded-auction bid helper.
 *
 * These are named as a gap, not as a second wallet: every one of them reads and moves proofs through the
 * same coco `Manager` the host's runtime is built on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { validatePreimage } from '@sdk/commerce/payments/preimage'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { authStore } from '@platform/web/auth/authStore'
import { createCocoWalletHost } from '@platform/web/wallet/cocoWalletHost'
import {
	CASHU_RECONCILERS,
	CASHU_WALLET_IDENTITY,
	cashuEngineSource,
	currentCashuAccount,
	invoiceAmountSats,
	preferredCashuMint,
} from '@platform/web/wallet/cocoWalletEngine'
import { cashuActions, cashuStore, type PendingToken } from '@platform/web/wallet/cashuStore'
import { projectWalletPanelBalance } from '@platform/web/wallet/cocoWalletPanelBalance'
import { LocalCocoLegStore, LocalWalletOperationStore } from '@platform/web/wallet/cocoWalletStores'
import { walletOps, type WalletDevAuctionBidResult, type WalletTestMintResult } from '@platform/web/wallet/walletOps'
import { Nip60WalletView, type Nip60WalletModalType } from '@ui/wallet/nip60-wallet-view'
import { DepositLightningModalHost } from './DepositLightningModalHost'
import { ReceiveEcashModalHost } from './ReceiveEcashModalHost'
import { SendEcashModalHost } from './SendEcashModalHost'
import { WithdrawLightningModalHost } from './WithdrawLightningModalHost'

export function CocoWalletPanelHost() {
	const { isAuthenticated, user } = useStore(authStore)
	const { manager, status, balances: cachedBalances, mints, error, pendingTokens } = useStore(cashuStore)
	const [hostBalances, setHostBalances] = useState<Record<string, number>>({})
	const [hostTotalBalance, setHostTotalBalance] = useState(0)
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

	/**
	 * The wallet host this panel is driven by, scoped to the live manager.
	 *
	 * A fresh host per coco `Manager` object is what keeps it honest: a host caches the runtime it opened
	 * (and that runtime captures the manager it opened over), so reusing one across a wallet teardown
	 * (`walletOps.reset()` on logout) would leave the panel reading a disposed engine. The manager object
	 * is the app's own wallet identity, so a new manager always gets a host bound to it.
	 */
	const walletHost = useMemo(
		() =>
			manager
				? createCocoWalletHost({
						...CASHU_WALLET_IDENTITY,
						engine: cashuEngineSource,
						reconcilers: CASHU_RECONCILERS,
						preferredMint: preferredCashuMint,
						invoiceAmountSats,
						validatePreimage: (invoice: string, preimage: string) => validatePreimage(invoice, preimage),
						legStore: new LocalCocoLegStore(),
						walletStore: new LocalWalletOperationStore(),
						now: () => Date.now(),
					}).host
				: null,
		[manager],
	)

	/**
	 * Read the panel's numbers from the host, not from the UI: `available` is coco's spendable projection
	 * and the unscoped total is the host's own sum, so the panel never adds up an authority of its own.
	 *
	 * A `reserved`-only mint is reported with `0` available and a mint with no ready proofs at all is
	 * omitted — coco omits such a mint from an unscoped balance read, and the mint rows must not invent
	 * one.
	 */
	const readHostBalance = useCallback(async (): Promise<void> => {
		const host = walletHost
		if (!host) return
		const account = currentCashuAccount()
		if (!account) return
		try {
			const [total, perMint] = await Promise.all([
				host.balance(account),
				Promise.all(mints.map(async (mintUrl) => [mintUrl, await host.balance(account, { mintUrl })] as const)),
			])
			const projected = projectWalletPanelBalance(total, perMint)
			setHostBalances(projected.balances)
			setHostTotalBalance(projected.totalBalance)
		} catch (err) {
			// Keep the last numbers the host reported: a read that failed is not a balance of zero.
			console.error('[wallet] Failed to read the balance through the Coco wallet host:', err)
		}
	}, [walletHost, mints])

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

	// The store's cache is what changes when coco's proofs move (its own `proofs:*` subscriptions
	// refresh it, and so does the manual refresh), so it is the panel's invalidation signal: re-read the
	// host whenever it moves, and drop the numbers when the wallet is torn down.
	useEffect(() => {
		if (!isAuthenticated || status !== 'ready') {
			setHostBalances({})
			setHostTotalBalance(0)
			return
		}
		void readHostBalance()
	}, [isAuthenticated, status, cachedBalances, user?.pubkey, readHostBalance])

	const handleRefresh = async () => {
		setIsRefreshing(true)
		try {
			// Re-read balances from coco
			await cashuActions.refreshBalances()
			await readHostBalance()
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
				totalBalance={hostTotalBalance}
				balances={hostBalances}
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
