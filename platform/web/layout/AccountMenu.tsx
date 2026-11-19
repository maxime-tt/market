/**
 * platform/web/layout/AccountMenu.tsx — the AppBar's one account surface.
 *
 * A single auth-aware dropdown (`ui/primitives/dropdown-menu.tsx`) mounted in the bar's account slot. It
 * subsumes the legacy header's account cluster (dashboard, profile, sign-out, cart, wallet, currency)
 * with one trigger and one menu, at every width — the small-screen gating that hid the wallet, dashboard and
 * sign-out on phones (the deleted `Header.tsx`) is gone, because a dropdown works at any size.
 *
 * - **Signed out** the menu holds one item, "Sign in", firing the same action the old login button did.
 * - **Signed in** it holds the identity header (avatar, npub, how the session is signed in), profile, wallet,
 *   dashboard (with the unseen-notifications badge), cart (with its item count), the currency submenu and
 *   sign-out.
 * - **Currency** is a submenu over `CURRENCIES`, checked against `uiStore.selectedCurrency` and writing
 *   through `uiActions.setCurrency` — the same setter and persistence the standalone currency dropdown used.
 * - **Wallet** opens the Coco wallet panel (`CocoWalletPanelHost`). The panel is NOT embedded in the menu
 *   content: a Radix menu content is `role="menu"` with roving focus and printable-key typeahead on its root,
 *   so a panel with real `<Input>`s inside it cannot be typed in (the first letter matching an item moves
 *   focus out of the field) and its portalled dialogs fight the menu's focus scope. Instead the item opens
 *   the unchanged host in a `Popover` anchored to this same trigger — the pattern the legacy header used —
 *   so the wallet stays one click deep from the account menu without losing a working surface.
 *
 * Styling is the widget role vocabulary (`bg-surface-raised`, `text-text-high`, `border-border-default`,
 * `bg-fill-ink`/`text-on-fill-ink` for the highlight), not the primitive's shadcn defaults: the token classes
 * are merged after the defaults, so `.arena-chrome`'s token rebinding styles the menu in both chromes.
 *
 * The auth read is the machine's, not a second store: `authStore` is the `@tanstack/store` mirror of
 * `sdk/core/auth`'s machine (registered through `authBinding`), so `signerType` and `user` are the same values
 * every other auth consumer sees.
 */

import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Coins, LayoutDashboard, Loader2, LogOut, ShoppingBag, User, Wallet } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useState, type FC, type ReactNode } from 'react'
import { CURRENCIES } from '@sdk/config/constants'
import type { AuthSignerType } from '@sdk/core/auth'
import { uiActions, uiStore, type SupportedCurrency } from '@platform/web/app/uiStore'
import { authActions, authStore } from '@platform/web/auth/authStore'
import { cartStore } from '@platform/web/cart/cartStore'
import { appNotificationsBinding, appUnseenCounts } from '@platform/web/notifications'
import { AvatarHost } from '@platform/web/profiles/userCardHosts'
import { CocoWalletPanelHost } from '@platform/web/wallet/CocoWalletPanelHost'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@ui/primitives/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@ui/primitives/popover'
import { cn } from '@ui/utils/cn'

// ---------------------------------------------------------------------------
// Presentation vocabulary
// ---------------------------------------------------------------------------

/**
 * The Arena token *scope* (`styles/arena-chrome.css`, imported globally). The menu is portalled to
 * `<body>`, outside the layout's `.arena-chrome` wrapper, so without this class the content inherits
 * the light token defaults and opens light under a bar that is Arena-dark. It rebinds the tokens the
 * menu already uses — it is not a second set of values, and nothing here copies a colour.
 */
const ARENA_SCOPE = 'arena-chrome'

/** The menu surface, in widget tokens (the primitive's shadcn skin is merged before these). */
const CONTENT_CLASS = cn(ARENA_SCOPE, 'w-64 min-w-0 border border-border-default bg-surface-raised p-1 text-text-high shadow-xl')

