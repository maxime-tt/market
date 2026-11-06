/**
 * platform/web/browse/browseProductMap.test.ts — the canonical kind-30402 →
 * BrowseProduct mapper.
 *
 * The facts a card cannot re-derive and must therefore get from here: the price
 * tag's own unit (dropped before this, which made every fiat listing render as
 * "sats"), the listing's first image, and the listing's identity fields.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { mapProduct, mapProductDetail } from './browseProductMap'

const PUBKEY = 'a'.repeat(64)

function listing(id: string, tags: string[][]): NostrEventLike {
	return {
		id: `event-${id}`,
		pubkey: PUBKEY,
		kind: 30402,
		created_at: 1_700_000_000,
		content: 'A listing body.',
		tags: [['d', id], ...tags],
	}
}

describe('mapProduct', () => {
	test('keeps the price amount and its own currency from the price tag', () => {
		const product = mapProduct(
			listing('fiat', [
				['title', 'Dubai property'],
				['price', '53', 'USD'],
			]),
		)
		expect(product?.price).toBe(53)
		expect(product?.currency).toBe('USD')
	})

	test('keeps a sats price tag’s own currency code too', () => {
		const product = mapProduct(
			listing('sats', [
				['title', 'Mug'],
				['price', '21000', 'SATS'],
			]),
		)
		expect(product?.price).toBe(21000)
		expect(product?.currency).toBe('SATS')
	})

	test('states no currency when the price tag omits it', () => {
		const product = mapProduct(
			listing('bare', [
				['title', 'Mug'],
				['price', '1500'],
			]),
		)
		expect(product?.price).toBe(1500)
		expect(product?.currency).toBeUndefined()
	})

	test('states no currency when the listing carries no price tag at all', () => {
		const product = mapProduct(listing('unpriced', [['title', 'Mug']]))
		expect(product?.price).toBeUndefined()
		expect(product?.currency).toBeUndefined()
	})

	test('takes the listing’s first image tag', () => {
		const product = mapProduct(
			listing('imaged', [
				['title', 'Mug'],
				['image', 'https://example.test/first.png'],
				['image', 'https://example.test/second.png'],
			]),
		)
		expect(product?.image).toBe('https://example.test/first.png')
	})

	test('states no relays of its own — the mapper cannot see the index hit', () => {
		const product = mapProduct(
			listing('unrelayed', [
				['title', 'Mug'],
				['price', '1', 'SATS'],
			]),
		)
		expect(product?.relays).toBeUndefined()
	})

	test('maps the identity fields a card addresses', () => {
		const product = mapProduct(
			listing('ceramic-ball', [
				['title', 'Ceramic Ball'],
				['t', 'pottery'],
				['location', 'Porto'],
			]),
		)
		expect(product).toMatchObject({
			id: 'ceramic-ball',
			eventId: 'event-ceramic-ball',
			pubkey: PUBKEY,
			title: 'Ceramic Ball',
			categories: ['pottery'],
			location: 'Porto',
		})
	})
})

describe('mapProductDetail', () => {
	test('keeps the currency alongside the description and shipping costs', () => {
		const detail = mapProductDetail(
			listing('shipped', [
				['title', 'Mug'],
				['price', '53', 'USD'],
				['shipping_option', 'standard', '2400'],
			]),
		)
		expect(detail?.currency).toBe('USD')
		expect(detail?.description).toBe('A listing body.')
		expect(detail?.shipping).toEqual([{ costSats: 2400 }])
	})
})
