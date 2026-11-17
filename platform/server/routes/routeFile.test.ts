import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	DECLARED_PREFIX_PATTERNS,
	ROUTES_FILE_BUDGET_BYTES,
	RoutesFileError,
	defaultPath,
	loadRoutesFile,
	lookup,
	prefixMatch,
	serializeRoutesFile,
	validateRoutesFile,
	writeAtomic,
	type RoutesFile,
} from './routeFile'

const AUTHOR = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

const temporaryDirectories: string[] = []
function scratch(): string {
	const directory = mkdtempSync(join(tmpdir(), 'ar-routes-file-'))
	temporaryDirectories.push(directory)
	return directory
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const binding = (path: string, extra: Record<string, unknown> = {}) => ({
	kind: 'admin',
	path,
	target: { type: 'page', author: AUTHOR, d: 'home' },
	updatedAt: 1763000000,
	updatedBy: 'instance',
	...extra,
})

const seriesBinding = (path: string, series = 'featured', extra: Record<string, unknown> = {}) => ({
	kind: 'admin',
	path,
	target: { type: 'series', series, author: AUTHOR },
	updatedAt: 1763000000,
	updatedBy: 'instance',
	...extra,
})

const base = (overrides: Record<string, unknown> = {}) => ({
	version: 1,
	instance: { pubkey: null },
	seq: 1,
	default: null,
	bindings: [binding('shop')],
	prefixes: [],
	...overrides,
})

function load(raw: unknown): RoutesFile {
	return validateRoutesFile(raw).file
}

describe('routeFile — load and validate', () => {
	test('loads a valid file from disk', () => {
		const directory = scratch()
		const path = join(directory, 'routes.json')
		writeFileSync(
			path,
			JSON.stringify(
				base({ prefixes: [{ pattern: DECLARED_PREFIX_PATTERNS[0], target: { type: 'render', render: 'item', param: 'eventId' } }] }),
			),
		)
		const loaded = loadRoutesFile(path)
		expect(loaded.file.bindings).toHaveLength(1)
		expect(loaded.file.bindings[0].target).toEqual({ type: 'page', author: AUTHOR, d: 'home' })
		expect(loaded.file.prefixes[0].pattern).toBe('item/:eventId')
		expect(loaded.warnings).toEqual([])
	})

	test('a missing file is an empty table, not a malformed one', () => {
		const path = join(scratch(), 'absent.json')
		const loaded = loadRoutesFile(path)

		expect(loaded.path).toBe(path)
		expect(loaded.file).toEqual({
			version: 1,
			instance: { pubkey: null },
			seq: 0,
			default: null,
			bindings: [],
			prefixes: [],
		})
		expect(loaded.warnings).toEqual([])
		// Loading is a read: the file stays absent until something writes it.
		expect(existsSync(path)).toBe(false)
	})

	test('the empty table a missing file stands for resolves nothing and round-trips through the validator', () => {
		const file = loadRoutesFile(join(scratch(), 'absent.json')).file

		expect(lookup(file, 'shop', 1_800_000_000)).toBeNull()
		expect(prefixMatch(file, ['item', 'abc'])).toBeNull()
		expect(defaultPath(file)).toBeNull()
		expect(validateRoutesFile(JSON.parse(serializeRoutesFile(file))).file).toEqual(file)
	})

	test('an existing malformed file still refuses, byte for byte', () => {
		const directory = scratch()
		const path = join(directory, 'routes.json')
		writeFileSync(path, '{"version":2,"seq":0,"bindings":[],"prefixes":[]}')

		let message = ''
		try {
			loadRoutesFile(path)
		} catch (error) {
			message = (error as RoutesFileError).message
		}

		expect(message).toBe(
			`Routing file refused: ${path}\n` +
				'  • /version: expected 1, got 2\n' +
				`Restore it from ${path}.bak (written by the last successful write) or from version control.`,
		)
		expect(existsSync(path)).toBe(true)
	})

	test('corrupt JSON refuses with the file path and the parse detail', () => {
		const directory = scratch()
		const path = join(directory, 'routes.json')
		writeFileSync(path, '{"version":1,')
		try {
			loadRoutesFile(path)
			throw new Error('expected a refusal')
		} catch (error) {
			expect(error).toBeInstanceOf(RoutesFileError)
			expect((error as RoutesFileError).message).toContain(path)
			expect((error as RoutesFileError).message).toContain('not valid JSON')
		}
	})

	test('a name in the URL space is refused, and the message names it', () => {
		try {
			load(base({ bindings: [binding('api')] }))
			throw new Error('expected a refusal')
		} catch (error) {
			const violations = (error as RoutesFileError).violations.join('\n')
			expect(violations).toContain('app-owned-name')
			expect(violations).toContain('api')
		}
	})

	test('a compiled-in name loads with a compiled-in-path warning', () => {
		const { file, warnings } = validateRoutesFile(base({ bindings: [binding('dashboard')] }))
		expect(file.bindings[0].path).toBe('dashboard')
		expect(warnings.map((warning) => warning.code)).toEqual(['compiled-in-path'])
	})

	test('a lease on a subpath is refused', () => {
		const candidate = base({ bindings: [binding('shop/featured', { meaning: 'lease', expiresAt: 1900000000 })] })
		try {
			load(candidate)
			throw new Error('expected a refusal')
		} catch (error) {
			expect((error as RoutesFileError).violations.join('\n')).toContain('lease-must-be-top-level')
		}
	})

	test('a lease without a positive expiry is refused', () => {
		try {
			load(base({ bindings: [binding('shop', { meaning: 'lease' })] }))
			throw new Error('expected a refusal')
		} catch (error) {
			expect((error as RoutesFileError).violations.join('\n')).toContain('positive integer expiry')
		}
	})

	test('an admin binding carrying expiresAt is refused — the forbidden shape', () => {
		try {
			load(base({ bindings: [binding('shop', { expiresAt: 1900000000 })] }))
			throw new Error('expected a refusal')
		} catch (error) {
			expect((error as RoutesFileError).violations.join('\n')).toContain('only valid with meaning "lease"')
		}
	})

	test('two bindings on one path are refused', () => {
		try {
			load(base({ bindings: [binding('shop'), binding('shop')] }))
			throw new Error('expected a refusal')
		} catch (error) {
			expect((error as RoutesFileError).violations.join('\n')).toContain('one binding per path')
		}
	})

	test('a well-formed series binding loads with its series key and author', () => {
		const file = load(base({ bindings: [seriesBinding('featured')] }))
		expect(file.bindings).toHaveLength(1)
		expect(file.bindings[0].target).toEqual({ type: 'series', series: 'featured', author: AUTHOR })
	})

	test('grants are still refused; a MALFORMED series target is refused by field pointer', () => {
		const grants = captureViolations({ ...base(), grants: { [OTHER]: ['featured-*'] } })
		expect(grants).toContain('increment 4')

		// The refusal narrowed, it did not vanish: a bad series key and a bad
		// author each name the field that failed.
		const badSeries = captureViolations(
			base({ bindings: [binding('featured', { target: { type: 'series', series: 'NO', author: AUTHOR } })] }),
		)
		expect(badSeries).toContain('/target/series')

		const badAuthor = captureViolations(
			base({ bindings: [binding('featured', { target: { type: 'series', series: 'featured', author: 'nope' } })] }),
		)
		expect(badAuthor).toContain('/target/author')
	})

	test('an unprogrammed prefix is refused', () => {
		const violations = captureViolations(
			base({ prefixes: [{ pattern: 'p/:npub', target: { type: 'render', render: 'profile', param: 'npub' } }] }),
		)
		expect(violations).toContain('not a programmed prefix')
	})

	test('a prefix param that is not in its pattern is refused', () => {
		const violations = captureViolations(
			base({ prefixes: [{ pattern: 'item/:eventId', target: { type: 'render', render: 'item', param: 'productId' } }] }),
		)
		expect(violations).toContain('does not appear in the pattern')
	})
})

function captureViolations(candidate: unknown): string {
	try {
		validateRoutesFile(candidate)
		return ''
	} catch (error) {
		return (error as RoutesFileError).violations.join('\n')
	}
}

describe('routeFile — serialization and atomic writes', () => {
	test('serialization is stable regardless of key order, and round-trips', () => {
		const a = load(base())
		const shuffled = JSON.parse(
			'{"prefixes":[],"bindings":[{"updatedBy":"instance","updatedAt":1763000000,"target":{"d":"home","author":"' +
				AUTHOR +
				'","type":"page"},"path":"shop","kind":"admin"}],"seq":1,"default":null,"instance":{"pubkey":null},"version":1}',
		)
		const b = load(shuffled)
		const text = serializeRoutesFile(a)
		expect(text).toBe(serializeRoutesFile(b))
		expect(text.endsWith('\n')).toBe(true)
		expect(text.indexOf('"bindings"')).toBeLessThan(text.indexOf('"default"'))
		expect(validateRoutesFile(JSON.parse(text)).file).toEqual(a)
	})

	test('writeAtomic leaves the previous bytes in .bak', () => {
		const directory = scratch()
		const path = join(directory, 'routes.json')
		writeAtomic(path, 'first')
		writeAtomic(path, 'second')
		expect(readFileSync(path, 'utf8')).toBe('second')
		expect(readFileSync(`${path}.bak`, 'utf8')).toBe('first')
	})

	test('a failed write leaves the original file intact and keeps no .tmp', () => {
		const directory = scratch()
		const path = join(directory, 'routes.json')
		writeAtomic(path, 'original')
		// Make the tmp path unusable so openSync fails before the rename.
		mkdirSync(`${path}.tmp`)
		expect(() => writeAtomic(path, 'replacement')).toThrow()
		expect(readFileSync(path, 'utf8')).toBe('original')
	})

	test('the file budget refuses a table over the cap, naming bytes, bindings and the cap, and writes nothing', () => {
		// The cap is 4 MiB and a binding serialises to roughly 285 bytes here, so
		// a table of 15 000 bindings is comfortably over it without a pathological
		// allocation.
		const many = Array.from({ length: 15_000 }, (_value, index) =>
			binding(`page${index}`, { target: { type: 'page', author: AUTHOR, d: `page-${index}` } }),
		)
		const oversized: RoutesFile = {
			version: 1,
			instance: { pubkey: null },
			seq: 1,
			default: null,
			bindings: many as unknown as RoutesFile['bindings'],
			prefixes: [],
		}

		const directory = scratch()
		const path = join(directory, 'routes.json')
		let message = ''
		try {
			// The argument is evaluated first: the serializer refuses before
			// `writeAtomic` is ever reached, so nothing is written.
			writeAtomic(path, serializeRoutesFile(oversized))
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}

		expect(message).toContain('budget exceeded')
		expect(message).toContain(`${many.length} bindings`)
		expect(message).toContain(`${ROUTES_FILE_BUDGET_BYTES}`)
		// The observed byte count is quoted, not estimated.
		expect(message).toMatch(/\d{7,} bytes/)
		expect(existsSync(path)).toBe(false)
	})

	test('serializeRoutesFile round-trips a series binding byte-identically twice', () => {
		const file = load(base({ bindings: [seriesBinding('featured')] }))
		const first = serializeRoutesFile(file)
		const second = serializeRoutesFile(load(JSON.parse(first)))
		expect(second).toBe(first)
		expect(validateRoutesFile(JSON.parse(first)).file).toEqual(file)
	})
})

describe('routeFile — lookup and prefix match', () => {
	const now = 1_800_000_000

	test('lookup finds an exact binding and returns null for an unknown path', () => {
		const file = load(base())
		const found = lookup(file, 'shop', now)
		expect(found?.kind).toBe('binding')
		expect(lookup(file, 'nothing', now)).toBeNull()
	})

	test('a lapsed lease is lease-expired, and a live lease is a binding', () => {
		const file = load(base({ bindings: [binding('shop', { meaning: 'lease', expiresAt: now - 1 })] }))
		expect(lookup(file, 'shop', now)?.kind).toBe('lease-expired')

		const live = load(base({ bindings: [binding('shop', { meaning: 'lease', expiresAt: now + 1 })] }))
		expect(lookup(live, 'shop', now)?.kind).toBe('binding')
	})

	test('prefixMatch returns the longest declared pattern', () => {
		const file = load(
			base({
				prefixes: [{ pattern: 'item/:eventId', target: { type: 'render', render: 'item', param: 'eventId' } }],
			}),
		)
		const match = prefixMatch(file, ['item', 'abc'])
		expect(match?.params).toEqual({ eventId: 'abc' })
		expect(prefixMatch(file, ['item', 'abc', 'extra'])).toBeNull()
		expect(prefixMatch(file, ['other', 'abc'])).toBeNull()
	})

	test('defaultPath reads the default field', () => {
		expect(defaultPath(load(base({ default: 'shop' })))).toBe('shop')
		expect(defaultPath(load(base()))).toBeNull()
	})
})
