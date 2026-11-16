/**
 * `ArenaAuctionsListHost.test.tsx` — the `/auctions` index surface.
 *
 * No network, no mint, no relay: the fixtures are **real 1440 events** run
 * through the real decode + projection chain (`decodeArenaEvent` →
 * `projectArenaEvents`), so what is under test is the host's selection and its
 * state mapping over the actual read-model, not a hand-built shape. The read's
 * *state* is a prop — that is the whole point of the host — so every state is
 * rendered literally, which is the only way to check that `loading` never claims
 * a count and that "No auctions yet" is reachable solely from `settled`.
 *
 * Pubkeys are short and non-hex on purpose: they are opaque strings here, and a
 * 64-hex literal in a test file is indistinguishable from a key to the
 * pre-commit scanner.
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ARENA_AUCTION_BID_KIND, ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import { testLabelActions } from '@sdk/config/test-labels'
import type { NostrEventLike } from '@sdk/core'
import {
	findAuction,
	toAuctionDetailModel,
} from '@platform/web/auctions/relay/auctionSurfacesRead'
import {
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaAuctionSnapshot,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import {
	ArenaAuctionsListHost,
	arenaAuctionHref,
	arenaListEmptyMessage,
	arenaListPartialNotice,
	arenaListSortOptions,
	selectArenaListCards,
	type ArenaListSort,
} from './ArenaAuctionsListHost'

const SELLER = 'seller-alice'
const OTHER_SELLER = 'seller-bob'
const BIDDER = 'bidder-one'

let idCounter = 0
function nextId(prefix: string): string {
	idCounter += 1
	return `${prefix}-${idCounter}`
}

interface CreateOverrides {
	d?: string
	seller?: string
	created_at?: number
	title?: string | null
	startPrice?: number | null
	durationSec?: number | null
}

function createEvent(over: CreateOverrides = {}): NostrEventLike {
	const d = over.d ?? 'lot-1'
	return {
		id: nextId('create'),
		pubkey: over.seller ?? SELLER,
		created_at: over.created_at ?? 1000,
		kind: ARENA_AUCTION_CREATE_KIND,
		tags: [['d', d]],
		content: JSON.stringify({
			auction_id: d,
			title: over.title === undefined ? `Lot ${d}` : over.title,
			startPrice: over.startPrice === undefined ? 1000 : over.startPrice,
			minIncrement: 100,
			mode: 'fixed',
			...(over.durationSec === undefined ? { durationSec: 3600 } : over.durationSec === null ? {} : { durationSec: over.durationSec }),
		}),
	}
}

function bidEvent(auctionId: string): NostrEventLike {
	return {
		id: nextId('bid'),
		pubkey: BIDDER,
		created_at: 1100,
		kind: ARENA_AUCTION_BID_KIND,
		tags: [],
		content: JSON.stringify({ auction_id: auctionId, amount: 500 }),
	}
}

/** The health the projection records — the host's own `status` is a prop, not this. */
function healthOf(over: Partial<ArenaReadHealth> = {}): ArenaReadHealth {
	return {
		relays: [],
		eose: [],
		answered: [],
		pending: [],
		failed: [],
		noRelaysReachable: false,
		empty: true,
		aborted: false,
		...over,
	}
}

function snapshotOf(events: NostrEventLike[], health: Partial<ArenaReadHealth> = {}): ArenaAuctionSnapshot {
	const decoded = events.map((event) => {
		const result = decodeArenaEvent(event, 'wss://relay.one')
		if (!result.ok) throw new Error(`fixture refused: ${result.refusal.reason} ${result.refusal.detail}`)
		return result.event
	})
	return projectArenaEvents(decoded, healthOf(health))
}

const EMPTY = snapshotOf([])
/**
 * Three lots with distinct start times and ends: `open-lot` (starts last, ends
 * 6600), `ended-lot` (ends 1010, before `NOW`), `endless-lot` (no stated end).
 */
