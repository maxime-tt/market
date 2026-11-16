import { verifyEvent, type Event } from 'nostr-tools/pure'
import { parseStorefrontPage, STOREFRONT_PAGE_KIND } from '@sdk/commerce/storefront/storefrontPage'
import { parseRouteIntent, ROUTE_INTENT_KIND } from '@sdk/commerce/storefront/routeIntent'
import { getAppPublicKeyOrThrow } from '../runtime'
import { getEventHandler } from '../EventHandler'
import { renderPage, type RenderedPage } from '../routes/pageRender'
import type { PageStore, StoredPage } from '../routes/pageStore'
import type { RouteTable } from '../routes/routeTable'
import type { BunRoutes } from './types'

/**
 * `POST /api/app-events` — the ONE write-restricted ingest surface
 * (`IMPLEMENTATION-PLAN.md` §1.5).
 *
 * verify → level → kind allowlist → dispatch. Two kinds are accepted: the
 * storefront page (30024), and the route intent (30025) that points a path at
 * one. Both pass the same gate in the same order, so there is exactly one place
 * where "may this pubkey write?" is answered.
 *
 * The endpoint never reads a relay: it is the app relay's own POST surface,
 * running in-process. `d` comes from the signed event's tag, never from the
 * request body, and the record is built by the server. A route intent is
 * applied to the live table and re-validated as a whole; a change that would
 * make the table invalid is refused and nothing is persisted.
 */

export type AccessLevel = 'app' | 'admin' | 'editor' | null

export interface AppEventsDeps {
	pageStore: PageStore
	/** Server-side level lookup — the signed event's pubkey is the only input. */
	levelOf: (pubkey: string) => AccessLevel
	/** The live table route intents are applied to. */
	routeTable: RouteTable
	/** Injectable for tests; production uses `renderPage`. */
	render?: (page: Parameters<typeof renderPage>[0], options: { author: string }) => RenderedPage
	/** Unix seconds. */
	now?: () => number
	/** A stale signed event is refused rather than stored twice. OUR CHOICE (§11 R-2). */
	freshnessSeconds?: number
	/**
	 * The byte cap checked BEFORE parsing. `STOREFRONT_LIMITS` bounds block
	 * counts and field lengths but names no payload byte ceiling; 512 KiB is
	 * this increment's OUR CHOICE, above the largest valid 100-block document.
	 */
	maxContentBytes?: number
}

export const DEFAULT_REPLAY_WINDOW_SECONDS = 300
export const MAX_PAGE_CONTENT_BYTES = 512 * 1024

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

const fail = (status: number, reason: string, detail?: string): Response =>
	json(status, detail ? { error: reason, detail } : { error: reason })

interface SignedEvent extends Event {
	tags: string[][]
}

function isSignedEvent(value: unknown): value is SignedEvent {
	if (typeof value !== 'object' || value === null) return false
	const event = value as Record<string, unknown>
	return (
		typeof event.id === 'string' &&
		HEX64.test(event.id) &&
		typeof event.pubkey === 'string' &&
		HEX64.test(event.pubkey) &&
		typeof event.sig === 'string' &&
		HEX128.test(event.sig) &&
		typeof event.created_at === 'number' &&
		Number.isInteger(event.created_at) &&
		typeof event.kind === 'number' &&
		typeof event.content === 'string' &&
		Array.isArray(event.tags) &&
		event.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))
	)
}

/** Production level lookup: the app key first, then the server's own managers. */
export function createLevelLookup(): (pubkey: string) => AccessLevel {
	return (pubkey: string): AccessLevel => {
		try {
			if (getAppPublicKeyOrThrow() === pubkey) return 'app'
		} catch {
			// No APP_PRIVATE_KEY configured yet — fall through to the managers.
		}
		const handler = getEventHandler()
		if (handler.isAdmin(pubkey)) return 'admin'
		if (handler.isEditor(pubkey)) return 'editor'
		return null
	}
}

export const ACCEPTED_KINDS: readonly number[] = [STOREFRONT_PAGE_KIND, ROUTE_INTENT_KIND]

