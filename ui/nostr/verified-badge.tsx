import { BadgeAlert, BadgeCheck } from 'lucide-react'
import type { Ref } from 'react'
import { Spinner } from '../primitives/spinner'
import { cn } from '../utils/cn'

/** The three states a NIP-05 verification badge can be in. */
export type Nip05VerificationState = 'loading' | 'verified' | 'invalid'

/**
 * Elides a NIP-05 address according to the NIP-05 spec: `_@domain.com` is shown
 * as `domain.com`; anything else is shown verbatim. Pure, so the host and the
 * view agree on exactly one implementation.
 */
export function elideNip05Address(nip05: string): string {
	return nip05.startsWith('_@') ? nip05.slice(2) : nip05
}

export interface VerifiedBadgeProps {
	/** Verification state resolved by the host's query. */
	state: Nip05VerificationState
	/** The NIP-05 address to display next to the badge. */
	nip05?: string | null
	/** Show the address text next to the badge. Defaults to `true`. */
	showAddress?: boolean
	className?: string
	ref?: Ref<HTMLDivElement>
}

const STATE_LABEL: Record<Nip05VerificationState, string> = {
	loading: 'Checking NIP-05 verification',
	verified: 'NIP-05 verified',
	invalid: 'NIP-05 not verified',
}

/**
 * Presentational NIP-05 badge. It renders verification state; it never acquires
 * it. The host runs the profile/validation queries and passes the result in, so
 * `ui/` stays free of `@/queries` and `@tanstack/react-query`.
 */
export function VerifiedBadge({ state, nip05, showAddress = true, className, ref }: VerifiedBadgeProps) {
	const address = showAddress && nip05 ? elideNip05Address(nip05) : null
	const label = STATE_LABEL[state]

	return (
		<div ref={ref} data-slot="verified-badge" data-state={state} className={cn('flex items-end gap-1', className)}>
			{state === 'loading' ? (
				// `Spinner` already exposes `role="status"` with the "Loading" name, so it
				// is not wrapped in a second labelled element.
				<Spinner />
			) : (
				<span role="img" aria-label={label} title={label} className="inline-flex">
					{state === 'verified' ? (
						<BadgeCheck aria-hidden="true" className="size-6 fill-secondary text-primary" />
					) : (
						<BadgeAlert aria-hidden="true" className="size-6 fill-destructive text-primary" />
					)}
				</span>
			)}
			{address && <span className="text-text-mid">{address}</span>}
		</div>
	)
}
