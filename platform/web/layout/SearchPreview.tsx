/**
 * platform/web/layout/SearchPreview.tsx — the header field's results preview.
 *
 * When the header IS the search (no page field registered, see
 * `ui/browse/search-presence.tsx`), typing in the bar's field shows a compact
 * preview of what the search finds, anchored under the field. It is a
 * convenience over the full results page, not a second search: the same
 * `useBrowseSearch` read answers it (with a small limit), the same price host
 * labels the amounts, and the last row is the honest way to the full results
 * (`/?q=`).
 *
 * ## Why a Popover, not a menu
 *
 * A Radix *menu* content is `role="menu"` and its root owns printable-key
 * typeahead: a real `<input>` inside it cannot be typed in (the `AccountMenu`
 * lesson, `AccountMenu.tsx`). A Popover is a plain dismissable layer, so the
 * field keeps its focus and its keystrokes. It is portalled to `<body>`, outside
 * the layout's `.arena-chrome` wrapper, so it carries the `arena-chrome` token
 * scope itself — the same widget-token treatment the account menu uses.
 *
 * Debounce is a local timer ref (following `v4v/ProfileSearch.tsx`): there is no
 * debounce hook in the codebase, and 250 ms keeps a fast typist from firing a
 * read per keystroke.
 */

import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FC } from 'react'
import { useBrowseSearch, type BrowseProduct } from '@platform/web/browse/browseQuery'
import { getNormalizedProfileDisplayName, useProfile } from '@platform/web/profiles/profileQuery'
import { PriceDisplayHost } from '@platform/web/products/PriceDisplayHost'
import { SearchField } from '@ui/browse/search-field'
import { Popover, PopoverAnchor, PopoverContent } from '@ui/primitives/popover'
import { cn } from '@ui/utils/cn'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** How long typing must pause before the search is read. */
const DEBOUNCE_MS = 250
/** A preview, not the results page: the small read the dropdown shows. */
const PREVIEW_LIMIT = 6

/**
 * The Arena token scope (`styles/arena-chrome.css`, imported globally). The
 * dropdown is portalled to `<body>`, outside the layout's `.arena-chrome`
 * wrapper, so without this class it would inherit the light token defaults and
 * open light under a dark bar. It rebinds the tokens the dropdown already uses;
 * it is not a second set of values.
 */
const ARENA_SCOPE = 'arena-chrome'

/** The dropdown surface, in widget tokens (the primitive's shadcn skin merges first). */
const CONTENT_CLASS = cn(
	ARENA_SCOPE,
	'w-[min(560px,92vw)] min-w-0 border border-border-default bg-surface-raised p-1 text-text-high shadow-xl',
)

const ROW_CLASS = 'flex items-center gap-3 rounded-md px-2 py-2 no-underline text-text-high hover:bg-fill-ink hover:text-on-fill-ink'

const MUTED_CLASS = 'px-2 py-2 text-sm text-text-mid'

// ---------------------------------------------------------------------------
// The debounced term
// ---------------------------------------------------------------------------

/**
 * The debounce and the open state, split out so it is testable without a DOM
 * popover. `typed` records a keystroke; `dismiss` closes the preview (a submit,
 * or Radix's own outside-dismiss).
 *
 * An empty value clears the term immediately and closes: an emptied field must
 * not keep showing results for a term that is gone.
 */
export function useSearchPreviewTerm(): {
	term: string
	open: boolean
	typed: (value: string) => void
	dismiss: () => void
} {
	const [term, setTerm] = useState('')
	const [open, setOpen] = useState(false)
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

	const clearTimer = () => {
		if (timer.current) {
			clearTimeout(timer.current)
			timer.current = null
		}
	}

	useEffect(() => clearTimer, [])

	const typed = (value: string) => {
		clearTimer()
		const trimmed = value.trim()
		if (trimmed.length === 0) {
			setTerm('')
			setOpen(false)
			return
		}
		setOpen(true)
		timer.current = setTimeout(() => setTerm(trimmed), DEBOUNCE_MS)
	}

	const dismiss = () => {
		clearTimer()
		setOpen(false)
	}

	return { term, open, typed, dismiss }
}

// ---------------------------------------------------------------------------
// The panel — the dropdown's own content, as a stated state
// ---------------------------------------------------------------------------

/**
 * What the panel shows. A discriminated union, so "loading", "empty", "error"
 * and "results" cannot be conflated by a boolean: an empty result set is not a
 * failure, and a still-running read is not "no results".
 */
