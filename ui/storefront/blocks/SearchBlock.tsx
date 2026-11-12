import type { ReactNode } from 'react'
import { SearchField } from '../../browse/search-field'
import { StorefrontSection } from './shared'

/** The document-facing configuration of the block (what the page event stores). */
export interface SearchBlockProps {
	/** Placeholder text shown when the query is empty. */
	placeholder: string
	/** CSS width — controls the pill's constrained width. */
	size: 'sm' | 'md' | 'lg'
}

/**
 * The props-only view contract: the block plus the query host, supplied by
 * the caller. `ui/` never resolves the data itself — the platform host
 * provides the query state and the navigation side-effect.
 *
 * The host wires `?q=` through its own routing; this block is purely
 * presentational and props-only.
 */
export interface SearchBlockViewProps extends SearchBlockProps {
	/** Current query value supplied by the host. */
	query: string
	/** Called with the new query on every keystroke. */
	onChange: (value: string) => void
	/** Called when the user submits (go button or Enter). */
	onGo?: () => void
	/** Called when the user clears the field. */
	onClear?: () => void
}

/**
 * A props-only search field pill.
 *
 * This reuses the existing `ui/browse/search-field.tsx` component verbatim
 * — no new search logic is built here. The host supplies query state and
 * wires `onGo`/`onClear` to its `?q=` routing, so the block is purely
 * presentational.
 */
export function SearchBlock({ placeholder, size, query, onChange, onGo, onClear }: SearchBlockViewProps) {
	// Map our size tokens to the SearchField's 'nav'/'hero' sizing.
	const fieldSize = size === 'lg' ? 'hero' : 'nav'

	return (
		<StorefrontSection width="narrow" className="py-6">
			<SearchField
				value={query}
				placeholder={placeholder}
				onChange={onChange}
				onGo={onGo ?? (() => {})}
				onClear={onClear}
				size={fieldSize}
				className="w-full max-w-[560px] min-w-0"
			/>
		</StorefrontSection>
	)
}
