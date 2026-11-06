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
	test('maps real listings to strip items — id, title, and the pubkey as the seller fallback', () => {
		const strips = feedStrips([product('1', A, [])], 8)
		expect(strips).toEqual([
			{
				id: '1',
				title: 'Product 1',
				seller: A.slice(0, 8),
				image: undefined,
				price: undefined,
				priceCurrency: undefined,
				material: expect.any(String),
				symbolId: expect.any(String),
			},
		])
	})

	test("carries the listing's own image, price and unit — the facts the card shows", () => {
		const listing: BrowseProduct = {
			...product('1', A, []),
			image: 'https://cdn.example/bowl.jpg',
			price: 21000,
			currency: 'USD',
		}
		const [strip] = feedStrips([listing], 8)
		expect(strip?.image).toBe('https://cdn.example/bowl.jpg')
		expect(strip?.price).toBe(21000)
		expect(strip?.priceCurrency).toBe('USD')
	})

	test('a listing with no image still carries the deterministic art as its fallback', () => {
		const [strip] = feedStrips([product('1', A, [])], 8)
		expect(strip?.image).toBeUndefined()
		// The art is the fallback the tile renders: material + symbol, assigned
		// from the pubkey exactly as the card assigns them.
		expect(strip?.material).toMatch(/^m[1-8]$/)
		expect(strip?.symbolId).toMatch(/^p-/)
	})

	test('states the seller name the resolver returns, not a pubkey prefix', () => {
		const [strip] = feedStrips([product('1', A, [])], 8, (pubkey) => (pubkey === A ? 'Atelier Norte' : undefined))
		expect(strip?.seller).toBe('Atelier Norte')
	})

	test('falls back to the pubkey prefix when the seller has no profile name', () => {
		const [strip] = feedStrips([product('1', A, [])], 8, () => undefined)
		expect(strip?.seller).toBe(A.slice(0, 8))
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
