import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState } from './empty-state'

describe('EmptyState', () => {
	test('renders the title with an optional muted description', () => {
		const markup = renderToStaticMarkup(<EmptyState title="No items" description="Try another filter" />)
		expect(markup).toContain('data-slot="empty-state"')
		expect(markup).toContain('No items')
		expect(markup).toContain('Try another filter')
		expect(markup).toContain('text-sm text-muted-foreground')
	})

	test('renders an action only when provided', () => {
		const withAction = renderToStaticMarkup(<EmptyState title="No items" action={<button type="button">Reload</button>} />)
		expect(withAction).toContain('Reload')

		const withoutAction = renderToStaticMarkup(<EmptyState title="No items" />)
		expect(withoutAction).not.toContain('<button')
	})

	test('merges host className and switches to compact spacing', () => {
		const markup = renderToStaticMarkup(<EmptyState title="No items" compact className="host-empty" />)
		expect(markup).toContain('host-empty')
		expect(markup).toContain('py-6')
		expect(markup).toContain('font-medium text-sm')
	})
})
