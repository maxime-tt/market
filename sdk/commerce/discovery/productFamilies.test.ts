import { describe, expect, test } from 'bun:test'
import {
	findProductFamily,
	getProductAddress,
	getProductEventType,
	getProductFamilyImages,
	getProductFamilyPriceRange,
	getProductFamilySpecKeys,
	getVariationLabel,
	getVariationParentAddress,
	getVariationSpecs,
	groupProductSearchResultsByFamily,
	isProductHidden,
	parseProductAddress,
	prepareProductFamilyCatalog,
	resolveProductVariation,
} from './productFamilies'

const seller = 'a'.repeat(64)
const other = 'b'.repeat(64)
const parentAddress = `30402:${seller}:shoe`

interface Raw {
	kind?: number
	id?: string
	pubkey?: string
	created_at?: number
	tags: string[][]
}

const listing = (dTag: string, tags: string[][] = [], overrides: Partial<Raw> = {}): Raw => ({
	kind: 30402,
	id: `id-${dTag}`,
	pubkey: seller,
	created_at: 1,
	tags: [['d', dTag], ...tags],
	...overrides,
})

const variation = (dTag: string, tags: string[][], overrides: Partial<Raw> = {}): Raw =>
	listing(dTag, [['type', 'variation', 'physical'], ...tags], overrides)

const readPrice = (event: Raw) => {
	const tag = event.tags.find((t) => t[0] === 'price')
	return tag ? { amount: Number(tag[1]), currency: tag[2] } : null
}

describe('event type and address', () => {
	test('reads the type tag, defaulting to simple', () => {
		expect(getProductEventType({ tags: [] })).toBe('simple')
		expect(getProductEventType({ tags: [['type', '']] })).toBe('simple')
		expect(getProductEventType(listing('a', [['type', 'variable']]))).toBe('variable')
		expect(getProductEventType(variation('a', []))).toBe('variation')
		expect(getProductEventType({ tags: [['type', 'bundle']] })).toBe('bundle')
	})

	test('builds a lowercased coordinate, refusing ambiguous identities', () => {
		expect(getProductAddress(listing('coat'))).toBe(`30402:${seller}:coat`)
		expect(getProductAddress(listing('coat', [], { pubkey: seller.toUpperCase() }))).toBe(`30402:${seller}:coat`)
		expect(getProductAddress(listing('coat', [['d', 'second']]))).toBeNull()
		expect(getProductAddress(listing(''))).toBeNull()
		expect(getProductAddress(listing('coat', [], { pubkey: 'not-hex' }))).toBeNull()
		expect(getProductAddress(listing('coat', [], { kind: 30405 }))).toBeNull()
	})

	test('parses only well-formed product coordinates', () => {
		expect(parseProductAddress(parentAddress)).toEqual({ address: parentAddress, pubkey: seller, dTag: 'shoe' })
		expect(parseProductAddress(`30405:${seller}:shoe`)).toBeNull()
		expect(parseProductAddress(`30402:${seller}:`)).toBeNull()
		expect(parseProductAddress(`30402:${seller}`)).toBeNull()
	})
})

describe('getVariationParentAddress refuses to guess', () => {
	test('returns null for a non-variation', () => {
		expect(getVariationParentAddress(listing('shoe', [['a', parentAddress]]))).toBeNull()
	})

	test('returns null with no parent tag', () => {
		expect(getVariationParentAddress(variation('shoe', [['spec', 'size', '42']]))).toBeNull()
	})

	test('returns null with more than one product parent tag', () => {
		expect(getVariationParentAddress(variation('shoe', [['a', parentAddress], ['a', parentAddress]]))).toBeNull()
	})

	test('returns null for a malformed coordinate', () => {
		expect(getVariationParentAddress(variation('shoe', [['a', `30402:${seller}`]]))).toBeNull()
		expect(getVariationParentAddress(variation('shoe', [['a', 'not-a-coordinate']]))).toBeNull()
	})

	test('returns null when the parent pubkey differs from the child author', () => {
		expect(getVariationParentAddress(variation('shoe', [['a', `30402:${other}:shoe`]]))).toBeNull()
	})

	test('returns the address for an unambiguous parent', () => {
		expect(getVariationParentAddress(variation('shoe', [['a', parentAddress]]))).toBe(parentAddress)
	})
})

describe('variation labels and specs', () => {
	test('one spec reads as its value', () => {
		expect(getVariationLabel(variation('shoe', [['spec', 'size', '42']]))).toBe('42')
	})

	test('several specs read as key: value pairs', () => {
		expect(
			getVariationLabel(
				variation('shoe', [
					['spec', 'size', '42'],
					['spec', 'color', 'red'],
				]),
			),
		).toBe('size: 42 / color: red')
	})

	test('excludes a sku-only spec and falls back to the title', () => {
		const skuOnly = variation('shoe', [
			['spec', 'SKU', 'ABC-1'],
			['title', 'Runner 42'],
		])
		expect(getVariationSpecs(skuOnly)).toEqual([])
		expect(getVariationLabel(skuOnly)).toBe('Runner 42')
	})

	test('falls back to title, then d-tag, then Option', () => {
		expect(getVariationLabel(variation('shoe', [['title', 'Runner'], ['spec', 'sku', 'x']]))).toBe('Runner')
		expect(getVariationLabel(variation('shoe', []))).toBe('shoe')
	})
})

