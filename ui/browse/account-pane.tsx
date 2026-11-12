/**
 * browse/account-pane.tsx — The floating right-side account panel.
 *
 * 420px wide, top offset = nav height, surface-raised, 1px border-default,
 * shadow. Internal content expands to fill the panel's width.
 *
 * Sections: profile (avatar/name/npub/sign-in method), Cashu balance block
 * (label, 32px tabular amount + sats, note), action pills (Top up / Withdraw /
 * Transactions / Connect NWC), nav sec (Orders link / Notifications / Saved
 * Lists), Sign out.
 */

import type { FC, Ref } from 'react'
import { cn } from '../utils/cn'
import { formatSats } from '../utils/format'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AccountPaneProps {
	/** User's display name. */
	name: string
	/** User's npub (elided). */
	npub: string
	/** Initial letter for avatar display. */
	avatarInitial: string
	/** Sign-in method text, e.g. "Signed in with extension signer, remote signer or nsec". */
	signedInWith: string
	/** Cashu balance in sats. */
	balance: number
	/** Top up action callback. */
	onTopUp?: () => void
	/** Withdraw action callback. */
	onWithdraw?: () => void
	/** Transactions action callback. */
	onTransactions?: () => void
	/** Connect NWC action callback. */
	onConnectNWC?: () => void
	/** Orders link callback (no counts, link only). */
	onOrders?: () => void
	/** Notifications callback. */
	onNotifications?: () => void
	/** Saved Lists callback. */
	onSavedLists?: () => void
	/** Sign out callback. */
	onSignOut?: () => void
	/** Extra classes for the pane root. */
	className?: string
	ref?: Ref<HTMLDivElement>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Account pane — the floating right panel.
 *
 * Content fills the panel's width. Every section is full-width inside.
 */
export const AccountPane: FC<AccountPaneProps> = ({
	name,
	npub,
	avatarInitial,
	signedInWith,
	balance,
	onTopUp,
	onWithdraw,
	onTransactions,
	onConnectNWC,
	onOrders,
	onNotifications,
	onSavedLists,
	onSignOut,
	className,
	ref,
	...props
}) => {
	return (
		<div
			ref={ref}
			data-slot="account-pane"
			data-testid="widget-account-pane"
			className={cn(
				'w-[420px]',
				'bg-surface-raised',
				'border',
				'border-border-default',
				'rounded',
				'box-shadow-[0_8px_24px_rgba(0,0,0,0.12)]',
				'overflow-hidden',
				'p-5',
				'flex',
				'flex-col',
				'gap-5',
				className,
			)}
			{...props}
		>
			{/* Profile section */}
			<div data-slot="profile" className="flex items-start gap-3">
				<div
					data-slot="avatar"
					className={cn(
						'w-10',
						'h-10',
						'rounded-full',
						'grid',
						'place-items-center',
						'bg-fill-ink',
						'text-on-fill-ink',
						'font-medium',
						'text-[12px]',
						'leading-none',
						'shrink-0',
					)}
					aria-label={`${name} avatar`}
				>
					{avatarInitial}
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2">
						<b className="text-[15px] font-semibold text-text-high">{name}</b>
						<em className="text-xs text-text-mid truncate">{npub}</em>
					</div>
					<p className="text-xs text-text-mid mt-0.5">{signedInWith}</p>
				</div>
			</div>

			{/* Cashu balance section */}
			<div data-slot="balance" className="border-t border-border-default pt-4">
				<div className="text-xs tracking-wide text-text-mid">Cashu balance · held here</div>
				<div
					data-slot="balance-amount"
					className="text-[32px] font-medium text-text-high leading-tight"
					style={{ fontVariantNumeric: 'tabular-nums' }}
				>
					{formatSats(balance)}
					<small className="text-base text-text-mid font-normal ml-1">sats</small>
				</div>
				<p className="text-xs text-text-mid mt-1.5 leading-relaxed">
					Bearer tokens you hold — payable without a third party. Lightning is never custodied: invoices are served by your own wallet over
					NWC.
				</p>
				<div data-slot="balance-actions" className="mt-3 flex flex-wrap gap-2">
					{onTopUp && (
						<button
							type="button"
							data-slot="btn-top-up"
							data-testid="widget-account-pane-top-up"
							className={cn(
								'h-8.5',
								'px-4',
								'rounded-full',
								'flex',
								'items-center',
								'justify-center',
								'bg-fill-ink',
								'text-on-fill-ink',
								'border',
								'border-fill-ink',
								'text-sm',
								'font-medium',
								'cursor-pointer',
							)}
							onClick={onTopUp}
						>
							Top up
						</button>
					)}
					{onWithdraw && (
						<button
							type="button"
							data-slot="btn-withdraw"
							data-testid="widget-account-pane-withdraw"
							className={cn(
								'h-8.5',
								'px-4',
								'rounded-full',
								'flex',
								'items-center',
								'justify-center',
								'border',
								'border-border-strong',
								'text-text-high',
								'text-sm',
								'font-medium',
								'cursor-pointer',
							)}
							onClick={onWithdraw}
						>
							Withdraw
						</button>
					)}
					{onTransactions && (
						<button
							type="button"
							data-slot="btn-transactions"
							data-testid="widget-account-pane-transactions"
							className={cn(
								'h-8.5',
								'px-4',
								'rounded-full',
								'flex',
								'items-center',
								'justify-center',
								'border',
								'border-border-strong',
								'text-text-high',
								'text-sm',
								'font-medium',
								'cursor-pointer',
							)}
							onClick={onTransactions}
						>
							Transactions
						</button>
					)}
					{onConnectNWC && (
						<button
							type="button"
							data-slot="btn-connect-nwc"
							data-testid="widget-account-pane-connect-nwc"
							className={cn(
								'h-8.5',
								'px-4',
								'rounded-full',
								'flex',
								'items-center',
								'justify-center',
								'border',
								'border-border-strong',
								'border-dashed',
								'text-text-high',
								'text-sm',
								'font-medium',
								'cursor-pointer',
							)}
							onClick={onConnectNWC}
						>
							Connect NWC
						</button>
					)}
				</div>
			</div>

			{/* Nav section: Orders (link), Notifications, Saved Lists */}
			<div data-slot="navsec" className="mt-1">
				<ul className="list-none p-0 m-0 flex flex-col gap-1.5">
					{onOrders && (
						<li>
							<button
								type="button"
								data-slot="nav-orders"
								data-testid="widget-account-pane-orders"
								className={cn(
									'w-full',
									'flex',
									'items-center',
									'justify-between',
									'px-3',
									'py-2',
									'rounded',
									'text-sm',
									'text-text-high',
									'hover:bg-surface-sunken',
									'cursor-pointer',
									'transition-colors',
								)}
								onClick={onOrders}
							>
								Orders
								<svg
									className="size-3 text-text-mid"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M9 6l6 6-6 6" />
								</svg>
							</button>
						</li>
					)}
					{onNotifications && (
						<li>
							<button
								type="button"
								data-slot="nav-notifications"
								data-testid="widget-account-pane-notifications"
								className={cn(
									'w-full',
									'flex',
									'items-center',
									'justify-between',
									'px-3',
									'py-2',
									'rounded',
									'text-sm',
									'text-text-high',
									'hover:bg-surface-sunken',
									'cursor-pointer',
									'transition-colors',
								)}
								onClick={onNotifications}
							>
								Notifications
								<svg
									className="size-3 text-text-mid"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M9 6l6 6-6 6" />
								</svg>
							</button>
						</li>
					)}
					{onSavedLists && (
						<li>
							<button
								type="button"
								data-slot="nav-saved-lists"
								data-testid="widget-account-pane-saved-lists"
								className={cn(
									'w-full',
									'flex',
									'items-center',
									'justify-between',
									'px-3',
									'py-2',
									'rounded',
									'text-sm',
									'text-text-high',
									'hover:bg-surface-sunken',
									'cursor-pointer',
									'transition-colors',
								)}
								onClick={onSavedLists}
							>
								Saved Lists
								<svg
									className="size-3 text-text-mid"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M9 6l6 6-6 6" />
								</svg>
							</button>
						</li>
					)}
				</ul>
				<div className="border-t border-border-default mt-2" />
				<div data-slot="sign-out" data-testid="widget-account-pane-sign-out" className="mt-3.5 pt-3 border-t border-border-default">
					{onSignOut ? (
						<button
							type="button"
							data-slot="btn-sign-out"
							data-testid="widget-account-pane-sign-out-btn"
							className={cn(
								'w-full',
								'flex',
								'items-center',
								'justify-between',
								'px-3',
								'py-2',
								'rounded',
								'text-sm',
								'text-text-high',
								'hover:bg-surface-sunken',
								'cursor-pointer',
								'transition-colors',
							)}
							onClick={onSignOut}
						>
							Sign out
						</button>
					) : (
						<span className="block px-3 py-2 text-sm text-text-high">Sign out</span>
					)}
				</div>
			</div>
		</div>
	)
}
