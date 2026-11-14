import { describe, expect, test } from 'bun:test'
import { composePageHtml, escapeHtml, serializePagePayload } from './pageHtml'

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
