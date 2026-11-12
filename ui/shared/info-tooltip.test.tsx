import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfoTooltip } from './info-tooltip'

/**
 * `TooltipContent` is portalled (Radix renders it to `document.body`), so
 * static markup cannot observe it — the assertions cover the trigger, which is
 * the part that carries the accessible name and the colour contract.
 */
describe('InfoTooltip', () => {
	test('renders an accessible trigger button', () => {
		const markup = renderToStaticMarkup(<InfoTooltip content="Explains the control" />)
		expect(markup).toContain('aria-label="More information"')
		expect(markup).toContain('type="button"')
	})

	test('uses the semantic text tokens rather than the legacy raw grey', () => {
		const markup = renderToStaticMarkup(<InfoTooltip content="Explains the control" />)
		expect(markup).toContain('text-text-mid')
		expect(markup).toContain('hover:text-text-high')
		expect(markup).not.toContain('text-gray-')
	})

	test('merges a host className without dropping its own', () => {
		const markup = renderToStaticMarkup(<InfoTooltip content="Explains the control" className="ml-2" />)
		expect(markup).toContain('ml-2')
		expect(markup).toContain('rounded-full')
		expect(markup).toContain('w-5')
	})
})