/** One row: the token highlight instead of the primitive's `accent`. */
const ITEM_CLASS =
	'cursor-pointer rounded-md px-2 py-2 text-sm text-text-high focus:bg-fill-ink focus:text-on-fill-ink data-[highlighted]:bg-fill-ink data-[highlighted]:text-on-fill-ink'

const SUB_TRIGGER_CLASS = cn(ITEM_CLASS, 'data-[state=open]:bg-fill-ink data-[state=open]:text-on-fill-ink [&>svg]:ml-auto [&>svg]:size-4')

const SUB_CONTENT_CLASS = cn(ARENA_SCOPE, 'w-32 border border-border-default bg-surface-raised p-1 text-text-high shadow-xl')

/**
 * The separator: `border-strong`, not `border-default`. Inside the Arena scope the default hairline
 * sits a step above the surface and reads as no line at all between two groups of rows; the strong
 * line is the same token pair at a value the dark surface can show, and the light chrome keeps the
 * same relationship one step darker. Both are widget role tokens — no colour is written here.
 */
const SEPARATOR_CLASS = 'bg-border-strong'

/** Icon size inside a row (the primitive sizes bare `<svg>` to 4, the token colour is set here). */
const ICON_CLASS = 'size-4 shrink-0 text-text-mid'

/** How each lane reads in the identity header. The machine reports the lane; the copy is the UI's. */
const SIGNER_TYPE_LABELS: Record<AuthSignerType, string> = {
	extension: 'Browser extension',
	nsec: 'Private key',
	ncryptsec: 'Encrypted private key',
	bunker: 'Remote signer',
}

/** `npub1…`, shortened for the identity header. A malformed pubkey is shown as-is rather than crashing. */
function shortenedNpub(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey)
		return `${npub.slice(0, 10)}…${npub.slice(-6)}`
	} catch {
		return pubkey
	}
}

