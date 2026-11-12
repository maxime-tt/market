import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@ui/primitives/tooltip'
import { AuctionBidderView, type AuctionBidderViewProps } from './auction-bidder-views'

/**
 * `TooltipToggleGroupItem` renders through the Radix tooltip, which needs its
 * provider (the app root and the widget-book catalogue both mount one), so the
 * SSR render wraps the panel in the same provider.
 */
const renderPanel = (overrides: Partial<AuctionBidderViewProps>): string => {
	const props: AuctionBidderViewProps = {
		compact: false,
		ended: false,
		notStarted: false,
		isOwnAuction: false,
		hasSignedInBidder: true,
		inCurveWindow: false,
		curveShape: 'none',
		curvePeakMultiplier: 2,
		minBid: 10_000,
		bidStep: 1_000,
		showMintSelector: true,
		availableMints: [
			{ mintUrl: 'https://mint.example', hostname: 'mint.example', balance: 12_000, hasSufficientBalance: true },
			{ mintUrl: 'https://mint.two.example', hostname: 'mint.two.example', balance: 40_000, hasSufficientBalance: false },
		],
		selectedMint: 'https://mint.example',
		onSelectMint: () => {},
		isDisabledInput: false,
		isDisabledBid: false,
		bidAmountInput: '10000',
		onBidAmountChange: () => {},
		onBidAmountPaste: () => {},
		buttonText: 'Place Bid',
		onSubmitBid: () => {},
		onOpenRules: () => {},
		...overrides,
	}
	return renderToStaticMarkup(
		<TooltipProvider>
			<AuctionBidderView {...props} />
		</TooltipProvider>,
	)
}

describe('AuctionBidderView', () => {
	test('renders the panel shell with the bid input, the mint selector and the minimum-bid info', () => {
		const markup = renderPanel({})
		expect(markup).toContain('data-testid="auction-bidder"')
		expect(markup).toContain('type="number"')
		expect(markup).toContain('value="10000"')
		expect(markup).toContain('placeholder="Min: 10,000"')
		expect(markup).toContain('Mint:')
		expect(markup).toContain('mint.example')
		expect(markup).toContain('Minimum allowed bid: 10,000 sats')
		expect(markup).toContain('Review auction rules')
		expect(markup).toContain('Place Bid')
	})

	test('hides the amount input, the mint selector and the minimum-bid info in compact mode', () => {
		const markup = renderPanel({ compact: true, buttonText: 'Bid 10,000 sats' })
		expect(markup).toContain('data-testid="auction-bidder"')
		expect(markup).not.toContain('type="number"')
		expect(markup).not.toContain('Mint:')
		expect(markup).not.toContain('Minimum allowed bid:')
		expect(markup).toContain('Bid 10,000 sats')
	})

	test('renders the anti-snipe banner only inside the curve window with a non-none shape', () => {
		const inWindow = renderPanel({ inCurveWindow: true, curveShape: 'linear', curvePeakMultiplier: 2 })
		expect(inWindow).toContain('Anti-snipe window — minimum bid rising')
		expect(inWindow).toContain('2× by then')
		expect(inWindow).toContain('Floor right now:')
		expect(inWindow).toContain('10,000 sats')

		const outsideWindow = renderPanel({ inCurveWindow: false, curveShape: 'linear', curvePeakMultiplier: 2 })
		expect(outsideWindow).not.toContain('Anti-snipe window')

		const flatCurve = renderPanel({ inCurveWindow: true, curveShape: 'none', curvePeakMultiplier: 2 })
		expect(flatCurve).not.toContain('Anti-snipe window')
	})

	test('the lower-bound gate disables the bid control before start_at', () => {
		const markup = renderPanel({ notStarted: true, isDisabledBid: true, buttonText: 'Bidding not started' })
		expect(markup).toContain('Bidding not started')
		expect(markup).toContain('disabled')
		expect(markup).toContain('Minimum allowed bid: 10,000 sats')
	})

	test('the ended state hides the minimum-bid info and disables the bid control', () => {
		const markup = renderPanel({ ended: true, isDisabledInput: true, isDisabledBid: true, buttonText: 'Auction Ended' })
		expect(markup).toContain('Auction Ended')
		expect(markup).not.toContain('Minimum allowed bid:')
	})

	test('marks an underfunded mint option as disabled in the selector', () => {
		const markup = renderPanel({})
		expect(markup).toContain('mint.two.example')
		// The option with an insufficient balance renders disabled and dimmed.
		expect(markup).toContain('opacity-60')
	})

	test('hides the rules link for the own auction and the signed-out bidder', () => {
		expect(renderPanel({ isOwnAuction: true })).not.toContain('Review auction rules')
		expect(renderPanel({ hasSignedInBidder: false, buttonText: 'Sign in to bid' })).not.toContain('Review auction rules')
	})
})
