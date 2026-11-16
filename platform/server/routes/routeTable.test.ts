import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROUTE_INTENT_VERSION, type RouteIntent } from '@sdk/commerce/storefront/routeIntent'
import { validateRoutesFile } from './routeFile'
import { createRouteTable, loadRouteTable } from './routeTable'

const AUTHOR = 'b'.repeat(64)
const ADMIN = 'c'.repeat(64)
const OTHER_ADMIN = 'd'.repeat(64)

const directories: string[] = []

function scratch(): string {
	const directory = mkdtempSync(join(tmpdir(), 'ar-route-table-'))
	directories.push(directory)
	return directory
}

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tableFile(bindings: unknown[] = []): string {
	const directory = scratch()
	const path = join(directory, 'routes.json')
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				version: 1,
				instance: { pubkey: null },
				seq: 1,
				default: null,
				bindings,
				prefixes: [{ pattern: 'item/:eventId', target: { type: 'render', render: 'item', param: 'eventId' } }],
			},
			null,
			2,
		)}\n`,
	)
	return path
}

const set = (path: string, d = 'storefront-page', author = AUTHOR): RouteIntent => ({
	version: ROUTE_INTENT_VERSION,
	action: 'set',
	path,
	target: { type: 'page', author, d },
})

const remove = (path: string): RouteIntent => ({ version: ROUTE_INTENT_VERSION, action: 'remove', path, target: null })

const at = (createdAt: number, pubkey = ADMIN) => ({ createdAt, pubkey })

describe('the live routing table', () => {
	test('a set intent creates a binding attributed to the signing event', () => {
		const path = tableFile()
		const table = loadRouteTable(path)

		const applied = table.apply(set('shop'), at(1_800_000_000))
		expect(applied).toMatchObject({ ok: true, changed: true, warnings: [] })

		const binding = table.current().bindings[0]
		expect(binding).toMatchObject({
			kind: 'admin',
			path: 'shop',
			target: { type: 'page', author: AUTHOR, d: 'storefront-page' },
			updatedAt: 1_800_000_000,
			updatedBy: ADMIN,
		})
		expect(table.current().seq).toBe(2)
	})

	test('the change is persisted atomically and readable again from disk', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		table.apply(set('shop'), at(1_800_000_000))

		const reloaded = loadRouteTable(path)
		expect(reloaded.current().bindings).toHaveLength(1)
		expect(reloaded.current().bindings[0].path).toBe('shop')
		expect(reloaded.current().seq).toBe(2)
		expect(readFileSync(`${path}.bak`, 'utf8')).toContain('"bindings"')
	})

	test('a second intent for the same path retargets it rather than duplicating it', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		table.apply(set('shop', 'first'), at(1_800_000_000))
		table.apply(set('shop', 'second'), at(1_800_000_100, OTHER_ADMIN))

		expect(table.current().bindings).toHaveLength(1)
		expect(table.current().bindings[0].target).toMatchObject({ d: 'second' })
		expect(table.current().bindings[0].updatedBy).toBe(OTHER_ADMIN)
	})

	test('a remove intent deletes the binding; removing it again is a no-op, not an error', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		table.apply(set('shop'), at(1_800_000_000))

		expect(table.apply(remove('shop'), at(1_800_000_100))).toMatchObject({ ok: true, changed: true })
		expect(table.current().bindings).toHaveLength(0)

		const again = table.apply(remove('shop'), at(1_800_000_200))
		expect(again).toMatchObject({ ok: true, changed: false })
		expect(table.current().seq).toBe(3)
	})

	test('an intent that is already satisfied writes nothing', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		table.apply(set('shop'), at(1_800_000_000))
		const seq = table.current().seq

		expect(table.apply(set('shop'), at(1_800_000_000))).toMatchObject({ ok: true, changed: false })
		expect(table.current().seq).toBe(seq)
	})

	test('an intent older than the binding it would replace is refused, so a delayed event cannot undo a newer one', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		table.apply(set('shop', 'newer'), at(1_800_000_100))

		const stale = table.apply(set('shop', 'older'), at(1_800_000_000))
		expect(stale.ok).toBe(false)
		expect(stale.ok === false && stale.violations[0]).toContain('refusing an intent signed at')
		expect(table.current().bindings[0].target).toMatchObject({ d: 'newer' })
	})

	test('a stale remove does not delete a newer binding', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		table.apply(set('shop'), at(1_800_000_100))
		expect(table.apply(remove('shop'), at(1_800_000_000)).ok).toBe(false)
		expect(table.current().bindings).toHaveLength(1)
	})

	test('a resulting table that fails validation is refused and nothing is written', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		const before = readFileSync(path, 'utf8')

		// The ingest parses the intent first, so this malformed target can only be
		// built by bypassing that layer — which is exactly what "re-validate the
		// whole table" defends against: the table is the last word, not the DTO.
		const malformed = { ...set('shop'), target: { type: 'page', author: 'not-hex', d: 'x' } } as unknown as RouteIntent
		const applied = table.apply(malformed, at(1_800_000_000))

		expect(applied.ok).toBe(false)
		expect(applied.ok === false && applied.violations.join('\n')).toContain('/bindings/0/target/author')
		expect(table.current().bindings).toHaveLength(0)
		expect(readFileSync(path, 'utf8')).toBe(before)
	})

	test('a binding on a compiled-in name is accepted and carries the warning', () => {
		const path = tableFile()
		const table = loadRouteTable(path)
		const applied = table.apply(set('products'), at(1_800_000_000))

		expect(applied).toMatchObject({ ok: true, changed: true })
		expect(applied.ok && applied.warnings.map((warning) => warning.code)).toEqual(['compiled-in-path'])
		expect(table.warnings().map((warning) => warning.path)).toEqual(['products'])
	})

	test('an existing binding is preserved when another path is authored', () => {
		const path = tableFile([
			{ kind: 'admin', path: 'shop', target: { type: 'page', author: AUTHOR, d: 'home' }, updatedAt: 1_700_000_000, updatedBy: 'instance' },
		])
		const table = loadRouteTable(path)
		table.apply(set('our-story'), at(1_800_000_000))
		expect(table.current().bindings.map((binding) => binding.path)).toEqual(['shop', 'our-story'])
	})

	test('the table refuses to be built from an invalid file at boot', () => {
		const directory = scratch()
		mkdirSync(directory, { recursive: true })
		const path = join(directory, 'routes.json')
		writeFileSync(path, '{"version":1,"seq":0,"bindings":[{"kind":"admin"}],"prefixes":[]}')
		expect(() => loadRouteTable(path)).toThrow()
	})

	test('a lease binding is left intact by an unrelated set', () => {
		const path = tableFile([
			{
				kind: 'admin',
				path: 'promo',
				meaning: 'lease',
				expiresAt: 1_900_000_000,
				target: { type: 'page', author: AUTHOR, d: 'promo' },
				updatedAt: 1_700_000_000,
				updatedBy: 'instance',
			},
		])
		const table = loadRouteTable(path)
		table.apply(set('shop'), at(1_800_000_000))
		const lease = table.current().bindings.find((binding) => binding.path === 'promo')
		expect(lease).toMatchObject({ meaning: 'lease', expiresAt: 1_900_000_000 })
	})

	test('validateRoutesFile still accepts what the table writes', () => {
		const path = tableFile()
		const table = createRouteTable({ file: validateRoutesFile(JSON.parse(readFileSync(path, 'utf8'))).file, path })
		table.apply(set('shop'), at(1_800_000_000))
		const written = JSON.parse(readFileSync(path, 'utf8'))
		expect(() => validateRoutesFile(written)).not.toThrow()
	})
})