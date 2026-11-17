import { beforeAll, describe, expect, mock, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core'
import type { EventTemplate } from '@platform/web/ndkPublishContext'
import type { EventFilter } from '@sdk/core/event-store'
import {
	STOREFRONT_PAGE_D_TAG,
	STOREFRONT_PAGE_KIND,
	STOREFRONT_PAGE_VERSION,
	createEmptyStorefrontPage,
} from '@sdk/commerce/storefront/storefrontPage'

/**
 * Covers the two halves of the storefront page round trip that only show up at
 * the I/O boundary: what gets signed, and which of several relay answers wins.
 *
 * The two seams mocked here are first-party platform modules — the publish
 * bridge (`platform/web/ndkPublishContext.ts`) and the read composition root
 * (`platform/web/readContext.ts`) — which is what makes mocking them
 * acceptable: the repo's test rules forbid mocking third-party packages
 * process-wide, and unit files run under `--isolate`.
 */

const AUTHOR = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

let lastFilters: EventFilter[] | null = null
let fetchResult: NostrEventLike[] = []
let signAs = AUTHOR
let publishedRelays = new Set<string>(['wss://relay.example'])
let lastSigned: NostrEventLike | null = null

mock.module('@platform/web/ndkPublishContext', () => ({
	getUser: async () => ({ pubkey: AUTHOR }),
	signNostrEvent: async (template: EventTemplate): Promise<NostrEventLike> => {
		const signed: NostrEventLike = { ...template, id: 'signed-id', pubkey: signAs, sig: 'sig' }
		lastSigned = signed
		return signed
	},
	publishNostrEvent: async () => ({ publishedRelays }),
}))

mock.module('@platform/web/readContext', () => ({
	getReadContext: () => ({
		fetch: async (filters: readonly EventFilter[]) => {
			lastFilters = [...filters]
			return fetchResult
		},
		store: {},
	}),
}))

/**
 * The ingest leg of publish. `publishStorefrontPage` POSTs the signed page to
 * the one write surface (`/api/app-events`, the same call `routeTableQuery.ts`
 * makes), and this file's production modules only reach the network through
 * `globalThis.fetch` for that one call. Standing in for it here is what lets
 * these tests assert the request the browser would send, and drive the two
 * refusal shapes (a refused ingest, a dead ingest) without a server.
 */
interface IngestCall {
	url: string
	method: string
	body: unknown
}
let ingestCalls: IngestCall[] = []
let ingestRespond: () => Response = () => jsonResponse(200, { stored: true })

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const urlOf = (input: RequestInfo | URL): string =>
	typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const raw = init?.body
	ingestCalls.push({
		url: urlOf(input),
		method: init?.method ?? 'GET',
		body: typeof raw === 'string' ? JSON.parse(raw) : null,
	})
	return ingestRespond()
}) as typeof fetch

// Imported inside beforeAll, after the seams above are mocked — a static import
// would be hoisted past `mock.module` and bind the real platform modules.
let buildStorefrontPageEvent: (typeof import('./storefrontPublish'))['buildStorefrontPageEvent']
let publishStorefrontPage: (typeof import('./storefrontPublish'))['publishStorefrontPage']
let unpublishStorefrontPage: (typeof import('./storefrontPublish'))['unpublishStorefrontPage']
let fetchStorefrontPage: (typeof import('./storefrontQuery'))['fetchStorefrontPage']
let shouldRenderStorefrontPage: (typeof import('./storefrontQuery'))['shouldRenderStorefrontPage']
let storefrontAddressPageQueryOptions: (typeof import('./storefrontQuery'))['storefrontAddressPageQueryOptions']

beforeAll(async () => {
	;({ buildStorefrontPageEvent, publishStorefrontPage, unpublishStorefrontPage } = await import('./storefrontPublish'))
	;({ fetchStorefrontPage, shouldRenderStorefrontPage, storefrontAddressPageQueryOptions } = await import('./storefrontQuery'))
})

function pageEvent(overrides: Partial<NostrEventLike> & { content?: string } = {}): NostrEventLike {
	return {
		id: 'e1',
		pubkey: AUTHOR,
		kind: STOREFRONT_PAGE_KIND,
		created_at: 1000,
		tags: [['d', STOREFRONT_PAGE_D_TAG]],
		content: JSON.stringify({
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			root: { props: {} },
			content: [{ type: 'Divider', props: { id: 'd1' } }],
		}),
		sig: 'sig',
		...overrides,
	}
}

