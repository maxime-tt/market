import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseStorefrontPage } from '@sdk/commerce/storefront/storefrontPage'
import { PageRenderError, derivePageMeta, renderPage } from './pageRender'

const AUTHOR = 'a'.repeat(64)
const EXAMPLE = readFileSync(join(import.meta.dir, '..', '..', '..', 'data', 'pages.example', 'example.json'), 'utf8')

function examplePage() {
	const parsed = parseStorefrontPage(EXAMPLE)
	if (!parsed.page || parsed.error) throw new Error(`example page did not parse: ${parsed.error}`)
	return parsed.page
}

describe('pageRender — static blocks render, data-bound blocks placeholder', () => {
	test('static content is in the HTML with no JavaScript', () => {
		const { html } = renderPage(examplePage(), { author: AUTHOR })
		expect(html).toContain('data-testid="storefront-page"')
		expect(html).toContain('Example storefront')
		expect((html.match(/<h1/g) ?? []).length).toBeGreaterThanOrEqual(1)
	})

	test('each data-bound block is a placeholder region carrying its type', () => {
		const { html } = renderPage(examplePage(), { author: AUTHOR })
		expect(html).toContain('data-ar-block="ProductGrid"')
		expect(html).toContain('data-ar-block-placeholder="true"')
		// The block's own "no data yet" view is inside the region — not live data.
		expect(html).toContain('No products yet.')
	})

	test('meta is derived once from the document', () => {
		const meta = derivePageMeta(examplePage())
		expect(meta.title).toBe('Example storefront')
		expect(meta.description).toContain('kind 30024')
		expect(meta.canonical).toBeNull()
	})

	test('renders with no window and no document in the Bun process', () => {
		// The assertion of §11 R-1 item 1: if a client-only import ever reaches
		// this module, this test stops being able to run.
		expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')
		expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined')
		const { html } = renderPage(examplePage(), { author: AUTHOR })
		expect(html.length).toBeGreaterThan(500)
	})

	test('an unrenderable document throws a named PageRenderError', () => {
		expect(() => renderPage(null as never, { author: AUTHOR })).toThrow(PageRenderError)
	})
})
