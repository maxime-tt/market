import { describe, expect, test } from 'bun:test'
import {
	ROUTE_INTENT_KIND,
	ROUTE_INTENT_VERSION,
	buildRouteIntentEvent,
	parseRouteIntent,
	routeIntentContent,
	validateIntentPath,
	type RouteIntent,
} from './routeIntent'

const AUTHOR = 'a'.repeat(64)

const setIntent = (over: Partial<RouteIntent> = {}): RouteIntent => ({
	version: ROUTE_INTENT_VERSION,
	action: 'set',
	path: 'shop',
	target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
	...over,
})

const parse = (intent: RouteIntent, dTag?: string) => parseRouteIntent(routeIntentContent(intent), dTag)

describe('route intent — the signed record of a binding', () => {
	test('a set intent round-trips with its d tag', () => {
		const result = parse(setIntent(), 'shop')
		expect(result.error).toBeNull()
		expect(result.intent).toEqual({
			version: 1,
			action: 'set',
			path: 'shop',
			target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
		})
	})

	test('a remove intent carries no target', () => {
		const result = parse({ version: 1, action: 'remove', path: 'shop', target: null }, 'shop')
		expect(result.error).toBeNull()
		expect(result.intent?.action).toBe('remove')
		expect(result.intent?.target).toBeNull()
	})

	test('the event is addressable by the path it authors', () => {
		const event = buildRouteIntentEvent(setIntent(), 1_800_000_000)
		expect(event.kind).toBe(ROUTE_INTENT_KIND)
		expect(event.tags).toEqual([['d', 'shop']])
		expect(parseRouteIntent(event.content, event.tags[0][1]).intent?.path).toBe('shop')
	})

	test('the path and the d tag must agree — one address, one meaning', () => {
		const result = parse(setIntent(), 'other')
		expect(result.intent).toBeNull()
		expect(result.error).toContain("does not match the event's d tag")
	})

	test('a remove intent naming a target is refused', () => {
		const content = JSON.stringify({ version: 1, action: 'remove', path: 'shop', target: { type: 'page', author: AUTHOR, d: 'x' } })
		expect(parseRouteIntent(content).error).toContain('must not name a target')
	})

	test('unknown fields and wrong versions are refused', () => {
		expect(parseRouteIntent(JSON.stringify({ version: 1, action: 'set', path: 'shop', extra: true })).error).toContain('unknown field')
		expect(parseRouteIntent(JSON.stringify({ version: 2, action: 'set', path: 'shop' })).error).toContain('/version')
		expect(parseRouteIntent('{').error).toContain('not valid JSON')
		expect(parseRouteIntent('[]').error).toContain('expected a JSON object')
	})

	test('an unknown action is refused', () => {
		expect(parseRouteIntent(JSON.stringify({ version: 1, action: 'rename', path: 'shop' })).error).toContain('/action')
	})

	test('a set intent needs a page target with a hex author and a d tag', () => {
		const content = (target: unknown) => JSON.stringify({ version: 1, action: 'set', path: 'shop', target })
		expect(parseRouteIntent(content(undefined)).error).toContain('/target: expected an object')
		expect(parseRouteIntent(content({ type: 'render', render: 'item', param: 'id' })).error).toContain('only "page"')
		expect(parseRouteIntent(content({ type: 'page', author: 'nope', d: 'x' })).error).toContain('expected 64 lowercase hex')
		expect(parseRouteIntent(content({ type: 'page', author: AUTHOR, d: '' })).error).toContain('/target/d')
	})

	test('the path grammar is the app name grammar, one top-level segment', () => {
		expect(validateIntentPath('shop')).toBeNull()
		expect(validateIntentPath('my-shop_2')).toBeNull()
		expect(validateIntentPath('SHOP')).toContain('name grammar')
		expect(validateIntentPath('ab')).toContain('name grammar')
		expect(validateIntentPath('shop/extra')).toContain('top-level name')
		expect(validateIntentPath('')).toContain('/path')
		expect(validateIntentPath('api')).toContain('app-owned-name')
	})

	test('a compiled-in name is authorable — the table supersedes it and warns', () => {
		expect(validateIntentPath('products')).toBeNull()
		expect(parse(setIntent({ path: 'products' }), 'products').intent?.path).toBe('products')
	})

	test('building an event for an invalid intent throws before anything is signed', () => {
		expect(() => buildRouteIntentEvent(setIntent({ path: 'api' }), 1)).toThrow('Route intent is not valid')
		expect(() => buildRouteIntentEvent(setIntent({ path: 'a/b' }), 1)).toThrow('top-level name')
	})
})