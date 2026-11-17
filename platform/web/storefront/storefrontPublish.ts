import { getUser, publishNostrEvent, signNostrEvent } from '@platform/web/ndkPublishContext'
import type { EventTemplate, NostrEvent } from '@platform/web/ndkPublishContext'
import {
	STOREFRONT_PAGE_D_TAG,
	STOREFRONT_PAGE_KIND,
	validateStorefrontPageForPublish,
	type StorefrontPage,
} from '@sdk/commerce/storefront/storefrontPage'

/**
 * Publishing a user's storefront page (ADR-0006).
 *
 * Event shape, stated explicitly per the publish-state rule:
 *
 *   kind    30024 — addressable, one page per pubkey
 *   d       `storefront-page` — the addressable identifier
 *   author  the logged-in user's own pubkey. The app key is NOT involved: page
 *           content is user speech, and the app must not be its author.
 *   content JSON `{ version, enabled, root, content }`, validated by
 *           `validateStorefrontPageForPublish` BEFORE signing
 *   relays  the host's configured write relays
 *   ingest  the SAME signed event, POSTed to `/api/app-events` after the relay
 *           ACK, so this instance stores the page it will serve
 *
 * There are two destinations and they answer different questions. A relay makes
 * the page reachable by pubkey to other clients — that is the portability path
 * and it stays. The ingest is what puts the page in THIS instance's local page
 * store, which is the only thing the serve path reads; without it a published
 * page answers `binding-target-missing` at its bound path forever.
 *
 * The name at which a page is reachable is rented and arbitrated, but the page
 * itself is the author's and stays reachable by pubkey whether or not a name is
 * held or this instance accepts it (ADR-0006). That is why an ingest refusal is
 * reported as "not servable here", not as "lost".
 *
 * This is not a high-sensitivity publish — it moves no funds and carries no
 * payment lifecycle. It is, however, the input to a renderer that runs in a
 * wallet-bearing app, which is why validation happens here and again on read
 * (`parseStorefrontPage`), and again at the ingest (`parseStorefrontPage`): the
 * relay round trip means the bytes we render are never provably the bytes we
 * signed.
 */

/** Human-readable title tag, so other clients can list the page without parsing content. */
const TITLE_TAG = 'title'

/** The one write-restricted ingest surface — the same path `routeTableQuery.ts` posts to. */
export const APP_EVENTS_PATH = '/api/app-events'

export interface PublishStorefrontPageResult {
	eventId: string
	pubkey: string
	/** Relays that acknowledged the event. Never empty — a zero-ACK publish throws. */
	publishedRelays: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Turns the ingest's refusal of a page into the sentence the author needs.
 *
 * Mirrors `describeIngestFailure` in `routeTableQuery.ts`: a named reason beats
 * an HTTP status, and the default still names the status so nothing is hidden.
 */
export function describePageIngestRefusal(status: number, body: unknown): string {
	const error = isRecord(body) && typeof body.error === 'string' ? body.error : null
	const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : null

	switch (error) {
		case 'no-acl':
			return 'this instance only stores pages written by its app key, an admin or an editor'
		case 'bad-signature':
			return 'the signature did not verify at the ingest'
		case 'stale-intent':
			return 'the signed page fell outside the ingest freshness window — check this machine’s clock and try again'
		case 'invalid-page':
			return `the ingest rejected the page document${detail ? `: ${detail}` : ''}`
		case 'render-failed':
			return `the page could not be rendered on this instance${detail ? `: ${detail}` : ''}`
		case 'too-large':
			return 'the page was too large for the ingest'
		case 'store-failed':
			return `this instance could not write the page to its store${detail ? `: ${detail}` : ''}`
		default:
			return `the ingest refused it (HTTP ${status}${error ? `: ${error}` : ''})`
	}
}

/**
 * The local-store leg: the signed event, unchanged, to the app's own ingest.
 *
 * The event is already signed and verified once on the way in, so this adds no
 * identity — the ingest re-verifies the signature and derives `d` from the
 * tag. A throw here means the page is NOT servable on this instance; the
 * caller must not turn that into a success.
 */
async function ingestSignedPage(event: NostrEvent): Promise<void> {
	const response = await fetch(APP_EVENTS_PATH, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ event }),
	})

	let body: unknown = null
	try {
		body = await response.json()
	} catch {
		body = null
	}

	if (!response.ok) throw new Error(describePageIngestRefusal(response.status, body))
	// 200 is not proof of a write: the ingest answers `stored: true` only after
	// `pageStore.put` returned. Anything else is a refusal with a 200-shaped body.
	if (!isRecord(body) || body.stored !== true) throw new Error('the ingest answered without confirming the page was stored')
}