export function buildAppEventsRoutes(deps: AppEventsDeps): BunRoutes {
	const render = deps.render ?? renderPage
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
	const freshness = deps.freshnessSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS
	const maxBytes = deps.maxContentBytes ?? MAX_PAGE_CONTENT_BYTES

	const handler = async (request: Request): Promise<Response> => {
		let body: unknown
		try {
			body = await request.json()
		} catch {
			return fail(400, 'bad-request')
		}
		if (typeof body !== 'object' || body === null || !isSignedEvent((body as { event?: unknown }).event)) {
			return fail(400, 'bad-request')
		}
		const event = (body as { event: SignedEvent }).event

		// 1. The signature is the only identity.
		if (!verifyEvent(event)) return fail(400, 'bad-signature')

		// 2. The level comes from the server's own state, keyed on pubkey.
		const level = deps.levelOf(event.pubkey)
		if (level !== 'app' && level !== 'admin' && level !== 'editor') return fail(403, 'no-acl')

		// 3. Kind allowlist.
		if (!ACCEPTED_KINDS.includes(event.kind)) return fail(400, 'kind-not-allowed', `kind ${event.kind}`)

		// 4. Replay: a signed event with no session has no built-in expiry.
		if (Math.abs(now() - event.created_at) > freshness) return fail(400, 'stale-intent')

		// 4a. Size cap before parsing — a hostile document does not get to spend
		// validation time proportional to its own length.
		if (Buffer.byteLength(event.content, 'utf8') > maxBytes) return fail(400, 'too-large')

		if (event.kind === ROUTE_INTENT_KIND) return applyRouteIntent(event)

		return storePage(event)
	}

	/**
	 * The route-intent arm. The event's `d` tag is the binding path — the same
	 * "the tag, never the body" rule the page arm applies to `d` — and the
	 * table's own validator decides whether the result is servable.
	 */
	function applyRouteIntent(event: SignedEvent): Response {
		const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
		if (typeof d !== 'string' || d.length === 0) return fail(400, 'invalid-route-intent', '/d: missing d tag')

		const parsed = parseRouteIntent(event.content, d)
		if (!parsed.intent || parsed.error) return fail(400, 'invalid-route-intent', parsed.error ?? 'route intent rejected')
		const intent = parsed.intent

		// Attribution is the event: `createdAt` is the signature's timestamp and
		// `updatedBy` its pubkey. Neither is read from the request body.
		const applied = deps.routeTable.apply(intent, { createdAt: event.created_at, pubkey: event.pubkey })
		if (!applied.ok) return json(400, { error: 'invalid-route-table', detail: applied.violations.join('; ') })

		return json(200, {
			stored: true,
			kind: ROUTE_INTENT_KIND,
			path: intent.path,
			action: intent.action,
			eventId: event.id,
			changed: applied.changed,
			warnings: applied.warnings,
		})
	}

	function storePage(event: SignedEvent): Response {
		// 4b. Parse. A structurally wrong document is refused, not stored.
		const parsed = parseStorefrontPage(event.content)
		if (!parsed.page || parsed.error) return fail(400, 'invalid-page', parsed.error ?? 'page document rejected')

		// `d` comes from the event's tag, never from the request body.
		const d = event.tags.find((tag) => tag[0] === 'd')?.[1]
		if (typeof d !== 'string' || d.length === 0) return fail(400, 'invalid-page', '/d: missing d tag')

		const series = [
			...new Set(event.tags.filter((tag) => tag[0] === 't' && typeof tag[1] === 'string' && tag[1].length > 0).map((tag) => tag[1])),
		]

		// 4c. Render. A page that cannot render is not stored — that is what lets
		// the serve path treat a stored page as servable by construction.
		let rendered: RenderedPage
		try {
			rendered = render(parsed.page, { author: event.pubkey })
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			return fail(400, 'render-failed', detail)
		}

		const record: StoredPage = {
			document: parsed.page,
			html: rendered.html,
			meta: rendered.meta,
			eventId: event.id,
			createdAt: event.created_at,
			author: event.pubkey,
			d,
			series,
		}

		try {
			// 4d. Store. Nothing above this line has written a byte.
			deps.pageStore.put(record)
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			return json(500, { error: 'store-failed', detail })
		}

		return json(200, { stored: true, kind: STOREFRONT_PAGE_KIND, author: event.pubkey, d, eventId: event.id })
	}

	return {
		'/api/app-events': { POST: handler },
	}
}