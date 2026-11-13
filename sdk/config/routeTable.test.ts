import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
	PERMANENT_TERM,
	ROUTE_RESERVED_NAMES,
	RouteTableError,
	decodeTarget,
	encodeTarget,
	isReservedRouteName,
	isValidRouteName,
	parseRouteTable,
	resolveDefaultRoute,
	resolveRoute,
	routeIsLapsed,
	serializeRouteTable,
} from '@sdk/config/routeTable'
import type { RouteEntry } from '@sdk/config/routeTable'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CAROL = 'c'.repeat(64)
const TERM = 1900000000

const routeTag = (name: string, type: string, target: string, authority = 'admin', term = '0', holder = '-') => [
	'route',
	name,
	type,
	target,
	authority,
	term,
	holder,
]
const vanityTag = (name: string, pubkey: string, validUntil: string | number) => ['vanity', name, pubkey, String(validUntil)]

describe('route names', () => {
	test('accepts home', () => {
		expect(isValidRouteName('home')).toBe(true)
	})

	test('rejects a one-character name and a 31-character name', () => {
		expect(isValidRouteName('h')).toBe(false)
		expect(isValidRouteName('a'.repeat(31))).toBe(false)
		expect(isValidRouteName('a'.repeat(30))).toBe(true)
	})

	test('rejects a leading hyphen and a trailing underscore', () => {
		expect(isValidRouteName('-home')).toBe(false)
		expect(isValidRouteName('home_')).toBe(false)
	})

	test('home is not reserved', () => {
		expect(isReservedRouteName('home')).toBe(false)
	})

	test('products is reserved', () => {
		expect(isReservedRouteName('products')).toBe(true)
	})

	test('the reserved list matches sdk/config/vanity.ts and platform/server/VanityManager.ts', async () => {
		const readReservedBlock = async (path: string) => {
			const source = await Bun.file(path).text()
			const start = source.indexOf('RESERVED_NAMES = new Set([')
			const end = source.indexOf('])', start)
			expect(start).toBeGreaterThan(-1)
			expect(end).toBeGreaterThan(start)
			const block = source.slice(start, end)
			return new Set(Array.from(block.matchAll(/'([^']+)'/g), (match) => match[1]))
		}

		const configCopy = await readReservedBlock(join(import.meta.dir, 'vanity.ts'))
		const serverCopy = await readReservedBlock(join(import.meta.dir, '..', '..', 'platform', 'server', 'VanityManager.ts'))
		const mine = new Set(ROUTE_RESERVED_NAMES)

		expect(mine.size).toBe(37)
		expect([...mine].sort()).toEqual([...configCopy].sort())
		expect([...mine].sort()).toEqual([...serverCopy].sort())
	})
})

describe('route targets', () => {
	test('encode/decode round-trips all three types', () => {
		const targets = [
			{ type: 'profile' as const, pubkey: ALICE },
			{ type: 'page' as const, author: ALICE, dTag: 'home' },
			{ type: 'listing' as const, pubkey: BOB, dTag: 'chair-01' },
		]
		for (const target of targets) {
			expect(decodeTarget(target.type, encodeTarget(target))).toEqual(target)
		}
	})

	test('decodeTarget rejects a 63-char author', () => {
		expect(decodeTarget('page', `${'a'.repeat(63)}:home`)).toBeNull()
		expect(decodeTarget('profile', 'a'.repeat(63))).toBeNull()
	})

	test('decodeTarget rejects a page target with an empty d-tag', () => {
		expect(decodeTarget('page', `${ALICE}:`)).toBeNull()
		expect(decodeTarget('page', ALICE)).toBeNull()
	})

	test('decodeTarget rejects a listing target whose kind is not 30402', () => {
		expect(decodeTarget('listing', `30403:${BOB}:chair-01`)).toBeNull()
		expect(decodeTarget('listing', `30402:${BOB}:chair-01`)).not.toBeNull()
	})

	test('decodeTarget keeps a d-tag containing colons', () => {
		const decoded = decodeTarget('page', `${ALICE}:a:b`)
		expect(decoded).toEqual({ type: 'page', author: ALICE, dTag: 'a:b' })
	})
})

describe('parsing', () => {
	test('an unknown type drops that tag and keeps the rest', () => {
		const table = parseRouteTable([routeTag('odd', 'store', ALICE), routeTag('home', 'page', `${ALICE}:home`)])
		expect(table.entries).toHaveLength(1)
		expect(table.entries[0].name).toBe('home')
		expect(table.dropped).toHaveLength(1)
		expect(table.dropped[0].reason).toBe('unknown-type')
	})

	test('a short tag is dropped, not thrown', () => {
		const table = parseRouteTable([['route', 'sparse', 'page']])
		expect(table.entries).toEqual([])
		expect(table.dropped[0].reason).toBe('short-tag')
	})

	test('a bad term is dropped', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`, 'admin', 'soon')])
		expect(table.entries).toEqual([])
		expect(table.dropped[0].reason).toBe('bad-term')

		const tooBig = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`, 'admin', String(2 ** 40 + 1))])
		expect(tooBig.dropped[0].reason).toBe('bad-term')
	})

	test('a missing holder is null, not a crash', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`, 'admin', '0', '-')])
		expect(table.dropped).toEqual([])
		expect(table.entries[0].holder).toBeNull()
	})

	test('route wins over a legacy vanity tag of the same name', () => {
		const table = parseRouteTable([
			vanityTag('alice-shop', ALICE, TERM),
			routeTag('alice-shop', 'profile', ALICE, 'reservation', String(TERM), ALICE),
		])
		expect(table.entries).toHaveLength(1)
		expect(table.entries[0].source).toBe('route')
		expect(table.conflicts.filter((conflict) => conflict.kind === 'legacy-shadowed')).toHaveLength(1)
	})

	test('two route tags with one name: first wins, duplicate-name recorded', () => {
		const table = parseRouteTable([
			routeTag('shop', 'profile', ALICE, 'reservation', String(TERM), ALICE),
			routeTag('shop', 'profile', BOB, 'reservation', String(TERM), BOB),
		])
		expect(table.entries).toHaveLength(1)
		expect(table.entries[0].target).toEqual({ type: 'profile', pubkey: ALICE })
		expect(table.conflicts[0].kind).toBe('duplicate-name')
	})

	test('legacy vanity tags parse as profile reservations', () => {
		const table = parseRouteTable([vanityTag('alice-shop', ALICE, TERM)])
		expect(table.entries[0]).toEqual({
			name: 'alice-shop',
			target: { type: 'profile', pubkey: ALICE },
			authority: 'reservation',
			holder: ALICE,
			term: TERM,
			isDefault: false,
			source: 'vanity',
		})
	})

	test('a legacy validUntil of 0 is lapsed, not permanent (the deliberate asymmetry)', () => {
		const table = parseRouteTable([vanityTag('alice-shop', ALICE, PERMANENT_TERM)])
		const entry = table.entries[0]
		expect(entry.term).toBe(PERMANENT_TERM)
		expect(routeIsLapsed(entry, 1)).toBe(true)
		expect(resolveRoute(table, 'alice-shop', 1)).toBeNull()

		const routeVersion = parseRouteTable([routeTag('alice-shop', 'profile', ALICE, 'reservation', '0', ALICE)])
		expect(routeIsLapsed(routeVersion.entries[0], 1)).toBe(false)
	})

	test('parse does not mutate the input array', () => {
		const tags = [routeTag('home', 'page', `${ALICE}:home`), vanityTag('ALICE-SHOP', ALICE, TERM), ['route-default', 'home']]
		const snapshot = structuredClone(tags)
		parseRouteTable(tags)
		expect(tags).toEqual(snapshot)
	})
})

describe('defaults', () => {
	test('one default is read', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`), ['route-default', 'home']])
		expect(table.defaultName).toBe('home')
		expect(table.entries[0].isDefault).toBe(true)
		expect(table.conflicts).toEqual([])
	})

	test('a second default tag is a duplicate-default conflict and the first wins', () => {
		const table = parseRouteTable([
			routeTag('home', 'page', `${ALICE}:home`),
			routeTag('landing', 'page', `${ALICE}:landing`),
			['route-default', 'home'],
			['route-default', 'landing'],
		])
		expect(table.defaultName).toBe('home')
		expect(table.conflicts.map((conflict) => conflict.kind)).toEqual(['duplicate-default'])
	})

	test('a default naming a missing entry is dangling and resolves to null', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`), ['route-default', 'ghost']])
		expect(table.conflicts.map((conflict) => conflict.kind)).toContain('dangling-default')
		expect(resolveDefaultRoute(table)).toBeNull()
	})

	test('a default naming a profile route is non-page-default and resolves to null', () => {
		const table = parseRouteTable([routeTag('home', 'profile', ALICE, 'reservation', String(TERM), ALICE), ['route-default', 'home']])
		expect(table.conflicts.map((conflict) => conflict.kind)).toContain('non-page-default')
		expect(resolveDefaultRoute(table)).toBeNull()
	})

	test('a lapsed default resolves to null', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`, 'admin', String(TERM)), ['route-default', 'home']])
		const entry = table.entries[0]
		expect(resolveDefaultRoute(table, entry.term - 1)).toEqual(entry)
		expect(resolveDefaultRoute(table, entry.term + 1)).toBeNull()
	})
})

