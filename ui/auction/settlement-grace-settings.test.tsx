import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettlementGraceSettings } from './settlement-grace-settings'

/**
 * `SettlementGraceSettings` moved out of the `auction-editor` monolith in T6.3
 * S4. The unit suite has no DOM renderer, so the card is asserted through its
 * server-rendered markup: the same three presets, the same copy, the same
 * button structure. The palette is proven verbatim against the monolith rather
 * than quoted here — a raw class string in a `*.test.*` file is itself
 * guard-counted debt (`raw-palette-test`).
 *
 * The selected-vs-active wiring has no server-rendered, palette-free signal, so
 * it is proven in the widget-book spec against an interactive demo that clicks a
 * preset and observes the active choice move.
 */
const noop = () => {}

describe('SettlementGraceSettings', () => {
	test('renders the three grace presets with their copy', () => {
		const markup = renderToStaticMarkup(<SettlementGraceSettings value="1h" onValueChange={noop} />)
		expect(markup).toContain('class="grid w-full gap-3 rounded-lg border ')
		expect(markup).toContain(' px-4 py-4"')
		expect(markup).toContain('Settlement grace')
		expect(markup).toContain('publish the settlement before losing bidders can reclaim their funds.')
		expect(markup).toContain('same locktime regardless of how many bids land.')
		for (const copy of ['5 min', '1 hour', '3 hours', 'tight, mint must be reliable', 'recommended', 'safest for losers']) {
			expect(markup).toContain(copy)
		}
		expect((markup.match(/<button/g) ?? []).length).toBe(3)
	})

	test('renders the same three presets whatever the selection is', () => {
		const five = renderToStaticMarkup(<SettlementGraceSettings value="5min" onValueChange={noop} />)
		const three = renderToStaticMarkup(<SettlementGraceSettings value="3h" onValueChange={noop} />)
		for (const markup of [five, three]) {
			expect((markup.match(/<button/g) ?? []).length).toBe(3)
			expect(markup).toContain('5 min')
			expect(markup).toContain('1 hour')
			expect(markup).toContain('3 hours')
		}
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(<SettlementGraceSettings value="1h" onValueChange={noop} className="mt-2" />)
		expect(markup).toContain(' px-4 py-4 mt-2"')
		expect(markup).toContain('rounded-lg')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		const withRef = renderToStaticMarkup(<SettlementGraceSettings value="1h" onValueChange={noop} ref={null} />)
		expect(withRef).toContain(' px-4 py-4"')
	})
})
