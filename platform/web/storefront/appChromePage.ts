import { normalizePath } from '@platform/web/servedPage'

/**
 * The app-chrome page — the client's half of the `#__AR_ROUTE__` seam.
 *
 * `platform/web/servedPage.tsx` is the sibling of this module: both read a JSON
 * script the server put in the document, both answer "what does *this* URL
 * mean" without re-deciding routing in the browser. They are deliberately
 * different ids. `#__AR_PAGE__` means *a served document* — the server sent the
 * page's markup and the client hydrates it outside the router. `#__AR_ROUTE__`
 * means *a shell that names a page* — the server sent the ordinary SPA shell
 * and answered the path question in-band, so the app mounts normally and
 * `routes/__root.tsx` renders the page inside the real header and footer.
 *
 * The distinction is what makes a stale tab degrade instead of going blank: an
 * old bundle reading a new shell finds no `#__AR_PAGE__`, mounts the app and
 * falls through to its own surface, rather than hydrating an empty wrapper.
 *
 * The payload is a fact about **this document load**, not about the URL. The
 * server resolved the path against the routing file (`resolve.ts`) and carries
 * the path it was served for, so the accessor is keyed by path rather than a
 * one-shot flag: a client-side return to that path renders the page again,
 * while a navigation elsewhere falls through to `<Outlet/>`. A client-side
 * navigation to a *different* bound path has no payload and cannot get one —
 * the SPA cannot ask the routing file anything — so that path needs a full
 * document load. That is the same limit the standalone `served` guard has.
 */

/** The payload the app-chrome seam carries: the page, and the path it answered. */
export interface AppChromePagePayload {
	author: string
	d: string
	path: string
}

const PAYLOAD_SCRIPT_ID = '__AR_ROUTE__'

/**
 * The last body seen and what it parsed to. One parse per document body: the
 * script cannot change once the server wrote it, so every render after the
 * first is a string compare, and re-reading for a different fixture costs one
 * parse rather than threading test-only state through the module.
 */
let memoRaw: string | null = null
let memoPayload: AppChromePagePayload | null = null
let memoised = false

/**
 * The app-chrome payload, or `null` when this document is not one.
 *
 * Tolerant by design — relay-adjacent bytes are untrusted until they parse:
 * absent script, malformed JSON, or any field missing/not a non-empty string
 * all yield `null`, never a throw. `path` is required: a payload that does not
 * say which path the server answered for cannot be matched to a URL, and
 * guessing would render a page at the wrong address.
 */
export function readAppChromePage(): AppChromePagePayload | null {
	if (typeof document === 'undefined') return null

	const raw = document.getElementById(PAYLOAD_SCRIPT_ID)?.textContent ?? null
	if (memoised && raw === memoRaw) return memoPayload

	memoised = true
	memoRaw = raw
	memoPayload = parsePayload(raw)
	return memoPayload
}

function parsePayload(raw: string | null): AppChromePagePayload | null {
	if (raw === null) return null

	try {
		const parsed = JSON.parse(raw) as Partial<AppChromePagePayload>
		if (typeof parsed.author !== 'string' || parsed.author.length === 0) return null
		if (typeof parsed.d !== 'string' || parsed.d.length === 0) return null
		if (typeof parsed.path !== 'string' || parsed.path.length === 0) return null
		return { author: parsed.author, d: parsed.d, path: parsed.path }
	} catch {
		return null
	}
}

/**
 * The page the server bound to `pathname`, if it bound one.
 *
 * Path normalisation is `servedPageForPath`'s — one function, imported, so the
 * two guards cannot drift (`resolve.ts` `normalizePath` is the server's rule).
 */
export function appChromePageForPath(pathname: string): AppChromePagePayload | null {
	const payload = readAppChromePage()
	if (!payload) return null
	return normalizePath(pathname) === normalizePath(payload.path) ? payload : null
}
