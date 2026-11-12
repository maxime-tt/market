import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusBadge, type StatusTone } from './status-badge'

const TONE_CLASS: Record<StatusTone, string> = {
	neutral: 'bg-surface-sunken',
	info: 'bg-info-muted',
	warning: 'bg-warning-muted',
	error: 'bg-error-muted',
	success: 'bg-success-muted',
}

describe('StatusBadge', () => {
	test('renders the status as the default label with the neutral tone', () => {
		const markup = renderToStaticMarkup(createElement(StatusBadge, { status: 'draft' }))
		expect(markup).toContain('data-slot="status-badge"')
		expect(markup).toContain('data-tone="neutral"')
		expect(markup).toContain('bg-surface-sunken')
		expect(markup).toContain('text-text-mid')
		expect(markup).toContain('draft')
	})

	test('accepts a label override without losing the status', () => {
		const markup = renderToStaticMarkup(createElement(StatusBadge, { status: 'paid', label: 'Paid in full' }))
		expect(markup).toContain('Paid in full')
		expect(markup).not.toContain('>paid<')
	})

	for (const tone of Object.keys(TONE_CLASS) as StatusTone[]) {
		test(`renders the ${tone} tone with its token palette`, () => {
			const markup = renderToStaticMarkup(createElement(StatusBadge, { status: tone, tone }))
			expect(markup).toContain(`data-tone="${tone}"`)
			expect(markup).toContain(TONE_CLASS[tone])
		})
	}

	test('merges a host className', () => {
		const markup = renderToStaticMarkup(createElement(StatusBadge, { status: 'draft', className: 'host-badge' }))
		expect(markup).toContain('host-badge')
	})
})
