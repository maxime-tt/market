import { describe, expect, test } from 'bun:test'
import { ARENA_AUCTION_CREATE_KIND } from '../../commerce/auctions/constants'
import { createTestPublishContext } from '../testing/publishContext'
import { CURATION_LISTS, buildCurationListEventData, isValidCurationListItem } from './curationLists'
import { publishCurationListWorkflow } from './curationPublish'

const pk = (char: string) => char.repeat(64)

/** A live arena lot: `1440:<seller>:<d>`. */
const lotCoord = `1440:${pk('a')}:lot-1`
/** The retired 30408 family — no live lot can carry this coordinate any more. */
const retiredCoord = `30408:${pk('a')}:lot-1`

describe('featured auctions name arena lots', () => {
	test('the item kind is the arena create kind, not a retired family', () => {
		expect(CURATION_LISTS.featuredAuctions).toEqual({
			kind: 30409,
			dTag: 'featured_auctions',
			itemTag: 'a',
			itemKind: ARENA_AUCTION_CREATE_KIND,
		})
	})

	test('accepts a 1440 coordinate', () => {
		expect(isValidCurationListItem('featuredAuctions', lotCoord)).toBe(true)
	})

	test('refuses a retired 30408 coordinate', () => {
		expect(isValidCurationListItem('featuredAuctions', retiredCoord)).toBe(false)
	})

	test('rejects a retired coordinate before signing and publishes nothing', async () => {
		const { context, published } = createTestPublishContext()
		expect(await publishCurationListWorkflow(context, 'featuredAuctions', [retiredCoord])).toEqual({
			ok: false,
			issue: 'invalid-item',
			item: retiredCoord,
		})
		expect(published).toHaveLength(0)
	})

	test('publishes a 1440 coordinate as an a tag on the featured_auctions list', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishCurationListWorkflow(context, 'featuredAuctions', [lotCoord])
		expect(outcome.ok).toBe(true)
		expect(published).toHaveLength(1)
		expect(buildCurationListEventData('featuredAuctions', [lotCoord])).toEqual({
			kind: 30409,
			content: '',
			tags: [
				['d', 'featured_auctions'],
				['a', lotCoord],
			],
		})
	})
})