import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailField } from './detail-field'

describe('DetailField', () => {
	test('renders label, value, and helper with the legacy end alignment', () => {
		const markup = renderToStaticMarkup(<DetailField label="Total" value="2,100 sats" helper="includes shipping" />)
		expect(markup).toContain('flex items-start gap-2 text-sm')
		expect(markup).toContain('justify-between')
		expect(markup).toContain('Total')
		expect(markup).toContain('2,100 sats')
		expect(markup).toContain('includes shipping')
	})

	test('start alignment stacks the label over the value', () => {
		const markup = renderToStaticMarkup(<DetailField label="Total" value="2,100 sats" align="start" />)
		expect(markup).toContain('flex-col')
		expect(markup).toContain('w-full')
		expect(markup).not.toContain('justify-between')
	})

	test('merges host, label, and value classNames', () => {
		const markup = renderToStaticMarkup(
			<DetailField label="Total" value="1" className="row" labelClassName="uppercase" valueClassName="font-bold" />,
		)
		expect(markup).toContain('row')
		expect(markup).toContain('uppercase')
		expect(markup).toContain('font-bold')
	})
})
