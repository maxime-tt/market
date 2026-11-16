/**
 * The label registry's item-kind gate.
 *
 * The test-label gate (`excludeTestLabeledEvents` → `collectTestLabelCoordinates`
 * → `filterTestLabeledEvents`) keys on an item's `kind:pubkey:d` coordinate, so
 * which kinds are accepted here decides whether a label can ever hide an item.
 * After the auction consolidation the auction lot kind is the arena create event
 * (1440); the retired 30408 listing must be refused, because a label published
 * against `30408:<seller>:<d>` is a coordinate nothing reads — the item would
 * look labeled and stay visible.
 *
 * Pure, offline: the store is driven directly and no read port is involved.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { ARENA_AUCTION_CREATE_KIND } from '../commerce/auctions/constants'
import type { NostrEventLike } from '../core/nostr/eventLike'
import { TEST_LABEL_AUCTION_KIND, TEST_LABEL_PRODUCT_KIND } from './test-label-constants'
import {
	collectTestLabelCoordinates,
	filterTestLabeledCoordinates,
	filterTestLabeledEvents,
	filterTestLabeledItems,
	getItemTestLabelCoordinate,
	isAuctionTestLabeled,
	isCoordinateTestLabeled,
	isProductTestLabeled,
} from './testLabelFilters'
import { testLabelActions } from './test-labels'

const SELLER = 'c'.repeat(64)
const LABELER = 'a'.repeat(64)

/** Kind 30408 — the retired auction listing. Not in the registry any more. */
const RETIRED_AUCTION_KIND = 30408

const makeItem = (params: { kind: number; dTag?: string; id?: string }): NostrEventLike => ({
	id: params.id ?? `item-${params.kind}-${params.dTag ?? 'x'}`,
	pubkey: SELLER,
	kind: params.kind,
	created_at: 1_700_000_000,
	content: '',
	tags: params.dTag ? [['d', params.dTag]] : [],
})

beforeEach(() => {
	testLabelActions.clearLabels()
})

describe('the auction kind in the label registry', () => {
	test('is the arena create kind, not the retired 30408 listing', () => {
		expect(TEST_LABEL_AUCTION_KIND).toBe(ARENA_AUCTION_CREATE_KIND)
		expect(TEST_LABEL_AUCTION_KIND).toBe(1440)
		expect(TEST_LABEL_AUCTION_KIND).not.toBe(RETIRED_AUCTION_KIND)
	})

	test('product kind is unchanged', () => {
		expect(TEST_LABEL_PRODUCT_KIND).toBe(30402)
	})
})

