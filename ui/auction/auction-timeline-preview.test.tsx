import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionTimelinePreview } from './auction-timeline-preview'
import { formatAbsoluteCompact } from '../utils/duration'

/**
 * The time-axis preview moved out of the `auction-editor` monolith in T6.3 S3.
 * It now consumes `formatAbsoluteCompact` from `ui/utils/duration` (created in
 * S1) instead of a local copy; the tick-label assertions below pin that wiring
 * by deriving the expected label from the same helper the component uses.
 *
 * The chart is deliberately symbolic (fixed segment widths, not real time), so
 * the assertions are about branches, tick counts and labels — never about pixel
 * geometry or palette. A raw class string in a `*.test.*` file is itself
 * guard-counted debt (`raw-palette-test`), so this suite carries none.
 */
const START = 1_760_000_000
const END = 1_760_086_400
const MAX_END = 1_760_090_000
const GRACE = 86_400

const base = {
	startingBid: 1000,
	bidIncrement: 100,
	reserve: 0,
	curveShape: 'linear' as const,
	curvePeakMultiplier: 2,
	startAtSeconds: START,
	endAtSeconds: END,
	maxEndAtSeconds: END,
	settlementGraceSeconds: GRACE,
	showCurve: false,
}

const guides = (markup: string) => (markup.match(/stroke-dasharray="0\.6 0\.6"/g) ?? []).length

describe('AuctionTimelinePreview', () => {
	test('asks for an end time instead of charting an unbounded auction', () => {
		const markup = renderToStaticMarkup(<AuctionTimelinePreview {...base} endAtSeconds={0} />)
		expect(markup).toContain('Pick an end time to preview the bidding timeline.')
		expect(markup).toContain('class="mt-3 rounded-md border border-dashed')
		expect(markup).not.toContain('<svg')

		// The same guard covers a start time that has not been resolved yet
		// (`!endAtSeconds || !startAtSeconds`).
		const noStart = renderToStaticMarkup(<AuctionTimelinePreview {...base} startAtSeconds={0} />)
		expect(noStart).toContain('Pick an end time to preview the bidding timeline.')
		expect(noStart).not.toContain('<svg')
	})

	test('charts the flat auction when no anti-snipe window is set', () => {
		const markup = renderToStaticMarkup(<AuctionTimelinePreview {...base} />)
		expect(markup).toContain('class="mt-3 rounded-md border ')
		expect(markup).toContain(' px-3 py-3"')
		expect(markup).not.toContain('border-dashed')
		expect(markup).toContain('Bidding timeline')
		expect(markup).toContain('>start</span>')
		expect(markup).toContain('>auction end</span>')
		expect(markup).toContain('>locktime</span>')
		expect(markup).toContain('segments aren&#x27;t to scale')
		// No window: the mid label stays "auction end", the floor line is flat,
		// three ticks, and no curve phase exists.
		expect(markup).not.toContain('>ramp begins</span>')
		expect(markup).toContain('Floor when ')
		expect(markup).toContain('>auction ends</span>')
		expect(markup).not.toContain('<path')
		expect(guides(markup)).toBe(3)
		// baseline = starting bid + increment; no curve, so both floors agree.
		expect((markup.match(/1,100 sats/g) ?? []).length).toBe(2)
	})

	test('labels every tick with the compact time from ui/utils/duration', () => {
		const markup = renderToStaticMarkup(<AuctionTimelinePreview {...base} />)
		expect(markup).toContain(formatAbsoluteCompact(START))
		expect(markup).toContain(formatAbsoluteCompact(END))
		expect(markup).toContain(formatAbsoluteCompact(END + GRACE))
	})

	test('draws the anti-snipe ramp and its peak when a window and a curve are on', () => {
		const markup = renderToStaticMarkup(
			<AuctionTimelinePreview {...base} maxEndAtSeconds={MAX_END} showCurve curveShape="exponential" curvePeakMultiplier={5} />,
		)
		expect(markup).toContain('>ramp begins</span>')
		expect(markup).toContain('anti-snipe ramp begins')
		expect(markup).toContain('<path')
		expect(markup).toContain('(5×, exponential)')
		expect(markup).toContain('Floor at ')
		// A window adds the fourth tick; the peak floor is baseline × multiplier.
		expect(guides(markup)).toBe(4)
		expect(markup).toContain('5,500 sats')
		expect(markup).toContain(formatAbsoluteCompact(MAX_END))
	})

	test('falls back to a flat dashed segment when the shape is off but a window exists', () => {
		const markup = renderToStaticMarkup(<AuctionTimelinePreview {...base} maxEndAtSeconds={MAX_END} />)
		expect(markup).toContain('>ramp begins</span>')
		expect(markup).toContain('(no curve)')
		expect(markup).not.toContain('<path')
		expect(guides(markup)).toBe(4)
		// No curve: the settlement segment sits at the flat floor, so both floors agree.
		expect((markup.match(/1,100 sats/g) ?? []).length).toBe(2)
	})

	test('derives the preview top bid and the floor from the reserve when one is set', () => {
		const withReserve = renderToStaticMarkup(<AuctionTimelinePreview {...base} reserve={5000} />)
		expect(withReserve).toContain('(from reserve)')
		expect(withReserve).toContain('5,000 sats')
		// baseline = reserve + increment.
		expect((withReserve.match(/5,100 sats/g) ?? []).length).toBe(2)

		const noReserve = renderToStaticMarkup(<AuctionTimelinePreview {...base} />)
		expect(noReserve).toContain('(no reserve, using starting bid)')
		// baseline = starting bid + increment.
		expect(noReserve).toContain('1,100 sats')
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(<AuctionTimelinePreview {...base} className="mt-4" />)
		expect(markup).toContain(' px-3 py-3 mt-4"')
		expect(markup).toContain('rounded-md')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		// Server rendering does not invoke refs; this pins the prop contract
		// (React 19 ref-as-prop) rather than the attachment itself.
		const withRef = renderToStaticMarkup(<AuctionTimelinePreview {...base} ref={null} />)
		expect(withRef).toContain(' px-3 py-3"')
	})
})
