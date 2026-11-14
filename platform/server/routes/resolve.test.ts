import { afterEach, describe, expect, test } from 'bun:test'
import { resolve } from './resolve'
import { validateRoutesFile, type RoutesFile } from './routeFile'

const AUTHOR = 'a'.repeat(64)
const NOW = 1_800_000_000

const binding = (path: string, extra: Record<string, unknown> = {}) => ({
	kind: 'admin',
	path,
	target: { type: 'page', author: AUTHOR, d: path },
	updatedAt: 1763000000,
	updatedBy: 'instance',
	...extra,
})

const file = (overrides: Record<string, unknown> = {}): RoutesFile =>
	validateRoutesFile({
		version: 1,
		instance: { pubkey: null },
		seq: 1,
		default: null,
		bindings: [binding('shop')],
		prefixes: [{ pattern: 'item/:eventId', target: { type: 'render', render: 'item', param: 'eventId' } }],
		...overrides,
	}).file

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe('resolve — the three rungs', () => {
	test('rung 1: an exact admin binding resolves to its page target', () => {
		const resolution = resolve(file(), '/shop', NOW)
		expect(resolution).toEqual({ status: 200, outcome: 'page', target: { type: 'page', author: AUTHOR, d: 'shop' }, path: 'shop' })
	})

	test('rung 1 normalises case and trailing slash', () => {
		expect(resolve(file(), '/SHOP/', NOW).status).toBe(200)
	})

	test('rung 1: a live lease resolves', () => {
		const leased = file({ bindings: [binding('shop', { meaning: 'lease', expiresAt: NOW + 10 })] })
		expect(resolve(leased, '/shop', NOW).outcome).toBe('page')
	})

	test('rung 1: a lapsed lease is 404 and does NOT fall through to a compiled-in page', () => {
		// `dashboard` is compiled in; a lease on it that has lapsed must be 404,
		// not the app's own dashboard and not a prefix match.
		const leased = file({ bindings: [binding('dashboard', { meaning: 'lease', expiresAt: NOW })] })
		expect(resolve(leased, '/dashboard', NOW)).toEqual({ status: 404, outcome: 'not-found', path: 'dashboard', reason: 'lease-expired' })
		// At expiresAt + 1 it is still the lease's 404.
		expect(resolve(leased, '/dashboard', NOW + 1).status).toBe(404)
	})

	test('rung 1b: an unbound compiled-in page answers with a warning', () => {
		expect(resolve(file(), '/dashboard', NOW)).toEqual({
			status: 200,
			outcome: 'compiled-in',
			path: 'dashboard',
			warning: 'compiled-in-path',
		})
	})

	test('a binding on a compiled-in name wins over the compiled-in page', () => {
		const bound = file({ bindings: [binding('dashboard')] })
		expect(resolve(bound, '/dashboard', NOW).outcome).toBe('page')
	})

	test('rung 2: a programmed prefix resolves to a render target with its params', () => {
		const resolution = resolve(file(), '/item/abc123', NOW)
		expect(resolution.status).toBe(200)
		expect(resolution.outcome).toBe('render')
		if (resolution.outcome !== 'render') throw new Error('unreachable')
		expect(resolution.target).toEqual({ type: 'render', render: 'item', param: 'eventId' })
		expect(resolution.params).toEqual({ eventId: 'abc123' })
	})

	test('rung 3: anything unmatched is a real 404 with no-match', () => {
		expect(resolve(file(), '/nothing', NOW)).toEqual({ status: 404, outcome: 'not-found', path: 'nothing', reason: 'no-match' })
		expect(resolve(file(), '/not/a/programmed/path', NOW).status).toBe(404)
	})

	test('URL-space names are not compiled in and 404', () => {
		expect(resolve(file(), '/api', NOW).status).toBe(404)
	})

	test('traversal and encoded separators are 404 invalid-path', () => {
		expect(resolve(file(), '/a/../b', NOW)).toEqual({ status: 404, outcome: 'not-found', path: '/a/../b', reason: 'invalid-path' })
		expect(resolve(file(), '/item%2Fabc', NOW).status).toBe(404)
		expect(resolve(file(), '/item%5Cabc', NOW).status).toBe(404)
	})
})

describe('resolve — no network on the route path (sentence 1)', () => {
	test('resolution succeeds while any fetch call throws', () => {
		globalThis.fetch = (() => {
			throw new Error('the route path attempted a network call')
		}) as unknown as typeof fetch

		expect(resolve(file(), '/shop', NOW).status).toBe(200)
		expect(resolve(file(), '/item/abc', NOW).status).toBe(200)
		expect(resolve(file(), '/dashboard', NOW).status).toBe(200)
		expect(resolve(file(), '/nothing', NOW).status).toBe(404)
	})
})