const OPEN_AND_ENDED = snapshotOf([
	createEvent({ d: 'open-lot', created_at: 3000, durationSec: 3600 }),
	createEvent({ d: 'ended-lot', created_at: 1000, durationSec: 10 }),
	createEvent({ d: 'endless-lot', created_at: 2000, durationSec: null }),
])
const ONE_LOT = snapshotOf([createEvent({ d: 'lot-1', created_at: 1000, durationSec: 3600 }), bidEvent('lot-1')])

const NOW = 2000
const HEALTH = { answered: 1, total: 2 }

function renderHost(over: Partial<Parameters<typeof ArenaAuctionsListHost>[0]> = {}): string {
	return renderToStaticMarkup(
		createElement(ArenaAuctionsListHost, {
			snapshot: ONE_LOT,
			status: 'settled',
			relayHealth: HEALTH,
			now: NOW,
			sort: 'newest',
			hideEnded: false,
			onSortChange: () => {},
			onToggleHideEnded: () => {},
			onReset: () => {},
			...over,
		}),
	)
}

/** The rendered text of the list's empty block, tags stripped. */
function emptyText(markup: string): string {
	const at = markup.indexOf('data-slot="arena-auctions-list-empty"')
	expect(at).toBeGreaterThan(-1)
	const slice = markup.slice(markup.lastIndexOf('<', at))
	return slice.slice(0, slice.indexOf('</div>')).replace(/<[^>]*>/g, '')
}

const CARD = 'data-slot="arena-auction-card"'
const CARD_STATE = 'data-slot="arena-auction-card-state"'

// =========================================================================
// Read states — every one of them, and none claiming another's sentence
// =========================================================================

describe('ArenaAuctionsListHost — read states', () => {
	test('loading with nothing delivered states the read, and claims no count', () => {
		const markup = renderHost({ snapshot: null, status: 'loading', relayHealth: { answered: 0, total: 2 } })

		expect(markup).toContain('Reading auctions from relays')
		expect(markup).toContain('not that there are no auctions')
		expect(markup).not.toContain('No auctions yet')
		expect(markup).not.toContain(CARD)
		// No lot/auction count is asserted while the read runs: the only numbers
		// allowed are the relay health the read itself measured.
		expect(emptyText(markup)).not.toMatch(/\d+\s+(auctions|lots)/i)
	})

	test('settled with no lots is the one state that may say there are no auctions', () => {
		const markup = renderHost({ snapshot: EMPTY, status: 'settled', relayHealth: { answered: 2, total: 2 } })

		expect(markup).toContain('No auctions yet.')
		expect(markup).toContain('Every relay answered')
		expect(markup).toContain('data-state="settled"')
	})

	test('"No auctions yet" is reachable ONLY from settled', () => {
		for (const status of ['loading', 'incomplete', 'no-relays', 'error'] as const) {
			const markup = renderHost({ snapshot: EMPTY, status, relayHealth: HEALTH })
			expect(markup).not.toContain('No auctions yet')
		}
	})

	test('no relay answered is not "there are no auctions"', () => {
		const markup = renderHost({ snapshot: EMPTY, status: 'no-relays', relayHealth: { answered: 0, total: 2 } })

		expect(markup).toContain('No relay answered')
		expect(markup).toContain('not the same as there being no auctions')
		expect(markup).toContain('0 of 2 relays answered')
		expect(markup).not.toContain('No auctions yet')
	})

	test('an error is a failure, never an empty result', () => {
		const markup = renderHost({ snapshot: EMPTY, status: 'error', relayHealth: HEALTH })

		expect(markup).toContain('could not be read right now')
		expect(markup).not.toContain('No auctions yet')
	})

	test('an incomplete read keeps every lot that arrived and says the picture is partial', () => {
		const markup = renderHost({ snapshot: ONE_LOT, status: 'incomplete', relayHealth: HEALTH })

		// The lot arrived, so it renders…
		expect(markup).toContain(CARD)
		expect(markup).toContain('Lot lot-1')
		// …under a notice that says the read stopped short, and the cards say so too.
		expect(markup).toContain('data-slot="arena-auctions-list-notice"')
		expect(markup).toContain('not the whole picture')
		expect(markup).toContain('data-state="incomplete"')
		expect(markup).toContain('1 bid so far')
	})

	test('a settled read of several lots renders one card each, with no partial notice', () => {
		const markup = renderHost({ snapshot: OPEN_AND_ENDED, status: 'settled', relayHealth: { answered: 2, total: 2 } })

		expect(markup.split(CARD).length - 1).toBe(3)
		expect(markup).not.toContain('data-slot="arena-auctions-list-notice"')
		expect(markup).toContain('data-state="settled"')
		// Settled: no card qualifies a count as "so far" any more.
		expect(markup).not.toContain('bids so far')
	})

	test('every read state has its own sentence, and every state gets a partial notice except settled', () => {
		const statuses = ['loading', 'settled', 'incomplete', 'no-relays', 'error'] as const
		const titles = statuses.map((status) => arenaListEmptyMessage(status).title)
		expect(new Set(titles).size).toBe(statuses.length)

		expect(arenaListPartialNotice('settled')).toBeNull()
		for (const status of ['loading', 'incomplete', 'no-relays', 'error'] as const) {
			expect(arenaListPartialNotice(status)).not.toBeNull()
		}
	})
})

