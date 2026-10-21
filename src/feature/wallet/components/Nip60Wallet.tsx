import { authStore } from '@/lib/stores/auth'
import { nip60Actions, type Nip60DevAuctionBidResult, type Nip60TestMintResult } from '@/lib/stores/nip60'
import { cashuActions, cashuStore, type PendingToken } from '@/lib/stores/cashu'
import { useStore } from '@tanstack/react-store'
import {
	Loader2,
	Landmark,
	Plus,
	RefreshCw,
	Zap,
	Send,
	QrCode,
	Coins,
	Gavel,
	Clock,
	Eye,
	Copy,
	Check,
	RotateCcw,
	Trash2,
} from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { DepositLightningModal } from './DepositLightningModal'
import { WithdrawLightningModal } from './WithdrawLightningModal'
import { SendEcashModal } from './SendEcashModal'
import { ReceiveEcashModal } from './ReceiveEcashModal'
import { Button } from '@ui/primitives/button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@ui/primitives/alert-dialog'
import { Input } from '@ui/primitives/input'
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from '@ui/primitives/dialog'
import { getMintHostname } from '@/lib/wallet'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null

export function Nip60Wallet() {
	const { isAuthenticated, user } = useStore(authStore)
	const { status, totalBalance, balances, mints, error, pendingTokens } = useStore(cashuStore)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [openModal, setOpenModal] = useState<ModalType>(null)
	const [openSection, setOpenSection] = useState<'mints' | 'pending' | null>(null)
	const [viewingToken, setViewingToken] = useState<PendingToken | null>(null)
	const [isReclaiming, setIsReclaiming] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [devMintAmount, setDevMintAmount] = useState('1000')
	const [devBidAmount, setDevBidAmount] = useState('')
	const [isDevMinting, setIsDevMinting] = useState(false)
	const [isDevBidding, setIsDevBidding] = useState(false)
	const [lastDevMint, setLastDevMint] = useState<Nip60TestMintResult | null>(null)
	const [lastDevBid, setLastDevBid] = useState<Nip60DevAuctionBidResult | null>(null)
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
			const result = await nip60Actions.mintTestEcash(amount, mints[0])
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
			const result = await nip60Actions.placeDevBidOnSeededAuction({ preferredBidAmount, preferredMintUrl: mints[0] })
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

	// Button appearance class definitions

	const classNameGhost = 'hover:bg-white/10 text-gray-400 hover:text-white'
	const classNameSubtle = 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
	const classNameMuted = 'bg-white/10 hover:bg-white/20 text-white'
	const classNameActive = 'bg-white/20 text-white'
	const classNameSuccess = 'bg-green-600 hover:bg-green-700 text-white'
	const classNameWarning = 'bg-orange-600 hover:bg-orange-700 text-white'
	const classNameDestructive = 'bg-transparent hover:bg-red-500/20 text-red-400 hover:text-red-300'

	if (!isAuthenticated) {
		return (
			<div className="bg-primary p-4 rounded-lg text-gray-400 text-center">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className="flex justify-center items-center bg-primary p-4 rounded-lg">
				<Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="bg-primary p-4 rounded-lg text-red-400 text-center">
				<p>{error}</p>
			</div>
		)
	}

	return (
		<div className="bg-primary p-4 rounded-lg max-w-full overflow-hidden text-white">
			<div className="relative mb-4 text-center">
				<div className="top-0 right-0 absolute flex gap-1">
					<Button className={classNameGhost} size="icon" onClick={handleRefresh} disabled={isRefreshing} title="Refresh & sync wallet">
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>
				<p className="mb-1 text-gray-400 text-sm">Balance</p>
				<p className="font-bold text-white text-2xl">{totalBalance.toLocaleString()} sats</p>
			</div>

			{/* Action Buttons */}
			<div className="gap-2 grid grid-cols-2 mb-4">
				<Button className={classNameSuccess} size="sm" onClick={() => setOpenModal('deposit')}>
					<Zap className="w-4 h-4" />
					Deposit
				</Button>
				<Button className={classNameWarning} size="sm" onClick={() => setOpenModal('withdraw')} disabled={totalBalance === 0}>
					<Zap className="w-4 h-4" />
					Withdraw
				</Button>
				<Button className={classNameMuted} size="sm" onClick={() => setOpenModal('receive')}>
					<QrCode className="w-4 h-4" />
					Receive eCash
				</Button>
				<Button className={classNameMuted} size="sm" onClick={() => setOpenModal('send')} disabled={totalBalance === 0}>
					<Send className="w-4 h-4" />
					Send eCash
				</Button>
			</div>

			{walletDevMode && (
				<div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 space-y-2">
					<p className="text-xs uppercase tracking-wide text-amber-300 font-semibold">Auction Test Tools</p>
					<p className="text-xs text-amber-100/80">Available in local development for seeded auctions and fallback testnut mints.</p>

					<div className="flex gap-2">
						<Input
							type="number"
							min={1}
							step={1}
							value={devMintAmount}
							onChange={(e) => setDevMintAmount(e.target.value)}
							placeholder="Mint sats"
							className="h-8 text-sm bg-white/10 border-white/20 text-white placeholder:text-gray-500"
						/>
						<Button
							variant="dark-active"
							size="sm"
							onClick={() => void handleDevMintTestEcash()}
							disabled={isDevMinting}
							icon={isDevMinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
						>
							Mint Test
						</Button>
					</div>

					<div className="flex gap-2">
						<Input
							type="number"
							min={1}
							step={1}
							value={devBidAmount}
							onChange={(e) => setDevBidAmount(e.target.value)}
							placeholder="Bid sats (optional)"
							className="h-8 text-sm bg-white/10 border-white/20 text-white placeholder:text-gray-500"
						/>
						<Button
							variant="dark-active"
							size="sm"
							onClick={() => void handleDevBidSeededAuction()}
							disabled={isDevBidding}
							icon={isDevBidding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gavel className="h-3.5 w-3.5" />}
						>
							Bid Seeded
						</Button>
					</div>

					{lastDevMint && (
						<p className="text-[11px] text-amber-100/90">
							Last mint: {lastDevMint.amount.toLocaleString()} sats via {getMintHostname(lastDevMint.mintUrl)}
						</p>
					)}
					{lastDevBid && (
						<p className="text-[11px] text-amber-100/90 break-words">
							Last bid: {lastDevBid.bidAmount.toLocaleString()} sats on {lastDevBid.auctionTitle}
						</p>
					)}
				</div>
			)}

			{/* Toggle Row: Mints, Pending */}
			<div className="pt-2 overflow-hidden">
				{/* Toggle buttons row */}
				<div className="flex gap-1 mb-2">
					<Button
						className={cn(openSection === 'mints' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
						size="sm"
						onClick={() => setOpenSection(openSection === 'mints' ? null : 'mints')}
						title="Manage mints"
					>
						<Landmark className="w-4 h-4 shrink-0" />
						<span className="text-xs">{mints.length}</span>
					</Button>
					{activePendingTokens.length > 0 && (
						<Button
							className={cn(openSection === 'pending' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
							size="sm"
							onClick={() => setOpenSection(openSection === 'pending' ? null : 'pending')}
							title="Pending tokens"
						>
							<Clock className="w-4 h-4 shrink-0" />
							<span className="text-xs">{activePendingTokens.length}</span>
						</Button>
					)}
				</div>

				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="space-y-2 pt-2 border-white/10 border-t overflow-hidden">
						{mints.map((mint) => (
							<div key={mint} className="flex justify-between items-center gap-2 text-sm">
								<span className="min-w-0 text-gray-300 truncate" title={mint}>
									{getMintHostname(mint)}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{balances[mint] !== undefined && <span className="text-gray-400 text-xs">{balances[mint].toLocaleString()}</span>}
								</div>
							</div>
						))}
						<div className="flex gap-2">
							<Input
								type="url"
								value={newMintUrl}
								onChange={(e) => setNewMintUrl(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && void handleAddMint()}
								placeholder="https://mint.example.com"
								className="flex-1 bg-white/10 border-white/20 min-w-0 h-8 text-white placeholder:text-gray-500 text-sm"
							/>
							<Button
								className={cn(classNameMuted, 'px-2 h-8 shrink-0')}
								size="sm"
								onClick={() => void handleAddMint()}
								disabled={!newMintUrl.trim()}
							>
								<Plus className="w-4 h-4" />
							</Button>
						</div>
					</div>
				)}

				{openSection === 'pending' && (
					<div className="space-y-2 pt-2 border-white/10 border-t max-h-48 overflow-y-auto">
						{activePendingTokens.map((token) => (
							<div key={token.id} className="flex justify-between items-center gap-2 bg-white/5 p-2 rounded-lg">
								<div className="min-w-0">
									<p className="font-medium text-white text-sm">{token.amount.toLocaleString()} sats</p>
									<p className="text-gray-400 text-xs truncate">
										{getMintHostname(token.mintUrl)} • {new Date(token.createdAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex gap-0.5 shrink-0">
									<Button className={cn(classNameGhost, 'w-7 h-7')} size="icon" onClick={() => setViewingToken(token)} title="View token">
										<Eye className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'w-7 h-7')}
										size="icon"
										onClick={() => handleCopyToken(token.token)}
										title="Copy token"
									>
										<Copy className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'w-7 h-7')}
										size="icon"
										onClick={() => handleReclaim(token)}
										disabled={isReclaiming === token.id}
										title="Try to reclaim"
									>
										{isReclaiming === token.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
									</Button>
									<Button
										className={cn(classNameDestructive, 'w-7 h-7')}
										size="icon"
										onClick={() => setTokenPendingRemoval(token)}
										title="Remove from list"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Modals */}
			<DepositLightningModal open={openModal === 'deposit'} onClose={() => setOpenModal(null)} />
			<WithdrawLightningModal open={openModal === 'withdraw'} onClose={() => setOpenModal(null)} />
			<SendEcashModal open={openModal === 'send'} onClose={() => setOpenModal(null)} />
			<ReceiveEcashModal open={openModal === 'receive'} onClose={() => setOpenModal(null)} />

			{/* Pending Token Detail Modal */}
			<Dialog open={viewingToken !== null} onOpenChange={(isOpen) => !isOpen && setViewingToken(null)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Send className="w-5 h-5 text-purple-500" />
							Pending Token
						</DialogTitle>
						<DialogDescription>
							{viewingToken?.amount.toLocaleString()} sats • {viewingToken ? getMintHostname(viewingToken.mintUrl) : ''}
						</DialogDescription>
					</DialogHeader>

					{viewingToken && (
						<div className="space-y-4">
							<div className="flex justify-center">
								<div className="bg-white p-4 rounded-lg">
									<QRCodeSVG value={viewingToken.token} size={200} />
								</div>
							</div>
							<div className="space-y-2">
								<p className="font-medium text-sm">Cashu Token</p>
								<textarea
									value={viewingToken.token}
									readOnly
									className="bg-muted px-3 py-2 rounded-md w-full h-24 font-mono text-sm resize-none"
								/>
								<div className="flex justify-end">
									<Button variant="outline" size="sm" onClick={() => handleCopyToken(viewingToken.token)} className="gap-2">
										{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
										{copied ? 'Copied!' : 'Copy Token'}
									</Button>
								</div>
							</div>
							<p className="text-muted-foreground text-xs text-center">Created {new Date(viewingToken.createdAt).toLocaleString()}</p>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => {
										handleReclaim(viewingToken)
										setViewingToken(null)
									}}
									disabled={isReclaiming === viewingToken.id}
								>
									{isReclaiming === viewingToken.id ? (
										<Loader2 className="mr-2 w-4 h-4 animate-spin" />
									) : (
										<RotateCcw className="mr-2 w-4 h-4" />
									)}
									Reclaim
								</Button>
								<Button onClick={() => setViewingToken(null)}>Close</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Remove Pending Token Confirmation */}
			<AlertDialog open={tokenPendingRemoval !== null} onOpenChange={(isOpen) => !isOpen && setTokenPendingRemoval(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove token from list?</AlertDialogTitle>
						<AlertDialogDescription>
							This token is a bearer instrument worth {tokenPendingRemoval?.amount.toLocaleString()} sats. Removing it from the list does
							not reclaim the funds — if the token has not been claimed yet, removing it may make those funds unreachable. Consider claiming
							it first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={handleConfirmRemovePendingToken}>
							Remove anyway
						</AlertDialogAction>
						<Button variant="outline" onClick={handleClaimFirst} disabled={isReclaiming === tokenPendingRemoval?.id}>
							{isReclaiming === tokenPendingRemoval?.id ? (
								<Loader2 className="mr-2 w-4 h-4 animate-spin" />
							) : (
								<RotateCcw className="mr-2 w-4 h-4" />
							)}
							Claim first
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
