import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { isValidRouteName, URL_SPACE_NAMES, isCompiledInName } from '@sdk/config/routeNames'

/**
 * The routing file: one JSON file, loaded once, never partially loaded.
 *
 * `ARCHITECTURE.md` §4. A file that is missing, unparseable or invalid is a
 * broken site — the process refuses to boot rather than degrading to an empty
 * table (§4.4). The in-memory object returned by `loadRoutesFile` is the whole
 * state; there are no timers, no watchers, and no re-read per request.
 *
 * Increment-1 subset, and the refusals that name their successor increment:
 *
 *   - accepted: admin bindings to `page` targets, top-level lease bindings
 *     (`meaning: "lease"` with a positive `expiresAt`, no `/` in the path),
 *     and the declared prefix patterns;
 *   - refused: `grants` (§4/ACL, increment 4), `series` targets (increment 5),
 *     `pageByParam`/`profile` prefix targets, and any prefix pattern the build
 *     does not program.
 *
 * A binding on a compiled-in name loads with a `compiled-in-path` warning:
 * under ruling 3 the binding supersedes the compiled page, it does not lose
 * to it.
 */

export const ROUTES_FILE_VERSION = 1

/** Prefix patterns this build programs. Increment 1 serves them as render targets. */
export const DECLARED_PREFIX_PATTERNS: readonly string[] = ['item/:eventId']

/** The binding's page address: the coordinate the page store is keyed by. */
export interface PageTarget {
	type: 'page'
	author: string
	d: string
}

/** A released surface whose own data lookup is the surface's concern (§3.3 rung 2). */
export interface RenderTarget {
	type: 'render'
	render: string
	param: string
}

export type RouteTarget = PageTarget | RenderTarget

export interface Binding {
	kind: 'admin'
	path: string
	meaning?: 'lease'
	holder?: string
	leaseId?: string
	expiresAt?: number
	target: RouteTarget
	updatedAt: number
	updatedBy: string
}

export interface PrefixRoute {
	pattern: string
	target: RenderTarget
}

export interface RoutesFile {
	version: typeof ROUTES_FILE_VERSION
	instance: { pubkey: string | null }
	seq: number
	default: string | null
	bindings: Binding[]
	prefixes: PrefixRoute[]
}

export interface RouteWarning {
	code: 'compiled-in-path'
	path: string
	message: string
}

export interface LoadedRoutesFile {
	file: RoutesFile
	warnings: RouteWarning[]
	path: string
}

/** Every violation, each with the JSON pointer that produced it. */
export class RoutesFileError extends Error {
	readonly violations: string[]
	readonly filePath: string

	constructor(filePath: string, violations: string[]) {
		super(
			`Routing file refused: ${filePath}\n` +
				violations.map((violation) => `  • ${violation}`).join('\n') +
				`\nRestore it from ${filePath}.bak (written by the last successful write) or from version control.`,
		)
		this.name = 'RoutesFileError'
		this.violations = violations
		this.filePath = filePath
	}
}

const HEX64 = /^[0-9a-f]{64}$/
const POINTER = (base: string, key: string | number) => `${base}/${key}`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

/** A page `d` is an opaque tag value; it may not be empty and may not be a path. */
const isPageDTag = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\u0000')

function isSubpath(value: string): boolean {
	return value.split('/').some((segment) => !isValidRouteName(segment))
}

/**
 * Validates a parsed routing file. Throws `RoutesFileError` carrying every
 * violation; returns the typed file plus the warnings that are allowed.
 */
