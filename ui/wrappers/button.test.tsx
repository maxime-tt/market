import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from './button'

describe('Button (wrapper)', () => {
	test('renders the primitive with the caller children and no pending state', () => {
		const markup = renderToStaticMarkup(<Button variant="outline">Save</Button>)
		expect(markup).toContain('data-slot="button"')
		expect(markup).toContain('data-variant="outline"')
		expect(markup).toContain('data-pending="false"')
		expect(markup).toContain('Save')
		// Nothing pending: no spinner, no disabled, no busy state.
		expect(markup).not.toContain('data-slot="button-spinner"')
		// The base class list contains `disabled:` variants, so assert the attribute.
		expect(markup).not.toContain('disabled=""')
		expect(markup).not.toContain('aria-busy')
	})

	test('pending shows the spinner, disables the button and marks it busy', () => {
		const markup = renderToStaticMarkup(<Button pending>Saving</Button>)
		expect(markup).toContain('data-slot="button-spinner"')
		expect(markup).toContain('data-pending="true"')
		expect(markup).toContain('disabled=""')
		expect(markup).toContain('aria-busy="true"')
		expect(markup).toContain('Saving')
	})

	test('the spinner is aria-hidden so it cannot rename the button', () => {
		const markup = renderToStaticMarkup(<Button pending>Add</Button>)
		expect(markup).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-slot="button-spinner"/)
		// And the visible label is still the whole accessible name candidate.
		expect(markup).toContain('>Add</button>')
	})

	test('places the spinner after the label when asked', () => {
		const start = renderToStaticMarkup(<Button pending>Go</Button>)
		expect(start.indexOf('data-slot="button-spinner"')).toBeLessThan(start.indexOf('Go'))

		const end = renderToStaticMarkup(
			<Button pending pendingPosition="end">
				Go
			</Button>,
		)
		expect(end.indexOf('data-slot="button-spinner"')).toBeGreaterThan(end.indexOf('Go'))
	})

	test('preserves an explicit disabled prop', () => {
		expect(renderToStaticMarkup(<Button disabled>Save</Button>)).toContain('disabled=""')
	})

	test('merges host className through the primitive', () => {
		expect(renderToStaticMarkup(<Button className="col-span-2">Save</Button>)).toContain('col-span-2')
	})
})