describe('getItemTestLabelCoordinate — accepted kinds', () => {
	test('accepts an arena auction lot and builds its 1440 coordinate', () => {
		expect(getItemTestLabelCoordinate(makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-1' }))).toBe(`1440:${SELLER}:lot-1`)
	})

	test('accepts a product and builds its 30402 coordinate', () => {
		expect(getItemTestLabelCoordinate(makeItem({ kind: TEST_LABEL_PRODUCT_KIND, dTag: 'mug' }))).toBe(`30402:${SELLER}:mug`)
	})

	test('refuses the retired 30408 listing — no coordinate, so no label can apply', () => {
		expect(getItemTestLabelCoordinate(makeItem({ kind: RETIRED_AUCTION_KIND, dTag: 'old-lot' }))).toBeNull()
	})

	test('refuses an event with no d tag, whatever its kind', () => {
		expect(getItemTestLabelCoordinate(makeItem({ kind: ARENA_AUCTION_CREATE_KIND }))).toBeNull()
	})
})

describe('the filters agree with the registry', () => {
	test('an arena auction lot carrying a label is labeled; a retired 30408 event never is', () => {
		testLabelActions.setLabel(`1440:${SELLER}:lot-1`, 'label-1', LABELER)
		testLabelActions.setLabel(`${RETIRED_AUCTION_KIND}:${SELLER}:old-lot`, 'label-2', LABELER)

		expect(isAuctionTestLabeled(makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-1' }))).toBe(true)
		// The store holds a label for the 30408 coordinate, but the kind is out of
		// the registry: the filter must not honour it.
		expect(isAuctionTestLabeled(makeItem({ kind: RETIRED_AUCTION_KIND, dTag: 'old-lot' }))).toBe(false)
		expect(getItemTestLabelCoordinate(makeItem({ kind: RETIRED_AUCTION_KIND, dTag: 'old-lot' }))).toBeNull()
	})

	test('isProductTestLabeled stays product-only', () => {
		testLabelActions.setLabel(`1440:${SELLER}:lot-1`, 'label-1', LABELER)
		testLabelActions.setLabel(`30402:${SELLER}:mug`, 'label-2', LABELER)

		// A labeled lot is not a labeled product, and the converse holds too:
		// the predicate is about the kind in hand, not about the store.
		expect(isProductTestLabeled(makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-1' }))).toBe(false)
		expect(isProductTestLabeled(makeItem({ kind: TEST_LABEL_PRODUCT_KIND, dTag: 'mug' }))).toBe(true)
	})

	test('collectTestLabelCoordinates batches arena lots and skips retired listings', () => {
		const events = [
			makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-1' }),
			makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-2' }),
			makeItem({ kind: RETIRED_AUCTION_KIND, dTag: 'old-lot' }),
			makeItem({ kind: TEST_LABEL_PRODUCT_KIND, dTag: 'mug' }),
		]

		expect(collectTestLabelCoordinates(events)).toEqual([`1440:${SELLER}:lot-1`, `1440:${SELLER}:lot-2`, `30402:${SELLER}:mug`])
	})

	test('filterTestLabeledEvents drops a labeled arena lot and leaves the retired listing alone', () => {
		const labeledCoordinate = `1440:${SELLER}:lot-1`
		// `applyFetchedLabels` is what arms the loaded state the filter gates on.
		testLabelActions.applyFetchedLabels(new Map([[labeledCoordinate, { eventId: 'label-1', labelerPubkey: LABELER }]]), [labeledCoordinate])

		const labeledLot = makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-1' })
		const controlLot = makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-2' })
		const retiredLot = makeItem({ kind: RETIRED_AUCTION_KIND, dTag: 'old-lot' })

		expect(filterTestLabeledEvents([labeledLot, controlLot, retiredLot]).map((event) => event.id)).toEqual([controlLot.id, retiredLot.id])
	})
})

// --- The coordinate-shaped gate (read-models that already carry `coordinate`) ---

describe('coordinate-shaped test-label filters', () => {
	interface Item {
		coordinate: string
	}

	const item = (coordinate: string): Item => ({ coordinate })

	test('filterTestLabeledItems drops a labeled coordinate and keeps the rest', () => {
		const labeled = `1440:${SELLER}:lot-1`
		testLabelActions.applyFetchedLabels(new Map([[labeled, { eventId: 'label-1', labelerPubkey: LABELER }]]), [labeled])

		const items = [item(labeled), item(`1440:${SELLER}:lot-2`)]

		expect(filterTestLabeledItems(items).map((entry) => entry.coordinate)).toEqual([`1440:${SELLER}:lot-2`])
		expect(isCoordinateTestLabeled(labeled)).toBe(true)
		expect(isCoordinateTestLabeled(`1440:${SELLER}:lot-2`)).toBe(false)
	})

	test('fails open until a label read has populated the store — nothing is hidden', () => {
		// A label in the set with `isLoaded` still false: the read did not happen,
		// so it is not evidence. This is the ADR-0009 fail-open rule.
		testLabelActions.setLabel(`1440:${SELLER}:lot-1`, 'label-1', LABELER)
		expect(testLabelActions.areLabelsLoaded()).toBe(false)

		const items = [item(`1440:${SELLER}:lot-1`), item(`1440:${SELLER}:lot-2`)]

		expect(isCoordinateTestLabeled(`1440:${SELLER}:lot-1`)).toBe(false)
		expect(filterTestLabeledItems(items)).toHaveLength(2)
		expect(filterTestLabeledCoordinates([`1440:${SELLER}:lot-1`])).toHaveLength(1)
	})

	test('the coordinate filters read the same store as the event filter', () => {
		const labeled = `1440:${SELLER}:lot-1`
		testLabelActions.applyFetchedLabels(new Map([[labeled, { eventId: 'label-1', labelerPubkey: LABELER }]]), [labeled])

		// Same truth, both shapes: the event carries the same coordinate.
		expect(isAuctionTestLabeled(makeItem({ kind: ARENA_AUCTION_CREATE_KIND, dTag: 'lot-1' }))).toBe(true)
		expect(isCoordinateTestLabeled(labeled)).toBe(true)
		expect(filterTestLabeledCoordinates([labeled])).toEqual([])
	})
})