import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Notice } from './notice'

describe('Notice', () => {
	test('defaults to the info tone with a status role', () => {
		const markup = renderToStaticMarkup(createElement(Notice, null, 'Heads up'))
		expect(markup).toContain('data-slot="notice"')
		expect(markup).toContain('data-tone="info"')
		expect(markup).toContain('role="status"')
		expect(markup).toContain('bg-info-muted')
		expect(markup).toContain('border-info-border')
		expect(markup).toContain('text-info-muted-foreground')
		expect(markup).toContain('Heads up')
	})

	test('renders warning and error tones with an alert role', () => {
		const warning = renderToStaticMarkup(createElement(Notice, { tone: 'warning', title: 'Careful' }, 'Verify shipping'))
		expect(warning).toContain('role="alert"')
		expect(warning).toContain('bg-warning-muted')
		expect(warning).toContain('border-warning-border')
		expect(warning).toContain('text-warning-muted-foreground')
		expect(warning).toContain('font-medium')

		const error = renderToStaticMarkup(createElement(Notice, { tone: 'error' }, 'The invoice expired'))
		expect(error).toContain('role="alert"')
		expect(error).toContain('bg-error-muted')
		expect(error).toContain('border-error-border')
		expect(error).toContain('text-error-muted-foreground')
	})

	test('renders the success tone with a status role', () => {
		const markup = renderToStaticMarkup(createElement(Notice, { tone: 'success' }, 'Saved'))
		expect(markup).toContain('data-tone="success"')
		expect(markup).toContain('role="status"')
		expect(markup).toContain('bg-success-muted')
		expect(markup).toContain('border-success-border')
		expect(markup).toContain('text-success-muted-foreground')
	})

	test('renders a trailing action and dismiss control only when provided', () => {
		const markup = renderToStaticMarkup(
			createElement(Notice, { action: createElement('button', { type: 'button' }, 'Retry'), onDismiss: () => {}, compact: true }, 'Body'),
		)
		expect(markup).toContain('Retry')
		expect(markup).toContain('aria-label="Dismiss"')
		expect(markup).toContain('px-3 py-2')

		const plain = renderToStaticMarkup(createElement(Notice, null, 'Body'))
		expect(plain).not.toContain('aria-label="Dismiss"')
		expect(plain).toContain('p-4')
	})
})
