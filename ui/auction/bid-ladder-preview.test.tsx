import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BidLadderPreview } from './bid-ladder-preview'

/**
 * `BidLadderViz` was lifted out of the `auction-editor` monolith and renamed
 * `BidLadderPreview` in T6.3 S3. The suite has no DOM renderer, so the component
 * is asserted through its server-rendered markup — which is what "behaviour
 * unchanged" means here: same branches, same structure, same copy.
 *
 * The root elements now route their own classes through `cn()`, so the suite
 * pins the parts `cn()` could silently disturb: the geometry/spacing utilities
 * that surround the palette, and the tick count (the `w-px` lanes) the ladder
 * derives from the reserve. The palette itself is untouched by this slice and is
 * proven verbatim against the monolith instead — a raw class string in a
 * `*.test.*` file is itself guard-counted debt (`raw-palette-test`), so these
 * assertions deliberately carry none.
 */
const noLanes = (markup: string) => (markup.match(/w-px/g) ?? []).length

describe('BidLadderPreview', () => {
	test('asks for the two inputs it needs instead of charting them', () => {
		const noStart = renderToStaticMarkup(<BidLadderPreview startingBid={Number.NaN} bidIncrement={100} reserve={0} />)
		expect(noStart).toContain('Enter a starting bid and bid increment to preview the bid ladder.')
		expect(noStart).toContain('class="rounded-lg border border-dashed')
		expect(noStart).not.toContain('Bid ladder preview')
		expect(noLanes(noStart)).toBe(0)

		const noIncrement = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={0} reserve={0} />)
		expect(noIncrement).toContain('Enter a starting bid and bid increment to preview the bid ladder.')
	})

	test('renders the sats-only ladder with its root utilities intact', () => {
		const markup = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={100} reserve={0} />)
		expect(markup).toContain('class="rounded-lg border ')
		expect(markup).toContain(' px-4 py-4"')
		expect(markup).not.toContain('border-dashed')
		expect(markup).toContain('Bid ladder preview')
		expect(markup).toContain('1,000 sats')
		expect(markup).toContain('+100')
		expect(markup).toContain('Starting bid')
		expect(markup).toContain('per bid')
	})

	test('shows the no-reserve column when the reserve does not clear the starting bid', () => {
		const markup = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={100} reserve={1000} />)
		expect(markup).toContain('No reserve')
		expect(markup).toContain('Highest bid wins')
		expect(markup).not.toContain('needed to clear the reserve')
		expect(noLanes(markup)).toBe(0)
	})

	test('shows the reserve column and the bids needed to clear it', () => {
		const markup = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={100} reserve={1500} />)
		expect(markup).toContain('1,500 sats')
		expect(markup).toContain('Reserve')
		expect(markup).toContain('needed to clear the reserve')
		expect(markup).toContain('>5</span> bids of')
		expect(noLanes(markup)).toBe(5)
	})

	test('pluralises a single bid to reserve', () => {
		const markup = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={500} reserve={1500} />)
		expect(markup).toContain('>1</span> bid of')
		expect(markup).not.toContain('>1</span> bids')
		expect(noLanes(markup)).toBe(1)
	})

	test('caps the ladder at 24 lanes however far away the reserve is', () => {
		const markup = renderToStaticMarkup(<BidLadderPreview startingBid={1} bidIncrement={1} reserve={1_000_000} />)
		expect(noLanes(markup)).toBe(24)
		// The lanes are capped; the "bids to clear" count is the true figure.
		expect(markup).toContain('>999999</span> bids of')
	})

	test('merges a host className without dropping or reordering its own', () => {
		const markup = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={100} reserve={0} className="mt-2" />)
		expect(markup).toContain(' px-4 py-4 mt-2"')
		expect(markup).toContain('rounded-lg')
	})

	test('accepts the ref prop without altering the rendered markup', () => {
		// Server rendering does not invoke refs, so this pins the prop contract
		// (React 19 ref-as-prop) rather than the attachment itself.
		const withRef = renderToStaticMarkup(<BidLadderPreview startingBid={1000} bidIncrement={100} reserve={0} ref={null} />)
		expect(withRef).toContain(' px-4 py-4"')
	})
})
