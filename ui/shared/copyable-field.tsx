import type { ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'
import { CopyButton } from './copy-button'

export interface CopyableFieldProps {
	label: string
	value: string
	/** Leading visual, typically a lucide icon. Sized by this component. */
	icon?: ReactNode
	/** Reports a failed clipboard write, so the host can surface it. */
	onCopyError?: (label: string, error: unknown) => void
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * Bordered row showing one copyable string with a leading icon.
 *
 * Lifted out of `platform/web/routes/_dashboard-layout/dashboard/about.tsx`,
 * which also carried its own hand-rolled copy button. The copy control is now
 * the canonical `shared/copy-button`: same 32px ghost button and 16px icon as
 * the hand-rolled one, but one implementation of the clipboard write, the
 * Copy -> Check swap and the failure path.
 */
export function CopyableField({ label, value, icon, onCopyError, className, ref }: CopyableFieldProps) {
	return (
		<div
			ref={ref}
			data-slot="copyable-field"
			className={cn('flex items-start gap-3 rounded-md border bg-surface-sunken/50 p-3', className)}
		>
			{icon && <span className="flex-shrink-0 text-text-mid [&_svg]:size-5">{icon}</span>}
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-text-mid">{label}</p>
				<p className="font-mono text-sm break-all">{value}</p>
			</div>
			<CopyButton
				value={value}
				ariaLabel={`Copy ${label}`}
				variant="ghost"
				size="icon-sm"
				className="flex-shrink-0"
				onError={onCopyError ? (error) => onCopyError(label, error) : undefined}
			/>
		</div>
	)
}