describe('resolution', () => {
	test('resolveRoute is exact-match', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`)])
		expect(resolveRoute(table, 'HOME')).not.toBeNull()
		expect(resolveRoute(table, 'hom')).toBeNull()
	})

	test('resolveRoute returns null one second after a term, and the entry one second before', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`, 'admin', String(TERM))])
		expect(resolveRoute(table, 'home', TERM - 1)).not.toBeNull()
		expect(resolveRoute(table, 'home', TERM + 1)).toBeNull()
	})

	test('a permanent (term 0) route never lapses', () => {
		const table = parseRouteTable([routeTag('home', 'page', `${ALICE}:home`)])
		expect(table.entries[0].term).toBe(PERMANENT_TERM)
		expect(routeIsLapsed(table.entries[0], Number.MAX_SAFE_INTEGER)).toBe(false)
		expect(resolveRoute(table, 'home', Number.MAX_SAFE_INTEGER)).not.toBeNull()
	})
})

describe('serialisation', () => {
	const entries = (): RouteEntry[] => [
		{
			name: 'about-us',
			target: { type: 'page', author: ALICE, dTag: 'about' },
			authority: 'admin',
			holder: null,
			term: PERMANENT_TERM,
			isDefault: true,
			source: 'route',
		},
		{
			name: 'bobs-shop',
			target: { type: 'profile', pubkey: BOB },
			authority: 'reservation',
			holder: BOB,
			term: TERM,
			isDefault: false,
			source: 'route',
		},
		{
			name: 'zara',
			target: { type: 'page', author: CAROL, dTag: 'storefront-page' },
			authority: 'editor',
			holder: CAROL,
			term: PERMANENT_TERM,
			isDefault: false,
			source: 'route',
		},
	]

	test('round-trips: parse(serialize(t)) deep-equals the entries', () => {
		const original = entries()
		const table = parseRouteTable(serializeRouteTable(original, 'about-us'))
		expect(table.entries).toEqual(original)
		expect(table.defaultName).toBe('about-us')
	})

	test('output is sorted by name and byte-stable across two calls', () => {
		const shuffled = [entries()[2], entries()[0], entries()[1]]
		const tags = serializeRouteTable(shuffled, 'about-us')
		const routeNames = tags.filter((tag) => tag[0] === 'route').map((tag) => tag[1])
		expect(routeNames).toEqual(['about-us', 'bobs-shop', 'zara'])
		expect(JSON.stringify(tags)).toBe(JSON.stringify(serializeRouteTable(entries(), 'about-us')))
	})

	test('throws on duplicate names', () => {
		expect(() => serializeRouteTable([entries()[1], entries()[1]], null)).toThrow(RouteTableError)
	})

	test('throws when the default is not in the table', () => {
		expect(() => serializeRouteTable(entries(), 'ghost')).toThrow(RouteTableError)
	})

	test('throws when the default target is not a page', () => {
		expect(() => serializeRouteTable(entries(), 'bobs-shop')).toThrow(RouteTableError)
	})

	test('emits a legacy vanity mirror for a paid profile reservation', () => {
		const tags = serializeRouteTable(entries(), 'about-us')
		expect(tags).toContainEqual(['vanity', 'bobs-shop', BOB, String(TERM)])
	})

	test('emits no legacy mirror for an admin route, an editor grant, or a permanent entry', () => {
		const tags = serializeRouteTable(entries(), 'about-us')
		const mirrored = tags.filter((tag) => tag[0] === 'vanity').map((tag) => tag[1])
		expect(mirrored).toEqual(['bobs-shop'])

		const permanentReservation = serializeRouteTable([{ ...entries()[1], term: PERMANENT_TERM }], null)
		expect(permanentReservation.filter((tag) => tag[0] === 'vanity')).toEqual([])
	})
})
