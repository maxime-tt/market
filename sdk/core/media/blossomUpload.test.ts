import { describe, expect, test } from 'bun:test'
import {
	BLOSSOM_UPLOAD_FAILED,
	BLOSSOM_UPLOAD_NO_SERVERS,
	DEFAULT_UPLOAD_ATTEMPTS,
	getUploadServerOrder,
	uploadFileToBlossom,
	type BlossomUploadEventTemplate,
	type BlossomUploadSigner,
} from './blossomUpload'

/**
 * Probes for the declared behavioural deltas of the rebuilt upload client (A1 §8,
 * red-team F2 — these are NEW-contract assertions, not parity claims):
 *
 * 1. the auth event: kind 24242, `t=upload`, an `x` tag for the blob and a
 *    `server` tag, handed to the signer FUNCTION (not an object);
 * 2. the fallback chain: the preferred server first, the first public default
 *    second, and the chain is WALKED when the preferred server fails (the
 *    legacy client hard-failed on a specified server);
 * 3. the retry count: every server gets up to `maxRetries` attempts (the legacy
 *    XHR path never reached its retry helper);
 * 4. the error surface: the `BLOSSOM_UPLOAD_*` message prefixes;
 * 5. progress is ADVISORY: `onProgress` fires at most a completion tick.
 *
 * The upload wire flow stubbed here mirrors the library's: HEAD /upload answers
 * 401, the auth event is requested once, then the authorized PUT answers the
 * blob descriptor.
 */

const STUB_PUBKEY = 'aa'.repeat(32)
const makeStubSigner = (drafts: BlossomUploadEventTemplate[]): BlossomUploadSigner => {
	return async (draft) => {
		drafts.push(draft)
		return { ...draft, id: `stub-event-${drafts.length}`, sig: 'stub-sig', pubkey: STUB_PUBKEY }
	}
}

const sha256Hex = async (file: File): Promise<string> => {
	const bytes = await file.arrayBuffer()
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const makeFile = (): File => new File([new Uint8Array([1, 2, 3, 4])], 'test.jpg', { type: 'image/jpeg' })

const descriptorFor = (url: URL) => ({
	uploaded: 1730000000,
	type: 'image/jpeg',
	sha256: 'ab'.repeat(32),
	size: 4,
	url: `${url.origin}/${'ab'.repeat(32)}.jpg`,
})

type FetchCall = { url: string; method: string; authorization?: string }

const withStubbedFetch = async <T>(stub: (url: URL, init: RequestInit) => Response, run: (calls: FetchCall[]) => Promise<T>) => {
	const calls: FetchCall[] = []
	const original = globalThis.fetch
	globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
		const parsed = url instanceof URL ? url : new URL(String(url))
		const headers = (init?.headers ?? {}) as Record<string, string>
		calls.push({ url: parsed.origin, method: init?.method ?? 'GET', authorization: headers['Authorization'] })
		return stub(parsed, init ?? {})
	}) as typeof fetch
	try {
		return await run(calls)
	} finally {
		globalThis.fetch = original
	}
}

describe('getUploadServerOrder', () => {
	test('puts the preferred server first, then the public defaults', () => {
		const order = getUploadServerOrder('https://preferred.example')
		expect(order[0]).toBe('https://preferred.example')
		expect(order[1]).toBe('https://nostrcheck.me')
		expect(order).toHaveLength(6)
	})

	test('deduplicates the preferred server against the defaults', () => {
		const order = getUploadServerOrder('https://nostrcheck.me')
		expect(order).toHaveLength(5)
		expect(order.filter((url) => url === 'https://nostrcheck.me')).toHaveLength(1)
	})

	test('falls back to the public defaults only when no preferred server is given', () => {
		const order = getUploadServerOrder()
		expect(order).toHaveLength(5)
		expect(order[0]).toBe('https://nostrcheck.me')
	})

	test('excludes the paid default from the chain', () => {
		const order = getUploadServerOrder()
		expect(order).not.toContain('https://blossom.band')
	})
})