describe('buildStorefrontPageEvent', () => {
	test('produces an addressable event with the documented kind and d tag', () => {
		const template = buildStorefrontPageEvent(createEmptyStorefrontPage())
		expect(template.kind).toBe(STOREFRONT_PAGE_KIND)
		expect(template.tags).toContainEqual(['d', STOREFRONT_PAGE_D_TAG])
	})

	test('carries a title tag so other clients can list the page without parsing content', () => {
		const page = createEmptyStorefrontPage()
		page.root.props.title = 'Alice’s shop'
		expect(buildStorefrontPageEvent(page).tags).toContainEqual(['title', 'Alice’s shop'])
	})

	test('omits the title tag when there is no title', () => {
		const tags = buildStorefrontPageEvent(createEmptyStorefrontPage()).tags
		expect(tags.some((tag) => tag[0] === 'title')).toBe(false)
	})

	test('refuses to build an event for a page with an unsafe link', () => {
		const page = {
			...createEmptyStorefrontPage(),
			content: [{ type: 'LinkList', props: { id: 'l1', title: '', layout: 'row', links: [{ label: 'x', href: 'javascript:alert(1)' }] } }],
		}
		expect(() => buildStorefrontPageEvent(page as never)).toThrow(/not valid/i)
	})

	test('the signed content parses back to the same document', () => {
		const page = { ...createEmptyStorefrontPage(), enabled: true }
		expect(JSON.parse(buildStorefrontPageEvent(page).content)).toEqual(page)
	})
})

describe('publishStorefrontPage', () => {
	test('returns the relays that acknowledged', async () => {
		signAs = AUTHOR
		publishedRelays = new Set(['wss://a.example', 'wss://b.example'])

		const result = await publishStorefrontPage(createEmptyStorefrontPage())
		expect(result.pubkey).toBe(AUTHOR)
		expect(result.publishedRelays.sort()).toEqual(['wss://a.example', 'wss://b.example'])
	})

	test('treats zero relay ACKs as a failure rather than a success', async () => {
		signAs = AUTHOR
		publishedRelays = new Set()
		await expect(publishStorefrontPage(createEmptyStorefrontPage())).rejects.toThrow(/No relay accepted/i)
		publishedRelays = new Set(['wss://a.example'])
	})

	test('refuses to publish when the signer produced a different author', async () => {
		signAs = OTHER
		await expect(publishStorefrontPage(createEmptyStorefrontPage())).rejects.toThrow(/different account/i)
		signAs = AUTHOR
	})
})

