import type { ReactNode, Ref } from 'react'
import { cn } from '../utils/cn'

export interface DetailFieldProps {
	label: ReactNode
	value: ReactNode
	className?: string
	valueClassName?: string
	labelClassName?: string
	/** Supporting line rendered under the value. */
	helper?: ReactNode
	/** `end` keeps the legacy label-left/value-right row; `start` stacks them. */
	align?: 'start' | 'end'
	ref?: Ref<HTMLDivElement>
}

/** Label/value row used in order, auction, and product detail panels. */
export function DetailField({ label, value, className, valueClassName, labelClassName, helper, align = 'end', ref }: DetailFieldProps) {
	return (
		<div ref={ref} className={cn('flex items-start gap-2 text-sm', align === 'start' ? 'flex-col' : 'justify-between', className)}>
			<span className={cn('text-text-mid', align === 'end' && 'whitespace-nowrap', labelClassName)}>{label}</span>
			<span className={cn('flex flex-col gap-0.5', align === 'start' ? 'w-full' : 'flex-1 items-end text-right')}>
				<span className={cn('font-medium', valueClassName)}>{value}</span>
				{helper && <span className="text-xs font-normal text-text-mid">{helper}</span>}
			</span>
		</div>
	)
}
