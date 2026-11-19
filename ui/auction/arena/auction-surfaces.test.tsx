/**
 * `ui/auction/arena/auction-surfaces.test.tsx` — the 1440-series surfaces are
 * honest about what the read does and does not know.
 *
 * Rendered to static markup with literal data: the point under test is the
 * *state mapping*, not a read. `ui/` may not touch a relay
 * (`ui/AGENTS.md:18-28`), so there is nothing to stub — the platform adapter is
 * where `platform/web/auctions/relay/auctionSurfacesRead.test.ts` does its work.
 *
 * The card / detail presentations moved to the ported Layout A views
 * (`ui/auctions/catalogue/*`), which carry their own suites
 * (`catalogue-detail-view.test.tsx`) and are exercised through the hosts
 * (`ArenaAuctionsListHost.test.tsx`, `SellerAuctionsListHost.test.tsx`,
 * `SellerAuctionLotHost.test.tsx`). What is asserted here is the part that did
 * not move: the read-state sentences, the count/price honesty, and the verdict
 * panel that infers no quorum.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	ARENA_QUORUM_DISCLAIMER,
	ARENA_UNKNOWN_END_LABEL,
	ARENA_VERDICT_ABSENT_LABEL,
	ARENA_VERDICT_NOT_CLOSED_LABEL,
	ARENA_VERDICT_PHASE_UNKNOWN_LABEL,
	ARENA_VERDICT_READING_LABEL,
	bidCountLabel,
	phaseLabel,
	priceLine,
	readStateMessage,
	verdictEmptyLabel,
	type ArenaAuctionCardModel,
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
		endSource: 'create-derived',
		createDerivedEndsAt: 4600,
		committedEndHeight: null,
		committedEndOrdinal: null,
		phase: 'open',
		verdict: null,
		verdictCount: 0,
		validatorCount: 0,
		divergent: false,
		relayCount: 2,
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
		phase: 'open',
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
// Read-state sentences and count/price honesty
// =========================================================================

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
// Verdict panel
// =========================================================================

describe('ArenaVerdictPanel — no quorum is inferred, ever', () => {
	test('verdictEmptyLabel states the phase only once the read has settled', () => {
		expect(verdictEmptyLabel('open', 'loading')).toBe(ARENA_VERDICT_READING_LABEL)
		expect(verdictEmptyLabel('ended', 'incomplete')).toBe(ARENA_VERDICT_READING_LABEL)
		expect(verdictEmptyLabel('unknown', 'error')).toBe(ARENA_VERDICT_READING_LABEL)
		expect(verdictEmptyLabel('open', 'settled')).toBe(ARENA_VERDICT_NOT_CLOSED_LABEL)
		expect(verdictEmptyLabel('ended', 'settled')).toBe(ARENA_VERDICT_ABSENT_LABEL)
		expect(verdictEmptyLabel('unknown', 'settled')).toBe(ARENA_VERDICT_PHASE_UNKNOWN_LABEL)
	})

	test('an open lot with no verdicts states the lot has not closed, and never an absence', () => {
		const html = render(createElement(ArenaVerdictPanel, { model: panel({ phase: 'open' }), status: 'settled', relayHealth: HEALTH }))
		expect(html).toContain(ARENA_VERDICT_NOT_CLOSED_LABEL)
		expect(html).toContain('still open')
		expect(html).toContain('publish a verdict when the chain closes a lot')
		expect(html).not.toContain('No validator published a verdict')
		expect(html).not.toContain('That is an absence')
		expect(html).not.toContain(ARENA_QUORUM_DISCLAIMER)
	})

	test('a closed lot with no verdicts keeps the absence sentence, and no disclaimer', () => {
		const html = render(createElement(ArenaVerdictPanel, { model: panel({ phase: 'ended' }), status: 'settled', relayHealth: HEALTH }))
		expect(html.replace(/&quot;/g, '"')).toContain(ARENA_VERDICT_ABSENT_LABEL)
		expect(html).toContain('No validator published a verdict')
		expect(html).toContain('That is an absence, not a verdict')
		expect(html).not.toContain(ARENA_VERDICT_NOT_CLOSED_LABEL)
		expect(html).not.toContain(ARENA_QUORUM_DISCLAIMER)
	})

	test('a lot with no readable end says so rather than claiming it closed', () => {
		const html = render(createElement(ArenaVerdictPanel, { model: panel({ phase: 'unknown' }), status: 'settled', relayHealth: HEALTH }))
		expect(html).toContain(ARENA_VERDICT_PHASE_UNKNOWN_LABEL)
		expect(html).toContain('whether the chain has closed it is unknown')
		expect(html).not.toContain('No validator published a verdict')
		expect(html).not.toContain(ARENA_QUORUM_DISCLAIMER)
	})

	test('a closed lot with verdicts lists them, counts the validators, and explains the list', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({
					phase: 'ended',
					rows: [verdictRow({ validator: V1 }), verdictRow({ validator: V2, outcome: 'cancelled', height: 120 })],
					validatorCount: 2,
					outcomes: ['cancelled', 'winner'],
				}),
				status: 'settled',
				relayHealth: HEALTH,
			}),
		)
		expect(html).toContain('data-slot="arena-verdict-row"')
		expect(html).toContain('2 verdicts')
		expect(html).toContain('2 validators')
		expect(html).toContain(ARENA_QUORUM_DISCLAIMER)
		expect(html).not.toContain('No validator published a verdict')
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
		expect(html).not.toContain(ARENA_QUORUM_DISCLAIMER)
	})

	test('validators publishing different outcomes are shown as disagreeing, not resolved', () => {
		const html = render(
			createElement(ArenaVerdictPanel, {
				model: panel({
					rows: [
						verdictRow({ validator: V1, outcome: 'winner', height: 100 }),
						verdictRow({ validator: V2, outcome: 'cancelled', height: 120 }),
					],
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
