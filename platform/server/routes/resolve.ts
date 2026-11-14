import { COMPILED_IN_NAMES } from '@sdk/config/routeNames'
import { lookup, prefixMatch, type PageTarget, type RenderTarget, type RoutesFile } from './routeFile'

/**
 * The resolution ladder — exactly three rungs, pure, no I/O, no network.
 *
 * `ARCHITECTURE.md` §3.3 / §13. Routing decides *which page* answers from the
 * routing file alone; the local page store then supplies it. A request never
 * asks a relay which path matched (sentence 1), and a lapsed lease never
 * falls through to a prefix or a compiled-in page (sentence 3).
 */

export type Resolution =
	| { status: 200; outcome: 'page'; target: PageTarget; path: string }
	| { status: 200; outcome: 'render'; target: RenderTarget; params: Record<string, string>; path: string }
	| { status: 200; outcome: 'compiled-in'; path: string; warning: 'compiled-in-path' }
	| { status: 404; outcome: 'not-found'; path: string; reason: 'no-match' | 'lease-expired' | 'invalid-path' }

/**
 * Lowercase, strip trailing slash, and refuse anything that could escape the
 * URL space. Returns null for a path with `..` or an encoded separator: such
 * a request is a 404, not a lookup.
 */
export function normalizePath(pathname: string): { path: string; segments: string[] } | null {
	let path = pathname
	if (!path.startsWith('/')) return null
	if (/%2f|%5c|%00/i.test(path)) return null
	if (path.includes('..')) return null

	path = path.replace(/\/+$/, '').toLowerCase()
	if (path === '') return { path: '', segments: [] }
	if (path === '/') return { path: '', segments: [] }

	const withoutLeadingSlash = path.slice(1)
	const segments = withoutLeadingSlash.split('/')
	if (segments.some((segment) => segment.length === 0)) return null
	return { path: withoutLeadingSlash, segments }
}

/**
 * Resolves a request path. `nowSeconds` is passed in rather than read so the
 * leaked-liveness rule is testable at `expiresAt + 1`.
 */
export function resolve(file: RoutesFile, pathname: string, nowSeconds: number): Resolution {
	const normalized = normalizePath(pathname)
	if (!normalized) return { status: 404, outcome: 'not-found', path: pathname, reason: 'invalid-path' }

	const path = normalized.path

	// RUNG 1 — exact path.
	const exact = lookup(file, path, nowSeconds)
	if (exact?.kind === 'lease-expired') {
		// STOP. The space is gone; it must not fall through to rung 1b or rung 2.
		return { status: 404, outcome: 'not-found', path, reason: 'lease-expired' }
	}
	if (exact?.kind === 'binding') {
		const target = exact.binding.target
		if (target.type === 'page') return { status: 200, outcome: 'page', target, path }
		return { status: 200, outcome: 'render', target, params: {}, path }
	}

	// RUNG 1b — a compiled-in page answers. Allowed, with the warning the
	// write path already recorded; never a reason to 404 a working URL.
	if (normalized.segments.length === 1 && COMPILED_IN_NAMES.includes(normalized.segments[0])) {
		return { status: 200, outcome: 'compiled-in', path, warning: 'compiled-in-path' }
	}

	// RUNG 2 — programmed prefix. The segment pattern is in the file; the id is
	// in the URL, so routing needs no indexer and no network call.
	const prefixed = prefixMatch(file, normalized.segments)
	if (prefixed) {
		return { status: 200, outcome: 'render', target: prefixed.binding.target, params: prefixed.params, path }
	}

	// RUNG 3 — the honest default.
	return { status: 404, outcome: 'not-found', path, reason: 'no-match' }
}
