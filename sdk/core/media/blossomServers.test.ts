import { describe, expect, test } from 'bun:test'
import { DEFAULT_BLOSSOM_SERVERS, checkBlossomServerAvailability, getAvailableBlossomServers } from './blossomServers'

/**
 * Pure-function probes for the server-list half of the media capability:
 * the shipped list's shape, and the availability helpers' ok/non-ok/reject
 * paths (the timeout path is a fetch rejection, which the reject stub covers).
 */

describe('DEFAULT_BLOSSOM_SERVERS', () => {
	test('ships six defaults, each with a name, an https url and a plan', () => {
		expect(DEFAULT_BLOSSOM_SERVERS).toHaveLength(6)
		for (const server of DEFAULT_BLOSSOM_SERVERS) {
			expect(server.name).toBeTruthy()
			expect(server.url.startsWith('https://')).toBe(true)
			expect(['free', 'paid', 'public']).toContain(server.plan)
		}
	})

	test('keeps the legacy first default: nostrcheck.me, plan public', () => {
		expect(DEFAULT_BLOSSOM_SERVERS[0]).toEqual({ name: 'nostrcheck.me', url: 'https://nostrcheck.me', plan: 'public' })
	})

	test('holds the first public server the upload chain falls back to', () => {
		const firstPublic = DEFAULT_BLOSSOM_SERVERS.find((server) => server.plan === 'public')
		expect(firstPublic?.url).toBe('https://nostrcheck.me')
	})
})

describe('checkBlossomServerAvailability', () => {
	/** A minimal fetch stand-in: the availability helpers only call `fetch(url, { method, signal })`. */
	type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

	const withStubbedFetch = async <T>(stub: FetchStub, run: () => Promise<T>): Promise<T> => {
		const original = globalThis.fetch
		globalThis.fetch = stub as typeof fetch
		try {
			return await run()
		} finally {
			globalThis.fetch = original
		}
	}

	test('returns true when the HEAD probe answers ok', async () => {
		await withStubbedFetch(
			async () => new Response(null, { status: 200 }),
			async () => {
				expect(await checkBlossomServerAvailability('https://nostrcheck.me/')).toBe(true)
			},
		)
	})

	test('returns false when the HEAD probe answers non-ok', async () => {
		await withStubbedFetch(
			async () => new Response(null, { status: 500 }),
			async () => {
				expect(await checkBlossomServerAvailability('https://nostrcheck.me')).toBe(false)
			},
		)
	})

	test('returns false when the probe is rejected (the timeout path)', async () => {
		await withStubbedFetch(
			async () => {
				throw new Error('aborted')
			},
			async () => {
				expect(await checkBlossomServerAvailability('https://nostrcheck.me')).toBe(false)
			},
		)
	})
})

describe('getAvailableBlossomServers', () => {
	test('filters the list down to the servers whose probe answers ok', async () => {
		const original = globalThis.fetch
		const calls: string[] = []
		globalThis.fetch = (async (url: unknown) => {
			calls.push(String(url))
			return String(url).includes('nostrcheck.me') ? new Response(null, { status: 200 }) : new Response(null, { status: 500 })
		}) as typeof fetch
		try {
			const available = await getAvailableBlossomServers()
			expect(available).toHaveLength(1)
			expect(available[0].name).toBe('nostrcheck.me')
			expect(calls).toHaveLength(DEFAULT_BLOSSOM_SERVERS.length)
		} finally {
			globalThis.fetch = original
		}
	})
})
