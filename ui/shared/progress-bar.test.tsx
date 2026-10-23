import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ProgressBar from './progress-bar'

describe('ProgressBar', () => {
	test('renders the label overlay when one is given', () => {
		const markup = renderToStaticMarkup(<ProgressBar progress={0.64} label="64%" />)
		expect(markup).toContain('64%')
		expect(markup).toContain('absolute inset-0')
	})

	test('omits the label overlay when none is given', () => {
		expect(renderToStaticMarkup(<ProgressBar progress={0.5} />)).not.toContain('absolute inset-0')
	})

	test('clamps progress into the 0-100 per cent range', () => {
		expect(renderToStaticMarkup(<ProgressBar progress={2} />)).toMatch(/width:\s*100%/)
		expect(renderToStaticMarkup(<ProgressBar progress={-1} />)).toMatch(/width:\s*0%/)
		expect(renderToStaticMarkup(<ProgressBar progress={0.5} />)).toMatch(/width:\s*50%/)
	})

	test('merges a host className onto the bar element', () => {
		expect(renderToStaticMarkup(<ProgressBar progress={0.5} className="mt-4" />)).toContain('mt-4')
	})

	test('accepts a caller-supplied bar colour', () => {
		const markup = renderToStaticMarkup(<ProgressBar progress={0.5} color="#ff0000" />)
		expect(markup).toContain('#ff0000')
	})

	test('switches the label ink with textOnDark', () => {
		expect(renderToStaticMarkup(<ProgressBar progress={0.5} label="x" textOnDark />)).toContain('text-white')
		expect(renderToStaticMarkup(<ProgressBar progress={0.5} label="x" textOnDark={false} />)).toContain('text-tertiary-black')
	})
})
