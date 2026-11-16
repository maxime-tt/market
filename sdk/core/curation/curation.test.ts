import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../testing/publishContext'
import { buildBlacklistEventData, buildCurationListEventData, readCurationListItems } from './curationLists'
import { publishBlacklistWorkflow, publishCurationListWorkflow } from './curationPublish'

const pk = (char: string) => char.repeat(64)
const productCoord = `30402:${pk('a')}:mug`

describe('curation list events', () => {
	test('featured products carry title and content; other lists are bare', () => {
		expect(buildCurationListEventData('featuredProducts', [productCoord])).toEqual({
			kind: 30405,
			content: 'Featured products collection',
			tags: [
				['d', 'featured_products'],
				['title', 'Featured Products'],
				['a', productCoord],
			],
		})
		expect(buildCurationListEventData('featuredUsers', [pk('b')])).toEqual({
			kind: 30000,
			content: '',
			tags: [
				['d', 'featured_users'],
				['p', pk('b')],
			],
		})
	})

	test('blacklist is a NIP-51 mute list with p then a tags', () => {
		const data = buildBlacklistEventData({
			blacklistedPubkeys: [pk('c')],
			blacklistedProducts: [productCoord],
			blacklistedCollections: ['30405:x:y'],
		})
		expect(data).toEqual({
			kind: 10000,
			content: '',
			tags: [
				['p', pk('c')],
				['a', productCoord],
				['a', '30405:x:y'],
			],
		})
	})

	test('reads list items by the list item tag', () => {
		expect(
			readCurationListItems('admins', [
				['d', 'admins'],
				['p', pk('a')],
				['a', productCoord],
				['p', ''],
			]),
		).toEqual([pk('a')])
	})
})

describe('curation publish workflows', () => {
	test('rejects items of the wrong kind or shape before signing', async () => {
		const { context, published } = createTestPublishContext()
		expect(await publishCurationListWorkflow(context, 'featuredAuctions', [productCoord])).toEqual({
			ok: false,
			issue: 'invalid-item',
			item: productCoord,
		})
		expect(
			await publishBlacklistWorkflow(context, { blacklistedPubkeys: ['nope'], blacklistedProducts: [], blacklistedCollections: [] }),
		).toEqual({
			ok: false,
			issue: 'invalid-item',
			item: 'nope',
		})
		expect(published).toHaveLength(0)
	})

	test('refuses an empty admin list but allows an empty editor list', async () => {
		const { context, published } = createTestPublishContext()
		expect(await publishCurationListWorkflow(context, 'admins', [])).toEqual({ ok: false, issue: 'admins-required' })
		expect((await publishCurationListWorkflow(context, 'editors', [])).ok).toBe(true)
		expect(published).toHaveLength(1)
	})
})
