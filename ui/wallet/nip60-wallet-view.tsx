import {
	Check,
	Clock,
	Coins,
	Copy,
	Eye,
	Gavel,
	Landmark,
	Loader2,
	Plus,
	QrCode,
	RefreshCw,
	RotateCcw,
	Send,
	Trash2,
	Zap,
} from 'lucide-react'
import type { PendingToken } from '@sdk/commerce/payments/wallet'
import { getMintHostname } from '@sdk/commerce/payments/display'
import { cn } from '../utils/cn'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../primitives/alert-dialog'
import { Button } from '../primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../primitives/dialog'
import { Input } from '../primitives/input'
import { QRCode } from '../primitives/qr-code'

export type Nip60WalletModalType = 'deposit' | 'withdraw' | 'send' | 'receive'

/** Display summary of the last dev mint; the host owns the walletOps result type. */
export interface DevMintSummary {
	amount: number
	mintUrl: string
}

/** Display summary of the last dev bid; the host owns the walletOps result type. */
export interface DevBidSummary {
	bidAmount: number
	auctionTitle: string
}

/**
 * NIP-60 wallet panel — the presentational half of the retired
 * `src/feature/wallet/components/Nip60Wallet.tsx`.
 *
 * Props-only: the host owns the auth/cashu store subscriptions, every action,
 * and the four ecash/lightning modal hosts (which it renders as siblings). The
 * raw white/grey/amber/green/orange palette of the original maps to the
 * deliberate-dark `bg-fill-ink`/`text-on-fill-ink` surface and the semantic
 * state tones.
 */
export interface Nip60WalletViewProps {
	isAuthenticated: boolean
	status: 'idle' | 'initializing' | 'ready' | 'error'
	error: string | null
	totalBalance: number
	balances: Record<string, number>
	mints: readonly string[]
	activePendingTokens: readonly PendingToken[]
	isRefreshing: boolean
	onRefresh: () => void
	onOpenModal: (type: Nip60WalletModalType) => void
	openSection: 'mints' | 'pending' | null
	onOpenSectionChange: (section: 'mints' | 'pending' | null) => void
	newMintUrl: string
	onNewMintUrlChange: (url: string) => void
	onAddMint: () => void
	viewingToken: PendingToken | null
	onViewingTokenChange: (token: PendingToken | null) => void
	isReclaiming: string | null
	onReclaim: (token: PendingToken) => void
	copied: boolean
	onCopyToken: (token: string) => void
	tokenPendingRemoval: PendingToken | null
	onTokenPendingRemovalChange: (token: PendingToken | null) => void
	onConfirmRemovePendingToken: () => void
	onClaimFirst: () => void
	walletDevMode: boolean
	devMintAmount: string
	onDevMintAmountChange: (value: string) => void
	devBidAmount: string
	onDevBidAmountChange: (value: string) => void
	isDevMinting: boolean
	isDevBidding: boolean
	lastDevMint: DevMintSummary | null
	lastDevBid: DevBidSummary | null
	onDevMintTestEcash: () => void
	onDevBidSeededAuction: () => void
}

// Button appearance class definitions (semantic roles over the dark ink surface).
const classNameGhost = 'hover:bg-on-fill-ink/10 text-on-fill-ink/70 hover:text-on-fill-ink'
const classNameSubtle = 'bg-on-fill-ink/5 hover:bg-on-fill-ink/10 text-on-fill-ink/70 hover:text-on-fill-ink'
const classNameMuted = 'bg-on-fill-ink/10 hover:bg-on-fill-ink/20 text-on-fill-ink'
const classNameActive = 'bg-on-fill-ink/20 text-on-fill-ink'
const classNameSuccess = 'bg-success text-success-foreground hover:bg-success/90'
const classNameWarning = 'bg-warning text-warning-foreground hover:bg-warning/90'
const classNameDestructive = 'bg-transparent hover:bg-error/20 text-error hover:text-error/80'

