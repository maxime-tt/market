import type { Ref } from 'react'
import { cn } from '../utils/cn'

export type BackButtonVariant = 'inline' | 'icon'

export interface BackButtonProps {
	/** Visible text for the `inline` variant; the `icon` variant never shows it. */
	label?: string
	/** Accessible name; falls back to `label`, then to `'Back'`. */
	ariaLabel?: string
	onClick: () => void
	/**
	 * `inline` renders icon + label for desktop detail pages; `icon` renders the
	 * absolutely-positioned control used in the mobile dashboard header.
	 */
	variant?: BackButtonVariant
	className?: string
	ref?: Ref<HTMLButtonElement>
}

const INLINE_CLASS = cn('flex items-center gap-2 text-text-mid hover:text-foreground transition-colors cursor-pointer')
const ICON_CLASS = cn(
	'absolute top-1/2 left-2 z-20 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center',
	'text-fill-accent focus:outline-none sm:left-3 md:left-4',
)

/**
 * The dashboard's back control. Both variants render the same `i-back` icon
 * glyph; only the presentation differs. The label is supplied by the caller
 * (resolved from the nav model's back target), never derived from the path.
 */
export function BackButton({ label, ariaLabel, onClick, variant = 'inline', className, ref }: BackButtonProps) {
	const accessibleName = ariaLabel ?? label ?? 'Back'
	const icon = <span className={variant === 'inline' ? 'h-5 w-5 i-back' : 'h-6 w-6 i-back'} />

	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			aria-label={accessibleName}
			data-slot="back-button"
			data-variant={variant}
			className={cn(variant === 'inline' ? INLINE_CLASS : ICON_CLASS, className)}
		>
			{icon}
			{variant === 'inline' && <span className="font-medium text-sm">{label ?? 'Back'}</span>}
		</button>
	)
}
