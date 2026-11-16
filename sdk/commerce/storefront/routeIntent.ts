import { isUrlSpaceName, isValidRouteName } from '@sdk/config/routeNames'

/**
 * Route intents — the signed record an admin authors to point a path at a page.
 *
 * `IMPLEMENTATION-PLAN.md` §1.5 keeps one write surface: the intent is an
 * ordinary signed event handed to `POST /api/app-events`, exactly like a
 * storefront page. The signature is the identity; the server's routing table is
 * *derived* state, rebuilt by applying intents, so nothing about who may
 * author a binding is asserted by this document — the server asks its own ACL.
 *
 * Event shape:
 *
 *   kind    30025 — addressable, one intent per path (OUR CHOICE: 30025 is
 *           unclaimed in this app's parameterised-replaceable range; the intent
 *           is instance state and is never published to a public relay)
 *   d       the path being authored. The event's address IS the binding path,
 *           so a replacement for `shop` can never land on another path.
 *   content `{ version, action, path, target }`, validated here
 *   author  the signing key. The server records it as `updatedBy`.
 *
 * This module is framework-free and imports only the page-independent name
 * grammar, because the browser signs intents and the Bun server applies them
 * with the same parser.
 */

export const ROUTE_INTENT_KIND = 30025

export const ROUTE_INTENT_VERSION = 1

/** `set` creates or retargets a binding; `remove` deletes it. */
export type RouteIntentAction = 'set' | 'remove'

/** The page address a binding points at — the coordinate the page store keys by. */
export interface RouteIntentPageTarget {
	type: 'page'
	author: string
	d: string
}

export interface RouteIntent {
	version: typeof ROUTE_INTENT_VERSION
	action: RouteIntentAction
	path: string
	/** Present for `set`, `null` for `remove`. */
	target: RouteIntentPageTarget | null
}

export interface RouteIntentParseResult {
	intent: RouteIntent | null
	error: string | null
}

const HEX64 = /^[0-9a-f]{64}$/

const MAX_D_LENGTH = 512

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A page `d` is an opaque tag value: non-empty, bounded, and never containing
 * NUL — the same rule the routing table applies to a stored binding's target.
 */
export function isValidIntentDTag(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= MAX_D_LENGTH && !value.includes('\u0000')
}

/**
 * The paths this increment can author: one top-level name.
 *
 * A subpath binding is legal in the table but is served from a static route
 * registered at boot, so authoring one at runtime would store a row the serve
 * path could not honour without a restart. Refusing it here is the honest
 * choice; multi-segment authoring arrives with the multi-segment serve
 * increment. Reserved URL-space names (`api`, `images`, …) are refused because
 * they are the URL space itself, not a page address.
 */
export function validateIntentPath(value: unknown): string | null {
	if (typeof value !== 'string' || value.length === 0) return '/path: expected a non-empty string'
	if (value.includes('/')) return `/path: ${JSON.stringify(value)}: only a top-level name can be authored in this increment`
	if (!isValidRouteName(value)) return `/path: ${JSON.stringify(value)} does not match the name grammar (3-30 lowercase alphanumerics, "_" or "-")`
	if (isUrlSpaceName(value)) return `/path: app-owned-name: ${value} is part of the URL space and cannot be re-pointed`
	return null
}

/**
 * Parses an intent document. `dTag` is the event's own `d` tag: when supplied it
 * must equal the document's `path`, because the tag is what makes the event
 * addressable and a mismatch would let a signed event claim one address and
 * mean another.
 */
export function parseRouteIntent(content: string, dTag?: string): RouteIntentParseResult {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		return { intent: null, error: `/ : not valid JSON (${detail})` }
	}

	if (!isRecord(parsed)) return { intent: null, error: '/ : expected a JSON object' }

	for (const key of Object.keys(parsed)) {
		if (!['version', 'action', 'path', 'target'].includes(key)) return { intent: null, error: `/${key}: unknown field` }
	}

	if (parsed.version !== ROUTE_INTENT_VERSION) {
		return { intent: null, error: `/version: expected ${ROUTE_INTENT_VERSION}, got ${JSON.stringify(parsed.version)}` }
	}

	const action = parsed.action
	if (action !== 'set' && action !== 'remove') {
		return { intent: null, error: `/action: expected "set" or "remove", got ${JSON.stringify(action)}` }
	}

	const pathError = validateIntentPath(parsed.path)
	if (pathError) return { intent: null, error: pathError }
	const path = parsed.path as string

	if (dTag !== undefined && dTag !== path) {
		return { intent: null, error: `/path: ${JSON.stringify(path)} does not match the event's d tag ${JSON.stringify(dTag)}` }
	}

	if (action === 'remove') {
		if (parsed.target !== undefined && parsed.target !== null) {
			return { intent: null, error: '/target: a remove intent must not name a target' }
		}
		return { intent: { version: ROUTE_INTENT_VERSION, action, path, target: null }, error: null }
	}

	const target = parsed.target
	if (!isRecord(target)) return { intent: null, error: '/target: expected an object' }
	if (target.type !== 'page') {
		return { intent: null, error: `/target/type: ${JSON.stringify(target.type)} is not supported (only "page")` }
	}
	if (typeof target.author !== 'string' || !HEX64.test(target.author)) {
		return { intent: null, error: '/target/author: expected 64 lowercase hex' }
	}
	if (!isValidIntentDTag(target.d)) return { intent: null, error: '/target/d: expected a non-empty page d tag' }

	return {
		intent: { version: ROUTE_INTENT_VERSION, action, path, target: { type: 'page', author: target.author, d: target.d } },
		error: null,
	}
}

/** The document an author signs. `path` also becomes the event's `d` tag. */
export function routeIntentContent(intent: RouteIntent): string {
	return JSON.stringify({
		version: ROUTE_INTENT_VERSION,
		action: intent.action,
		path: intent.path,
		...(intent.target ? { target: intent.target } : {}),
	})
}

export interface RouteIntentEventTemplate {
	kind: number
	created_at: number
	tags: string[][]
	content: string
}

/**
 * The unsigned event for an intent. Throws on an invalid intent rather than
 * signing something the server would refuse: an author deserves the reason
 * before a write, not after a 400.
 */
export function buildRouteIntentEvent(intent: RouteIntent, createdAt: number): RouteIntentEventTemplate {
	const { error } = parseRouteIntent(routeIntentContent(intent), intent.path)
	if (error) throw new Error(`Route intent is not valid: ${error}`)
	return {
		kind: ROUTE_INTENT_KIND,
		created_at: createdAt,
		tags: [['d', intent.path]],
		content: routeIntentContent(intent),
	}
}