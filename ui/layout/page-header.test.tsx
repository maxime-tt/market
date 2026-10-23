import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobilePageHeader, PAGE_HEADER_CLASS, PageHeader } from './page-header'

/**
 * The unit suite has no DOM renderer, so markup is asserted through
 * `renderToStaticMarkup`.
 */

describe('PAGE_HEADER_CLASS', () => {
	test('carries the band utilities the 21 dashboard routes declared by hand', () => {
		for (const utility of ['sticky', 'top-0', 'z-10', 'hidden', 'border-b', 'bg-background', 'lg:flex']) {
			expect(PAGE_HEADER_CLASS).toContain(utility)
		}
	})
})

describe('PageHeader', () => {
	test('renders the shared band with its children', () => {
		const markup = renderToStaticMarkup(createElement(PageHeader, null, createElement('span', null, 'Products')))
		expect(markup).toContain('data-slot="page-header"')
		expect(markup).toContain('sticky')
		expect(markup).toContain('Products')
	})

	test('merges extra utilities without losing the band', () => {
		const markup = renderToStaticMarkup(createElement(PageHeader, { className: 'gap-4', children: 'x' }))
		expect(markup).toContain('gap-4')
		expect(markup).toContain('sticky')
	})

	test('opts into a glass band', () => {
		const markup = renderToStaticMarkup(createElement(PageHeader, { glass: true, children: 'x' }))
		expect(markup).toContain('glass')
	})

	test('is hidden until lg, so compact viewports use MobilePageHeader instead', () => {
		const markup = renderToStaticMarkup(createElement(PageHeader, null, 'x'))
		expect(markup).toContain('hidden')
		expect(markup).toContain('lg:flex')
	})
})

describe('MobilePageHeader', () => {
	test('is hidden from lg upwards', () => {
		const markup = renderToStaticMarkup(createElement(MobilePageHeader, null, 'Dashboard'))
		expect(markup).toContain('lg:hidden')
		expect(markup).toContain('Dashboard')
		expect(markup).toContain('data-slot="mobile-page-header"')
	})

	test('accepts a top offset for the fixed app header', () => {
		const markup = renderToStaticMarkup(createElement(MobilePageHeader, { className: 'top-[8.5rem]', children: 'x' }))
		expect(markup).toContain('top-[8.5rem]')
	})
})
