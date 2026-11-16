import { ROUTE_INTENT_VERSION, isValidIntentDTag, validateIntentPath, type RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import type { Binding } from '@platform/server/routes/routeFile'
import { npubToHex } from '@platform/web/app/pubkeyCodec'
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
	targetLabel: string
	updatedAtLabel: string
	updatedByLabel: string
	/** The `compiled-in-path` warning for this binding, or null. */
	warning: string | null
	/** The author and `d` the edit form starts from. */
	author: string
	d: string
}

export interface BindingDraft {
	path: string
	author: string
	d: string
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
	return {
		path: binding.path,
		targetLabel:
			target.type === 'page' ? `page ${shortPubkey(target.author)} / ${target.d}` : `${target.type} ${target.render} (${target.param})`,
		updatedAtLabel: formatUpdatedAt(binding.updatedAt),
		updatedByLabel: shortPubkey(binding.updatedBy),
		warning: warnings.find((warning) => warning.path === binding.path)?.message ?? null,
		author: target.type === 'page' ? target.author : '',
		d: target.type === 'page' ? target.d : '',
	}
}

export function describeBindings(bindings: Binding[], warnings: RouteTableWarning[] = []): BindingRow[] {
	return [...bindings]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((binding) => describeBinding(binding, warnings))
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
	if (author.error) errors.push(author.error)

	if (draft.d.trim().length === 0) {
		errors.push('Enter the d tag of the published page (usually "storefront-page").')
	} else if (!isValidIntentDTag(draft.d)) {
		errors.push('That d tag cannot be used: it is longer than 512 characters or contains a NUL.')
	}

	if (errors.length > 0 || !author.hex) return { errors, intent: null }

	return {
		errors: [],
		intent: {
			version: ROUTE_INTENT_VERSION,
			action: 'set',
			path,
			target: { type: 'page', author: author.hex, d: draft.d },
		},
	}
}

export function removeIntent(path: string): RouteIntent {
	return { version: ROUTE_INTENT_VERSION, action: 'remove', path, target: null }
}

/** The form's starting point for a new binding. */
export const EMPTY_DRAFT: BindingDraft = { path: '', author: '', d: 'storefront-page' }

export function draftFromRow(row: BindingRow): BindingDraft {
	return { path: row.path, author: row.author, d: row.d }
}