import { ROUTE_INTENT_VERSION, isValidIntentDTag, validateIntentPath, type RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import type { Binding } from '@platform/server/routes/routeFile'
import { npubToHex } from '@platform/web/app/pubkeyCodec'
import { pageLabel } from './pageIdentity'
import type { RouteTableWarning } from './routeTableQuery'

/**
 * The authoring surface's view model: what a row says, and what a draft must
 * satisfy before it becomes a signed intent.
 *
 * Kept free of React and of the network so the three states the page can be in
 * — empty, failed, populated — are decided by data rather than inferred in JSX,
 * and so the rules are testable without rendering.
 */

export interface BindingRow {
	path: string
	/** The raw address, `page <short author> / <d>` — a secondary line in the row. */
	targetLabel: string
	/** The page's name as a human reads it: `Storefront` for the reserved default. */
	pageName: string
	/** The page author as a human reads it. */
	pageAuthorLabel: string
	updatedAtLabel: string
	updatedByLabel: string
	/** The `compiled-in-path` warning for this binding, or null. */
	warning: string | null
	/** The label the AppBar shows when this binding is pinned into the nav; null when it is not. */
	navLabel: string | null
	/** The AppBar's ascending sort key when this binding is pinned; null when it is not. */
	navOrder: number | null
	/** The author and `d` the edit form starts from. */
	author: string
	d: string
}

export interface BindingDraft {
	path: string
	/** Hex author of the target page, resolved from the picker or a pasted address. */
	author: string
	/** The target page's `d`. Set together with `author`, never alone. */
	d: string
	/** Whether this binding is pinned into the AppBar nav (the "Show in navigation" control). */
	showInNav: boolean
	/** The nav label, as typed. Required and at most 24 characters when `showInNav`. */
	navLabel: string
	/** The nav order, as typed — form inputs are strings, and the validator coerces it to an integer. */
	navOrder: string
}

export interface DraftValidation {
	/** Empty when the draft may be signed. */
	errors: string[]
	/** Present only when `errors` is empty. */
	intent: RouteIntent | null
}

export function shortPubkey(pubkey: string): string {
	if (pubkey === 'instance') return 'the instance (at boot)'
	if (!/^[0-9a-f]{64}$/.test(pubkey)) return pubkey
	return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
}

/** The event timestamp, as a stable UTC date — no locale, no time zone drift. */
export function formatUpdatedAt(updatedAt: number): string {
	if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 'unknown'
	return new Date(updatedAt * 1000).toISOString().slice(0, 10)
}

export function describeBinding(binding: Binding, warnings: RouteTableWarning[] = []): BindingRow {
	const target = binding.target
	// The table arrives over the wire and `fetchRouteTable` does not validate the
	// binding shape (plan §7.6), so a malformed `nav` reads as "not pinned": a
	// half-rendered pin would be a lie about what the AppBar shows.
	const nav = binding.nav
	const pinned = nav !== undefined && typeof nav.label === 'string' && nav.label.length > 0 && Number.isInteger(nav.order)
	return {
		path: binding.path,
		targetLabel:
			target.type === 'page'
				? `page ${shortPubkey(target.author)} / ${target.d}`
				: target.type === 'series'
					? `series ${target.series} / ${shortPubkey(target.author)}`
					: `${target.type} ${target.render} (${target.param})`,
		// A human reads a row as "/featured → featured-13-11-2026 (mine)"; the raw
		// address above stays available as the row's secondary line.
		pageName: target.type === 'page' ? pageLabel(target.d) : '',
		pageAuthorLabel: target.type === 'page' ? shortPubkey(target.author) : '',
		updatedAtLabel: formatUpdatedAt(binding.updatedAt),
		updatedByLabel: shortPubkey(binding.updatedBy),
		warning: warnings.find((warning) => warning.path === binding.path)?.message ?? null,
		navLabel: pinned ? nav.label : null,
		navOrder: pinned ? nav.order : null,
		author: target.type === 'page' ? target.author : '',
		d: target.type === 'page' ? target.d : '',
	}
}

export function describeBindings(bindings: Binding[], warnings: RouteTableWarning[] = []): BindingRow[] {
	return [...bindings].sort((a, b) => a.path.localeCompare(b.path)).map((binding) => describeBinding(binding, warnings))
}

/** Whether this binding can be edited in this increment: page targets only. */
export function isEditable(binding: Binding): boolean {
	return binding.target.type === 'page'
}

/**
 * Accepts the author as an `npub1…` or a 64-character hex key and returns the
 * hex form the routing table stores.
 */
export function resolveAuthor(input: string): { hex: string | null; error: string | null } {
	const trimmed = input.trim()
	if (trimmed.length === 0) return { hex: null, error: 'Enter the author pubkey of the page (npub or hex).' }
	try {
		return { hex: npubToHex(trimmed), error: null }
	} catch {
		return { hex: null, error: 'That is not an npub or a 64-character hex pubkey.' }
	}
}

/**
 * Validates a draft against the paths already bound.
 *
 * `editingPath` is the binding being retargeted; its own path is not a
 * collision with itself. Every message names the field it is about, because
 * "invalid" alone tells an admin nothing about what to type instead.
 */
export function validateDraft(draft: BindingDraft, boundPaths: string[], editingPath?: string): DraftValidation {
	const errors: string[] = []
	const path = draft.path.trim()

	if (path.length === 0) {
		errors.push('Enter a path.')
	} else if (path !== draft.path) {
		errors.push('A path may not begin or end with a space.')
	} else {
		const pathError = validateIntentPath(path)
		if (pathError) errors.push(pathError.replace(/^\/path: /, ''))
		if (boundPaths.includes(path) && path !== editingPath) {
			errors.push(`${path} is already bound. Edit that binding instead of creating a second one.`)
		}
	}

	const author = resolveAuthor(draft.author)
	if (author.error || draft.d.trim().length === 0) {
		errors.push('Choose the page this path should serve.')
	} else if (!isValidIntentDTag(draft.d)) {
		errors.push('That page address cannot be used: it is longer than 512 characters or contains a NUL.')
	}

	// The pin is a pair: a label the AppBar can render and an integer it can
	// sort by. Both are checked whenever the binding is pinned, so an admin
	// never signs a `nav` the server's intent parser would refuse.
	const navLabel = draft.navLabel.trim()
	const navOrder = draft.navOrder.trim()
	if (draft.showInNav) {
		if (navLabel.length === 0) errors.push('Enter a nav label.')
		else if (navLabel.length > 24) errors.push('A nav label is at most 24 characters.')
		if (!/^-?\d+$/.test(navOrder)) errors.push('Nav order must be a whole number.')
	}

	if (errors.length > 0 || !author.hex) return { errors, intent: null }

	return {
		errors: [],
		intent: {
			version: ROUTE_INTENT_VERSION,
			action: 'set',
			path,
			target: { type: 'page', author: author.hex, d: draft.d },
			...(draft.showInNav ? { nav: { label: navLabel, order: Number.parseInt(navOrder, 10) } } : {}),
		},
	}
}

export function removeIntent(path: string): RouteIntent {
	return { version: ROUTE_INTENT_VERSION, action: 'remove', path, target: null }
}

/**
 * The form's starting point for a new binding: a path, and no page yet.
 *
 * `author` and `d` always travel together — they are one page's coordinate —
 * and they arrive from the picker (or the Advanced paste field) already
 * resolved, so there is no default `d` to pre-fill.
 */
export const EMPTY_DRAFT: BindingDraft = { path: '', author: '', d: '', showInNav: false, navLabel: '', navOrder: '' }

export function draftFromRow(row: BindingRow): BindingDraft {
	const pinned = row.navLabel !== null && row.navOrder !== null
	return {
		path: row.path,
		author: row.author,
		d: row.d,
		showInNav: pinned,
		navLabel: row.navLabel ?? '',
		navOrder: row.navOrder === null ? '' : String(row.navOrder),
	}
}
