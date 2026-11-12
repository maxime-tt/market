import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	AuctionDetailCard,
	AuctionPartyCard,
	AuctionSettlementBadge,
	AuctionStatusBadge,
	AuctionTechnicalRow,
	getAuctionStatusTone,
	getSettlementStatusCopy,
} from './auction-detail-views'

describe('getAuctionStatusTone', () => {
	test('maps the lifecycle status to a semantic tone', () => {
		expect(getAuctionStatusTone('Live')).toBe('success')
		expect(getAuctionStatusTone('Scheduled')).toBe('info')
		expect(getAuctionStatusTone('Settlement')).toBe('info')
		expect(getAuctionStatusTone('Ended')).toBe('neutral')
	})

	test('falls back to neutral for an unknown status', () => {
		expect(getAuctionStatusTone('Something else')).toBe('neutral')
	})
})

describe('getSettlementStatusCopy', () => {
	test('maps published settlement states', () => {
		expect(getSettlementStatusCopy('settled')).toEqual({ label: 'settled', tone: 'success' })
		expect(getSettlementStatusCopy('reserve_not_met')).toEqual({ label: 'reserve not met', tone: 'warning' })
		expect(getSettlementStatusCopy('cancelled')).toEqual({ label: 'cancelled', tone: 'error' })
		expect(getSettlementStatusCopy('unknown')).toEqual({ label: 'unknown', tone: 'neutral' })
	})

	test('maps the derived pre-settlement states', () => {
		expect(getSettlementStatusCopy('ready')).toEqual({ label: 'Ready to settle', tone: 'warning' })
		expect(getSettlementStatusCopy('awaiting')).toEqual({ label: 'Awaiting close', tone: 'info' })
	})

	test('falls back to the unknown copy', () => {
		expect(getSettlementStatusCopy('nonsense')).toEqual({ label: 'unknown', tone: 'neutral' })
	})
})

describe('AuctionStatusBadge', () => {
	test('renders the status label and tone', () => {
		const markup = renderToStaticMarkup(<AuctionStatusBadge status="Live" />)
		expect(markup).toContain('data-slot="status-badge"')
		expect(markup).toContain('data-tone="success"')
		expect(markup).toContain('Live')
	})

	test('merges host className', () => {
		expect(renderToStaticMarkup(<AuctionStatusBadge status="Ended" className="ml-2" />)).toContain('ml-2')
	})
})

describe('AuctionSettlementBadge', () => {
	test('renders the mapped copy for each display state', () => {
		expect(renderToStaticMarkup(<AuctionSettlementBadge state="ready" />)).toContain('Ready to settle')
		expect(renderToStaticMarkup(<AuctionSettlementBadge state="settled" />)).toContain('data-tone="success"')
	})
})

describe('AuctionDetailCard', () => {
	test('renders label, value and helper on a bordered card', () => {
		const markup = renderToStaticMarkup(<AuctionDetailCard label="Auction type" value="English" helper="Primary format" />)
		expect(markup).toContain('data-slot="auction-detail-card"')
		expect(markup).toContain('border-border-default')
		expect(markup).toContain('Auction type')
		expect(markup).toContain('English')
		expect(markup).toContain('Primary format')
	})

	test('accepts a node value and a node helper', () => {
		const markup = renderToStaticMarkup(
			<AuctionDetailCard label="Final amount" value={<strong>12,000 sats</strong>} helper={<em>includes shipping</em>} />,
		)
		expect(markup).toContain('<strong>12,000 sats</strong>')
		expect(markup).toContain('<em>includes shipping</em>')
	})

	test('merges host className', () => {
		expect(renderToStaticMarkup(<AuctionDetailCard label="L" value="V" className="col-span-2" />)).toContain('col-span-2')
	})
})

describe('AuctionPartyCard', () => {
	test('renders the label and the injected identity node', () => {
		const markup = renderToStaticMarkup(<AuctionPartyCard label="Seller" helper="You" identity={<span>satoshi</span>} />)
		expect(markup).toContain('data-slot="auction-party-card"')
		expect(markup).toContain('Seller')
		expect(markup).toContain('satoshi')
		expect(markup).toContain('You')
	})

	test('omits the helper when not supplied', () => {
		const markup = renderToStaticMarkup(<AuctionPartyCard label="Winner" identity={<span>satoshi</span>} />)
		expect(markup).not.toContain('mt-1 text-xs text-text-mid')
	})
})

describe('AuctionTechnicalRow', () => {
	test('renders the label and value and falls back to N/A', () => {
		const markup = renderToStaticMarkup(<AuctionTechnicalRow label="Schema" value="" />)
		expect(markup).toContain('data-slot="auction-technical-row"')
		expect(markup).toContain('Schema')
		expect(markup).toContain('N/A')
	})

	test('renders a copy control only when copyValue is supplied', () => {
		const copyable = renderToStaticMarkup(<AuctionTechnicalRow label="Bid event ID" value="abc" copyValue="abc" />)
		expect(copyable).toContain('data-slot="copy-button"')
		expect(copyable).toContain('aria-label="Copy Bid event ID"')

		const plain = renderToStaticMarkup(<AuctionTechnicalRow label="Key scheme" value="hd_p2pk" />)
		expect(plain).not.toContain('data-slot="copy-button"')
	})

	test('reports a copy failure with the row label', () => {
		const seen: Array<[string, unknown]> = []
		const markup = renderToStaticMarkup(
			<AuctionTechnicalRow label="Bid event ID" value="abc" copyValue="abc" onCopyError={(label, error) => seen.push([label, error])} />,
		)
		expect(markup).toContain('data-slot="copy-button"')
	})

	test('stacks the value under the label in stacked mode', () => {
		expect(renderToStaticMarkup(<AuctionTechnicalRow label="Trusted mints" value={'a\nb'} stacked />)).toContain('whitespace-pre-wrap')
	})

	test('merges host className', () => {
		expect(renderToStaticMarkup(<AuctionTechnicalRow label="L" value="V" className="mt-2" />)).toContain('mt-2')
	})
})
