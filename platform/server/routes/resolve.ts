import { COMPILED_IN_NAMES } from '@sdk/config/routeNames'
import { lookup, prefixMatch, type PageTarget, type RenderTarget, type RoutesFile, type SeriesTarget } from './routeFile'

/**
 * The resolution ladder — exactly three rungs, pure, no I/O, no network.
 *
 * `ARCHITECTURE.md` §3.3 / §13. Routing decides *which page* answers from the
 * routing file alone; the local page store then supplies it. A request never
 * asks a relay which path matched (sentence 1), and a lapsed lease never
 * falls through to a prefix or a compiled-in page (sentence 3).
 *
 * R3 (the series path) is a **rung-1 refinement**, not a new rung: `/featured`
 * is an exact path in the routing file, and a series binding answers it. The
 * series index is I/O, so `resolve` does not read it — the caller injects a
 * resolver through `ResolveContext`. Called without one (every test that does
 * not care about series), a series binding is an honest `series-empty` 404.
 */

export interface ResolveContext {
	/** Given a series target, the member to answer with — or null when empty. */
	series?: (target: SeriesTarget) => { author: string; d: string } | null
}

export type Resolution =
	| { status: 200; outcome: 'page'; target: PageTarget; path: string }
	| { status: 200; outcome: 'series'; target: SeriesTarget; author: string; d: string; path: string }
	| { status: 200; outcome: 'render'; target: RenderTarget; params: Record<string, string>; path: string }
	| { status: 200; outcome: 'compiled-in'; path: string; warning: 'compiled-in-path' }
	| { status: 404; outcome: 'not-found'; path: string; reason: 'no-match' | 'lease-expired' | 'invalid-path' | 'series-empty' }

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
export function resolve(file: RoutesFile, pathname: string, nowSeconds: number, context: ResolveContext = {}): Resolution {
	const normalized = normalizePath(pathname)
	if (!normalized) return { status: 404, outcome: 'not-found', path: pathname, reason: 'invalid-path' }

	const path = normalized.path

	// RUNG 1 — exact path.
	const exact = lookup(file, path, nowSeconds)
	if (exact?.kind === 'lease-expired') {
		// STOP. The space is gone; it must not fall through to rung 1b or rung 2,
		// and it must not consult the series resolver either — a lapsed lease is a
		// 404 regardless of what the index holds (invariant 3).
		return { status: 404, outcome: 'not-found', path, reason: 'lease-expired' }
	}
	if (exact?.kind === 'binding') {
		const target = exact.binding.target
		if (target.type === 'page') return { status: 200, outcome: 'page', target, path }
		if (target.type === 'series') {
			// RUNG 1b-series, evaluated *at* rung 1: the path is an exact binding,
			// and the series is resolved from the injected index. It answers before
			// the compiled-in check, so a series binding on a compiled-in name wins.
			const member = context.series?.(target) ?? null
			if (member) return { status: 200, outcome: 'series', target, author: member.author, d: member.d, path }
			// No resolver, or an empty series: an honest 404, never a render.
			return { status: 404, outcome: 'not-found', path, reason: 'series-empty' }
		}
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