export function Nip60WalletView({
	isAuthenticated,
	status,
	error,
	totalBalance,
	balances,
	mints,
	activePendingTokens,
	isRefreshing,
	onRefresh,
	onOpenModal,
	openSection,
	onOpenSectionChange,
	newMintUrl,
	onNewMintUrlChange,
	onAddMint,
	viewingToken,
	onViewingTokenChange,
	isReclaiming,
	onReclaim,
	copied,
	onCopyToken,
	tokenPendingRemoval,
	onTokenPendingRemovalChange,
	onConfirmRemovePendingToken,
	onClaimFirst,
	walletDevMode,
	devMintAmount,
	onDevMintAmountChange,
	devBidAmount,
	onDevBidAmountChange,
	isDevMinting,
	isDevBidding,
	lastDevMint,
	lastDevBid,
	onDevMintTestEcash,
	onDevBidSeededAuction,
}: Nip60WalletViewProps) {
	if (!isAuthenticated) {
		return (
			<div className="bg-fill-ink p-4 rounded-lg text-on-fill-ink/70 text-center">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className="flex justify-center items-center bg-fill-ink p-4 rounded-lg">
				<Loader2 className="w-6 h-6 text-on-fill-ink/70 animate-spin" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="bg-fill-ink p-4 rounded-lg text-error text-center">
				<p>{error}</p>
			</div>
		)
	}

	return (
		<div className="bg-fill-ink p-4 rounded-lg max-w-full overflow-hidden text-on-fill-ink">
			<div className="relative mb-4 text-center">
				<div className="top-0 right-0 absolute flex gap-1">
					<Button className={classNameGhost} size="icon" onClick={onRefresh} disabled={isRefreshing} title="Refresh & sync wallet">
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>
				<p className="mb-1 text-on-fill-ink/70 text-sm">Balance</p>
				<p className="font-bold text-on-fill-ink text-2xl">{totalBalance.toLocaleString()} sats</p>
			</div>

			{/* Action Buttons */}
			<div className="gap-2 grid grid-cols-2 mb-4">
				<Button className={classNameSuccess} size="sm" onClick={() => onOpenModal('deposit')}>
					<Zap className="w-4 h-4" />
					Deposit
				</Button>
				<Button className={classNameWarning} size="sm" onClick={() => onOpenModal('withdraw')} disabled={totalBalance === 0}>
					<Zap className="w-4 h-4" />
					Withdraw
				</Button>
				<Button className={classNameMuted} size="sm" onClick={() => onOpenModal('receive')}>
					<QrCode className="w-4 h-4" />
					Receive eCash
				</Button>
				<Button className={classNameMuted} size="sm" onClick={() => onOpenModal('send')} disabled={totalBalance === 0}>
					<Send className="w-4 h-4" />
					Send eCash
				</Button>
			</div>

			{walletDevMode && (
				<div className="mb-4 rounded-lg border border-warning-border bg-warning-muted p-3 space-y-2">
					<p className="text-xs uppercase tracking-wide text-warning-muted-foreground font-semibold">Auction Test Tools</p>
					<p className="text-xs text-warning-muted-foreground/80">
						Available in local development for seeded auctions and fallback testnut mints.
					</p>

					<div className="flex gap-2">
						<Input
							type="number"
							min={1}
							step={1}
							value={devMintAmount}
							onChange={(e) => onDevMintAmountChange(e.target.value)}
							placeholder="Mint sats"
							className="h-8 text-sm"
						/>
						<Button variant="secondary" size="sm" onClick={() => void onDevMintTestEcash()} disabled={isDevMinting}>
							{isDevMinting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
							Mint Test
						</Button>
					</div>

					<div className="flex gap-2">
						<Input
							type="number"
							min={1}
							step={1}
							value={devBidAmount}
							onChange={(e) => onDevBidAmountChange(e.target.value)}
							placeholder="Bid sats (optional)"
							className="h-8 text-sm"
						/>
						<Button variant="secondary" size="sm" onClick={() => void onDevBidSeededAuction()} disabled={isDevBidding}>
							{isDevBidding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gavel className="h-3.5 w-3.5" />}
							Bid Seeded
						</Button>
					</div>

					{lastDevMint && (
						<p className="text-2xs text-warning-muted-foreground/90">
							Last mint: {lastDevMint.amount.toLocaleString()} sats via {getMintHostname(lastDevMint.mintUrl)}
						</p>
					)}
					{lastDevBid && (
						<p className="text-2xs text-warning-muted-foreground/90 break-words">
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
						onClick={() => onOpenSectionChange(openSection === 'mints' ? null : 'mints')}
						title="Manage mints"
					>
						<Landmark className="w-4 h-4 shrink-0" />
						<span className="text-xs">{mints.length}</span>
					</Button>
					{activePendingTokens.length > 0 && (
						<Button
							className={cn(openSection === 'pending' ? classNameActive : classNameSubtle, 'flex-1 gap-1.5 px-2')}
							size="sm"
							onClick={() => onOpenSectionChange(openSection === 'pending' ? null : 'pending')}
							title="Pending tokens"
						>
							<Clock className="w-4 h-4 shrink-0" />
							<span className="text-xs">{activePendingTokens.length}</span>
						</Button>
					)}
				</div>

				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="space-y-2 pt-2 border-on-fill-ink/10 border-t overflow-hidden">
						{mints.map((mint) => (
							<div key={mint} className="flex justify-between items-center gap-2 text-sm">
								<span className="min-w-0 text-on-fill-ink/80 truncate" title={mint}>
									{getMintHostname(mint)}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{balances[mint] !== undefined && <span className="text-on-fill-ink/70 text-xs">{balances[mint].toLocaleString()}</span>}
								</div>
							</div>
						))}
						<div className="flex gap-2">
							<Input
								type="url"
								value={newMintUrl}
								onChange={(e) => onNewMintUrlChange(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && onAddMint()}
								placeholder="https://mint.example.com"
								className="flex-1 min-w-0 h-8 text-sm"
							/>
							<Button className={cn(classNameMuted, 'px-2 h-8 shrink-0')} size="sm" onClick={onAddMint} disabled={!newMintUrl.trim()}>
								<Plus className="w-4 h-4" />
							</Button>
						</div>
					</div>
				)}

				{openSection === 'pending' && (
					<div className="space-y-2 pt-2 border-on-fill-ink/10 border-t max-h-48 overflow-y-auto">
						{activePendingTokens.map((token) => (
							<div key={token.id} className="flex justify-between items-center gap-2 bg-on-fill-ink/5 p-2 rounded-lg">
								<div className="min-w-0">
									<p className="font-medium text-on-fill-ink text-sm">{token.amount.toLocaleString()} sats</p>
									<p className="text-on-fill-ink/70 text-xs truncate">
										{getMintHostname(token.mintUrl)} • {new Date(token.createdAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex gap-0.5 shrink-0">
									<Button
										className={cn(classNameGhost, 'w-7 h-7')}
										size="icon"
										onClick={() => onViewingTokenChange(token)}
										title="View token"
									>
										<Eye className="w-3.5 h-3.5" />
									</Button>
									<Button className={cn(classNameGhost, 'w-7 h-7')} size="icon" onClick={() => onCopyToken(token.token)} title="Copy token">
										<Copy className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'w-7 h-7')}
										size="icon"
										onClick={() => onReclaim(token)}
										disabled={isReclaiming === token.id}
										title="Try to reclaim"
									>
										{isReclaiming === token.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
									</Button>
									<Button
										className={cn(classNameDestructive, 'w-7 h-7')}
										size="icon"
										onClick={() => onTokenPendingRemovalChange(token)}
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

			{/* Pending Token Detail Modal */}
			<Dialog open={viewingToken !== null} onOpenChange={(isOpen) => !isOpen && onViewingTokenChange(null)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Send className="w-5 h-5 text-fill-accent" />
							Pending Token
						</DialogTitle>
						<DialogDescription>
							{viewingToken?.amount.toLocaleString()} sats • {viewingToken ? getMintHostname(viewingToken.mintUrl) : ''}
						</DialogDescription>
					</DialogHeader>

					{viewingToken && (
						<div className="space-y-4">
							<div className="flex justify-center">
								<div className="p-4 rounded-lg">
									<QRCode value={viewingToken.token} size={200} includeMargin={false} showBorder={false} />
								</div>
							</div>
							<div className="space-y-2">
								<p className="font-medium text-sm">Cashu Token</p>
								<textarea
									value={viewingToken.token}
									readOnly
									className="bg-surface-sunken px-3 py-2 rounded-md w-full h-24 font-mono text-sm resize-none"
								/>
								<div className="flex justify-end">
									<Button variant="outline" size="sm" onClick={() => onCopyToken(viewingToken.token)} className="gap-2">
										{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
										{copied ? 'Copied!' : 'Copy Token'}
									</Button>
								</div>
							</div>
							<p className="text-text-mid text-xs text-center">Created {new Date(viewingToken.createdAt).toLocaleString()}</p>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => {
										onReclaim(viewingToken)
										onViewingTokenChange(null)
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
								<Button onClick={() => onViewingTokenChange(null)}>Close</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Remove Pending Token Confirmation */}
			<AlertDialog open={tokenPendingRemoval !== null} onOpenChange={(isOpen) => !isOpen && onTokenPendingRemovalChange(null)}>
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
						<AlertDialogAction className="bg-error text-error-foreground hover:bg-error/90" onClick={onConfirmRemovePendingToken}>
							Remove anyway
						</AlertDialogAction>
						<Button variant="outline" onClick={onClaimFirst} disabled={isReclaiming === tokenPendingRemoval?.id}>
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