describe('uploadFileToBlossom', () => {
	test('auth event: kind 24242 with t=upload, x and server tags, signed by the signer function', async () => {
		const drafts: BlossomUploadEventTemplate[] = []
		const signer = makeStubSigner(drafts)
		const file = makeFile()
		const expectedHash = await sha256Hex(file)
		const progress: { loaded: number; total: number }[] = []

		await withStubbedFetch(
			(url, init) => {
				if (init.method === 'HEAD') return new Response(null, { status: 401 })
				return new Response(JSON.stringify(descriptorFor(url)), { status: 200, headers: { 'content-type': 'application/json' } })
			},
			async (calls) => {
				const result = await uploadFileToBlossom(signer, file, {
					preferredServer: 'https://nostrcheck.me',
					onProgress: (p) => progress.push(p),
				})

				// The auth draft handed to the signer function.
				expect(drafts).toHaveLength(1)
				const [draft] = drafts
				expect(draft.kind).toBe(24242)
				expect(draft.tags).toContainEqual(['t', 'upload'])
				expect(draft.tags).toContainEqual(['x', expectedHash])
				expect(draft.tags).toContainEqual(['server', 'nostrcheck.me'])
				expect(draft.tags.find(([name]) => name === 'expiration')).toBeTruthy()

				// The authorized PUT carries the signed event as the Nostr header.
				const put = calls.find((call) => call.method === 'PUT')
				expect(put?.authorization?.startsWith('Nostr ')).toBe(true)

				// The result: descriptor url/hash through the imeta.
				expect(result.url).toBe(descriptorFor(new URL('https://nostrcheck.me/upload')).url)
				expect(result.hash).toBe('ab'.repeat(32))
				expect(result.imeta.x).toBe('ab'.repeat(32))
				expect(result.imeta.url).toBe(result.url)
				expect(result.imeta.m).toBe('image/jpeg')

				// Progress is advisory: exactly one completion tick.
				expect(progress).toEqual([{ loaded: file.size, total: file.size }])
			},
		)
	})

	test('fallback chain: walks to the first public default when the preferred server fails', async () => {
		const drafts: BlossomUploadEventTemplate[] = []
		const signer = makeStubSigner(drafts)
		const file = makeFile()
		const errors: { error: string; serverUrl?: string }[] = []

		await withStubbedFetch(
			(url, init) => {
				if (url.origin === 'https://preferred.example') return new Response(null, { status: 500 })
				if (init.method === 'HEAD') return new Response(null, { status: 401 })
				return new Response(JSON.stringify(descriptorFor(url)), { status: 200, headers: { 'content-type': 'application/json' } })
			},
			async (calls) => {
				const result = await uploadFileToBlossom(signer, file, {
					preferredServer: 'https://preferred.example',
					maxRetries: 3,
					onError: (error, serverUrl) => errors.push({ error, serverUrl }),
				})

				// The preferred server was tried first, once per attempt.
				const preferredHeads = calls.filter((call) => call.url === 'https://preferred.example' && call.method === 'HEAD')
				expect(preferredHeads).toHaveLength(3)

				// The fallback succeeded on the first public default.
				expect(result.url).toBe(descriptorFor(new URL('https://nostrcheck.me/upload')).url)
				expect(calls.find((call) => call.method === 'PUT')?.url).toBe('https://nostrcheck.me')

				// One best-effort error report for the failed preferred server.
				expect(errors).toEqual([{ error: 'Server error', serverUrl: 'https://preferred.example' }])
			},
		)
	})

	test('retry count: every server gets up to maxRetries attempts before the typed failure', async () => {
		const drafts: BlossomUploadEventTemplate[] = []
		const signer = makeStubSigner(drafts)
		const file = makeFile()
		const errors: { error: string; serverUrl?: string }[] = []

		await withStubbedFetch(
			() => new Response(null, { status: 500 }),
			async (calls) => {
				const serverCount = getUploadServerOrder('https://preferred.example').length
				await expect(
					uploadFileToBlossom(signer, file, {
						preferredServer: 'https://preferred.example',
						maxRetries: 3,
						onError: (error, serverUrl) => errors.push({ error, serverUrl }),
					}),
				).rejects.toThrow(new RegExp(`^${BLOSSOM_UPLOAD_FAILED}: `))

				// Every attempt is a HEAD probe (the 500 throws before the PUT).
				expect(calls).toHaveLength(serverCount * 3)
				expect(new Set(calls.map((call) => call.url)).size).toBe(serverCount)
				expect(errors).toHaveLength(serverCount)
				expect(drafts).toHaveLength(0)
			},
		)
	})

	test('default attempts per server is three when maxRetries is omitted', () => {
		expect(DEFAULT_UPLOAD_ATTEMPTS).toBe(3)
		expect(getUploadServerOrder('https://preferred.example')).toHaveLength(6)
		expect(BLOSSOM_UPLOAD_NO_SERVERS).toBe('BLOSSOM_UPLOAD_NO_SERVERS')
	})
})
