import type { ReactNode } from 'react'

import { atoms } from './libraries/atoms'

export interface WidgetEntry {
	/** Display name; also used as the `data-widget` attribute for tests. */
	name: string
	/** Renders one deterministic state of the component. */
	render: () => ReactNode
}

export interface WidgetLibrary {
	/** Directory/feature name, e.g. `atoms`, `shared`, `nostr`, `checkout`. */
	name: string
	entries: WidgetEntry[]
}

/**
 * Every widget library the harness knows about.
 *
 * A library maps to a directory or component family under `ui/`. Add one entry
 * per component variant/state worth reviewing or asserting. Libraries must only
 * import `ui/` (and `sdk/` types) — never `platform/` or `src/`.
 */
export const libraries: WidgetLibrary[] = [atoms]

/**
 * Resolves the `LIBRARY` selection. `*` (or undefined) means every library.
 */
export function resolveLibraries(selection: string | undefined): WidgetLibrary[] {
	if (!selection || selection === '*') return libraries

	const match = libraries.filter((library) => library.name === selection)
	if (match.length === 0) {
		const available = libraries.map((library) => library.name).join(', ')
		throw new Error(`Unknown widget library "${selection}". Available: ${available}, or "*" for all.`)
	}
	return match
}
