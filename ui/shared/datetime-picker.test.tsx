import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DateTimePicker } from './datetime-picker'

const noop = () => {}

/**
 * The unit suite has no DOM renderer, so `DateTimePicker` is asserted through its
 * server-rendered trigger. The popover content (calendar + time field) is
 * deliberately unmounted at rest — that is the same "closed at rest" contract
 * every popover-based widget-book entry relies on — so these tests also pin the
 * default-closed state.
 */
describe('DateTimePicker', () => {
	test('shows the default placeholder for an empty value', () => {
		const markup = renderToStaticMarkup(<DateTimePicker value="" onChange={noop} />)
		expect(markup).toContain('Pick a date &amp; time')
	})

	test('honours a caller placeholder', () => {
		const markup = renderToStaticMarkup(<DateTimePicker value="" onChange={noop} placeholder="Pick a start date & time" />)
		expect(markup).toContain('Pick a start date &amp; time')
	})

	test('renders the formatted instant instead of the placeholder when a value is set', () => {
		const value = '2026-10-24T15:30'
		const markup = renderToStaticMarkup(<DateTimePicker value={value} onChange={noop} />)
		expect(markup).toContain(new Date(value).toLocaleString())
		expect(markup).not.toContain('Pick a date')
	})

	test('triggers an outlined button that reports the popover as closed', () => {
		const markup = renderToStaticMarkup(<DateTimePicker value="" onChange={noop} />)
		expect(markup).toContain('data-slot="popover-trigger"')
		expect(markup).toContain('data-variant="outline"')
		expect(markup).toContain('aria-haspopup="dialog"')
		expect(markup).toContain('aria-expanded="false"')
	})

	test('renders the calendar affordance as an icon', () => {
		const markup = renderToStaticMarkup(<DateTimePicker value="" onChange={noop} />)
		expect(markup).toContain('lucide-calendar')
	})
})