describe('publishStorefrontPage — the ingest switch', () => {
	// The relay leg and the local-store leg are separate facts. These tests pin
	// that the SAME signed event goes to the ingest, that a refused or dead
	// ingest is a refusal the author sees (never a success), and that switching
	// the page off travels the identical path — an unpublish that only reached
	// relays would leave this instance serving a withdrawn page.

	test('posts the same signed event to the ingest so this instance stores it', async () => {
		signAs = AUTHOR
		publishedRelays = new Set(['wss://a.example'])
		ingestCalls = []
		ingestRespond = () => jsonResponse(200, { stored: true })

		await publishStorefrontPage(createEmptyStorefrontPage())

		expect(ingestCalls).toHaveLength(1)
		expect(ingestCalls[0].url).toBe('/api/app-events')
		expect(ingestCalls[0].method).toBe('POST')
		const sent = (ingestCalls[0].body as { event: NostrEventLike }).event
		expect(sent.id).toBe('signed-id')
		expect(sent.pubkey).toBe(AUTHOR)
		expect(sent.kind).toBe(STOREFRONT_PAGE_KIND)
	})

	test('a refused ingest rejects, naming the relays that did accept and why the instance did not', async () => {
		signAs = AUTHOR
		publishedRelays = new Set(['wss://a.example', 'wss://b.example'])
		ingestCalls = []
		ingestRespond = () => jsonResponse(403, { error: 'no-acl' })

		const failure = publishStorefrontPage(createEmptyStorefrontPage())
		await expect(failure).rejects.toThrow(/did not store it/i)
		await expect(publishStorefrontPage(createEmptyStorefrontPage())).rejects.toThrow(/2 relays/)
		await expect(publishStorefrontPage(createEmptyStorefrontPage())).rejects.toThrow(/app key, an admin or an editor/)
	})

	test('a dead ingest rejects rather than reporting the page as live', async () => {
		signAs = AUTHOR
		publishedRelays = new Set(['wss://a.example'])
		ingestCalls = []
		ingestRespond = () => {
			throw new Error('network is dead')
		}

		await expect(publishStorefrontPage(createEmptyStorefrontPage())).rejects.toThrow(/did not store it/i)
		ingestRespond = () => jsonResponse(200, { stored: true })
	})

	test('an ingest that answers without confirming the store is a refusal', async () => {
		signAs = AUTHOR
		publishedRelays = new Set(['wss://a.example'])
		ingestCalls = []
		ingestRespond = () => jsonResponse(200, { stored: false })

		await expect(publishStorefrontPage(createEmptyStorefrontPage())).rejects.toThrow(/did not store it/i)
		ingestRespond = () => jsonResponse(200, { stored: true })
	})

	test('switching the page off reaches the ingest with the same coordinate', async () => {
		signAs = AUTHOR
		publishedRelays = new Set(['wss://a.example'])
		ingestCalls = []
		ingestRespond = () => jsonResponse(200, { stored: true })

		await unpublishStorefrontPage({ ...createEmptyStorefrontPage(), enabled: true })

		expect(ingestCalls).toHaveLength(1)
		const sent = (ingestCalls[0].body as { event: NostrEventLike }).event
		expect(JSON.parse(sent.content as string).enabled).toBe(false)
		expect(sent.tags).toContainEqual(['d', STOREFRONT_PAGE_D_TAG])
	})
})

describe('fetchStorefrontPage', () => {
	test('queries the author-scoped addressable coordinate through the read seam', async () => {
		fetchResult = []
		await fetchStorefrontPage(AUTHOR)
		expect(lastFilters).toEqual([
			{
				kinds: [STOREFRONT_PAGE_KIND],
				authors: [AUTHOR],
				'#d': [STOREFRONT_PAGE_D_TAG],
			},
		])
	})

	test('returns the empty result for an author with no page', async () => {
		fetchResult = []
		const result = await fetchStorefrontPage(AUTHOR)
		expect(result.event).toBeNull()
		expect(result.page).toBeNull()
		expect(result.error).toBeNull()
	})

	test('rejects an invalid pubkey without touching the relay', async () => {
		lastFilters = null
		const result = await fetchStorefrontPage('not-a-pubkey')
		expect(result.event).toBeNull()
		expect(lastFilters).toBeNull()
	})

	test('picks the newest replacement when a relay returns several', async () => {
		fetchResult = [pageEvent({ id: 'old', created_at: 1000 }), pageEvent({ id: 'new', created_at: 2000 })]
		const result = await fetchStorefrontPage(AUTHOR)
		expect(result.event?.id).toBe('new')
	})

	test('breaks a created_at tie on the lower event id, as NIP-01 requires', async () => {
		fetchResult = [pageEvent({ id: 'ffff', created_at: 2000 }), pageEvent({ id: 'aaaa', created_at: 2000 })]
		expect((await fetchStorefrontPage(AUTHOR)).event?.id).toBe('aaaa')
	})

	test('discards events the relay returned that do not match the address', async () => {
		// A relay is free to answer with whatever it likes; author and d tag
		// decide the address, so both are re-checked client side.
		fetchResult = [
			pageEvent({ id: 'wrong-author', pubkey: OTHER, created_at: 5000 }),
			pageEvent({ id: 'wrong-dtag', tags: [['d', 'something-else']], created_at: 4000 }),
			pageEvent({ id: 'right', created_at: 1000 }),
		]
		expect((await fetchStorefrontPage(AUTHOR)).event?.id).toBe('right')
	})

	test('surfaces a parse failure without throwing, so the profile can take over', async () => {
		fetchResult = [pageEvent({ content: 'not json' })]
		const result = await fetchStorefrontPage(AUTHOR)
		expect(result.event).not.toBeNull()
		expect(result.page).toBeNull()
		expect(result.error).toBeTruthy()
	})
})

