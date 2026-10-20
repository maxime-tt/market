import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatCard } from './stat-card'

describe('StatCard', () => {
	test('renders the label, value, and optional helper on the card surface', () => {
		const markup = renderToStaticMarkup(<StatCard label="Revenue" value="12,000 sats" helper="Last 30 days" />)
		expect(markup).toContain('data-slot="stat-card"')
		expect(markup).toContain('bg-card')
		expect(markup).toContain('Revenue')
		expect(markup).toContain('12,000 sats')
		expect(markup).toContain('Last 30 days')
	})

	test('maps trend to success/destructive/muted value tokens', () => {
		expect(renderToStaticMarkup(<StatCard label="Up" value="1" trend="up" />)).toContain(
			'<p class="text-2xl font-medium text-success">1</p>',
		)
		expect(renderToStaticMarkup(<StatCard label="Down" value="1" trend="down" />)).toContain(
			'<p class="text-2xl font-medium text-destructive">1</p>',
		)
		expect(renderToStaticMarkup(<StatCard label="Flat" value="1" trend="flat" />)).toContain(
			'<p class="text-2xl font-medium text-muted-foreground">1</p>',
		)
		expect(renderToStaticMarkup(<StatCard label="None" value="1" />)).toContain('<p class="text-2xl font-medium">1</p>')
	})

	test('merges host className', () => {
		expect(renderToStaticMarkup(<StatCard label="Revenue" value="1" className="col-span-2" />)).toContain('col-span-2')
	})
})
