/**
 * browse/seller-profile.tsx — the seller profile screen (frame `YcjyRPZbVo`).
 *
 * Props-only, two composition parts:
 *  - `SellerProfileHeader` — avatar, name with the seller's primary category,
 *    the npub chip, the reputation facts, the ships-from line, the affordances.
 *  - `SellerProfileView` — the page frame: relay status line, header, the
 *    listings grid.
 *
 * Two rules the caller has to honour, because a design may not invent a value:
 *
 *  1. `facts` carries only what a read seam actually returned (the frame's
 *     "N trades · N sats zapped · joined <date>"). The header joins whatever it
 *     is given and renders no fact at all when given none — there is no
 *     placeholder, no zero and no default score. An absent fact is the
 *     caller's to explain, not this component's to fill in.
 *
 *  2. The frame's **Follow** button is deliberately absent. No contact-list
 *     (NIP-02) read or write exists in the seam, so a Follow control could only
 *     be a no-op; the buyer-side affordance that IS real here is Contact (the
 *     host opens the conversation). Contact renders only when the host supplies
 *     `onContact`, the same rule the product card applies to its optional
 *     controls.
 */

import { Check, Copy, MessageCircle } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { ProfileAvatarView } from '../nostr/identity'
import { useCopyToClipboard } from '../shared/use-copy-to-clipboard'
import { Button } from '../primitives/button'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface SellerProfileHeaderProps {
	/** Display name, or the short pubkey label when no kind-0 name was observed. */
	name: string
	/** kind-0 `picture`/`image`; the avatar falls back to the name's initial. */
	picture?: string | null
	/** The seller's primary category (a real `t` tag from their listings). */
	category?: string
	/** Encoded npub. The host encodes it — `ui/` may not import `nostr-tools`. */
	npub?: string
	/** Click-to-copy the npub. Default true, as on the shared user card. */
	copyNpub?: boolean
	/**
	 * Reputation facts, each already a whole string (e.g. `"Joined Mar 2024"`).
	 * Supplied only by the read seam — never a placeholder score.
	 */
	facts?: readonly string[]
	/** The seller's own location string, already resolved by the host. */
	shipsFrom?: string
	/** Opens the conversation with this seller. Absent → no Contact button. */
	onContact?: () => void
	/** Label for the contact affordance. */
	contactLabel?: string
	/** Host-owned actions (share, edit, curation) rendered beside Contact. */
	affordances?: ReactNode
	/** The identity read is still in flight. */
	isLoading?: boolean
	className?: string
	ref?: Ref<HTMLElement>
}

/**
 * The seller identity header: avatar, name + category, npub chip, reputation
 * facts, ships-from, affordances.
 */