// =========================================================================
// Card href — the `d` tag only
// =========================================================================

describe('the card href is the auction\'s `d` tag', () => {
	test('a lot links to /auctions/<d>, never to the seller or the coordinate', () => {
		const markup = renderHost({ snapshot: ONE_LOT })
		expect(markup).toContain('href="/auctions/lot-1"')
		// The seller key and the full coordinate appear nowhere in a link.
		expect(markup).not.toContain(`href="/auctions/${SELLER}`)
		expect(markup).not.toContain('href="/auctions/1440:')
	})

	test('a `d` needing escaping is escaped, and the helper is the one shape', () => {
		expect(arenaAuctionHref('lot-1')).toBe('/auctions/lot-1')
		expect(arenaAuctionHref('a b/c')).toBe('/auctions/a%20b%2Fc')
	})
})

// =========================================================================
// The filter that survived — and the ones that did not
// =========================================================================

describe('hide ended', () => {
	test('filters ended lots out of the rendered list, and keeps open and unknown-end lots', () => {
		const withoutFilter = renderHost({ snapshot: OPEN_AND_ENDED })
		expect(withoutFilter.split(CARD).length - 1).toBe(3)

		const hidden = renderHost({ snapshot: OPEN_AND_ENDED, hideEnded: true })
		expect(hidden.split(CARD).length - 1).toBe(2)
		expect(hidden).toContain('Lot open-lot')
		expect(hidden).toContain('Lot endless-lot')
		expect(hidden).not.toContain('Lot ended-lot')
	})

	test('a settled read whose lots are all filtered out says the filter did it, not the relays', () => {
		const onlyEnded = snapshotOf([createEvent({ d: 'ended-lot', created_at: 1000, durationSec: 10 })])
		const markup = renderHost({ snapshot: onlyEnded, status: 'settled', hideEnded: true, relayHealth: { answered: 2, total: 2 } })

		expect(markup).toContain('No auctions match the current filter')
		expect(markup).toContain('data-state="filtered"')
		expect(markup).not.toContain('No auctions yet')
		expect(markup).not.toContain(CARD)
	})

	test('a lot with no stated end is never treated as ended', () => {
		const onlyEndless = snapshotOf([createEvent({ d: 'endless-lot', durationSec: null })])
		const { cards, total } = selectArenaListCards(onlyEndless, { now: NOW, status: 'settled', sort: 'newest', hideEnded: true })
		expect(total).toBe(1)
		expect(cards.map((card) => card.d)).toEqual(['endless-lot'])
	})
})

