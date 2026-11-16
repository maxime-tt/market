/**
 * The SPA shell, as a handler can return it.
 *
 * Bun's `serve({ routes })` accepts the `./index.html` module (`HTMLBundle`) as
 * a route *value*, but a handler that returns an `HTMLBundle` is a 500 — Bun
 * wants a `Response`. The serve path needs to hand out the shell itself for one
 * case: a compiled-in name with no binding answers with the SPA, and whether it
 * has a binding is decided per request so a runtime-authored binding supersedes
 * it without a restart.
 *
 * So the shell is acquired once and re-served:
 *
 *  - when the caller passes a `Response` (the shape tests use), it is cloned;
 *  - otherwise the shell is fetched from the process's own origin, through the
 *    same HTML pipeline that builds the `'/*'` response, and the bytes are
 *    cached for the life of the process. One self-request per boot, not per
 *    page view.
 *
 * The fetch is injected rather than hardcoded to keep the loopback origin (and
 * the test double) in `buildServer.ts`, where the port already lives — the same
 * split `ogRoutes` uses for its shell fetch.
 */

export type ShellFetch = () => Promise<Response>

export interface ShellResponderOptions {
	/** The same value the entrypoint hands `buildServer` for the `'/*'` route. */
	indexHtml: unknown
	/** Required when `indexHtml` is Bun's `HTMLBundle`. */
	fetchShell?: ShellFetch
}

interface CachedShell {
	body: string
	contentType: string
	cacheControl: string | null
}

const isResponse = (value: unknown): value is Response => typeof Response !== 'undefined' && value instanceof Response

export function createShellResponder({ indexHtml, fetchShell }: ShellResponderOptions): () => Promise<Response> {
	if (isResponse(indexHtml)) {
		return async () => indexHtml.clone()
	}

	let cached: CachedShell | null = null
	let pending: Promise<CachedShell> | null = null

	const load = async (): Promise<CachedShell> => {
		if (!fetchShell) throw new Error('spa-shell-unavailable: no shell fetch configured for the HTML bundle')
		const response = await fetchShell()
		if (!response.ok) throw new Error(`spa-shell-unavailable: the shell request answered ${response.status}`)
		return {
			body: await response.text(),
			contentType: response.headers.get('content-type') ?? 'text/html; charset=utf-8',
			cacheControl: response.headers.get('cache-control'),
		}
	}

	return async () => {
		if (!cached) {
			pending ??= load()
			try {
				cached = await pending
			} finally {
				pending = null
			}
		}
		const headers: Record<string, string> = { 'content-type': cached.contentType }
		if (cached.cacheControl) headers['cache-control'] = cached.cacheControl
		return new Response(cached.body, { headers })
	}
}