import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AntiSnipeCurveSettings } from './anti-snipe-curve-settings'

/**
 * `AntiSnipeCurveSettings` moved out of the `auction-editor` monolith in T6.3 S4.
 * The unit suite has no DOM renderer, so the card is asserted through its
 * server-rendered markup — which is what "behaviour unchanged" means here: the
 * same branches, the same copy, the same gating of the curve controls.
 *
 * The root element routes its own classes through `cn()` now, so the suite pins
 * the parts `cn()` could silently disturb (the geometry/spacing utilities around
 * the palette) rather than the palette itself — a raw class string in a
 * `*.test.*` file is itself guard-counted debt (`raw-palette-test`). The palette
 * is proven verbatim against the monolith instead.
 *
 * The `onFormPatch` wiring has no server-rendered signal, so it is proven in the
 * widget-book spec against an interactive demo (click the switch/window/shape
 * buttons and observe the state move) — not asserted vacuously here.
 */
const noop = () => {}

const base = {
	startAtSeconds: 1_760_000_000,
	endAtSeconds: 1_760_086_400,
	maxEndAtSeconds: 1_760_090_000,
	settlementGraceSeconds: 86_400,
	startingBid: 1000,
	bidIncrement: 50,
	reserve: 0,
	onFormPatch: noop,
}

/** React renders a true boolean attribute as `disabled=""`. */
const disabledCount = (markup: string) => (markup.match(/disabled=""/g) ?? []).length

describe('AntiSnipeCurveSettings', () => {
	test('gates the curve controls behind a window and explains why', () => {
		const markup = renderToStaticMarkup(
			<AntiSnipeCurveSettings {...base} antiSnipeWindowMinutes={0} minBidCurveShape="none" minBidCurvePeakMultiplier={2} />,
		)
		expect(markup).toContain('class="grid w-full gap-3 rounded-lg border ')
		expect(markup).toContain(' px-4 py-4"')
		expect(markup).toContain('Anti-snipe')
		expect(markup).toContain('data-slot="switch"')
		expect(markup).toContain('data-state="unchecked"')
		expect(markup).toContain('>Off</span>')
		expect(markup).toContain('>On</span>')
		expect(markup).toContain('Anti-snipe protection window')
		expect(markup).toContain('No window')
		expect(markup).toContain('5 min')
		expect(markup).toContain('15 min')
		expect(markup).toContain('30 min')
		expect(markup).toContain('Bid curve')
		expect(markup).toContain('Multiplier')
		// The shape buttons (3) and the multiplier buttons (3) are both gated on
		// a window; nothing else on the card is disabled.
		expect(disabledCount(markup)).toBe(6)
		expect(markup).toContain('Pick a window above to enable the curve.')
		expect(markup).not.toContain('the floor when the anti-snipe ramp begins')
		// The timeline preview is composed inside the card.
		expect(markup).toContain('Bidding timeline')
	})

	test('enables every control once a window and a shape are set', () => {
		const markup = renderToStaticMarkup(
			<AntiSnipeCurveSettings {...base} antiSnipeWindowMinutes={15} minBidCurveShape="linear" minBidCurvePeakMultiplier={5} />,
		)
		expect(markup).toContain('data-state="checked"')
		expect(disabledCount(markup)).toBe(0)
		expect(markup).not.toContain('Pick a window above to enable the curve.')
		expect(markup).toContain('Floor at auction end will be 5× the floor when the anti-snipe ramp begins.')
	})

	test('gates only the multiplier when the shape is none', () => {
		const markup = renderToStaticMarkup(
			<AntiSnipeCurveSettings {...base} antiSnipeWindowMinutes={5} minBidCurveShape="none" minBidCurvePeakMultiplier={2} />,
		)
		// A window is set, so the switch reads on and the shape buttons are live;
		// only the three multiplier buttons stay disabled.
		expect(markup).toContain('data-state="checked"')
		expect(disabledCount(markup)).toBe(3)
		expect(markup).not.toContain('Pick a window above to enable the curve.')
		expect(markup).not.toContain('the floor when the anti-snipe ramp begins')
	})

	test('renders the shape and peak presets verbatim', () => {
		const markup = renderToStaticMarkup(
			<AntiSnipeCurveSettings {...base} antiSnipeWindowMinutes={5} minBidCurveShape="linear" minBidCurvePeakMultiplier={2} />,
		)
		for (const copy of ['None', 'Linear', 'Exponential', 'flat floor', 'straight ramp', 'steep finish', '2×', '5×', '10×']) {
			expect(markup).toContain(copy)
		}
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(
			<AntiSnipeCurveSettings
				{...base}
				antiSnipeWindowMinutes={0}
				minBidCurveShape="none"
				minBidCurvePeakMultiplier={2}
				className="mt-2"
			/>,
		)
		expect(markup).toContain(' px-4 py-4 mt-2"')
		expect(markup).toContain('rounded-lg')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		// Server rendering does not invoke refs, so this pins the prop contract
		// (React 19 ref-as-prop) rather than the attachment itself.
		const withRef = renderToStaticMarkup(
			<AntiSnipeCurveSettings {...base} antiSnipeWindowMinutes={0} minBidCurveShape="none" minBidCurvePeakMultiplier={2} ref={null} />,
		)
		expect(withRef).toContain(' px-4 py-4"')
	})
})
