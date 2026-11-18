import { describe, expect, test } from 'bun:test'
import { ROUTE_PAYLOAD_SCRIPT_ID, composePageHtml, escapeHtml, injectRoutePayload, serializePagePayload } from './pageHtml'

const AUTHOR = 'a'.repeat(64)

const compose = (overrides: Partial<Parameters<typeof composePageHtml>[0]> = {}) =>
	composePageHtml({
		meta: { title: 'My shop', description: 'Things & stuff', ogImage: 'https://example.test/og.png', canonical: null },
		html: '<div data-testid="storefront-page"><h1>Hello</h1></div>',
		payload: { author: AUTHOR, d: 'home', version: 1 },
		path: '/shop',
		...overrides,
	})

describe('pageHtml — the served document', () => {
	test('carries title, description, og/twitter meta and the canonical URL', () => {
		const html = compose()
		expect(html).toContain('<title>My shop</title>')
		expect(html).toContain('name="description" content="Things &amp; stuff"')
		expect(html).toContain('property="og:title" content="My shop"')
		expect(html).toContain('property="og:image" content="https://example.test/og.png"')
		expect(html).toContain('name="twitter:card" content="summary_large_image"')
		expect(html).toContain('<link rel="canonical" href="/shop">')
	})

	test('the rendered fragment is the body, with no per-block script', () => {
		const html = compose()
		expect(html).toContain('<div data-testid="storefront-page"><h1>Hello</h1></div>')
		expect(html).not.toContain('<script type="module" src=')
		expect((html.match(/<script/g) ?? []).length).toBe(1) // only #__AR_PAGE__
		expect(html).toContain('id="__AR_PAGE__"')
	})

	test('the payload names (author, d) and cannot break out of its script element', () => {
		const html = compose({ payload: { author: AUTHOR, d: '</script><script>alert(1)</script>', version: 1 } })
		const payload = html.slice(html.indexOf('id="__AR_PAGE__"'))
		expect(payload).not.toContain('</script><script>')
		expect(payload).toContain('\\u003c')
		expect(html).toContain(AUTHOR)
	})

	test('escapeHtml is applied to every interpolated meta value', () => {
		expect(escapeHtml('"<&>\'')).toBe('&quot;&lt;&amp;&gt;&#39;')
	})

	test('a bootstrap script is emitted only when one is supplied', () => {
		expect(compose().match(/<script type="module"/)).toBeNull()
		expect(compose({ bootstrapSrc: '/app.js' })).toContain('<script type="module" src="/app.js"></script>')
	})

	test('serializePagePayload escapes the HTML-opening characters', () => {
		expect(serializePagePayload({ author: AUTHOR, d: '</script>', version: 1 })).not.toContain('</script>')
	})
})

describe('injectRoutePayload — the app-chrome document', () => {
	const SHELL =
		'<!doctype html><html lang="en"><head><title>Plebeian Market</title></head><body><div id="root"></div></body></html>'
	const route = { author: AUTHOR, d: 'home', path: '/shop' }
	const SCRIPT = `<script id="__AR_ROUTE__" type="application/json">${JSON.stringify(route)}</script>`

	test('the script id is the app-chrome one, never the served-document one', () => {
		expect(ROUTE_PAYLOAD_SCRIPT_ID).toBe('__AR_ROUTE__')
	})

	test('inserts the payload immediately before </body>', () => {
		expect(injectRoutePayload(SHELL, route)).toBe(SHELL.replace('</body>', `${SCRIPT}</body>`))
	})

	test('appends to the document when there is no </body>', () => {
		// The test harness shells (`new Response('SHELL')`) have no closing body;
		// a browser hoists a trailing script into the body anyway.
		expect(injectRoutePayload('SHELL', route)).toBe(`SHELL${SCRIPT}`)
	})

	test('emits exactly one script element', () => {
		const html = injectRoutePayload(SHELL, route)
		expect((html.match(/<script/g) ?? []).length).toBe(1)
		expect((html.match(/__AR_ROUTE__/g) ?? []).length).toBe(1)
		// Idempotent: injecting again does not add a second answer.
		expect(injectRoutePayload(html, route)).toBe(html)
	})

	test('escapes a `</script>` in a field — one escaping rule, the payload cannot break out', () => {
		const html = injectRoutePayload(SHELL, { ...route, path: '</script><script>alert(1)</script>' })
		const start = html.indexOf(`id="${ROUTE_PAYLOAD_SCRIPT_ID}"`)
		const script = html.slice(start, html.indexOf('</script>', start) + '</script>'.length)
		expect(script).not.toContain('</script><script>')
		expect(script).toContain('\\u003c')
		// Same rule as the served document's payload.
		expect(script).toContain(serializePagePayload({ ...route, path: '</script><script>alert(1)</script>' }))
	})

	test('leaves a `#__AR_PAGE__` document untouched', () => {
		// A composed standalone page is already an answer: adding a second,
		// different one would leave the client choosing between them.
		const standalone = compose()
		expect(injectRoutePayload(standalone, route)).toBe(standalone)
	})

	test('the payload names author, d and path as the client reads them', () => {
		const html = injectRoutePayload(SHELL, route)
		const raw = html.slice(html.indexOf('>', html.indexOf('type="application/json"')) + 1, html.lastIndexOf('</script>'))
		expect(JSON.parse(raw)).toEqual({ author: AUTHOR, d: 'home', path: '/shop' })
	})
})
