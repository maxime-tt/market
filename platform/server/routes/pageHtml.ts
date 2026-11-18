import type { PageMeta } from './pageStore'

/**
 * Composes the served page: `<head>` meta, the rendered fragment, the SPA
 * bootstrap seam and the `#__AR_PAGE__` payload.
 *
 * `IMPLEMENTATION-PLAN.md` §1.4.3. A crawler that runs no JavaScript sees the
 * static content and the meta; a browser sees the same DOM and then hydrates
 * it. The fragment is never re-rendered by the client — the payload names the
 * `(author, d)` the server already resolved, so the client does not re-decide
 * the route.
 *
 * Three things the document carries for that seam, and what each is for:
 *
 *   - `#__AR_PAGE__` — the coordinate the routing file resolved to, so the
 *     client reads the same page's live data without re-deciding anything;
 *   - the fragment's wrapper (`[data-ar-served-page]`) — the element the
 *     client's first commit reproduces byte-for-byte, so hydration matches
 *     without the client knowing the document;
 *   - the bundle's own `<script type="module">` and stylesheets, read from the
 *     shell's bytes at serve time. Without them a served page ships no JS and
 *     no CSS at all — measured on the increment-1/2 document.
 *
 * No block emits a script. There is no per-block asset and no registry.
 *
 * This is the **standalone** answer. A bound path whose page document asks for
 * `chrome: 'app'` answers with the ordinary SPA shell plus `#__AR_ROUTE__`
 * (`injectRoutePayload`, below) instead: the shell renders the app's own header
 * and footer and the client renders the page inside them. A standalone
 * document is still composed here and still carries the server-rendered body,
 * which is what makes it survive a dead relay; it is now one of two answers a
 * bound path can give, not the only one.
 */

export interface PagePayload {
	author: string
	d: string
	version: 1
}

export interface ComposePageOptions {
	meta: PageMeta
	html: string
	payload: PagePayload
	/** The request path — used for the canonical URL, which ingest cannot know. */
	path: string
	/**
	 * The stylesheet URLs the shell styles itself with, in document order. A
	 * served page replaces the whole `<head>`, so without these the page renders
	 * unstyled until the bundle boots — measured: the shell links the app's CSS
	 * (one `chunk-*.css` in a production build, five `_bun/asset/*.css` in dev)
	 * and the font stylesheets, and nothing re-emits them otherwise.
	 *
	 * Sourced from the shell's own bytes (`shell.ts` `readShellAssets`), never
	 * from a constructed path: there is no in-process source for the hashed URL
	 * other than the shell.
	 */
	stylesheetHrefs?: string[]
	/**
	 * Optional SPA bundle URL. Increment 1 has no stable asset path to pass
	 * (the SPA shell is Bun's HTMLBundle, injected at serve time), so the
	 * bootstrap script is emitted only when a caller supplies one; the
	 * `#__AR_PAGE__` payload is always emitted.
	 */
	bootstrapSrc?: string
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ESCAPES[character])
}

/**
 * JSON that cannot terminate its own `<script>` element. The one escaping rule;
 * every payload script on this server (`#__AR_PAGE__` and `#__AR_ROUTE__`) is
 * serialised through it.
 */
export function serializePagePayload<T extends object>(payload: T): string {
	return JSON.stringify(payload)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')
}

/**
 * The script id of the app-chrome payload — deliberately not `#__AR_PAGE__`.
 *
 * The two ids are the discriminator between the two answers a bound path can
 * give. `#__AR_PAGE__` means *a served document*: `platform/web/frontend.tsx`
 * sees it and mounts the app outside the router, hydrating the server's
 * markup. `#__AR_ROUTE__` means *a shell that names a page*: the app mounts
 * normally and `platform/web/storefront/appChromePage.ts` reads the payload so
 * the root guard renders the page inside the real header and footer.
 */
export const ROUTE_PAYLOAD_SCRIPT_ID = '__AR_ROUTE__'

/** The app-chrome payload: the page, and the path the server answered for. */
export interface RoutePayload {
	author: string
	d: string
	/** The request path, normalised the way the standalone arm's canonical is. */
	path: string
}

