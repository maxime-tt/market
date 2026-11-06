/**
 * browse/search-field.tsx — the one search pill, in the two sizes the frames ask
 * for.
 *
 * `nav`  — the compact 40px field embedded top-centre in the nav band
 *          (`vnwQ7csazs__split-view-product-detail-1440.html:55`).
 * `hero` — the 70px field inside the idle hero's title block, with the `⌘K`
 *          affordance (`Glje8eeQGh__browse-idle-1440.html:289-292`).
 *
 * Size is a prop, not a second component: both instances are the same input, so
 * one `value`/`onChange` pair drives either of them. When `submitted` is true
 * the field renders query text + a blinking caret instead of an input — the
 * active state in frames W8vkrHbRq6 and QPUcf4Fs38.
 */

import { useEffect, useRef, useState } from 'react'
import type { FC, KeyboardEvent, MutableRefObject, Ref } from 'react'
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
	/**
	 * The `<input>` itself. The host holds one of these per instance: when the
	 * idle hero hands the query over to the nav field (the hero unmounts with
	 * the idle screen), the keystroke's focus is moved through it.
	 */
	inputRef?: Ref<HTMLInputElement>
	/**
	 * `nav` (default) is the frame's compact field in the nav band; `hero` is
	 * the idle hero's large field.
	 */
	size?: 'nav' | 'hero'
	/**
	 * Show the frame's `⌘K` affordance and make it focus this field. Defaults
	 * to true for the hero size, which is the frame that carries it.
	 */
	shortcut?: boolean
	/** Show submitted state: text + caret, no input. */
	submitted?: boolean
}

// ---------------------------------------------------------------------------
// Size table — the frames' two measurements, stated once
// ---------------------------------------------------------------------------

/**
 * The measured parts of each size. The `nav` values are
 * `vnwQ7csazs__split-view-product-detail-1440.html:55-62` (40px pill, 560px,
 * 18px glyph, 14px text, 32px go pill); the `hero` values are
 * `Glje8eeQGh__browse-idle-1440.html:113-122` (70px pill, 22px glyph, 17px
 * text, 50px go pill, shadow-2).
 */
const SIZE_CLASSES = {
	nav: {
		root: ['h-10', 'w-[560px]', 'max-w-full', 'pl-4', 'pr-1.5', 'gap-2.5'],
		glyph: 'size-[18px]',
		input: 'text-sm',
		go: 'h-8 px-4 text-[13px]',
		clear: 'size-[22px]',
	},
	hero: {
		root: ['h-[70px]', 'w-full', 'pl-[26px]', 'pr-2.5', 'gap-4', 'shadow-[var(--shadow-2)]'],
		glyph: 'size-[22px]',
		input: 'text-[17px]',
		go: 'h-[50px] px-[26px] text-[15px]',
		clear: 'size-[24px]',
	},
} as const

/** Write to a React ref that may be a callback or an object. */
function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (typeof ref === 'function') ref(value)
	else if (ref) (ref as MutableRefObject<T | null>).current = value
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Search field pill.
 *
 * Structure: [search glyph] [query input] [⌘K] [× clear] [go pill]
 */
export const SearchField: FC<SearchFieldProps> = ({
	value,
	placeholder = 'Search products, sellers and lists',
	onChange,
	onGo,
	onClear,
	className,
	ref,
	inputRef,
	size = 'nav',
	shortcut,
	submitted,
}) => {
	const hasValue = value.length > 0
	const sizing = SIZE_CLASSES[size]
	const showShortcut = shortcut ?? size === 'hero'

	/** The input this instance owns; the shortcut focuses it, the host may too. */
	const ownInput = useRef<HTMLInputElement | null>(null)
	const handleInputRef = (element: HTMLInputElement | null) => {
		ownInput.current = element
		assignRef(inputRef, element)
	}

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

	// The ⌘K affordance is only honest if it works: focus this field.
	useEffect(() => {
		if (!showShortcut || submitted) return
		const handleShortcut = (event: globalThis.KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
			const input = ownInput.current
			if (!input) return
			event.preventDefault()
			input.focus()
		}
		window.addEventListener('keydown', handleShortcut)
		return () => window.removeEventListener('keydown', handleShortcut)
	}, [showShortcut, submitted])

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
			data-size={size}
			data-testid="widget-search-field"
			className={cn(
				'relative',
				'flex',
				'items-center',
				'bg-surface-raised',
				'border',
				'border-border-strong',
				'rounded-full',
				'transition-shadow',
				'focus-within:shadow-[0_0_0_2px_var(--focus-ring)]',
				sizing.root,
				className,
			)}
		>
			{/* Search glyph */}
			<svg
				className={cn('shrink-0 text-text-mid', sizing.glyph)}
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
					ref={handleInputRef}
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={placeholder}
					className={cn(
						'flex-1',
						'min-w-0',
						'bg-transparent',
						'outline-none',
						'leading-tight',
						'text-text-high',
						'placeholder:text-text-mid',
						sizing.input,
					)}
					aria-label="Search"
				/>
			) : (
				<div className={cn('flex-1 min-w-0 leading-tight text-text-high whitespace-nowrap overflow-hidden', sizing.input)}>
					{value}
					<span
						className="inline-block w-[2px] h-[17px] ml-[2px] mb-[4px] align-[-4px] bg-fill-ink animate-search-caret-blink"
						aria-hidden="true"
					/>
				</div>
			)}

			{/* ⌘K affordance */}
			{showShortcut && !submitted && (
				<span
					data-slot="search-kbd"
					data-testid="widget-search-field-kbd"
					className="shrink-0 rounded-md border border-border-default px-[7px] py-[3px] text-[11px] tracking-[0.1em] text-text-mid"
					aria-hidden="true"
				>
					⌘K
				</span>
			)}

			{/* Clear control — only when there's content */}
			{hasValue && (
				<button
					type="button"
					data-slot="search-clear"
					data-testid="widget-search-field-clear"
					onClick={handleClear}
					aria-label="Clear search"
					className={cn('shrink-0 grid place-items-center rounded-full bg-surface-sunken cursor-pointer', sizing.clear)}
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
					'flex',
					'items-center',
					'justify-center',
					'rounded-full',
					'bg-fill-ink',
					'text-on-fill-ink',
					'font-medium',
					'transition-colors',
					'hover:bg-fill-ink-hover',
					'cursor-pointer',
					sizing.go,
				)}
			>
				Search
			</button>
		</div>
	)
}