describe('the controls that cannot do anything are gone, not inert', () => {
	test('no test-listings toggle and no category chip is rendered on an arena list', () => {
		const markup = renderHost({ snapshot: OPEN_AND_ENDED })

		expect(markup).not.toContain('Show test listings')
		expect(markup).not.toContain('>All<')
		// The one control on the page is the filter/sort popover, and it is a real
		// control (its panel opens), not an inert label.
		expect(markup).toContain('Filter &amp; Sort')
		expect(markup).toContain('aria-haspopup="dialog"')
	})

	test('the sort vocabulary is only what the arena card model carries', () => {
		expect(arenaListSortOptions.map((option) => option.title)).toEqual([
			'Newest first',
			'Ending soonest',
			'Highest starting bid',
			'Title A–Z',
		])
	})
})

// =========================================================================
// Sort — only fields the card model carries
// =========================================================================

describe('sort', () => {
	const dispatch = (sort: ArenaListSort, snapshot: ArenaAuctionSnapshot = OPEN_AND_ENDED) =>
		selectArenaListCards(snapshot, { now: NOW, status: 'settled', sort, hideEnded: false }).cards.map((card) => card.d)

	test('newest first is the root create\'s time, newest lot first', () => {
		expect(dispatch('newest')).toEqual(['open-lot', 'endless-lot', 'ended-lot'])
	})

	test('ending-soonest orders by end time and puts a lot with no stated end last', () => {
		expect(dispatch('ending-soon')).toEqual(['ended-lot', 'open-lot', 'endless-lot'])
	})

	test('highest starting bid orders descending, with an unstated price last', () => {
		const snapshot = snapshotOf([
			createEvent({ d: 'cheap', created_at: 1000, startPrice: 100 }),
			createEvent({ d: 'dear', created_at: 1000, startPrice: 9000 }),
			createEvent({ d: 'unpriced', created_at: 1000, startPrice: null }),
		])
		expect(dispatch('highest-starting-bid', snapshot)).toEqual(['dear', 'cheap', 'unpriced'])
	})

	test('title A–Z falls back to the `d` when no title was published', () => {
		const snapshot = snapshotOf([
			createEvent({ d: 'zz-lot', created_at: 1000, title: 'Zebra' }),
			createEvent({ d: 'aa-lot', created_at: 1000, title: null }),
		])
		expect(dispatch('title-a-z', snapshot)).toEqual(['aa-lot', 'zz-lot'])
	})

	test('two lots from different sellers are ordered by the read-model, not by event order', () => {
		const snapshot = snapshotOf([
			createEvent({ d: 'late-end', seller: SELLER, created_at: 1000, durationSec: 9000 }),
			createEvent({ d: 'early-end', seller: OTHER_SELLER, created_at: 1000, durationSec: 100 }),
		])
		expect(dispatch('ending-soon', snapshot)).toEqual(['early-end', 'late-end'])
	})
})

// =========================================================================
// Relay disagreement reaches the card, it is not smoothed over
// =========================================================================

describe('divergence is surfaced', () => {
	test('the list passes the snapshot\'s divergence list into the card projection', () => {
		// Detection itself is covered by `auctionSurfacesRead.test.ts`; what is
		// under test here is that the list hands the read's own list to the
		// projection instead of dropping it.
		const divergent: ArenaAuctionSnapshot = {
			...ONE_LOT,
			verdictDivergence: [{ auctionId: `1440:${SELLER}:lot-1`, byRelay: { 'wss://relay.a': ['winner'], 'wss://relay.b': ['cancelled'] } }],
		}
		const markup = renderHost({ snapshot: divergent })

		expect(markup).toContain('Relays disagree about this auction')
	})
})

// =========================================================================
// ADR-0009 — the live list honours test labels
// =========================================================================