describe('isProductHidden', () => {
	test('only an exact hidden visibility hides', () => {
		expect(isProductHidden({ tags: [['visibility', 'hidden']] })).toBe(true)
		expect(isProductHidden({ tags: [['visibility', 'on-sale']] })).toBe(false)
		expect(isProductHidden({ tags: [] })).toBe(false)
	})
})

describe('prepareProductFamilyCatalog', () => {
	test('keeps the newest revision per address with a lower-id tie-break', () => {
		const older = listing('shoe', [['title', 'old'], ['stock', '1']], { id: 'b', created_at: 1 })
		const newer = listing('shoe', [['title', 'new'], ['stock', '1']], { id: 'a', created_at: 2 })
		const tiedLow = listing('coat', [['title', 'low'], ['stock', '1']], { id: 'aaa', created_at: 5 })
		const tiedHigh = listing('coat', [['title', 'high'], ['stock', '1']], { id: 'zzz', created_at: 5 })
		const catalog = prepareProductFamilyCatalog([older, newer, tiedHigh, tiedLow])
		const titles = catalog.items.map((item) => item.product.tags.find((t) => t[0] === 'title')?.[1])
		expect(titles).toContain('new')
		expect(titles).not.toContain('old')
		expect(titles).toContain('low')
		expect(titles).not.toContain('high')
	})

	test('groups a variable parent with its children as a family', () => {
		const parent = listing('shoe', [['type', 'variable', 'physical']], { created_at: 3 })
		const size42 = variation('shoe-42', [
			['a', parentAddress],
			['spec', 'size', '42'],
			['stock', '4'],
		])
		const size43 = variation('shoe-43', [
			['a', parentAddress],
			['spec', 'size', '43'],
			['stock', '0'],
		])
		const catalog = prepareProductFamilyCatalog([parent, size42, size43])

		expect(catalog.items).toHaveLength(1)
		const item = catalog.items[0]
		expect(item.kind).toBe('family')
		if (item.kind !== 'family') throw new Error('expected family item')
		expect(item.family.variations.map((v) => v.label)).toEqual(['42', '43'])
		expect(item.family.availableVariations.map((v) => v.label)).toEqual(['42'])
	})

	test('treats a childless variable parent like a simple product', () => {
		const parent = listing('lone', [['type', 'variable'], ['stock', '2']])
		const catalog = prepareProductFamilyCatalog([parent])
		expect(catalog.items).toHaveLength(1)
		expect(catalog.items[0].kind).toBe('simple')
	})

	test('excludes a hidden child from variations without destroying the family', () => {
		const parent = listing('shoe', [['type', 'variable']])
		const visible = variation('shoe-42', [
			['a', parentAddress],
			['spec', 'size', '42'],
			['stock', '1'],
		])
		const hidden = variation('shoe-43', [
			['a', parentAddress],
			['spec', 'size', '43'],
			['stock', '1'],
			['visibility', 'hidden'],
		])
		const catalog = prepareProductFamilyCatalog([parent, visible, hidden])
		const item = catalog.items[0]
		if (item.kind !== 'family') throw new Error('expected family item')
		expect(item.family.variations.map((v) => v.label)).toEqual(['42'])
		expect(catalog.items).toHaveLength(1)
	})

	test('surfaces an available orphan variation on its own', () => {
		const orphan = variation('shoe-42', [['a', `30402:${seller}:missing`], ['stock', '1']])
		const catalog = prepareProductFamilyCatalog([orphan])
		expect(catalog.unresolvedVariations).toHaveLength(1)
		expect(catalog.items[0].kind).toBe('unresolved-variation')
	})

	test('orders items newest-first', () => {
		const old = listing('old', [['stock', '1']], { created_at: 1 })
		const recent = listing('recent', [['stock', '1']], { created_at: 9 })
		const catalog = prepareProductFamilyCatalog([old, recent])
		expect(catalog.items.map((item) => item.product.tags[0][1])).toEqual(['recent', 'old'])
	})

	test('exposes spec keys in first-seen order', () => {
		const parent = listing('shoe', [['type', 'variable']])
		const a = variation('shoe-42', [
			['a', parentAddress],
			['spec', 'size', '42'],
			['spec', 'color', 'red'],
			['stock', '1'],
		])
		const b = variation('shoe-43', [
			['a', parentAddress],
			['spec', 'width', 'wide'],
			['stock', '1'],
		])
		const catalog = prepareProductFamilyCatalog([parent, b, a])
		const family = findProductFamily(catalog, parent)
		if (!family) throw new Error('expected family')
		expect(getProductFamilySpecKeys(family)).toEqual(['size', 'color', 'width'])
	})
})

