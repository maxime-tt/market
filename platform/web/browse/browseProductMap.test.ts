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
import { collapseProductFamilyEvents, mapProduct, mapProductDetail, mapProductWithFamily, readProductPrice } from './browseProductMap'

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

// ---------------------------------------------------------------------------
// Product families — collapse to one row and carry the family fields
// ---------------------------------------------------------------------------

const PARENT_ADDRESS = `30402:${PUBKEY}:shoe`

/** A `type=variable` parent. */
function familyParent(extraTags: string[][] = []): NostrEventLike {
	return listing('shoe', [['type', 'variable'], ['title', 'Trail Runner'], ...extraTags])
}

/** A `type=variation` child naming the parent above. */
function child(dTag: string, size: string, extraTags: string[][] = []): NostrEventLike {
	return listing(dTag, [['type', 'variation'], ['a', PARENT_ADDRESS], ['spec', 'size', size], ...extraTags])
}

describe('family mapper and collapse', () => {
	test('the mapper carries the family fields for a parent', () => {
		const parent = familyParent([['price', '100', 'USD']])
		const rows = collapseProductFamilyEvents([
			child('shoe-42', '42', [
				['price', '100', 'USD'],
				['stock', '2'],
			]),
			child('shoe-43', '43', [
				['price', '120', 'USD'],
				['stock', '1'],
			]),
			parent,
		])

		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			id: 'shoe',
			familyRole: 'parent',
			familyAddress: PARENT_ADDRESS,
			variantCount: 2,
			availableVariantCount: 2,
			priceMin: 100,
			priceMax: 120,
		})
		expect(rows[0]?.specKeys).toEqual(['size'])
	})

	test('the mapper states a variation’s own role and label', () => {
		// No family container: a lone variation still renders its option.
		const row = mapProductWithFamily(child('shoe-42', '42'), null)
		expect(row?.familyRole).toBe('variation')
		expect(row?.variantLabel).toBe('42')
		// A lone variation is not a family row: no aggregate fields.
		expect(row?.familyAddress).toBeUndefined()
		expect(row?.variantCount).toBeUndefined()
	})

	test('leaves the family fields absent for a simple listing', () => {
		const product = mapProduct(
			listing('mug', [
				['title', 'Mug'],
				['price', '5', 'SATS'],
			]),
		)
		expect(product?.familyRole).toBeUndefined()
		expect(product?.familyAddress).toBeUndefined()
		expect(product?.variantLabel).toBeUndefined()
		expect(product?.variantCount).toBeUndefined()
		expect(product?.availableVariantCount).toBeUndefined()
		expect(product?.priceMin).toBeUndefined()
		expect(product?.priceMax).toBeUndefined()
		expect(product?.specKeys).toBeUndefined()
	})

	test('the price reader reads one currency and ignores a mismatched one', () => {
		expect(readProductPrice(listing('priced', [['price', '53', 'USD']]))).toEqual({ amount: 53, currency: 'USD' })
		expect(readProductPrice(listing('unpriced', [['title', 'Mug']]))).toBeNull()

		// A single range cannot span two currencies: the first one seen wins, so
		// the EUR option is ignored and the range stays in USD.
		const rows = collapseProductFamilyEvents([
			child('shoe-42', '42', [['price', '100', 'USD']]),
			child('shoe-43', '43', [['price', '120', 'USD']]),
			child('shoe-44', '44', [['price', '500', 'EUR']]),
			familyParent(),
		])
		expect(rows[0]?.priceMin).toBe(100)
		expect(rows[0]?.priceMax).toBe(120)
	})

	test('collapses a three-child family to ONE row, preferring the parent', () => {
		const children = [42, 43, 44].map((size) => child(`shoe-${size}`, String(size)))
		const rows = collapseProductFamilyEvents([...children, familyParent()])

		expect(rows).toHaveLength(1)
		expect(rows[0]?.id).toBe('shoe')
		expect(rows[0]?.variantCount).toBe(3)
	})

	test('a family with no parent present still returns exactly one row', () => {
		const children = [42, 43, 44].map((size) => child(`shoe-${size}`, String(size)))
		const rows = collapseProductFamilyEvents(children)

		expect(rows).toHaveLength(1)
		expect(rows[0]?.familyRole).toBe('variation')
	})

	test('leaves non-family listings untouched', () => {
		const rows = collapseProductFamilyEvents([
			listing('hat', [
				['title', 'Hat'],
				['price', '9', 'SATS'],
			]),
			listing('belt', [
				['title', 'Belt'],
				['price', '12', 'SATS'],
			]),
		])
		expect(rows.map((row) => row.id)).toEqual(['hat', 'belt'])
	})

	test('a stockless three-child family still collapses to one row with a price range', () => {
		// Regression guard: most of the real market carries no `stock` tag, which
		// the stock rule reads as sold out. Routing this path through the
		// availability-filtered catalogue would collapse it to ZERO rows. The
		// collapse must not consult stock, and the price range falls back to all
		// variations when none is available.
		const rows = collapseProductFamilyEvents([
			child('shoe-42', '42', [['price', '12', 'EUR']]),
			child('shoe-43', '43', [['price', '15', 'EUR']]),
			child('shoe-44', '44', [['price', '18', 'EUR']]),
			familyParent(),
		])

		expect(rows).toHaveLength(1)
		expect(rows[0]?.variantCount).toBe(3)
		expect(rows[0]?.priceMin).toBe(12)
		expect(rows[0]?.priceMax).toBe(18)
	})
})