describe('ADR-0009 — test-labeled lots are hidden from the auction list', () => {
	const openCoordinate = `1440:${SELLER}:open-lot`

	/** A completed label read: these coordinates were checked, and all carry a label. */
	const markLoadedAndLabeled = (coordinates: string[]) =>
		testLabelActions.applyFetchedLabels(
			new Map(coordinates.map((coordinate) => [coordinate, { eventId: `label-${coordinate}`, labelerPubkey: 'labeler' }])),
			coordinates,
		)

	const select = (over: Partial<Parameters<typeof selectArenaListCards>[1]> = {}) =>
		selectArenaListCards(OPEN_AND_ENDED, { now: NOW, status: 'settled', sort: 'newest', hideEnded: false, ...over })

	beforeEach(() => {
		testLabelActions.clearLabels()
	})

	afterEach(() => {
		testLabelActions.clearLabels()
	})

	test('a labeled 1440 lot is absent from the list while its neighbours still render', () => {
		markLoadedAndLabeled([openCoordinate])

		const { cards, total } = select()
		expect(cards.map((card) => card.d)).toEqual(['endless-lot', 'ended-lot'])
		// Labeled lots are not discoverable results, so they are not in the count
		// a "filtered" empty state would be blamed on.
		expect(total).toBe(2)

		const markup = renderHost({ snapshot: OPEN_AND_ENDED })
		expect(markup).not.toContain('Lot open-lot')
		expect(markup).toContain('Lot endless-lot')
		expect(markup).toContain('Lot ended-lot')
	})

	test('fails open when no label read has happened — a labeled coordinate hides nothing', () => {
		// The store knows a label, but no read completed (`isLoaded` false): ADR-0009
		// says a read that did not happen is not evidence, so the lot stays.
		testLabelActions.setLabel(openCoordinate, 'label-event', 'labeler')
		expect(testLabelActions.areLabelsLoaded()).toBe(false)

		expect(select().cards.map((card) => card.d)).toEqual(['open-lot', 'endless-lot', 'ended-lot'])
		expect(renderHost({ snapshot: OPEN_AND_ENDED })).toContain('Lot open-lot')
	})

	test('the show-test-listings toggle reveals labeled lots, and switching it off hides them again', () => {
		markLoadedAndLabeled([openCoordinate])

		expect(select().cards.map((card) => card.d)).not.toContain('open-lot')
		expect(select({ showTestListings: true }).cards.map((card) => card.d)).toEqual(['open-lot', 'endless-lot', 'ended-lot'])

		// The toggle is the SDK state the product surfaces read, not a second one.
		testLabelActions.setShowTestListings(true)
		expect(renderHost({ snapshot: OPEN_AND_ENDED })).toContain('Lot open-lot')

		testLabelActions.setShowTestListings(false)
		expect(renderHost({ snapshot: OPEN_AND_ENDED })).not.toContain('Lot open-lot')
	})

	test('a settled read whose only lot is labeled says there are no auctions, not that a filter hid them', () => {
		markLoadedAndLabeled([`1440:${SELLER}:lot-1`])

		const markup = renderHost({ snapshot: ONE_LOT, status: 'settled', relayHealth: { answered: 2, total: 2 } })
		expect(markup).toContain('No auctions yet.')
		expect(markup).not.toContain('No auctions match the current filter')
	})

	test('the gate is projection-only: the detail page still finds the labeled lot', () => {
		markLoadedAndLabeled([`1440:${SELLER}:lot-1`])

		const view = findAuction(ONE_LOT, `1440:${SELLER}:lot-1`)
		expect(view).not.toBeNull()
		expect(toAuctionDetailModel(view!, { now: NOW, status: 'settled' }).d).toBe('lot-1')
	})

	test('a labeled lot from another seller is judged on its own coordinate, not the kind alone', () => {
		markLoadedAndLabeled([`1440:${OTHER_SELLER}:open-lot`])

		// `open-lot` is SELLER's; OtherSeller's same `d` is a different coordinate.
		expect(select().cards.map((card) => card.d)).toEqual(['open-lot', 'endless-lot', 'ended-lot'])
	})
})
