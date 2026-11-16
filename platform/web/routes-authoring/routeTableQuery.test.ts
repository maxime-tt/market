import { afterEach, describe, expect, test } from 'bun:test'
import { describeIngestFailure, fetchRouteTable } from './routeTableQuery'

const realFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = realFetch
})

const stubFetch = (response: Response | (() => Response)) => {
	globalThis.fetch = (async () => (typeof response === 'function' ? response() : response)) as unknown as typeof fetch
}

describe('reading the routing table', () => {
	test('a table response is parsed into bindings and warnings', async () => {
		stubFetch(
			Response.json({
				version: 1,
				seq: 4,
				default: null,
				bindings: [{ kind: 'admin', path: 'shop', target: { type: 'page', author: 'a'.repeat(64), d: 'home' }, updatedAt: 1, updatedBy: 'instance' }],
				warnings: [{ code: 'compiled-in-path', path: 'shop', message: 'supersedes' }],
			}),
		)

		const table = await fetchRouteTable()
		expect(table.seq).toBe(4)
		expect(table.bindings.map((binding) => binding.path)).toEqual(['shop'])
		expect(table.warnings[0].path).toBe('shop')
	})

	test('a failed read throws with the status rather than reporting an empty table', async () => {
		stubFetch(new Response('nope', { status: 502 }))
		await expect(fetchRouteTable()).rejects.toThrow('HTTP 502')
	})

	test('a body without a bindings list throws instead of becoming an empty list', async () => {
		stubFetch(Response.json({ version: 1 }))
		await expect(fetchRouteTable()).rejects.toThrow('did not contain a bindings list')
	})

	test('a non-JSON body throws', async () => {
		stubFetch(new Response('<html>'))
		await expect(fetchRouteTable()).rejects.toThrow('was not JSON')
	})
})

describe('a refused write explains itself', () => {
	test('the acl, signature, freshness and table refusals each get their own sentence', () => {
		expect(describeIngestFailure(403, { error: 'no-acl' })).toContain('not an admin or editor')
		expect(describeIngestFailure(400, { error: 'bad-signature' })).toContain('signature did not verify')
		expect(describeIngestFailure(400, { error: 'stale-intent' })).toContain('freshness window')
		expect(describeIngestFailure(400, { error: 'invalid-route-intent', detail: '/path: only a top-level name' })).toContain(
			'only a top-level name',
		)
		expect(describeIngestFailure(400, { error: 'invalid-route-table', detail: '/bindings/0: duplicate' })).toContain('duplicate')
	})

	test('an unknown refusal still names the status, and never claims success', () => {
		const message = describeIngestFailure(500, null)
		expect(message).toContain('HTTP 500')
		expect(message).toContain('Nothing was written')
	})
})