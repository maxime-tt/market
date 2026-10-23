import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Pattern } from './pattern'

describe('Pattern', () => {
	test('defaults to the dots pattern at full opacity', () => {
		const markup = renderToStaticMarkup(<Pattern />)
		expect(markup).toContain('absolute')
		expect(markup).toContain('inset-0')
		expect(markup).toContain('z-0')
		expect(markup).toContain('opacity-100')
		expect(markup).toContain('/images/dots-min.png')
	})

	test('page variant sits behind the content at reduced opacity', () => {
		const markup = renderToStaticMarkup(<Pattern pattern="page" />)
		expect(markup).toContain('-z-10')
		expect(markup).toContain('opacity-25')
		expect(markup).toContain('/images/page-min.png')
	})

	test('merges a host className without dropping its own', () => {
		const markup = renderToStaticMarkup(<Pattern className="h-32" />)
		expect(markup).toContain('h-32')
		expect(markup).toContain('w-full')
	})
})
