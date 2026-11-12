import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoadingState } from './loading-state'

describe('LoadingState', () => {
	test('renders the spinner variant with the default label', () => {
		const markup = renderToStaticMarkup(<LoadingState />)
		expect(markup).toContain('role="status"')
		expect(markup).toContain('Loading…')
		expect(markup).not.toContain('data-slot="skeleton"')
	})

	test('renders one skeleton row per requested row', () => {
		const markup = renderToStaticMarkup(<LoadingState variant="skeleton" rows={4} label="Loading rows" />)
		expect(markup).toContain('aria-label="Loading rows"')
		expect(markup.match(/data-slot="skeleton"/g) ?? []).toHaveLength(4)
	})

	test('custom label replaces the default in the spinner variant', () => {
		const markup = renderToStaticMarkup(<LoadingState label="Loading orders…" />)
		expect(markup).toContain('Loading orders…')
		expect(markup).not.toContain('>Loading…<')
	})

	test('merges host className and switches to compact spacing', () => {
		const markup = renderToStaticMarkup(<LoadingState compact className="h-full" />)
		expect(markup).toContain('h-full')
		expect(markup).toContain('py-4')
	})
})