export function validateRoutesFile(candidate: unknown, source = '<memory>'): { file: RoutesFile; warnings: RouteWarning[] } {
	const violations: string[] = []
	const warnings: RouteWarning[] = []

	if (!isRecord(candidate)) {
		throw new RoutesFileError(source, ['/ : the routing file must be a JSON object'])
	}

	for (const key of Object.keys(candidate)) {
		if (!['version', 'instance', 'seq', 'default', 'bindings', 'prefixes', 'grants'].includes(key)) {
			violations.push(`${POINTER('', key)}: unknown field`)
		}
	}

	if (candidate.version !== ROUTES_FILE_VERSION) {
		violations.push(`/version: expected ${ROUTES_FILE_VERSION}, got ${JSON.stringify(candidate.version)}`)
	}

	if (candidate.grants !== undefined) {
		violations.push('/grants: editor grants are not supported until increment 4 (the ACL)')
	}

	if (candidate.instance !== undefined) {
		if (!isRecord(candidate.instance)) {
			violations.push('/instance: expected an object')
		} else if (candidate.instance.pubkey !== null && candidate.instance.pubkey !== undefined) {
			violations.push('/instance/pubkey: only null is supported until the signed ledger lands')
		}
	}

	if (!isPositiveInteger(candidate.seq) && candidate.seq !== 0) {
		violations.push('/seq: expected a non-negative integer')
	}

	if (candidate.default !== undefined && candidate.default !== null) {
		if (typeof candidate.default !== 'string' || candidate.default.length === 0) {
			violations.push('/default: expected a path string or null')
		} else if (isCompiledInName(candidate.default)) {
			warnings.push({
				code: 'compiled-in-path',
				path: candidate.default,
				message: `compiled-in-path: the default names ${candidate.default}, a compiled-in route`,
			})
		}
	}

	const bindings: Binding[] = []
	const seenPaths = new Set<string>()

	if (!Array.isArray(candidate.bindings)) {
		violations.push('/bindings: expected an array')
	} else {
		candidate.bindings.forEach((raw, index) => {
			const base = `/bindings/${index}`
			if (!isRecord(raw)) {
				violations.push(`${base}: expected an object`)
				return
			}

			if (raw.kind !== 'admin') {
				violations.push(`${base}/kind: expected "admin", got ${JSON.stringify(raw.kind)}`)
			}

			const path = raw.path
			if (typeof path !== 'string' || path.length === 0) {
				violations.push(`${base}/path: expected a non-empty string`)
				return
			}
			const topLevel = !path.includes('/')
			if (topLevel ? !isValidRouteName(path) : isSubpath(path)) {
				violations.push(`${base}/path: ${JSON.stringify(path)} does not match the name grammar`)
			}
			if (URL_SPACE_NAMES.includes(path)) {
				violations.push(`${base}/path: app-owned-name: ${path} is part of the URL space and cannot be re-pointed`)
			}
			if (isCompiledInName(path)) {
				warnings.push({
					code: 'compiled-in-path',
					path,
					message: `compiled-in-path: the binding on ${path} supersedes a compiled-in route`,
				})
			}
			if (seenPaths.has(path)) {
				violations.push(`${base}/path: duplicate binding for ${path} — one binding per path`)
			}
			seenPaths.add(path)

			const meaning = raw.meaning
			const expiresAt = raw.expiresAt
			if (meaning !== undefined && meaning !== 'lease') {
				violations.push(`${base}/meaning: expected "lease" when present, got ${JSON.stringify(meaning)}`)
			}
			if (meaning === 'lease') {
				if (!isPositiveInteger(expiresAt)) {
					violations.push(`${base}/expiresAt: a lease requires a positive integer expiry`)
				}
				if (!topLevel) {
					violations.push(`${base}/path: lease-must-be-top-level — a lease may only hold a top-level path`)
				}
				if (raw.holder !== undefined && (typeof raw.holder !== 'string' || !HEX64.test(raw.holder))) {
					violations.push(`${base}/holder: expected 64 lowercase hex`)
				}
			} else {
				// The forbidden shape from §4.2: an admin binding with an expiry,
				// or one with `expiresAt: null` presented as a permanent lease.
				if (expiresAt !== undefined) {
					violations.push(`${base}/expiresAt: expiresAt is only valid with meaning "lease"`)
				}
				if (raw.holder !== undefined || raw.leaseId !== undefined) {
					violations.push(`${base}: holder/leaseId are only valid on a lease binding`)
				}
			}

			if (!isPositiveInteger(raw.updatedAt)) {
				violations.push(`${base}/updatedAt: expected a positive integer`)
			}
			if (typeof raw.updatedBy !== 'string' || (raw.updatedBy !== 'instance' && !HEX64.test(raw.updatedBy))) {
				violations.push(`${base}/updatedBy: expected 64 lowercase hex or "instance"`)
			}

			const target = raw.target
			if (!isRecord(target)) {
				violations.push(`${base}/target: expected an object`)
			} else if (target.type === 'page') {
				if (typeof target.author !== 'string' || !HEX64.test(target.author)) {
					violations.push(`${base}/target/author: expected 64 lowercase hex`)
				}
				if (!isPageDTag(target.d)) {
					violations.push(`${base}/target/d: expected a non-empty page d tag`)
				}
			} else if (target.type === 'series') {
				violations.push(`${base}/target/type: series targets are not supported until increment 5`)
			} else {
				violations.push(`${base}/target/type: ${JSON.stringify(target.type)} is not supported in increment 1 (only "page")`)
			}

			const targetObject = isRecord(target) ? (target as unknown as RouteTarget) : ({ type: 'page', author: '', d: '' } as PageTarget)
			bindings.push({
				kind: 'admin',
				path,
				...(meaning === 'lease'
					? {
							meaning: 'lease' as const,
							...(typeof raw.holder === 'string' ? { holder: raw.holder } : {}),
							...(typeof raw.leaseId === 'string' ? { leaseId: raw.leaseId } : {}),
							...(isPositiveInteger(expiresAt) ? { expiresAt } : {}),
						}
					: {}),
				target: targetObject,
				updatedAt: isPositiveInteger(raw.updatedAt) ? (raw.updatedAt as number) : 0,
				updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : 'instance',
			})
		})
	}

	const prefixes: PrefixRoute[] = []
	const seenPatterns = new Set<string>()
	if (!Array.isArray(candidate.prefixes)) {
		violations.push('/prefixes: expected an array')
	} else {
		candidate.prefixes.forEach((raw, index) => {
			const base = `/prefixes/${index}`
			if (!isRecord(raw)) {
				violations.push(`${base}: expected an object`)
				return
			}
			if (typeof raw.pattern !== 'string' || !DECLARED_PREFIX_PATTERNS.includes(raw.pattern)) {
				violations.push(
					`${base}/pattern: ${JSON.stringify(raw.pattern)} is not a programmed prefix (${DECLARED_PREFIX_PATTERNS.join(', ')})`,
				)
				return
			}
			if (seenPatterns.has(raw.pattern)) {
				violations.push(`${base}/pattern: duplicate prefix ${raw.pattern}`)
			}
			seenPatterns.add(raw.pattern)

			const target = raw.target
			if (!isRecord(target)) {
				violations.push(`${base}/target: expected an object`)
				return
			}
			if (target.type !== 'render') {
				violations.push(`${base}/target/type: prefix targets must be "render" in increment 1, got ${JSON.stringify(target.type)}`)
				return
			}
			if (typeof target.render !== 'string' || target.render.length === 0) {
				violations.push(`${base}/target/render: expected a non-empty render name`)
			}
			if (typeof target.param !== 'string' || target.param.length === 0) {
				violations.push(`${base}/target/param: expected a non-empty parameter name`)
			} else if (!raw.pattern.split('/').includes(`:${target.param}`)) {
				violations.push(`${base}/target/param: ${JSON.stringify(target.param)} does not appear in the pattern`)
			}
			prefixes.push({ pattern: raw.pattern, target: { type: 'render', render: String(target.render), param: String(target.param) } })
		})
	}

	if (violations.length > 0) {
		throw new RoutesFileError(source, violations)
	}

	const file: RoutesFile = {
		version: ROUTES_FILE_VERSION,
		instance: { pubkey: null },
		seq: isPositiveInteger(candidate.seq) ? (candidate.seq as number) : 0,
		default: typeof candidate.default === 'string' ? candidate.default : null,
		bindings,
		prefixes,
	}

	return { file, warnings }
}

