import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buildRouteIntentEvent, type RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import type { Binding, RouteWarning } from '@platform/server/routes/routeFile'
import { getUser, signNostrEvent } from '@platform/web/ndkPublishContext'

/**
 * The admin authoring surface's two edges: the table this instance serves
 * (`GET /api/routes`) and the signed intent that changes it
 * (`POST /api/app-events`).
 *
 * The table is process state, not relay state — there is nothing to subscribe
 * to for "what does this instance serve right now" — so the read deliberately
 * asks the server that owns it, with `cache-control: no-store` behind it. The
 * write is the same one ingest every other write uses: the author signs an
 * event, the server decides the level from the signature, and the table is
 * derived from what comes back.
 */

export interface RouteTableWarning extends RouteWarning {
	message: string
}

export interface RouteTableView {
	version: number
	seq: number
	default: string | null
	bindings: Binding[]
	warnings: RouteTableWarning[]
}

export const routeTableKeys = {
	all: ['route-table'] as const,
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads the live table. A malformed body throws rather than degrading to an
 * empty list: "no paths are bound" and "we could not read the table" are
 * different facts and the UI must not confuse them.
 */
export async function fetchRouteTable(): Promise<RouteTableView> {
	const response = await fetch('/api/routes', { headers: { accept: 'application/json' } })
	if (!response.ok) throw new Error(`Could not read the routing table (HTTP ${response.status}).`)

	let body: unknown
	try {
		body = await response.json()
	} catch {
		throw new Error('The routing table response was not JSON.')
	}
	if (!isRecord(body) || !Array.isArray(body.bindings) || !Array.isArray(body.warnings)) {
		throw new Error('The routing table response did not contain a bindings list.')
	}

	return {
		version: typeof body.version === 'number' ? body.version : 0,
		seq: typeof body.seq === 'number' ? body.seq : 0,
		default: typeof body.default === 'string' ? body.default : null,
		bindings: body.bindings as Binding[],
		warnings: body.warnings as RouteTableWarning[],
	}
}

export function useRouteTable() {
	return useQuery({ queryKey: routeTableKeys.all, queryFn: fetchRouteTable })
}

export interface PublishRouteIntentResult {
	changed: boolean
	warnings: RouteTableWarning[]
}

/** Turns the ingest's refusal into the sentence the admin needs to read. */
export function describeIngestFailure(status: number, body: unknown): string {
	const error = isRecord(body) && typeof body.error === 'string' ? body.error : null
	const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : null

	switch (error) {
		case 'no-acl':
			return 'This account is not an admin or editor of this app, so the change was refused. Nothing was written.'
		case 'bad-signature':
			return 'The signature did not verify, so the change was refused. Nothing was written.'
		case 'stale-intent':
			return 'The signed change was outside the freshness window — check this machine’s clock and try again.'
		case 'invalid-route-intent':
			return `The change was rejected: ${detail ?? 'the route intent is not valid'}.`
		case 'invalid-route-table':
			return `The change would make the routing table invalid, so it was refused: ${detail ?? 'no detail given'}.`
		case 'too-large':
			return 'The change was too large to be a route intent.'
		default:
			return `The change failed (HTTP ${status}${error ? `: ${error}` : ''}). Nothing was written.`
	}
}

/**
 * Signs and submits an intent as the logged-in admin.
 *
 * The signer decides the author. If it signed as somebody else — a signer
 * swapped between login and publish — the event would land on another
 * account's authority, so it is refused before it is sent.
 */
export async function publishRouteIntent(intent: RouteIntent): Promise<PublishRouteIntentResult> {
	const user = await getUser()
	if (!user?.pubkey) throw new Error('You must be logged in to change a route.')

	const template = buildRouteIntentEvent(intent, Math.floor(Date.now() / 1000))
	const signed = await signNostrEvent(template)
	if (signed.pubkey !== user.pubkey) {
		throw new Error('Refusing to send: the signer produced an event for a different account. Nothing was changed.')
	}

	const response = await fetch('/api/app-events', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ event: signed }),
	})

	let body: unknown = null
	try {
		body = await response.json()
	} catch {
		body = null
	}

	if (!response.ok) throw new Error(describeIngestFailure(response.status, body))
	if (!isRecord(body)) throw new Error('The ingest answered without a body; the change could not be confirmed.')

	return {
		changed: body.changed === true,
		warnings: Array.isArray(body.warnings) ? (body.warnings as RouteTableWarning[]) : [],
	}
}

/** Re-reads the table after a write, because the server is the authority on it. */
export function usePublishRouteIntent() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: publishRouteIntent,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: routeTableKeys.all })
		},
	})
}