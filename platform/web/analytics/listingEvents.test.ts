import { describe, expect, test } from 'bun:test'
import {
	K_ANONYMITY_FLOOR,
	bucketCount,
	buildListingEventPayload,
	createListingEventRecorder,
	isListingCoordinate,
	summarizeListingEvents,
	type ListingEventRow,
} from './listingEvents'

const ON = { enabled: true, src: 'https://analytics.example.org/', websiteId: 'site-1' }
const COORD = `30402:${'a'.repeat(64)}:orange-flock-black`

const row = (name: ListingEventRow['name'], coordinate = COORD, period = '2026-11-12'): ListingEventRow => ({ coordinate, name, period })

describe('listing analytics', () => {
	test('a coordinate addresses a listing; anything else is refused', () => {
		expect(isListingCoordinate(COORD)).toBe(true)
		expect(isListingCoordinate('30402:nothex:thing')).toBe(false)
		expect(isListingCoordinate('30023:' + 'a'.repeat(64) + ':x')).toBe(false)
		expect(buildListingEventPayload(ON, 'listing_view', 'nonsense')).toBeNull()
	})

	test('an event carries the coordinate and nothing about the person', () => {
		const body = buildListingEventPayload(ON, 'listing_view', COORD)
		expect(body).toEqual({
			type: 'event',
			payload: { website: 'site-1', name: 'listing_view', data: { coordinate: COORD } },
		})
		expect(Object.keys(body!.payload.data)).toEqual(['coordinate'])
	})

	test('unconfigured means nothing is sent', async () => {
		const calls: unknown[] = []
		const fakeFetch = (async (...args: unknown[]) => {
			calls.push(args)
			return new Response('{}')
		}) as unknown as typeof fetch
		await createListingEventRecorder({ enabled: false }, fakeFetch).record('listing_purchase', COORD)
		expect(calls.length).toBe(0)
	})

	test('aggregates below the k-anonymity floor do not report at all', () => {
		const oneView = summarizeListingEvents([row('listing_view')])
		expect(oneView).toEqual([])

		const nearly = summarizeListingEvents(Array.from({ length: K_ANONYMITY_FLOOR - 1 }, () => row('listing_view')))
		expect(nearly).toEqual([])
	})

	test('counts at or above the floor are bucketed, never exact', () => {
		const rows = Array.from({ length: K_ANONYMITY_FLOOR }, () => row('listing_view'))
		expect(summarizeListingEvents(rows)).toEqual([
			{ coordinate: COORD, name: 'listing_view', bucket: `${K_ANONYMITY_FLOOR}–9`, count: K_ANONYMITY_FLOOR },
		])
		expect(bucketCount(12)?.bucket).toBe('10–24')
		expect(bucketCount(240)?.bucket).toBe('100+')
		expect(bucketCount(1)).toBeNull()
	})

	test('periods and event names stay separate', () => {
		const rows = [
			...Array.from({ length: 6 }, () => row('listing_view', COORD, '2026-11-12')),
			...Array.from({ length: 6 }, () => row('listing_view', COORD, '2026-11-13')),
			...Array.from({ length: 6 }, () => row('listing_purchase', COORD, '2026-11-12')),
		]
		const summary = summarizeListingEvents(rows)
		expect(summary.length).toBe(3)
		expect(summary.every((r) => r.bucket === '5–9')).toBe(true)
	})
})