/**
 * Reads, parses and validates the file. Throws on every failure state in
 * `ARCHITECTURE.md` §4.4 — missing, unparseable, or invalid. Never creates a
 * file, never falls back to an empty table.
 */
export function loadRoutesFile(path: string): LoadedRoutesFile {
	let text: string
	try {
		text = readFileSync(path, 'utf8')
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new RoutesFileError(path, [`/ : cannot read the routing file (${detail})`])
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new RoutesFileError(path, [`/ : not valid JSON (${detail})`])
	}

	const { file, warnings } = validateRoutesFile(parsed, path)
	return { file, warnings, path }
}

/**
 * Stable JSON: keys sorted recursively, two-space indent, trailing newline —
 * so a diff is a review artefact and a hash is an assertion.
 */
export function serializeRoutesFile(file: RoutesFile): string {
	return `${JSON.stringify(sortKeys(file), null, 2)}\n`
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys)
	if (isRecord(value)) {
		const sorted: Record<string, unknown> = {}
		for (const key of Object.keys(value).sort()) {
			if (value[key] !== undefined) sorted[key] = sortKeys(value[key])
		}
		return sorted
	}
	return value
}

/**
 * `tmp → fsync → .bak → rename`. On any failure the previous file is
 * untouched: the rename is the only step that replaces the live bytes, and
 * it happens after the new bytes are durable.
 */
