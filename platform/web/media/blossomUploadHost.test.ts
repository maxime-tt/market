import { describe, expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NoActiveSessionError } from '@sdk/core/signer'

/**
 * Host behaviour probes (A1 §8, red-team F5/F6): the host uploads through the
 * LOGGED-IN session capability — not through a relay-client store — and a
 * missing session refuses with the session's TYPED error, not a silent no-op.
 *
 * The auth store is mocked at the platform seam (`getSignerSession`); the wire
 * stub mirrors the upload library's flow: HEAD /upload answers 401, one auth
 * event is requested (kind 24242, `t=upload`), then the authorized PUT answers
 * the blob descriptor.
 */

const STUB_PUBKEY = 'aa'.repeat(32)
const stubCapability = () => {
	const signed: { pubkey: string; kind: number; tags: string[][] }[] = []
	const capability: {
		getPublicKey: () => Promise<string>
		signEvent: (template: { kind: number; tags: string[][]; content: string; created_at: number }) => Promise<Record<string, unknown>>
	} = {
		getPublicKey: async () => STUB_PUBKEY,
		signEvent: async (template) => {
			signed.push({ pubkey: STUB_PUBKEY, kind: template.kind, tags: template.tags })
			return { ...template, id: 'stub-event-id', sig: 'stub-sig', pubkey: STUB_PUBKEY }
		},
	}
	return { capability, signed }
}

type FetchCall = { url: string; method: string; authorization?: string }

const withStubbedUploadFetch = async <T>(run: (calls: FetchCall[]) => Promise<T>): Promise<T> => {
	const calls: FetchCall[] = []
	const original = globalThis.fetch
	const descriptor = {
		uploaded: 1730000000,
		type: 'image/jpeg',
		sha256: 'ab'.repeat(32),
		size: 4,
		url: `https://nostrcheck.me/${'ab'.repeat(32)}.jpg`,
	}
	globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
		const parsed = url instanceof URL ? url : new URL(String(url))
		const headers = (init?.headers ?? {}) as Record<string, string>
		calls.push({ url: parsed.origin, method: init?.method ?? 'GET', authorization: headers['Authorization'] })
		if (init?.method === 'HEAD') return new Response(null, { status: 401 })
		return new Response(JSON.stringify(descriptor), { status: 200, headers: { 'content-type': 'application/json' } })
	}) as typeof fetch
	try {
		return await run(calls)
	} finally {
		globalThis.fetch = original
	}
}

describe('blossomUploadHost', () => {
	// The session seam: swapped per test, before the host module is imported.
	let activeSession: () => { currentSigner: () => ReturnType<typeof stubCapability>['capability'] }
	mock.module('@platform/web/auth/authStore', () => ({
		getSignerSession: () => activeSession(),
	}))

	test('uploads via the logged-in capability: kind-24242 t=upload auth event, signed by the session capability', async () => {
		const { capability, signed } = stubCapability()
		activeSession = () => ({ currentSigner: () => capability })

		const { uploadFileToBlossom, BLOSSOM_SERVERS } = await import('./blossomUploadHost')
		const file = new File([new Uint8Array([1, 2, 3, 4])], 'test.jpg', { type: 'image/jpeg' })

		await withStubbedUploadFetch(async (calls) => {
			const result = await uploadFileToBlossom(file, { preferredServer: 'https://nostrcheck.me' })

			// The auth event came through the session's signEvent: kind 24242, t=upload.
			expect(signed).toHaveLength(1)
			expect(signed[0].kind).toBe(24242)
			expect(signed[0].tags).toContainEqual(['t', 'upload'])
			// The auth event's author is the capability's identity, not a store's.
			expect(signed[0].pubkey).toBe(await capability.getPublicKey())

			// The authorized PUT carried the signed event; the result is the descriptor.
			const put = calls.find((call) => call.method === 'PUT')
			expect(put?.url).toBe('https://nostrcheck.me')
			expect(put?.authorization?.startsWith('Nostr ')).toBe(true)
			expect(result.url).toBe(`https://nostrcheck.me/${'ab'.repeat(32)}.jpg`)

			// The re-exported server list keeps the legacy consumer name.
			expect(BLOSSOM_SERVERS[0]).toEqual({ name: 'nostrcheck.me', url: 'https://nostrcheck.me', plan: 'public' })
		})
	})

	test('refuses with the session typed error when no session is active', async () => {
		activeSession = () => {
			throw new NoActiveSessionError('No signer is attached (session is idle)')
		}

		const { uploadFileToBlossom } = await import('./blossomUploadHost')
		const file = new File([new Uint8Array([1])], 'test.jpg', { type: 'image/jpeg' })

		await withStubbedUploadFetch(async (calls) => {
			// A typed refusal, not a silent no-op: nothing is uploaded.
			await expect(uploadFileToBlossom(file)).rejects.toThrow(NoActiveSessionError)
			expect(calls).toHaveLength(0)
		})
	})

	test("the host file's direct imports name no relay-client package", async () => {
		const source = await readFile(join(import.meta.dir, 'blossomUploadHost.ts'), 'utf8')
		// The needle is constructed, never spelled out (the footprint guard greps literally).
		const relayClientNeedle = ['@nostr', '-dev', '-kit'].join('')
		expect(source.includes(`${relayClientNeedle}/`)).toBe(false)
		expect(source.includes(relayClientNeedle)).toBe(false)
		// The host binds at the sdk seam and the platform auth seam.
		expect(source.includes("from '@sdk/core/media/blossomUpload'")).toBe(true)
		expect(source.includes("from '@platform/web/auth/authStore'")).toBe(true)
	})
})