describe('family resolution and presentation', () => {
	const build = () => {
		const parent = listing('shoe', [['type', 'variable'], ['image', 'parent.jpg']], { created_at: 3 })
		const size42 = variation('shoe-42', [
			['a', parentAddress],
			['spec', 'size', '42'],
			['stock', '4'],
			['image', 'forty-two.jpg'],
			['price', '100', 'USD'],
		])
		const size43 = variation('shoe-43', [
			['a', parentAddress],
			['spec', 'size', '43'],
			['stock', '0'],
			['price', '120', 'USD'],
		])
		return prepareProductFamilyCatalog([parent, size42, size43])
	}

	test('findProductFamily matches the parent and its variations', () => {
		const catalog = build()
		const parent = catalog.families[0].parent
		expect(findProductFamily(catalog, parent)).toBe(catalog.families[0])
		expect(findProductFamily(catalog, catalog.families[0].variations[0].product)).toBe(catalog.families[0])
		expect(findProductFamily(catalog, listing('unrelated'))).toBeNull()
	})

	test('resolveProductVariation defaults to available, then all', () => {
		const catalog = build()
		const family = catalog.families[0]
		expect(resolveProductVariation(family)?.label).toBe('42')
		expect(resolveProductVariation(family, 'shoe-43')?.label).toBe('43')
		expect(resolveProductVariation(family, 'shoe-99')).toBeNull()
	})

	test('defaults to the first variation when none is available', () => {
		const parent = listing('shoe', [['type', 'variable']])
		const sold = variation('shoe-42', [['a', parentAddress], ['spec', 'size', '42'], ['stock', '0']])
		const catalog = prepareProductFamilyCatalog([parent, sold])
		expect(catalog.families[0].availableVariations).toHaveLength(0)
		expect(resolveProductVariation(catalog.families[0])?.label).toBe('42')
	})

	test('inherits parent images only when the variation has none', () => {
		const catalog = build()
		const family = catalog.families[0]
		const withImages = family.variations.find((v) => v.label === '42')!
		const withoutImages = family.variations.find((v) => v.label === '43')!
		expect(getProductFamilyImages(family.parent, withImages).map((t) => t[1])).toEqual(['forty-two.jpg'])
		expect(getProductFamilyImages(family.parent, withoutImages).map((t) => t[1])).toEqual(['parent.jpg'])
		expect(getProductFamilyImages(family.parent, null).map((t) => t[1])).toEqual(['parent.jpg'])
	})

	test('computes a price range over available children, falling back when sold out', () => {
		const catalog = build()
		const family = catalog.families[0]
		expect(getProductFamilyPriceRange(family, readPrice)).toEqual({ min: 100, max: 100, currency: 'USD' })

		const soldOutParent = listing('boot', [['type', 'variable']])
		const a = variation('boot-1', [['a', `30402:${seller}:boot`], ['price', '80', 'USD'], ['stock', '0']])
		const b = variation('boot-2', [['a', `30402:${seller}:boot`], ['price', '150', 'USD'], ['stock', '0']])
		const soldCatalog = prepareProductFamilyCatalog([soldOutParent, a, b])
		expect(getProductFamilyPriceRange(soldCatalog.families[0], readPrice)).toEqual({ min: 80, max: 150, currency: 'USD' })
	})
})

describe('groupProductSearchResultsByFamily', () => {
	test('collapses N children to one row and prefers the parent', () => {
		const parent = listing('shoe', [['type', 'variable']])
		const children = [42, 43, 44].map((size) => variation(`shoe-${size}`, [['a', parentAddress], ['spec', 'size', String(size)]]))
		const rows = groupProductSearchResultsByFamily([...children, parent])
		expect(rows).toEqual([parent])
	})

	test('keeps the first child when the parent is absent', () => {
		const first = variation('shoe-42', [['a', parentAddress], ['spec', 'size', '42']])
		const second = variation('shoe-43', [['a', parentAddress], ['spec', 'size', '43']])
		expect(groupProductSearchResultsByFamily([first, second])).toEqual([first])
	})

	test('keeps a lone child as its own row', () => {
		const lone = variation('shoe-42', [['a', parentAddress], ['spec', 'size', '42']])
		expect(groupProductSearchResultsByFamily([lone])).toEqual([lone])
	})

	test('leaves non-family events untouched and in order', () => {
		const a = listing('hat', [['stock', '1']])
		const b = variation('orphan', [['stock', '1']])
		const c = listing('belt', [['stock', '1']])
		expect(groupProductSearchResultsByFamily([a, b, c])).toEqual([a, b, c])
	})
})