export function writeAtomic(path: string, text: string): void {
	const temporary = `${path}.tmp`
	const backup = `${path}.bak`
	mkdirSync(dirname(path), { recursive: true })

	let descriptor: number | undefined
	try {
		descriptor = openSync(temporary, 'w')
		writeSync(descriptor, text)
		fsyncSync(descriptor)
		closeSync(descriptor)
		descriptor = undefined

		if (existsSync(path)) copyFileSync(path, backup)
		renameSync(temporary, path)
	} catch (error) {
		if (descriptor !== undefined) {
			try {
				closeSync(descriptor)
			} catch {
				// Descriptor may already be closed.
			}
		}
		try {
			rmSync(temporary, { force: true })
		} catch {
			// Cleanup is best-effort; the original file is untouched either way.
		}
		throw error
	}
}

export type LookupResult = { kind: 'binding'; binding: Binding } | { kind: 'lease-expired'; binding: Binding }

const isLive = (binding: Binding, nowSeconds: number): boolean => binding.meaning !== 'lease' || (binding.expiresAt ?? 0) > nowSeconds

/**
 * Rung 1. Returns `null` when no binding claims the path, a `lease-expired`
 * result when a lease did claim it and its term is over, and the binding
 * otherwise. Never throws: a lookup is a read of already-validated state.
 */
export function lookup(file: RoutesFile, path: string, nowSeconds: number): LookupResult | null {
	try {
		const binding = file.bindings.find((candidate) => candidate.path === path)
		if (!binding) return null
		return isLive(binding, nowSeconds) ? { kind: 'binding', binding } : { kind: 'lease-expired', binding }
	} catch {
		return null
	}
}

export interface PrefixMatch {
	binding: PrefixRoute
	params: Record<string, string>
}

function patternSegments(pattern: string): string[] {
	return pattern.split('/').filter(Boolean)
}

/** Rung 2: the longest declared pattern that fits wins. */
export function prefixMatch(file: RoutesFile, segments: string[]): PrefixMatch | null {
	const candidates = [...file.prefixes].sort((a, b) => {
		const length = patternSegments(b.pattern).length - patternSegments(a.pattern).length
		return length !== 0 ? length : b.pattern.length - a.pattern.length
	})

	for (const binding of candidates) {
		const parts = patternSegments(binding.pattern)
		if (parts.length !== segments.length) continue
		const params: Record<string, string> = {}
		const fits = parts.every((part, index) => {
			if (part.startsWith(':')) {
				params[part.slice(1)] = segments[index]
				return segments[index].length > 0
			}
			return part === segments[index]
		})
		if (fits) return { binding, params }
	}
	return null
}

/** `default` field, or null. */
export function defaultPath(file: RoutesFile): string | null {
	return file.default ?? null
}
