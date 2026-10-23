import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { useState, type ComponentProps, type HTMLAttributes } from 'react'
import { Skeleton } from '../primitives/skeleton'
import { Spinner } from '../primitives/spinner'
import { UiLink } from '../provider/UiProvider'
import { cn } from '../utils/cn'

type ImageLoadingStatus = NonNullable<Parameters<NonNullable<ComponentProps<typeof AvatarPrimitive.Image>['onLoadingStatusChange']>>[0]>

export interface ProfileAvatarViewProps extends ComponentProps<typeof AvatarPrimitive.Root> {
	name?: string | null
	picture?: string | null
	isLoading?: boolean
	/**
	 * Accepted for compatibility with existing call sites, NOT implemented.
	 *
	 * Seven call sites pass these (`src/components/AuctionVerdictPanel.tsx` ×2,
	 * `platform/web/routes/.../products/auctions.tsx`, `.../products/bids.tsx`,
	 * `.../products/auctions.$auctionId.tsx` ×3) and they are not
	 * `AvatarUser` props, so they used to reach the DOM as
	 * `colored="true"` / `deterministicFallbackText` and raise React
	 * unknown-prop warnings (found by a headless pass, 2026-10-22; the same
	 * PR-introduced tsc error class was already noted at
	 * `src/components/AuctionBidProgressDialog.tsx:391`).
	 *
	 * They are destructured out below instead of forwarded. The fallback stays
	 * `bg-neo-purple` + the display-name initial, which is what renders today —
	 * `getColorFromNpub` in `src/lib/utils.ts` looks like the dropped
	 * implementation of `colored`, and restoring either behaviour is a visual
	 * change that needs a ruling.
	 */
	colored?: boolean
	deterministicFallbackText?: boolean
}

export function ProfileAvatarView({
	name,
	picture,
	isLoading = false,
	className,
	// Accepted for compatibility only — see ProfileAvatarViewProps.
	colored: _colored,
	deterministicFallbackText: _deterministicFallbackText,
	...props
}: ProfileAvatarViewProps) {
	const [imageState, setImageState] = useState<{ src: string; status: ImageLoadingStatus }>({ src: '', status: 'idle' })
	const imageStatus = picture ? (imageState.src === picture ? imageState.status : 'loading') : 'idle'
	const showSpinner = isLoading || imageStatus === 'loading'

	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full w-6 h-6', className)}
			{...props}
		>
			{picture && (
				<AvatarPrimitive.Image
					data-slot="avatar-image"
					className="aspect-square size-full"
					src={picture}
					alt={name || 'User avatar'}
					onLoadingStatusChange={(status) => setImageState({ src: picture, status })}
				/>
			)}
			<AvatarPrimitive.Fallback
				data-slot="avatar-fallback"
				className="bg-neo-purple text-white flex size-full items-center justify-center rounded-full text-center"
			>
				{showSpinner ? <Spinner className="h-1/2 w-1/2 text-white" /> : (name || 'N').charAt(0).toUpperCase()}
			</AvatarPrimitive.Fallback>
		</AvatarPrimitive.Root>
	)
}

export interface ProfileNameViewProps extends HTMLAttributes<HTMLSpanElement> {
	pubkey: string
	name?: string | null
	/** Label shown when no profile name is known (e.g. a short npub). */
	fallbackLabel: string
	isLoading?: boolean
	truncate?: boolean
	disableLink?: boolean
}

export function ProfileNameView({
	pubkey,
	name,
	fallbackLabel,
	isLoading = false,
	truncate = true,
	disableLink = false,
	className,
	...props
}: ProfileNameViewProps) {
	if (isLoading) return <Skeleton className={cn('h-4 w-24', className)} />

	const displayName = name || fallbackLabel

	if (disableLink) {
		return (
			<span className={cn('break-all', className)} {...props}>
				{displayName}
			</span>
		)
	}

	return (
		<UiLink href={`/profile/${encodeURIComponent(pubkey)}`} className={cn('break-all', className)}>
			<span {...props}>{truncate && name ? name.slice(0, 20) : displayName}</span>
		</UiLink>
	)
}
