/**
 * platform/web/browse/browseIndexFeed.test.ts — the idle index feed's pure parts.
 *
 * The read itself (`fetchBrowseIndexFeed`) needs the relay seam; what this file
 * pins is the part the screen depends on: the grouping into the platform's own
 * categories (taxonomy order, no invented ranking, no empty rows) and the wall
 * strips' shape.
 */

import { describe, expect, test } from 'bun:test'
import { PRODUCT_CATEGORIES } from '@sdk/config/constants'
import { groupProductsByCategory, feedStrips } from './browseIndexFeed'
import type { BrowseProduct } from './browseProductMap'

function product(id: string, pubkey: string, categories: string[]): BrowseProduct {
	return { id, eventId: `evt-${id}`, pubkey, title: `Product ${id}`, categories }
}

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('groupProductsByCategory', () => {
	test('groups by the platform taxonomy, in taxonomy order', () => {
		const products = [product('1', A, ['Art']), product('2', B, ['Bitcoin'])]
		const rows = groupProductsByCategory(products)
		expect(rows.map((row) => row.category)).toEqual(['Bitcoin', 'Art'])
		expect(rows[0]?.items.map((item) => item.id)).toEqual(['2'])
		expect(rows[1]?.items.map((item) => item.id)).toEqual(['1'])
	})

	test('drops a category with nothing loaded rather than rendering an empty row', () => {
		const rows = groupProductsByCategory([product('1', A, ['Art'])])
		expect(rows.map((row) => row.category)).toEqual(['Art'])
		expect(rows.every((row) => row.items.length > 0)).toBe(true)
	})

	test('ignores a category outside the platform taxonomy', () => {
		const rows = groupProductsByCategory([product('1', A, ['handmade', 'Art'])])
		expect(rows.map((row) => row.category)).toEqual(['Art'])
	})

	test('a listing with two known categories appears in both rows, and not twice in one', () => {
		const rows = groupProductsByCategory([product('1', A, ['Art', 'Bitcoin', 'Art'])])
		expect(rows.map((row) => row.category)).toEqual(['Bitcoin', 'Art'])
		expect(rows[1]?.items).toHaveLength(1)
	})

	test('an empty loaded set yields no rows', () => {
		expect(groupProductsByCategory([])).toEqual([])
	})

	test('every row category is one the taxonomy names', () => {
		const products = [product('1', A, ['Art', 'Other']), product('2', B, ['Services'])]
		const known = new Set<string>(PRODUCT_CATEGORIES)
		for (const row of groupProductsByCategory(products)) expect(known.has(row.category)).toBe(true)
	})
})

describe('feedStrips', () => {
	test('maps real listings to strip items — id, title, and the pubkey as seller', () => {
		const strips = feedStrips([product('1', A, [])], 8)
		expect(strips).toEqual([
			{ id: '1', title: 'Product 1', seller: A.slice(0, 8), material: expect.any(String), symbolId: expect.any(String) },
		])
	})

	test('caps at the requested limit', () => {
		const products = Array.from({ length: 20 }, (_, i) => product(String(i), A, []))
		expect(feedStrips(products, 16)).toHaveLength(16)
	})

	test('assigns the same material and symbol to a pubkey every time', () => {
		const [first] = feedStrips([product('1', A, [])], 8)
		const [second] = feedStrips([product('2', A, [])], 8)
		expect(first?.material).toBe(second?.material)
		expect(first?.symbolId).toBe(second?.symbolId)
	})
})