/**
 * The app-chrome document: the SPA shell's own bytes with the route payload
 * inserted, and nothing else changed.
 *
 * Pure `string → string` so the shell's cached bytes are never mutated: the
 * caller injects, then builds a fresh `Response` (`buildServer.ts`). The script
 * goes immediately before `</body>`; a shell with no `</body>` (Bun's
 * `HTMLBundle` has one, a test's `new Response('SHELL')` does not) gets it
 * appended, which the browser hoists into the body anyway.
 *
 * One script element per document, and a document that already carries
 * `#__AR_PAGE__` is returned untouched: that is a composed standalone page, and
 * adding a second, different answer to it would leave the client choosing.
 */
export function injectRoutePayload(shellHtml: string, payload: RoutePayload): string {
	if (shellHtml.includes(`id="${ROUTE_PAYLOAD_SCRIPT_ID}"`)) return shellHtml
	if (shellHtml.includes('id="__AR_PAGE__"')) return shellHtml

	const script = `<script id="${ROUTE_PAYLOAD_SCRIPT_ID}" type="application/json">${serializePagePayload(payload)}</script>`
	const close = shellHtml.lastIndexOf('</body>')
	if (close === -1) return shellHtml + script
	return `${shellHtml.slice(0, close)}${script}${shellHtml.slice(close)}`
}

export function composePageHtml(options: ComposePageOptions): string {
	const { meta, html, payload, path, bootstrapSrc, stylesheetHrefs = [] } = options
	const title = escapeHtml(meta.title)
	const description = escapeHtml(meta.description)
	const canonical = escapeHtml(meta.canonical ?? path)

	const head = [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${title}</title>`,
		`<meta name="description" content="${description}">`,
		`<link rel="canonical" href="${canonical}">`,
		`<meta property="og:type" content="website">`,
		`<meta property="og:title" content="${title}">`,
		`<meta property="og:description" content="${description}">`,
		`<meta property="og:url" content="${canonical}">`,
		meta.ogImage ? `<meta property="og:image" content="${escapeHtml(meta.ogImage)}">` : '',
		`<meta name="twitter:card" content="${meta.ogImage ? 'summary_large_image' : 'summary'}">`,
		`<meta name="twitter:title" content="${title}">`,
		`<meta name="twitter:description" content="${description}">`,
		meta.ogImage ? `<meta name="twitter:image" content="${escapeHtml(meta.ogImage)}">` : '',
		// The shell's own stylesheets, re-emitted in document order. Empty when
		// the shell carried none (a test's placeholder shell), which is why the
		// head is built as a filtered list rather than a fixed document.
		...stylesheetHrefs.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
		'</head>',
		'<body>',
		// `#root` holds exactly one element: the wrapper the client's first commit
		// reproduces. It exists so that commit needs to know nothing about the
		// document — its only attribute is this constant, and the fragment inside
		// keeps the theme attributes the server rendered, adopted by
		// `dangerouslySetInnerHTML` and never reconciled
		// (`platform/web/servedPage.tsx`). Hydration through the router is
		// impossible: TanStack's `Matches` renders a `Suspense` fallback on its
		// first commit (measured in Chromium), so the served document hydrates
		// outside it.
		//
		// On ONE line, deliberately: a newline between `#root` and the wrapper is a
		// whitespace text node, and React's first commit has no such node to match
		// it against — measured, that alone fails hydration.
		`<div id="root"><div data-ar-served-page="true">${html}</div></div>`,
		`<script id="__AR_PAGE__" type="application/json">${serializePagePayload(payload)}</script>`,
		bootstrapSrc ? `<script type="module" src="${escapeHtml(bootstrapSrc)}"></script>` : '',
		'</body>',
		'</html>',
	]

	return head.filter((line) => line !== '').join('\n')
}

/** A minimal, honest document for a rung-2 render target in increment 1. */
export function composeRenderPlaceholder(target: { render: string; param: string }, params: Record<string, string>): string {
	const value = escapeHtml(params[target.param] ?? '')
	return [
		'<!doctype html>',
		'<html lang="en">',
		'<head>',
		'<meta charset="utf-8">',
		`<title>${escapeHtml(target.render)}</title>`,
		'</head>',
		'<body>',
		'<div id="root">',
		`<div data-ar-render="${escapeHtml(target.render)}" data-ar-param="${escapeHtml(target.param)}" data-ar-param-value="${value}"></div>`,
		'</div>',
		'</body>',
		'</html>',
	].join('\n')
}
