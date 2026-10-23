import type { ReactNode, Ref } from 'react'
import { CopyButton } from '../shared/copy-button'
import { truncateMiddle } from '../shared/truncated-text'
import { cn } from '../utils/cn'

export interface PubkeyFieldProps {
	label: string
	/** The key's npub form; rendered as a link to njump.me. */
	npub: string
	/** The key's hex form; rendered as plain text. */
	hex: string
	/** Leading visual, typically a lucide icon. Sized by this component. */
	icon?: ReactNode
	/** Reports a failed clipboard write, so the host can surface it. */
	onCopyError?: (label: string, error: unknown) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * Bordered field showing a key's npub and hex forms, each with a copy control.
 *
 * Lifted out of `platform/web/routes/_dashboard-layout/dashboard/about.tsx`.
 * Both truncations go through `shared/truncated-text` and both copy controls are
 * the canonical `shared/copy-button` (`icon-xs` reproduces the hand-rolled 24px
 * button with a 12px icon exactly), so the route no longer carries a second
 * clipboard implementation.
 *
 * Declared styling change: the njump link was raw `text-blue-600`, now the
 * semantic `text-primary` per the `ui/` token rule.
 */
export function PubkeyField({ label, npub, hex, icon, onCopyError, className, ref }: PubkeyFieldProps) {
	// `truncateMiddle` guards on `head + tail + separator` rather than a bare
	// `length > 40`, so the two are equal for every real identifier (npub 63,
	// hex 64) and differ only at exactly length 40.
	const displayNpub = truncateMiddle(npub, 20, 16, '...')
	const displayHex = truncateMiddle(hex, 20, 16, '...')
	const copyError = (which: string) => (onCopyError ? (error: unknown) => onCopyError(which, error) : undefined)

	return (
		<div ref={ref} data-slot="pubkey-field" className={cn('space-y-2 rounded-md border bg-muted/50 p-3', className)}>
			<div className="flex items-center gap-2">
				{icon && <span className="flex-shrink-0 text-muted-foreground [&_svg]:size-5">{icon}</span>}
				<span className="text-sm font-medium">{label}</span>
			</div>
			<div className="space-y-1 pl-7">
				<div className="flex items-center gap-2">
					<span className="w-10 text-xs text-muted-foreground">npub</span>
					<a
						href={`https://njump.me/${npub}`}
						target="_blank"
						rel="noopener noreferrer"
						className="flex-1 truncate font-mono text-xs text-primary hover:underline"
					>
						{displayNpub}
					</a>
					<CopyButton
						value={npub}
						ariaLabel="Copy npub"
						variant="ghost"
						size="icon-xs"
						className="flex-shrink-0"
						onError={copyError('npub')}
					/>
				</div>
				<div className="flex items-center gap-2">
					<span className="w-10 text-xs text-muted-foreground">hex</span>
					<span className="flex-1 truncate font-mono text-xs">{displayHex}</span>
					<CopyButton
						value={hex}
						ariaLabel="Copy hex"
						variant="ghost"
						size="icon-xs"
						className="flex-shrink-0"
						onError={copyError('hex')}
					/>
				</div>
			</div>
		</div>
	)
}