describe('fetchStorefrontPage — generic address coordinate (HANDOVER §6.1)', () => {
	test('the requested d tag is the filter, verbatim', async () => {
		fetchResult = []
		await fetchStorefrontPage(AUTHOR, 'featured-2026-11-03')
		expect(lastFilters).toEqual([
			{
				kinds: [STOREFRONT_PAGE_KIND],
				authors: [AUTHOR],
				'#d': ['featured-2026-11-03'],
			},
		])
	})

	test('a plain segment and a dated segment resolve through the identical path', async () => {
		// The no-special-casing proof: whatever the segment looks like, the only
		// thing that changes is the d tag inside the same filter shape.
		fetchResult = [pageEvent({ id: 'plain', tags: [['d', 'featured']] })]
		expect((await fetchStorefrontPage(AUTHOR, 'featured')).event?.id).toBe('plain')

		fetchResult = [pageEvent({ id: 'dated', tags: [['d', 'featured-2026-11-03']] })]
		expect((await fetchStorefrontPage(AUTHOR, 'featured-2026-11-03')).event?.id).toBe('dated')
	})

	test('an event at a different d tag never wins the address', async () => {
		fetchResult = [pageEvent({ tags: [['d', 'some-other-page']], created_at: 9999 })]
		const result = await fetchStorefrontPage(AUTHOR, 'featured')
		expect(result.event).toBeNull()
		expect(result.page).toBeNull()
	})

	test('an absent coordinate is the empty result, not an error', async () => {
		fetchResult = []
		const result = await fetchStorefrontPage(AUTHOR, 'featured')
		expect(result.event).toBeNull()
		expect(result.error).toBeNull()
	})
})

describe('storefrontAddressPageQueryOptions', () => {
	test('composes a distinct cache key per (author, d) coordinate', () => {
		// Spread: `queryOptions` brands the key, so the assertion compares the
		// plain tuple it denotes.
		expect([...storefrontAddressPageQueryOptions(AUTHOR, 'featured').queryKey]).toEqual(['storefront', 'address', AUTHOR, 'featured'])
		expect([...storefrontAddressPageQueryOptions(AUTHOR, 'featured-2026-11-03').queryKey]).toEqual([
			'storefront',
			'address',
			AUTHOR,
			'featured-2026-11-03',
		])
	})

	test('gates on a valid author and a non-empty d tag', () => {
		expect(storefrontAddressPageQueryOptions(AUTHOR, 'featured').enabled).toBe(true)
		expect(storefrontAddressPageQueryOptions('not-a-pubkey', 'featured').enabled).toBe(false)
		expect(storefrontAddressPageQueryOptions(AUTHOR, '').enabled).toBe(false)
	})
})

describe('shouldRenderStorefrontPage', () => {
	test('requires the page to be enabled and to have surviving blocks', async () => {
		fetchResult = [pageEvent()]
		expect(shouldRenderStorefrontPage(await fetchStorefrontPage(AUTHOR))).toBe(true)

		fetchResult = [
			pageEvent({
				content: JSON.stringify({
					version: STOREFRONT_PAGE_VERSION,
					enabled: false,
					root: { props: {} },
					content: [{ type: 'Divider', props: { id: 'd' } }],
				}),
			}),
		]
		expect(shouldRenderStorefrontPage(await fetchStorefrontPage(AUTHOR))).toBe(false)

		// Enabled but every block was dropped: showing an empty page is worse
		// for a visitor than the profile they expected.
		fetchResult = [
			pageEvent({
				content: JSON.stringify({
					version: STOREFRONT_PAGE_VERSION,
					enabled: true,
					root: { props: {} },
					content: [{ type: 'Unknown', props: { id: 'x' } }],
				}),
			}),
		]
		expect(shouldRenderStorefrontPage(await fetchStorefrontPage(AUTHOR))).toBe(false)
	})

	test('is false for a missing page', () => {
		expect(shouldRenderStorefrontPage(undefined)).toBe(false)
	})
})

test('the mocked signer was actually exercised', () => {
	expect(lastSigned?.kind).toBe(STOREFRONT_PAGE_KIND)
})
