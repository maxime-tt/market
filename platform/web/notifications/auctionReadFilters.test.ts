import { describe, expect, test } from 'bun:test'
import { buildLiveActivityDTag, RELAY_TAG_INDEX_VALUE_MAX_LENGTH } from '@sdk/core/nostr/nip53'
import {
	auctionBidScopeFilters,
	commentTargetScopeFilters,
	liveActivityScopeFilters,
	type AuctionScopeTagFilter,
} from './auctionReadFilters'

const SELLER = '0e2f9ac8135df7157c2d57dab59396955145251bd8335ecafb1fceab46d1f5ed'
const LOT_D = '7a19b2b1-a414-45c9-9c17-2adb6a3d39d5'
const LOT_COORDINATE = `1440:${SELLER}:${LOT_D}`
const LOT_ROOT_ID = 'c5f0a247f5266e4c9a8cb311c03513033838e11754cd6b3b6c9083d04a4d6c4c'
const LOT_UPDATE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

const allValues = (filters: AuctionScopeTagFilter[]): string[] => filters.flatMap((filter) => filter.values)

describe('the relay index budget the lot reads must fit', () => {
	test('a lot coordinate with a UUID d is longer than the relay indexes', () => {
		// `1440:` + 64 hex + `:` + 36-char UUID. This is the measured store rule, not a choice.
		expect(LOT_COORDINATE).toHaveLength(106)
		expect(LOT_COORDINATE.length).toBeGreaterThan(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
	})

	test('every value the lot reads send is inside the budget', () => {
		const filters = [
			...auctionBidScopeFilters({ rootEventIds: [LOT_ROOT_ID] }),
			...commentTargetScopeFilters({
				targetKind: 1440,
				targetEventIds: [LOT_ROOT_ID, LOT_UPDATE_ID],
				targetCoordinates: [LOT_COORDINATE],
			}),
			...liveActivityScopeFilters([LOT_COORDINATE]),
		]

		const indexedFilters = filters.filter((filter) => filter.tagName !== '#a')
		expect(indexedFilters.length).toBe(filters.length)
		for (const value of allValues(indexedFilters)) {
			expect(value.length).toBeLessThanOrEqual(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
		}
	})
})

describe("a lot's bids: #e over the root create id", () => {
	test('asks for the root create id', () => {
		expect(auctionBidScopeFilters({ rootEventIds: [LOT_ROOT_ID] })).toEqual([{ tagName: '#e', values: [LOT_ROOT_ID] }])
	})

	test('never asks for the 106-character coordinate, which the relay cannot index', () => {
		// Measured on the running relay: `#a` with this value answers 0 while `#e` answers the bid.
		// NDK's guardrails (on in development and staging) additionally reject an `#a` value naming
		// a non-addressable kind, which aborts monitor initialization outright.
		const filters = auctionBidScopeFilters({ rootEventIds: [LOT_ROOT_ID] })
		expect(filters.some((filter) => filter.tagName === '#a')).toBe(false)
		expect(allValues(filters)).not.toContain(LOT_COORDINATE)
	})

	test('watched lots: one clause for every root, deduplicated', () => {
		expect(auctionBidScopeFilters({ rootEventIds: [LOT_ROOT_ID, LOT_UPDATE_ID, LOT_ROOT_ID] })).toEqual([
			{ tagName: '#e', values: [LOT_ROOT_ID, LOT_UPDATE_ID] },
		])
	})

	test('a lot with no known root id states no filter at all, never an empty clause', () => {
		expect(auctionBidScopeFilters({ rootEventIds: [] })).toEqual([])
		expect(auctionBidScopeFilters({ rootEventIds: [''] })).toEqual([])
	})
})

describe("a lot's comments: #E for every create version, never #a/#A", () => {
	test('a 1440 target is read by every known version id', () => {
		// A comment on the latest version carries `E` = that version's id, so reading only the
		// root id misses exactly the comments the app's lot page invites.
		expect(
			commentTargetScopeFilters({
				targetKind: 1440,
				targetEventIds: [LOT_ROOT_ID, LOT_UPDATE_ID],
				targetCoordinates: [LOT_COORDINATE],
			}),
		).toEqual([{ tagName: '#E', values: [LOT_ROOT_ID, LOT_UPDATE_ID] }])
	})

	test('a regular target never gets the coordinate clauses the old read asked for', () => {
		const filters = commentTargetScopeFilters({ targetKind: 1440, targetEventIds: [LOT_ROOT_ID] })
		expect(filters.some((filter) => filter.tagName === '#a' || filter.tagName === '#A')).toBe(false)
	})

	test('a 30402 product target is read by its coordinate, with no #E clause', () => {
		const coordinate = `30402:${SELLER}:a1Mai3P716`
		expect(
			commentTargetScopeFilters({ targetKind: 30402, targetCoordinates: [coordinate], targetEventIds: [LOT_ROOT_ID] }),
		).toEqual([
			{ tagName: '#a', values: [coordinate] },
			{ tagName: '#A', values: [coordinate] },
		])
	})

	test('a product coordinate with a short d fits the index budget', () => {
		const coordinate = `30402:${SELLER}:a1Mai3P716`
		expect(coordinate.length).toBeLessThanOrEqual(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
	})
})

describe("a lot's live activity: #d, the derived address", () => {
	test('asks for the derived d and not the 106-character coordinate', () => {
		const dTag = buildLiveActivityDTag(LOT_COORDINATE)
		expect(dTag).toMatch(/^auction:[0-9a-f]{12}$/)
		expect(liveActivityScopeFilters([LOT_COORDINATE])).toEqual([{ tagName: '#d', values: [dTag] }])
		expect(dTag.length).toBeLessThanOrEqual(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
	})

	test('the derived d matches what the producer puts on the event', () => {
		// `buildLiveActivityTags` derives the activity `d` from the same coordinate, so the filter
		// addresses exactly the event the cvm live-activity worker publishes.
		const dTag = liveActivityScopeFilters([LOT_COORDINATE])[0].values[0]
		expect(dTag).toBe(buildLiveActivityDTag(LOT_COORDINATE))
		expect(dTag.startsWith('auction:')).toBe(true)
	})

	test('several lots read under one #d clause', () => {
		const other = `1440:${SELLER}:0453d4aa-85f2-4bc9-bf28-0664abcc31b1`
		expect(liveActivityScopeFilters([LOT_COORDINATE, other])).toEqual([
			{ tagName: '#d', values: [buildLiveActivityDTag(LOT_COORDINATE), buildLiveActivityDTag(other)] },
		])
	})

	test('no coordinates states no filter at all', () => {
		expect(liveActivityScopeFilters([])).toEqual([])
	})
})