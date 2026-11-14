import type { PageMeta } from './pageStore'

/**
 * Composes the served page: `<head>` meta, the rendered fragment, the SPA
 * bootstrap seam and the `#__AR_PAGE__` payload.
 *
 * `IMPLEMENTATION-PLAN.md` §1.4.3. A crawler that runs no JavaScript sees the
 * static content and the meta; a browser sees the same DOM and then hydrates
 * it. The fragment is never re-rendered by the client — the payload names the
 * `(author, d)` the server already resolved, so the client does not re-decide
 * the route (that seam is consumed in increment 3).
 *
 * No block emits a script. There is no per-block asset and no registry.
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

/** JSON that cannot terminate its own `<script>` element. */
export function serializePagePayload(payload: PagePayload): string {
	return JSON.stringify(payload)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')
}

export function composePageHtml(options: ComposePageOptions): string {
	const { meta, html, payload, path, bootstrapSrc } = options
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
		'</head>',
		'<body>',
		'<div id="root">',
		html,
		'</div>',
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
