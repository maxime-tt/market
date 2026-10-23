import type { ReactNode } from 'react'

import { atoms } from './libraries/atoms'
import { auction } from './libraries/auction'
import { auth } from './libraries/auth'
import { checkout } from './libraries/checkout'
import { community } from './libraries/community'
import { dashboard } from './libraries/dashboard'
import { dialogs } from './libraries/dialogs'
import { layout } from './libraries/layout'
import { lightning } from './libraries/lightning'
import { messages } from './libraries/messages'
import { nav } from './libraries/nav'
import { migration } from './libraries/migration'
import { nostr } from './libraries/nostr'
import { orders } from './libraries/orders'
import { products } from './libraries/products'
import { settings } from './libraries/settings'
import { shared } from './libraries/shared'
import { wrappers } from './libraries/wrappers'

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
export const libraries: WidgetLibrary[] = [
	atoms,
	auction,
	auth,
	checkout,
	community,
	dashboard,
	dialogs,
	layout,
	lightning,
	messages,
	nav,
	migration,
	nostr,
	orders,
	products,
	settings,
	shared,
	wrappers,
]

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