export type SearchPreviewState =
	| { kind: 'loading' }
	| { kind: 'error'; query: string }
	| { kind: 'empty'; query: string }
	| { kind: 'results'; query: string; products: BrowseProduct[] }

/** One hit: title, price (the app's own price host) and seller, all one line. */
const SearchPreviewRow: FC<{ query: string; product: BrowseProduct }> = ({ query, product }) => {
	const { data: profileData } = useProfile(product.pubkey)
	const seller = getNormalizedProfileDisplayName(profileData?.profile) ?? product.pubkey.slice(0, 8)

	return (
		<Link data-testid="search-preview-hit" to="/" search={{ q: query, p: product.id }} className={ROW_CLASS}>
			{product.image ? (
				<img src={product.image} alt="" className="size-8 shrink-0 rounded object-cover" />
			) : (
				<span aria-hidden className="size-8 shrink-0 rounded bg-surface-sunken" />
			)}
			<span className="min-w-0 flex-1 truncate text-sm">{product.title}</span>
			{typeof product.price === 'number' && (
				<PriceDisplayHost
					priceValue={product.price}
					originalCurrency={product.currency || 'SATS'}
					showOriginalPrice={false}
					className="shrink-0 text-xs"
				/>
			)}
			<span className="shrink-0 max-w-[8rem] truncate text-xs text-text-mid">{seller}</span>
		</Link>
	)
}

/**
 * The dropdown's content for a stated state. Props-only, so its four states are
 * pinned without mounting a popover or a relay read.
 */
export const SearchPreviewPanel: FC<{ state: SearchPreviewState }> = ({ state }) => {
	if (state.kind === 'loading') {
		return (
			<div data-testid="search-preview-loading" className={MUTED_CLASS}>
				Searching…
			</div>
		)
	}

	if (state.kind === 'error') {
		return (
			<div data-testid="search-preview-error" className={MUTED_CLASS}>
				Couldn’t search right now. Press Enter to try the full results page.
			</div>
		)
	}

	if (state.kind === 'empty') {
		return (
			<div data-testid="search-preview-empty" className={MUTED_CLASS}>
				Nothing found for “{state.query}”.
			</div>
		)
	}

	return (
		<div data-testid="search-preview-results" role="list">
			{state.products.map((product) => (
				<SearchPreviewRow key={product.id} query={state.query} product={product} />
			))}
			<Link
				data-testid="search-preview-all"
				to="/"
				search={{ q: state.query }}
				className={cn(ROW_CLASS, 'justify-center text-sm font-medium')}
			>
				See all results for “{state.query}”
			</Link>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface SearchPreviewProps {
	/** The current field value (owned by the bar). */
	query: string
	/** Fired on every keystroke, so the bar's field and URL state stay one. */
	onChange: (value: string) => void
	/** Fired on Enter or the go pill — the bar's submit, to `/?q=`. */
	onGo: () => void
	/** Extra classes for the anchor wrapper. */
	className?: string
}

/**
 * The bar's search field plus its anchored results preview.
 *
 * The field is the popover's anchor (not its trigger): the preview follows the
 * field's own geometry, and the field keeps focus while the user types.
 */
export const SearchPreview: FC<SearchPreviewProps> = ({ query, onChange, onGo, className }) => {
	const { term, open, typed, dismiss } = useSearchPreviewTerm()
	const { data, isLoading, isError, progress } = useBrowseSearch(term, PREVIEW_LIMIT)

	// The settled result wins over the progressive snapshot; the snapshot is only
	// the first paint of a read still running (and is cheap: `useBrowseSearch`
	// already subscribes to it).
	const products = data?.products ?? progress?.products ?? []

	const state: SearchPreviewState = isError
		? { kind: 'error', query: term }
		: products.length > 0
			? { kind: 'results', query: term, products }
			: !term || isLoading
				? { kind: 'loading' }
				: { kind: 'empty', query: term }

	const handleChange = (value: string) => {
		onChange(value)
		typed(value)
	}

	const handleGo = () => {
		dismiss()
		onGo()
	}

	return (
		<Popover open={open} onOpenChange={(next) => (next ? undefined : dismiss())}>
			<PopoverAnchor asChild>
				<div className={cn('flex w-full min-w-0 items-center justify-center', className)}>
					<SearchField size="nav" value={query} onChange={handleChange} onGo={handleGo} announce={false} />
				</div>
			</PopoverAnchor>
			<PopoverContent data-testid="search-preview-panel" align="center" sideOffset={8} className={CONTENT_CLASS}>
				<SearchPreviewPanel state={state} />
			</PopoverContent>
		</Popover>
	)
}
