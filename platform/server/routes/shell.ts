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

/**
 * The path this process serves its own raw SPA shell on.
 *
 * It exists because increment 3 stopped `/` being "the shell": `/` is now the
 * default binding's page (`ARCHITECTURE.md` §3.5 R4), so every in-process
 * consumer of the shell *bytes* — the serve path's compiled-in fallback and the
 * og fallback — needs a URL that answers with the bundle and nothing else.
 *
 * Two properties make it unclaimable: it is two segments, so Bun's `/:name`
 * route cannot reach it, and `__ar` fails the route-name grammar
 * (`NAME_PATTERN`, `@sdk/config/routeNames.ts`), so `validateRoutesFile` refuses
 * any binding or prefix written on it. It is served by the same `'/*'`
 * catch-all that has always handed the shell to every unmatched multi-segment
 * path — this constant only names that fact for the callers that need it.
 */
export const SHELL_PATH = '/__ar/shell'

export interface ShellResponderOptions {
	/** The same value the entrypoint hands `buildServer` for the `'/*'` route. */
	indexHtml: unknown
	/** Required when `indexHtml` is Bun's `HTMLBundle`. */
	fetchShell?: ShellFetch
}

export interface ShellResponder {
	/** The shell, as a Response a handler may return. */
	(): Promise<Response>
	/**
	 * The shell's bytes. The same cached body the responses carry, so the asset
	 * URLs a served page must re-emit (`pageHtml.composePageHtml`) come from
	 * exactly the bytes this process serves — never from a second fetch and
	 * never from an assumed path.
	 */
	text(): Promise<string>
}

interface CachedShell {
	body: string
	contentType: string
	cacheControl: string | null
}

const isResponse = (value: unknown): value is Response => typeof Response !== 'undefined' && value instanceof Response

/** The bundle's asset URLs, as the shell's own bytes declare them. */
export interface ShellAssets {
	/** The bundle's module entry script, or null when the shell carries none. */
	bootstrapSrc: string | null
	/**
	 * Every `<link rel="stylesheet">` in document order — the bundle's own CSS
	 * and the font stylesheets the shell links. A served page replaces the whole
	 * `<head>`, so it has to re-emit what the shell styled itself with or the
	 * page renders unstyled until the bundle boots.
	 */
	stylesheetHrefs: string[]
}

const TAG = /<(script|link)\b[^>]*>/gi

/** One double-quoted attribute out of a tag's source text, or null. */
function attr(tag: string, name: string): string | null {
	const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
	return match ? match[1] : null
}

/**
 * Reads the asset URLs out of the shell's bytes.
 *
 * This is the *only* in-process source: Bun's `HTMLBundle` exposes no file list
 * (measured — `Object.getOwnPropertyNames` and the descriptor map are both
 * empty, and only a prototype `index` getter exists), so a served page cannot
 * be told the hashed URLs by the bundler and must read them from the shell the
 * process already serves. Nothing is constructed: an asset URL that is not in
 * the shell is reported as absent rather than guessed.
 */
export function readShellAssets(html: string): ShellAssets {
	const assets: ShellAssets = { bootstrapSrc: null, stylesheetHrefs: [] }
	for (const match of html.matchAll(TAG)) {
		const tag = match[0]
		const kind = match[1].toLowerCase()
		if (kind === 'script') {
			if (assets.bootstrapSrc !== null) continue
			if (attr(tag, 'type')?.toLowerCase() !== 'module') continue
			const src = attr(tag, 'src')
			if (src) assets.bootstrapSrc = src
			continue
		}
		if (attr(tag, 'rel')?.toLowerCase() !== 'stylesheet') continue
		const href = attr(tag, 'href')
		if (href) assets.stylesheetHrefs.push(href)
	}
	return assets
}

export function createShellResponder({ indexHtml, fetchShell }: ShellResponderOptions): ShellResponder {
	const load = async (): Promise<CachedShell> => {
		if (isResponse(indexHtml)) {
			return {
				body: await indexHtml.clone().text(),
				contentType: indexHtml.headers.get('content-type') ?? 'text/html; charset=utf-8',
				cacheControl: indexHtml.headers.get('cache-control'),
			}
		}
		if (!fetchShell) throw new Error('spa-shell-unavailable: no shell fetch configured for the HTML bundle')
		const response = await fetchShell()
		if (!response.ok) throw new Error(`spa-shell-unavailable: the shell request answered ${response.status}`)
		return {
			body: await response.text(),
			contentType: response.headers.get('content-type') ?? 'text/html; charset=utf-8',
			cacheControl: response.headers.get('cache-control'),
		}
	}

	let cached: CachedShell | null = null
	let pending: Promise<CachedShell> | null = null

	const ensure = async (): Promise<CachedShell> => {
		if (!cached) {
			pending ??= load()
			try {
				cached = await pending
			} finally {
				pending = null
			}
		}
		return cached
	}

	// A fresh Response per call: a Response body is consumed once, so handing out
	// the same instance twice would serve an empty body the second time.
	const responder = (async () => {
		const shell = await ensure()
		const headers: Record<string, string> = { 'content-type': shell.contentType }
		if (shell.cacheControl) headers['cache-control'] = shell.cacheControl
		return new Response(shell.body, { headers })
	}) as unknown as ShellResponder

	responder.text = async () => (await ensure()).body

	return responder
}