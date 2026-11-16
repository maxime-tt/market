import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	RouteBindingForm,
	RouteBindingsEmpty,
	RouteBindingsError,
	RouteBindingsList,
	RouteRemovalConfirm,
	type RouteBindingRow,
} from './route-authoring-views'

const row = (over: Partial<RouteBindingRow> = {}): RouteBindingRow => ({
	path: 'shop',
	targetLabel: 'page deadbeef…cafe / storefront-page',
	updatedAtLabel: '2027-01-15',
	updatedByLabel: 'abcdef12…3456',
	warning: null,
	author: 'a'.repeat(64),
	d: 'storefront-page',
	...over,
})

describe('route authoring views', () => {
	test('the empty state says the table has no bindings, not that it failed', () => {
		const markup = renderToStaticMarkup(createElement(RouteBindingsEmpty))
		expect(markup).toContain('No paths are bound yet')
		expect(markup).toContain('point one at a published storefront page')
	})

	test('the error state names the failure and offers a retry, and never renders an empty list', () => {
		const markup = renderToStaticMarkup(
			createElement(RouteBindingsError, { message: 'Could not read the routing table (HTTP 500).', onRetry: () => {} }),
		)
		expect(markup).toContain('Could not read the routing table')
		expect(markup).toContain('HTTP 500')
		expect(markup).toContain('Try again')
		expect(markup).not.toContain('No paths are bound yet')
	})

	test('the populated state renders each binding with its target, author and date', () => {
		const markup = renderToStaticMarkup(
			createElement(RouteBindingsList, {
				rows: [
					row(),
					row({ path: 'featured', targetLabel: 'page 11111111…2222 / home', updatedByLabel: 'the instance (at boot)' }),
				],
				pendingPath: null,
				onEdit: () => {},
				onRemove: () => {},
			}),
		)
		expect(markup).toContain('/shop')
		expect(markup).toContain('/featured')
		expect(markup).toContain('page deadbeef…cafe / storefront-page')
		expect(markup).toContain('Updated 2027-01-15 by abcdef12…3456')
		expect(markup).toContain('the instance (at boot)')
		expect(markup).not.toContain('No paths are bound yet')
	})

	test('a compiled-in collision is called out on the row that has it', () => {
		const markup = renderToStaticMarkup(
			createElement(RouteBindingsList, {
				rows: [
					row({ path: 'products', warning: 'compiled-in-path: the binding on products supersedes a compiled-in route' }),
					row({ path: 'shop' }),
				],
				pendingPath: null,
			}),
		)
		expect(markup).toContain('is also a page compiled into this build')
		expect(markup.match(/is also a page compiled into this build/g)).toHaveLength(1)
	})

	test('a row whose removal is in flight disables its own controls', () => {
		const markup = renderToStaticMarkup(
			createElement(RouteBindingsList, { rows: [row()], pendingPath: 'shop', onEdit: () => {}, onRemove: () => {} }),
		)
		expect(markup).toContain('disabled=""')
	})

	test('the form shows submitted errors and disables the path while retargeting', () => {
		const markup = renderToStaticMarkup(
			createElement(RouteBindingForm, {
				title: 'Retarget /shop',
				description: 'Choose the page this path should serve.',
				values: { path: 'shop', author: 'a'.repeat(64), d: 'home' },
				errors: ['shop is already bound. Edit that binding instead of creating a second one.'],
				pending: false,
				submitLabel: 'Save target',
				editing: true,
				onChange: () => {},
				onSubmit: () => {},
				onCancel: () => {},
			}),
		)
		expect(markup).toContain('Retarget /shop')
		expect(markup).toContain('already bound')
		expect(markup).toContain('A path cannot be renamed in place')
		expect(markup).toContain('Cancel')
	})

	test('a new binding form says what the path will become', () => {
		const markup = renderToStaticMarkup(
			createElement(RouteBindingForm, {
				title: 'Bind a path',
				description: 'Point a path at a page you have published.',
				values: { path: '', author: '', d: 'storefront-page' },
				errors: [],
				pending: false,
				submitLabel: 'Bind path',
				editing: false,
				onChange: () => {},
				onSubmit: () => {},
			}),
		)
		expect(markup).toContain('It becomes the URL: /your-name.')
		expect(markup).toContain('Bind path')
		expect(markup).not.toContain('role="alert"')
		expect(markup).not.toContain('Cancel')
	})

	test('removal asks first and names the path it takes away', () => {
		const markup = renderToStaticMarkup(createElement(RouteRemovalConfirm, { path: 'shop', pending: false, onConfirm: () => {}, onCancel: () => {} }))
		expect(markup).toContain('/shop')
		expect(markup).toContain('stops resolving to it')
		expect(markup).toContain('Keep it')
	})
})