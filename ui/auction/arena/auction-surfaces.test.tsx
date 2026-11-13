/**
 * `ui/auction/arena/auction-surfaces.test.tsx` — the 1440-series surfaces are
 * honest about what the read does and does not know.
 *
 * Rendered to static markup with literal data: the point under test is the
 * *state mapping*, not a read. `ui/` may not touch a relay
 * (`ui/AGENTS.md:18-28`), so there is nothing to stub — the platform adapter is
 * where `platform/web/auctions/relay/auctionSurfacesRead.test.ts` does its work.
 *
 * The cases mirror the storefront block's suite
 * (`ui/storefront/auction-list-block.test.tsx`): a count is a verdict, a verdict
 * needs a finished read, and "unknown" is never rendered as a value.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArenaAuctionCard, bidCountLabel, priceLine, readStateMessage } from './auction-card'
import { ArenaAuctionDetail } from './auction-detail'
import {
	ARENA_QUORUM_DISCLAIMER,
	ARENA_UNKNOWN_END_LABEL,
	phaseLabel,
	type ArenaAuctionCardModel,
	type ArenaAuctionDetailModel,
	type ArenaVerdictPanelModel,
	type ArenaVerdictRow,
} from './model'
import { ArenaVerdictPanel } from './verdict-panel'

const SELLER = 'seller-alice'
const COORD = `1440:${SELLER}:lot-1`
const V1 = 'validator-one'
const V2 = 'validator-two'

function card(over: Partial<ArenaAuctionCardModel> = {}): ArenaAuctionCardModel {
	return {
		coordinate: COORD,
		seller: SELLER,
		d: 'lot-1',
		title: 'A handmade mug',
		imageUrl: null,
		startingBid: 1000,
		topBidTotal: null,
		bidCount: 0,
		bidsWithoutAmount: 0,
		endsAt: 4600,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
		...over,
	}
}

function detail(over: Partial<ArenaAuctionDetailModel> = {}): ArenaAuctionDetailModel {
	return {
		...card(),
		description: 'Thrown on a wheel.',
		minIncrement: 100,
		reserve: 5000,
		durationSeconds: 3600,
		lateBidWindowSeconds: 60,
		lateBidExtensionSeconds: 120,
		maxTotalExtensionSeconds: 600,
		locktimeSeconds: 900,
		fundingMode: 'cashu_sigall_v1',
		versions: 1,
		rootEventId: 'root-event-1',
		canonicalEventId: 'root-event-1',
		rootCreatedAt: 1000,
		bids: [],
		positions: [],
		...over,
	}
}

function verdictRow(over: Partial<ArenaVerdictRow> = {}): ArenaVerdictRow {
	return {
		validator: V1,
		outcome: 'winner',
		height: 100,
		blockHash: 'beefcafe',
		bidId: 'bid-1',
		payoutTokenSha256: null,
		derivedFrom: 'committed_state',
		...over,
	}
}

function panel(over: Partial<ArenaVerdictPanelModel> = {}): ArenaVerdictPanelModel {
	return {
		auctionId: COORD,
		rows: [],
		validatorCount: 0,
		outcomes: [],
		divergence: null,
		...over,
	}
}

const HEALTH = { answered: 1, total: 2 }

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
	return renderToStaticMarkup(node)
}

// =========================================================================
// Card
// =========================================================================

describe('ArenaAuctionCard — read states', () => {
	test('loading with nothing delivered states the read, and never claims a count', () => {
		const html = render(createElement(ArenaAuctionCard, { model: null, status: 'loading', relayHealth: HEALTH, href: null }))
		expect(html).toContain('Reading this auction from relays')
		expect(html).toContain('not that the auction is missing')
		expect(html).toContain('1 of 2 relays answered')
		expect(html).not.toContain('No such auction')
	})

	test('no relay answered is not "the auction does not exist"', () => {
		const html = render(createElement(ArenaAuctionCard, { model: null, status: 'no-relays', relayHealth: { answered: 0, total: 2 }, href: null }))
		expect(html).toContain('No relay answered')
		expect(html).toContain('not the same as the auction not existing')
		expect(html).not.toContain('No such auction was read')
	})

	test('an incomplete read says so without pretending to be final', () => {
		const html = render(createElement(ArenaAuctionCard, { model: null, status: 'incomplete', relayHealth: HEALTH, href: null }))
		expect(html).toContain('stopped before every relay answered')
		expect(html).toContain('not the whole picture')
	})

	test('only a settled read may say the auction was not found', () => {
		const html = render(createElement(ArenaAuctionCard, { model: null, status: 'settled', relayHealth: { answered: 2, total: 2 }, href: null }))
		expect(html).toContain('No such auction was read')
		expect(html).toContain('Every relay answered')
	})

	test('an error is a failure, not an empty result', () => {
		const html = render(createElement(ArenaAuctionCard, { model: null, status: 'error', relayHealth: HEALTH, href: null }))
		expect(html).toContain('could not be read right now')
		expect(html).not.toContain('No such auction')
	})
})

describe('ArenaAuctionCard — what it may state', () => {
	test('a create with no duration renders an unknown end, not a made-up one', () => {
		const html = render(
			createElement(ArenaAuctionCard, {
				model: card({ phase: 'unknown', endsAt: null }),
				status: 'settled',
				relayHealth: HEALTH,
				href: '/auctions/lot-1',
			}),
		)
		expect(html).toContain(ARENA_UNKNOWN_END_LABEL)
		expect(html).not.toContain('LIVE')
		expect(html).not.toContain('ENDS')
	})

	test('an ended auction with no verdict says the outcome is not verified, not that there is none', () => {
		const html = render(
			createElement(ArenaAuctionCard, { model: card({ phase: 'ended', verdict: null }), status: 'settled', relayHealth: HEALTH, href: null }),
		)
		expect(html).toContain('Outcome not verified yet')
		expect(html).toContain('>Ended<')
	})

	test('a read verdict is labelled relay-reported', () => {
		const html = render(
			createElement(ArenaAuctionCard, {
				model: card({ phase: 'ended', verdict: 'winner', verdictCount: 1, validatorCount: 1 }),
				status: 'settled',
				relayHealth: HEALTH,
				href: null,
			}),
		)
		expect(html).toContain('Outcome: winner (relay-reported)')
	})

	test('a partial read says "so far", a finished one does not', () => {
		const loading = render(
			createElement(ArenaAuctionCard, {
				model: card({ bidCount: 3, topBidTotal: 300 }),
				status: 'incomplete',
				relayHealth: HEALTH,
				href: null,
			}),
		)
		expect(loading).toContain('3 bids so far')
		const settled = render(
			createElement(ArenaAuctionCard, {
				model: card({ bidCount: 3, topBidTotal: 300 }),
				status: 'settled',
				relayHealth: HEALTH,
				href: null,
			}),
		)
		expect(settled).toContain('3 bids')
		expect(settled).not.toContain('3 bids so far')
	})

	test('bids with no readable amount make the total unknown, never zero', () => {
		const html = render(
			createElement(ArenaAuctionCard, {
				model: card({ bidCount: 2, bidsWithoutAmount: 1, topBidTotal: null }),
				status: 'settled',
				relayHealth: HEALTH,
				href: null,
			}),
		)
		expect(html).toContain('1 bid carries no readable amount — total unknown')
		expect(html).not.toContain('0 sats')
	})

	test('relay disagreement is flagged on the card', () => {
		const html = render(
			createElement(ArenaAuctionCard, {
				model: card({ divergent: true, verdict: 'winner' }),
				status: 'settled',
				relayHealth: HEALTH,
				href: null,
			}),
		)
		expect(html).toContain('Relays disagree about this auction')
		expect(html).toContain('Outcome: winner (relay-reported)')
	})
})

describe('card formatters', () => {
	test('bidCountLabel qualifies a partial read', () => {
		expect(bidCountLabel(1, 'settled')).toBe('1 bid')
		expect(bidCountLabel(0, 'settled')).toBe('0 bids')
		expect(bidCountLabel(2, 'loading')).toBe('2 bids so far')
	})

	test('priceLine never asserts a total it cannot support', () => {
		expect(priceLine(card({ topBidTotal: 450 }))).toBe('450 sats')
		expect(priceLine(card({ bidsWithoutAmount: 2 }))).toBe('2 bids carry no readable amount — total unknown')
		expect(priceLine(card({ startingBid: 1000 }))).toBe('No bids · starting 1,000 sats')
		expect(priceLine(card({ startingBid: null }))).toBe('No bid amount stated')
	})

	test('every read state has its own sentence', () => {
		const statuses = ['loading', 'settled', 'incomplete', 'no-relays', 'error'] as const
		const sentences = statuses.map((status) => readStateMessage(status)?.title)
		expect(new Set(sentences).size).toBe(statuses.length)
	})

	test('phaseLabel names the unknown case in words', () => {
		expect(phaseLabel('open')).toBe('Open')
		expect(phaseLabel('ended')).toBe('Ended')
		expect(phaseLabel('unknown')).toBe(ARENA_UNKNOWN_END_LABEL)
	})
})

// =========================================================================
// Detail
// =========================================================================

describe('ArenaAuctionDetail', () => {
	test('renders terms as published and says "not stated" for the ones the create omitted', () => {
		const html = render(
			createElement(ArenaAuctionDetail, {
				model: detail({ reserve: null, durationSeconds: null, fundingMode: null }),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('An unstated reserve is not &quot;no reserve&quot;.')
		expect(html).toContain('No duration, so there is no end to state.')
		expect(html).toContain('not stated')
		expect(html).not.toContain('Reserve</span></div>0')
	})

	test('positions are labelled derived, not an outcome', () => {
		const html = render(
			createElement(ArenaAuctionDetail, {
				model: detail({ positions: [{ bidder: 'bidder-one', total: 300 }], topBidTotal: 300, bidCount: 1 }),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('Positions (derived)')
		expect(html).toContain('the verdict names the winner')
	})

	test('no verdict is rendered as unknown, with the reason spelled out', () => {
		const html = render(
			createElement(ArenaAuctionDetail, { model: detail({ verdict: null }), status: 'settled', relayHealth: HEALTH }),
		)
		expect(html).toContain('Unknown is not')
	})

	test('a partial read says so at the top and qualifies the bid list', () => {
		const html = render(
			createElement(ArenaAuctionDetail, {
				model: detail({ bids: [], bidCount: 0 }),
				status: 'incomplete',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('stopped before every relay answered')
		expect(html).toContain('the read has not finished, so this is not')
		expect(html).toContain('1 of 2 relays answered')
	})

	test('an empty read delivers the read state, not an empty auction', () => {
		const html = render(
			createElement(ArenaAuctionDetail, { model: null, status: 'loading', relayHealth: { answered: 0, total: 2 } }),
		)
		expect(html).toContain('Reading this auction from relays')
		expect(html).not.toContain('Terms, as published')
	})
})

// =========================================================================
// Verdict panel
// =========================================================================

describe('ArenaVerdictPanel — no quorum is inferred, ever', () => {
	test('the quorum disclaimer is present with zero verdicts', () => {
		const html = render(createElement(ArenaVerdictPanel, { model: panel(), status: 'settled', relayHealth: HEALTH }))
		expect(html).toContain(ARENA_QUORUM_DISCLAIMER)
		expect(html).toContain('No validator published a verdict')
		expect(html).toContain('That is an absence, not a verdict')
	})

	test('the disclaimer survives a single verdict — one verdict is not a quorum', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({ rows: [verdictRow()], validatorCount: 1, outcomes: ['winner'] }),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain(ARENA_QUORUM_DISCLAIMER)
		expect(html).toContain('data-slot="arena-verdict-row"')
		expect(html).toContain('winner')
	})

	test('a read still running with nothing delivered says it is not "no verdict"', () => {
		const html = render(createElement(ArenaVerdictPanel, { model: panel(), status: 'loading', relayHealth: { answered: 0, total: 2 } }))
		expect(html).toContain('No verdict has been read yet')
		expect(html).toContain('not &quot;no verdict&quot;')
		expect(html).not.toContain('No validator published a verdict')
	})

	test('validators publishing different outcomes are shown as disagreeing, not resolved', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({
					rows: [verdictRow({ validator: V1, outcome: 'winner', height: 100 }), verdictRow({ validator: V2, outcome: 'cancelled', height: 120 })],
					validatorCount: 2,
					outcomes: ['cancelled', 'winner'],
				}),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('The published verdicts disagree')
		expect(html).toContain('does not pick one')
		expect(html).toContain(ARENA_QUORUM_DISCLAIMER)
	})

	test('relay-level divergence is named by relay', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({
					rows: [verdictRow()],
					validatorCount: 1,
					outcomes: ['winner'],
					divergence: {
						auctionId: COORD,
						byRelay: { 'wss://relay.b': ['cancelled'], 'wss://relay.a': ['winner'] },
					},
				}),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('Two relays report different outcomes for this auction')
		expect(html).toContain('wss://relay.a')
		expect(html).toContain('wss://relay.b')
		expect(html).toContain('signal, not proof')
	})

	test('a verdict published without a p tag shows a placeholder, not a blank', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({ rows: [verdictRow({ validator: null })], validatorCount: 1, outcomes: ['winner'] }),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('key not stated')
	})

	test('more verdicts than validators is called out rather than silently merged', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({
					rows: [verdictRow({ height: 120 }), verdictRow({ height: 100 })],
					validatorCount: 1,
					outcomes: ['winner'],
				}),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('More verdicts than validators')
		expect(html).toContain('does not merge them')
	})

	test('counts are qualified while the read is unfinished', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({ rows: [verdictRow()], validatorCount: 1, outcomes: ['winner'] }),
				status: 'incomplete',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('1 verdict so far')
	})
})