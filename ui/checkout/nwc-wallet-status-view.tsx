import type { ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

export interface NwcWalletStatusViewProps {
	/** Whether a usable NWC wallet is configured (the host's `nwcEnabled`). */
	connected: boolean
	/** Wallets carrying a usable NWC URI; only read when `connected`. */
	connectedWalletCount: number
	/** Settings link node rendered inside the disconnected copy. */
	settingsLink: ReactNode
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * NWC wallet readiness for the checkout summaries.
 *
 * This block used to be written out twice in `platform/web/routes/checkout.tsx`
 * — once in the mobile order-summary card and once in the desktop sidebar —
 * with the same status dot and the same count but two different footer
 * sentences. One implementation owns both slots now, and the footer keeps the
 * more informative desktop wording (the declared visible change).
 *
 * Colours move from raw `green`/`gray`/`blue` classes to semantic tokens.
 */
export function NwcWalletStatusView({ connected, connectedWalletCount, settingsLink, className, ref }: NwcWalletStatusViewProps) {
	const walletLabel = `${connectedWalletCount} NWC wallet${connectedWalletCount === 1 ? '' : 's'} connected`

	return (
		<div ref={ref} data-slot="nwc-wallet-status" className={cn('rounded-lg border bg-muted/40 p-3', className)}>
			<div className="flex items-center justify-between text-sm">
				<span className="font-medium text-foreground">Wallet Status:</span>
				<div className="flex items-center gap-2">
					{connected ? (
						<>
							<span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
							<span className="font-medium text-success-foreground">{walletLabel}</span>
						</>
					) : (
						<>
							<span aria-hidden="true" className="h-2 w-2 rounded-full bg-muted-foreground" />
							<span className="text-muted-foreground">Fast Payments available with NWC, setup in {settingsLink}</span>
						</>
					)}
				</div>
			</div>
			{connected && <p className="mt-1 text-xs text-muted-foreground">Fast payments available • Configure more wallets in settings</p>}
		</div>
	)
}