/**
 * Builds the unsigned event for a page. Exported for tests and for callers that
 * want to inspect what would be signed without signing it.
 *
 * @throws if the page fails strict validation. Refusing here rather than
 * dropping bad blocks is the point: the author gets told, instead of publishing
 * a page that silently renders with holes in it.
 */
export function buildStorefrontPageEvent(page: StorefrontPage): EventTemplate {
	const validation = validateStorefrontPageForPublish(page)
	if (!validation.ok) {
		throw new Error(`Storefront page is not valid: ${validation.errors.join(', ')}`)
	}

	const validated = validation.page
	const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]

	const title = validated.root.props.title.trim()
	if (title.length > 0) tags.push([TITLE_TAG, title])

	return {
		kind: STOREFRONT_PAGE_KIND,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify(validated),
		tags,
	}
}

/**
 * Signs and publishes the page as the logged-in user.
 *
 * Fails closed on zero relay ACKs: the publish bridge documents an empty
 * `publishedRelays` as a publish failure, and the underlying adapter resolves
 * rather than throws in that case, so the check has to live here to be
 * adapter-independent.
 */
export async function publishStorefrontPage(page: StorefrontPage): Promise<PublishStorefrontPageResult> {
	const user = await getUser()
	if (!user?.pubkey) throw new Error('You must be logged in to publish a page')

	const template = buildStorefrontPageEvent(page)
	const signed: NostrEvent = await signNostrEvent(template)

	// The signer decides the author. If it signed as somebody else (a signer
	// swapped between login and publish), the event would land on a different
	// pubkey's page address — refuse rather than write to a stranger's address.
	if (signed.pubkey !== user.pubkey) {
		throw new Error('Refusing to publish: the signer produced an event for a different account. Nothing was published.')
	}

	const result = await publishNostrEvent(signed)
	if (result.publishedRelays.size === 0) {
		throw new Error('No relay accepted the page. Your changes were not published — check your relay connections and try again.')
	}

	// The relay ACK makes the page reachable by pubkey; it does not make it
	// servable HERE. Both legs must succeed before this is a success: a page
	// that reached relays but not the local store answers
	// `binding-target-missing` at its bound path, so reporting "published"
	// would be a claim this instance cannot honour.
	try {
		await ingestSignedPage(signed)
	} catch (error) {
		const relayCount = result.publishedRelays.size
		const detail = error instanceof Error ? error.message : String(error)
		throw new Error(
			`The page reached ${relayCount} relay${relayCount === 1 ? '' : 's'}, but this instance did not store it, so no bound path here will serve it: ${detail}. The relay copy stands — this is about this instance, not about your page.`,
		)
	}

	return {
		eventId: signed.id,
		pubkey: signed.pubkey,
		publishedRelays: Array.from(result.publishedRelays),
	}
}

/**
 * Turns the page off without discarding it.
 *
 * Republishes the same document with `enabled: false`, so visitors get the
 * default profile view again while the author keeps every block. This is not a
 * NIP-09 deletion: deleting would destroy content the author may want back, and
 * relays honour deletions inconsistently anyway.
 */
export async function unpublishStorefrontPage(page: StorefrontPage): Promise<PublishStorefrontPageResult> {
	return publishStorefrontPage({ ...page, enabled: false })
}