export function SellerProfileHeader({
	name,
	picture,
	category,
	npub,
	copyNpub = true,
	facts,
	shipsFrom,
	onContact,
	contactLabel = 'Contact',
	affordances,
	isLoading = false,
	className,
	ref,
}: SellerProfileHeaderProps) {
	const { copied, copy } = useCopyToClipboard()
	const hasAffordances = Boolean(onContact || affordances)

	return (
		<header
			ref={ref}
			data-slot="seller-profile-header"
			data-testid="widget-seller-profile-header"
			className={cn('flex items-start gap-3.5 border-b border-border-default py-1.5 pb-2', className)}
		>
			<ProfileAvatarView name={name} picture={picture} isLoading={isLoading} className="size-12 text-2xl font-header" />

			<div data-slot="seller-profile-identity" className="flex min-w-0 flex-1 flex-col">
				<h1 data-slot="seller-profile-name" className="font-header text-xl font-bold leading-tight text-text-high">
					{name}
					{category ? <span className="ml-1.5 font-medium text-fill-ink">· {category}</span> : null}
				</h1>

				{npub ? (
					<button
						type="button"
						data-slot="seller-profile-npub"
						data-testid="widget-seller-profile-npub"
						title={copied ? 'Copied' : 'Click to copy'}
						aria-label={copied ? 'npub copied' : `Copy npub ${npub}`}
						disabled={!copyNpub}
						onClick={() => void copy(npub)}
						className={cn(
							'mt-1 flex w-fit max-w-full items-center gap-1.5 rounded-xs bg-surface-sunken px-2 py-0.5',
							'text-left text-[11px] leading-tight text-text-mid',
							copyNpub && 'cursor-pointer hover:text-text-high',
						)}
					>
						<span className="break-all">{npub}</span>
						{copied ? (
							<Check className="size-3 shrink-0 opacity-60" aria-hidden="true" />
						) : (
							<Copy className="size-3 shrink-0 opacity-60" aria-hidden="true" />
						)}
					</button>
				) : null}

				{facts && facts.length > 0 ? (
					<div
						data-slot="seller-profile-reputation"
						data-testid="widget-seller-profile-reputation"
						className="mt-1.5 text-xs tabular-nums text-text-mid"
					>
						{facts.join(' · ')}
					</div>
				) : null}

				{shipsFrom ? (
					<div
						data-slot="seller-profile-ships-from"
						data-testid="widget-seller-profile-ships-from"
						className="mt-0.5 text-xs text-text-mid"
					>
						<span className="font-medium">Ships from </span>
						{shipsFrom}
					</div>
				) : null}

				{hasAffordances ? (
					<div
						data-slot="seller-profile-affordances"
						data-testid="widget-seller-profile-affordances"
						className="mt-2 flex flex-wrap items-center gap-2.5"
					>
						{onContact ? (
							<Button
								type="button"
								variant="outline"
								data-slot="seller-profile-contact"
								data-testid="widget-seller-profile-contact"
								onClick={onContact}
								className="rounded-full"
							>
								<MessageCircle className="size-4" aria-hidden="true" />
								{contactLabel}
							</Button>
						) : null}
						{affordances}
					</div>
				) : null}
			</div>
		</header>
	)
}

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

export interface SellerProfileViewProps extends SellerProfileHeaderProps {
	/** The relay status line, rendered above the header. */
	status?: ReactNode
	/** One node per listing — a `ProductCard` each. */
	children?: ReactNode
	/** Rendered instead of the grid while the listings read is in flight. */
	loading?: ReactNode
	/**
	 * Rendered instead of the grid when the listings read failed. A failed read
	 * is NOT an empty seller: the grid region says so rather than reporting a
	 * fact about the seller that was never observed.
	 */
	error?: ReactNode
	/** Rendered instead of the grid when the seller has no visible listings. */
	empty?: ReactNode
}

/**
 * The seller profile page: relay status, seller header, listings.
 *
 * `loading` wins over `error`, which wins over `empty`, which wins over the
 * listing grid, so a caller never has to decide precedence — and a seller with
 * nothing listed is a fact the page states, not a grid that happens to be
 * empty (nor an error dressed up as one).
 */
export function SellerProfileView({ status, children, loading, error, empty, className, ...header }: SellerProfileViewProps) {
	return (
		<div
			data-slot="seller-profile-view"
			data-testid="widget-seller-profile-view"
			className={cn('mx-auto w-full max-w-[1040px] px-4 pt-2.5 lg:px-6', className)}
		>
			{status}
			<SellerProfileHeader {...header} />
			{loading ? (
				<div data-slot="seller-profile-listings" data-testid="widget-seller-profile-listings" className="mt-3">
					{loading}
				</div>
			) : error ? (
				<div data-slot="seller-profile-listings" data-testid="widget-seller-profile-listings" className="mt-3">
					{error}
				</div>
			) : empty ? (
				<div data-slot="seller-profile-listings" data-testid="widget-seller-profile-listings" className="mt-3">
					{empty}
				</div>
			) : (
				<div
					data-slot="seller-profile-listings"
					data-testid="widget-seller-profile-listings"
					className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3"
				>
					{children}
				</div>
			)}
		</div>
	)
}
