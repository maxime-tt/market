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
/*
 * The panel wears the public (Reckless / Arena) theme through the role tokens the host's scope rebinds:
 * `surface-*`, `text-high` / `text-mid`, `border-*`, and `fill-ink` for the one pink action — the same pill as
 * the bar's Search button. No hard-coded colours, so another instance theme restyles it too.
 */
const classNameGhost = 'bg-transparent shadow-none text-text-mid hover:bg-surface-hover hover:text-text-high'
const classNamePill = 'h-10 rounded-full px-4 text-xs font-semibold tracking-[0.06em] shadow-none'
const classNamePrimary = cn(classNamePill, 'bg-fill-ink text-on-fill-ink hover:bg-fill-ink-hover')
const classNameOutline = cn(classNamePill, 'border border-border-strong bg-transparent text-text-high hover:bg-surface-hover')
const classNameQuiet = cn(classNamePill, 'bg-surface-hover text-text-high hover:bg-surface-sunken')
const classNameChip =
	'h-8 rounded-full border border-border-default bg-transparent px-3 text-xs font-medium normal-case tracking-normal text-text-mid shadow-none hover:bg-surface-hover hover:text-text-high'
const classNameChipActive = 'border-border-strong bg-surface-hover text-text-high'
const classNameDestructive = 'bg-transparent shadow-none hover:bg-error/15 text-error hover:text-error'

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
			<div className="py-6 text-text-mid text-sm text-center">
				<p>Sign in to see your wallet</p>
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className="flex justify-center items-center py-8">
				<Loader2 className="w-6 h-6 text-text-mid animate-spin" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="py-6 text-error text-sm text-center">
				<p>{error}</p>
			</div>
		)
	}

	return (
		<div data-slot="wallet-view" className="max-w-full overflow-hidden text-text-high">
			{/* Balance */}
			<div className="flex justify-between items-start gap-3 mb-5">
				<div className="min-w-0">
					<p className="mb-2 font-semibold text-[11px] text-text-mid uppercase tracking-[0.14em]">Wallet</p>
					<p className="flex items-baseline gap-2" data-testid="wallet-balance">
						<span className="font-heading font-normal text-[56px] text-text-high leading-none tracking-[-0.01em]">
							{totalBalance.toLocaleString()}
						</span>
						<span className="text-text-mid text-base">sats</span>
					</p>
					<p className="mt-2 text-text-mid text-xs">
						Cashu ecash · {mints.length} {mints.length === 1 ? 'mint' : 'mints'}
					</p>
				</div>
				<Button
					className={cn(classNameGhost, 'rounded-full w-9 h-9 shrink-0')}
					size="icon"
					onClick={onRefresh}
					disabled={isRefreshing}
					title="Refresh & sync wallet"
					aria-label="Refresh and sync wallet"
				>
					<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
				</Button>
			</div>

			{/* Actions: Lightning in and out, Cashu ecash across */}
			<div className="gap-2 grid grid-cols-2 mb-5">
				<Button className={classNamePrimary} onClick={() => onOpenModal('deposit')}>
					<Zap className="w-4 h-4" />
					Deposit
				</Button>
				<Button className={classNameOutline} onClick={() => onOpenModal('withdraw')} disabled={totalBalance === 0}>
					<Zap className="w-4 h-4" />
					Withdraw
				</Button>
				<Button className={classNameQuiet} onClick={() => onOpenModal('receive')}>
					<QrCode className="w-4 h-4" />
					Receive ecash
				</Button>
				<Button className={classNameQuiet} onClick={() => onOpenModal('send')} disabled={totalBalance === 0}>
					<Send className="w-4 h-4" />
					Send ecash
				</Button>
			</div>

			{walletDevMode && (
				<div className="space-y-2 bg-surface-sunken mb-5 p-3 border border-border-default rounded-2xl">
					<p className="font-semibold text-[11px] text-text-mid uppercase tracking-[0.14em]">Auction test tools</p>
					<p className="text-text-mid text-xs">Available in local development for seeded auctions and fallback testnut mints.</p>

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
						<p className="text-2xs text-text-mid">
							Last mint: {lastDevMint.amount.toLocaleString()} sats via {getMintHostname(lastDevMint.mintUrl)}
						</p>
					)}
					{lastDevBid && (
						<p className="text-2xs text-text-mid break-words">
							Last bid: {lastDevBid.bidAmount.toLocaleString()} sats on {lastDevBid.auctionTitle}
						</p>
					)}
				</div>
			)}

			{/* Toggle Row: Mints, Pending */}
			<div className="pt-4 border-border-default border-t overflow-hidden">
				{/* Toggle buttons row */}
				<div className="flex gap-2 mb-3">
					<Button
						className={cn(classNameChip, openSection === 'mints' && classNameChipActive, 'gap-1.5')}
						size="sm"
						onClick={() => onOpenSectionChange(openSection === 'mints' ? null : 'mints')}
						title="Manage mints"
					>
						<Landmark className="w-3.5 h-3.5 shrink-0" />
						<span>Mints</span>
						<span className="text-text-high">{mints.length}</span>
					</Button>
					{activePendingTokens.length > 0 && (
						<Button
							className={cn(classNameChip, openSection === 'pending' && classNameChipActive, 'gap-1.5')}
							size="sm"
							onClick={() => onOpenSectionChange(openSection === 'pending' ? null : 'pending')}
							title="Pending tokens"
						>
							<Clock className="w-3.5 h-3.5 shrink-0" />
							<span>Pending</span>
							<span className="text-text-high">{activePendingTokens.length}</span>
						</Button>
					)}
				</div>

				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="space-y-2 overflow-hidden">
						{mints.map((mint) => (
							<div
								key={mint}
								className="flex justify-between items-center gap-2 bg-surface-sunken px-3 py-2 border border-border-default rounded-xl text-sm"
							>
								<span className="min-w-0 text-text-high truncate" title={mint}>
									{getMintHostname(mint)}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{balances[mint] !== undefined && <span className="text-text-mid text-xs">{balances[mint].toLocaleString()} sats</span>}
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
								className="flex-1 bg-surface-sunken border-border-default rounded-full min-w-0 h-9 text-sm"
							/>
							<Button
								className={cn(classNameQuiet, 'px-0 w-9 h-9 shrink-0')}
								size="sm"
								onClick={onAddMint}
								disabled={!newMintUrl.trim()}
								aria-label="Add mint"
							>
								<Plus className="w-4 h-4" />
							</Button>
						</div>
					</div>
				)}

				{openSection === 'pending' && (
					<div className="space-y-2 max-h-48 overflow-y-auto">
						{activePendingTokens.map((token) => (
							<div
								key={token.id}
								className="flex justify-between items-center gap-2 bg-surface-sunken px-3 py-2 border border-border-default rounded-xl"
							>
								<div className="min-w-0">
									<p className="font-medium text-text-high text-sm">{token.amount.toLocaleString()} sats</p>
									<p className="text-text-mid text-xs truncate">
										{getMintHostname(token.mintUrl)} • {new Date(token.createdAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex gap-0.5 shrink-0">
									<Button
										className={cn(classNameGhost, 'rounded-full w-7 h-7')}
										size="icon"
										onClick={() => onViewingTokenChange(token)}
										title="View token"
									>
										<Eye className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'rounded-full w-7 h-7')}
										size="icon"
										onClick={() => onCopyToken(token.token)}
										title="Copy token"
									>
										<Copy className="w-3.5 h-3.5" />
									</Button>
									<Button
										className={cn(classNameGhost, 'rounded-full w-7 h-7')}
										size="icon"
										onClick={() => onReclaim(token)}
										disabled={isReclaiming === token.id}
										title="Try to reclaim"
									>
										{isReclaiming === token.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
									</Button>
									<Button
										className={cn(classNameDestructive, 'rounded-full w-7 h-7')}
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
