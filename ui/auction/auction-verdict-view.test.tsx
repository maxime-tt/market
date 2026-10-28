import { describe, expect, test } from 'bun:test'
import type { ParsedValidatorVerdictEvent } from '@sdk/commerce/auctions/events'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuctionVerdictView } from './auction-verdict-view'

const VALIDATOR_PUBKEY = 'a'.repeat(64)
const BIDDER_PUBKEY = 'b'.repeat(64)

const renderAvatar = (pubkey: string) => <span data-slot="verdict-avatar">{pubkey.slice(0, 1)}</span>

const verdictFixture = (claim: ParsedValidatorVerdictEvent['claim'], overrides: Partial<ParsedValidatorVerdictEvent> = {}) =>
	({
		rawEvent: { id: 'verdict-1', pubkey: VALIDATOR_PUBKEY, kind: 30440, created_at: 1_760_000_000, content: '', tags: [] },
		id: 'verdict-1',
		validatorPubkey: VALIDATOR_PUBKEY,
		createdAt: 1_760_000_000,
		dTag: `${BIDDER_PUBKEY}:root-event:bid-event`,
		bidderPubkey: BIDDER_PUBKEY,
		auctionRootEventId: 'root-event',
		auctionCoordinate: '30402:root-event:handmade-mug',
		bidEventId: 'bid-event',
		claim,
		observedAt: 1_760_000_000,
		...overrides,
	}) as ParsedValidatorVerdictEvent

describe('AuctionVerdictView', () => {
	test('renders the empty copy when there are no verdicts', () => {
		const markup = renderToStaticMarkup(<AuctionVerdictView verdicts={[]} renderAvatar={renderAvatar} />)
		expect(markup).toContain('data-slot="auction-verdict-view"')
		expect(markup).toContain('No validator verdicts yet on this auction.')
		expect(markup).not.toContain('Validator verdicts')
	})

	test('renders the settled claim with the success tone', () => {
		const markup = renderToStaticMarkup(<AuctionVerdictView verdicts={[verdictFixture('settled_promptly')]} renderAvatar={renderAvatar} />)
		expect(markup).toContain('settled_promptly')
		expect(markup).toContain('bg-success-muted')
		expect(markup).toContain('Validator verdicts')
		expect(markup).toContain('1 total')
		expect(markup).toContain('data-slot="verdict-avatar"')
	})

	test('renders the fraudulent claim with the error tone', () => {
		const markup = renderToStaticMarkup(
			<AuctionVerdictView verdicts={[verdictFixture('fraudulent_bid', { reason: 'proof_double_spent' })]} renderAvatar={renderAvatar} />,
		)
		expect(markup).toContain('fraudulent_bid')
		expect(markup).toContain('bg-error-muted')
		expect(markup).toContain('reason: proof_double_spent')
	})

	test('renders the loading copy while the first read is pending', () => {
		const markup = renderToStaticMarkup(<AuctionVerdictView verdicts={[]} isLoading renderAvatar={renderAvatar} />)
		expect(markup).toContain('Loading validator verdicts…')
		expect(markup).not.toContain('No validator verdicts yet on this auction.')
	})

	test('merges the host className', () => {
		const markup = renderToStaticMarkup(
			<AuctionVerdictView verdicts={[verdictFixture('valid_bid_placed')]} renderAvatar={renderAvatar} className="mt-4" />,
		)
		expect(markup).toContain('mt-4')
	})
})
