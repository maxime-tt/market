import { Check, Copy } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Ref } from 'react'
import type { ButtonProps } from '../wrappers/button-props'
import { Button } from '../primitives/button'
import { cn } from '../utils/cn'
import { useCopyToClipboard } from './use-copy-to-clipboard'

/** The icon/label pair the button renders for a given copy state. */
export interface CopyButtonVisualState {
	icon: 'copy' | 'check'
	/** Visible label; `undefined` keeps the button icon-only. */
	label?: string
}

/** Resolves the Copy → Check swap; exported so the swap is unit-testable. */
export function resolveCopyButtonState({ copied, label }: { copied: boolean; label?: string }): CopyButtonVisualState {
	return {
		icon: copied ? 'check' : 'copy',
		label: label === undefined ? undefined : copied ? 'Copied!' : label,
	}
}

/** Accessible name for the button; never returns an empty string. */
export function resolveCopyButtonAriaLabel({ ariaLabel, label }: { ariaLabel?: string; label?: string }): string {
	return ariaLabel ?? label ?? 'Copy to clipboard'
}

/**
 * Forwards a copy failure to the host exactly once per distinct error. A null
 * error clears the last-reported value so a later identical error is reported
 * again. Exported so the failure path is unit-testable without a DOM renderer.
 */
export function reportCopyButtonError(lastReported: unknown, error: unknown, onError?: (error: unknown) => void): unknown {
	if (error == null) return null
	if (error === lastReported) return lastReported
	onError?.(error)
	return error
}

export interface CopyButtonProps {
	/** The text written to the clipboard. */
	value: string
	/** Visible text; omitted renders an icon-only button. */
	label?: string
	/** Accessible name; defaults to the visible label or "Copy to clipboard". */
	ariaLabel?: string
	/** Called when the clipboard write fails, so the host can surface the error. */
	onError?: (error: unknown) => void
	className?: string
	/** Defaults to "outline". */
	variant?: ButtonProps['variant']
	/** Defaults to "icon" (icon-only) or "sm" when a label is given. */
	size?: ButtonProps['size']
	ref?: Ref<HTMLButtonElement>
}

/**
 * Canonical copy-to-clipboard control. Renders Copy → Check on success through
 * `primitives/button`, always exposes an accessible name, and reports write
 * failures through `onError` instead of swallowing them.
 */
export function CopyButton({ value, label, ariaLabel, onError, className, variant = 'outline', size, ref }: CopyButtonProps) {
	const { copied, error, copy } = useCopyToClipboard()
	const lastErrorRef = useRef<unknown>(null)
	const visual = resolveCopyButtonState({ copied, label })
	const resolvedSize = size ?? (label ? 'sm' : 'icon')

	useEffect(() => {
		lastErrorRef.current = reportCopyButtonError(lastErrorRef.current, error, onError)
	}, [error, onError])

	return (
		<Button
			ref={ref}
			type="button"
			variant={variant}
			size={resolvedSize}
			aria-label={resolveCopyButtonAriaLabel({ ariaLabel, label })}
			className={cn(copied && 'text-success', className)}
			onClick={() => {
				void copy(value)
			}}
			data-slot="copy-button"
			data-copied={copied ? 'true' : 'false'}
		>
			{visual.icon === 'check' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			{visual.label !== undefined && <span>{visual.label}</span>}
		</Button>
	)
}
