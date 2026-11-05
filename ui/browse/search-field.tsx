/**
 * browse/search-field.tsx — Search pill embedded top-centre in the nav.
 *
 * 18px search glyph, query text, clear control, `go` pill button
 * (fill-ink bg / on-fill-ink label).
 *
 * When `submitted` is true, renders query text + blinking caret instead of
 * an input field — matches the active/submitted state in frames W8vkrHbRq6
 * and QPUcf4Fs38.
 */

import { useEffect, useState } from 'react'
import type { FC, KeyboardEvent, Ref } from 'react'
import { cn } from '../utils/cn'
import { SEARCH_FIELD_CARET_CSS } from './art'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SearchFieldProps {
	/** The current search query string. */
	value: string
	/** Placeholder shown when value is empty. */
	placeholder?: string
	/** Fired on every input change. */
	onChange: (value: string) => void
	/** Fired when the go button is clicked or Enter is pressed. */
	onGo: () => void
	/** Fired when the clear (×) button is clicked. */
	onClear?: () => void
	/** Extra classes for the root container. */
	className?: string
	ref?: Ref<HTMLDivElement>
	/** Show submitted state: text + caret, no input. */
	submitted?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Search field pill — embedded top-centre in the nav.
 *
 * Structure: [search glyph] [query text / placeholder] [× clear] [go pill]
 */
export const SearchField: FC<SearchFieldProps> = ({
	value,
	placeholder = 'Search products, sellers and lists',
	onChange,
	onGo,
	onClear,
	className,
	ref,
	submitted,
	...props
}) => {
	const hasValue = value.length > 0

	// Inject caret blink keyframes once (de-duplicated by browser)
	const [injected, setInjected] = useState(false)
	useEffect(() => {
		if (!injected) {
			setInjected(true)
			const style = document.createElement('style')
			style.textContent = SEARCH_FIELD_CARET_CSS
			document.head.appendChild(style)
		}
	}, [injected])

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			onGo()
		}
	}

	const handleClear = () => {
		onChange('')
		onClear?.()
	}

	return (
		<div
			ref={ref}
			data-slot="search-field"
			data-testid="widget-search-field"
			className={cn(
				'relative',
				'flex',
				'items-center',
				'gap-4',
				'px-5',
				'py-2',
				'h-[50px]',
				'bg-surface-raised',
				'border',
				'border-border-default',
				'rounded-full',
				'transition-shadow',
				'focus-within:shadow-[0_0_0_2px_var(--focus-ring)]',
				'focus-within:border-border-strong',
				className,
			)}
			{...props}
		>
			{/* 18px search glyph */}
			<svg
				className="size-[18px] shrink-0 text-text-mid"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				aria-hidden="true"
			>
				<circle cx="10.5" cy="10.5" r="6.5" />
				<path d="M15.5 15.5 21 21" />
			</svg>

			{/* Query text input */}
			{!submitted ? (
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					className={cn(
						'flex-1',
						'bg-transparent',
						'outline-none',
						'text-[17px]',
						'leading-tight',
						'text-text-high',
						'placeholder:text-text-mid',
					)}
					aria-label="Search"
				/>
			) : (
				<div className="flex-1 min-w-0 text-[17px] leading-tight text-text-high whitespace-nowrap overflow-hidden">
					{value}
					<span className="inline-block w-[2px] h-[17px] ml-[2px] mb-[4px] align-[-4px] bg-fill-ink animate-search-caret-blink" aria-hidden="true" />
				</div>
			)}

			{/* Clear control — only when there's content */}
			{hasValue && (
				<button
					type="button"
					data-slot="search-clear"
					data-testid="widget-search-field-clear"
					onClick={handleClear}
					aria-label="Clear search"
					className="shrink-0"
				>
					<svg
						className="size-[11px] text-text-mid"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M5 5l14 14M19 5 5 19" />
					</svg>
				</button>
			)}

			{/* Go pill button — fill-ink bg / on-fill-ink label */}
			<button
				type="button"
				data-slot="search-go"
				data-testid="widget-search-field-go"
				onClick={onGo}
				className={cn(
					'shrink-0',
					'px-6',
					'py-2',
					'h-[38px]',
					'flex',
					'items-center',
					'justify-center',
					'rounded-full',
					'bg-fill-ink',
					'text-on-fill-ink',
					'text-sm',
					'font-medium',
					'transition-colors',
					'hover:bg-fill-ink-hover',
					'cursor-pointer',
				)}
			>
				Search
			</button>
		</div>
	)
}
