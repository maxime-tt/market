import { describe, expect, test } from 'bun:test'
import { serveFont, serveFontStylesheet } from './static'

// ADR-0026: bundled fonts are served as files from our own origin, never inlined, never third-party.
describe('font routes', () => {
	test('serves a bundled woff2 with a long cache', async () => {
		const res = await serveFont('young-serif-latin-wght-normal.woff2')
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('font/woff2')
		expect(res.headers.get('Cache-Control')).toContain('max-age=604800')
	})

	test('refuses path traversal, other extensions and unknown files', async () => {
		for (const name of ['../package.json', '..%2Fx.woff2', 'x.ttf', '', 'missing-face.woff2']) {
			expect((await serveFont(name)).status).toBe(404)
		}
	})

	test('the font stylesheet points only at our own /fonts/ path', async () => {
		const css = await serveFontStylesheet().text()
		const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''))
		expect(urls.length).toBeGreaterThan(0)
		for (const u of urls) expect(u).toMatch(/^\/fonts\/[a-z0-9-]+\.woff2$/)
	})
})