/** A small count pill on a row (cart items, unseen notifications). Renders nothing at zero. */
function RowCount({ count }: { count: number }): ReactNode {
	if (count <= 0) return null
	return (
		<span className="ml-auto rounded-full bg-fill-ink px-2 py-0.5 text-xs font-semibold text-on-fill-ink">
			{count > 99 ? '99+' : count}
		</span>
	)
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AccountMenuProps {
	/** Extra classes for the trigger wrapper. The bar mounts it with none. */
	className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AccountMenu: FC<AccountMenuProps> = ({ className }) => {
	const { isAuthenticated, isAuthenticating, user, signerType } = useStore(authStore)
	const { selectedCurrency } = useStore(uiStore)
	const { cart } = useStore(cartStore)
	const ledgerCounts = useStore(appNotificationsBinding.store, (snapshot) => snapshot.ledger.counts)
	const { unseenTotal } = appUnseenCounts(ledgerCounts)

	/**
	 * The wallet panel is its own surface (a popover on this trigger), not a menu body — see the file header.
	 * Local state only; nothing else reads it.
	 */
	const [walletOpen, setWalletOpen] = useState(false)

	const totalItems = Object.values(cart.products).reduce((total, product) => total + product.amount, 0)
	const pubkey = user?.pubkey ?? null

	/** Signed out, the trigger is still a menu button — opening it is how a signed-out visitor signs in. */
	const trigger = (
		<button
			type="button"
			data-testid="account-menu-trigger"
			data-slot="account-menu-trigger"
			aria-label="Account menu"
			className={cn(
				'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-default bg-surface-raised text-text-high transition-colors hover:bg-fill-ink hover:text-on-fill-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
				className,
			)}
		>
			{isAuthenticated && pubkey ? <AvatarHost pubkey={pubkey} className="h-6 w-6" /> : <User className="size-5" aria-hidden />}
		</button>
	)

	if (isAuthenticating) {
		return (
			<button
				type="button"
				disabled
				data-testid="auth-loading"
				aria-label="Signing in"
				aria-busy="true"
				className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface-raised text-text-high"
			>
				<Loader2 className="size-4 animate-spin" aria-hidden />
			</button>
		)
	}

	return (
		<Popover open={walletOpen} onOpenChange={setWalletOpen}>
			<DropdownMenu>
				<PopoverAnchor
					data-slot="account-menu-anchor"
					className="inline-flex"
					// Opening the account menu closes the wallet panel, so the two surfaces never co-render.
					onPointerDown={() => setWalletOpen(false)}
				>
					<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
				</PopoverAnchor>

				<DropdownMenuContent data-testid="account-menu-content" align="end" sideOffset={8} className={CONTENT_CLASS}>
					{isAuthenticated && pubkey ? (
						<>
							{/* Identity: who, and how the session is signed in. */}
							<DropdownMenuLabel className="flex items-center gap-2 px-2 py-2">
								<AvatarHost pubkey={pubkey} className="h-8 w-8 shrink-0" />
								<span className="min-w-0">
									<span className="block truncate text-sm font-semibold text-text-high">{shortenedNpub(pubkey)}</span>
									<span className="block truncate text-xs text-text-mid">{signerType ? SIGNER_TYPE_LABELS[signerType] : 'Signed in'}</span>
								</span>
							</DropdownMenuLabel>
							<DropdownMenuSeparator className={SEPARATOR_CLASS} />

							<DropdownMenuItem asChild className={ITEM_CLASS}>
								<Link to="/profile/$profileId" params={{ profileId: pubkey }} data-testid="profile-button">
									<User className={ICON_CLASS} aria-hidden />
									<span>Profile</span>
								</Link>
							</DropdownMenuItem>

							<DropdownMenuItem data-testid="wallet-button" className={ITEM_CLASS} onSelect={() => setWalletOpen(true)}>
								<Wallet className={ICON_CLASS} aria-hidden />
								<span>Wallet</span>
							</DropdownMenuItem>

							<DropdownMenuItem asChild className={ITEM_CLASS}>
								<Link to="/dashboard" data-testid="dashboard-button">
									<LayoutDashboard className={ICON_CLASS} aria-hidden />
									<span>Dashboard</span>
									<RowCount count={unseenTotal} />
								</Link>
							</DropdownMenuItem>

							<DropdownMenuItem data-testid="cart-button" className={ITEM_CLASS} onSelect={() => uiActions.openDrawer('cart')}>
								<ShoppingBag className={ICON_CLASS} aria-hidden />
								<span>Cart</span>
								<RowCount count={totalItems} />
							</DropdownMenuItem>

							<DropdownMenuSub>
								<DropdownMenuSubTrigger className={SUB_TRIGGER_CLASS}>
									<Coins className={ICON_CLASS} aria-hidden />
									<span>Currency</span>
									<span className="ml-auto text-xs text-text-mid">{selectedCurrency}</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className={SUB_CONTENT_CLASS}>
									<DropdownMenuRadioGroup
										value={selectedCurrency}
										onValueChange={(value) => uiActions.setCurrency(value as SupportedCurrency)}
									>
										{CURRENCIES.map((currency) => (
											<DropdownMenuRadioItem
												key={currency}
												value={currency}
												data-testid={`currency-option-${currency}`}
												className={cn(ITEM_CLASS, 'pl-8')}
											>
												{currency}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>

							<DropdownMenuSeparator className={SEPARATOR_CLASS} />

							<DropdownMenuItem
								data-testid="logout-button"
								className={cn(ITEM_CLASS, 'text-text-high')}
								onSelect={() => authActions.logout()}
							>
								<LogOut className={ICON_CLASS} aria-hidden />
								<span>Sign out</span>
							</DropdownMenuItem>
						</>
					) : (
						<DropdownMenuItem
							data-testid="login-button"
							className={cn(ITEM_CLASS, 'px-3 py-2')}
							onSelect={() => uiActions.openDialog('login')}
						>
							<User className={ICON_CLASS} aria-hidden />
							<span>Sign in</span>
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<PopoverContent
				data-testid="wallet-panel"
				aria-label="Wallet"
				align="end"
				sideOffset={8}
				// The panel is portalled too, so it carries the same scope as the menu it opens from.
				className={cn(ARENA_SCOPE, 'w-[calc(100vw-2rem)] rounded-lg bg-primary md:w-96')}
			>
				<CocoWalletPanelHost />
			</PopoverContent>
		</Popover>
	)
}
