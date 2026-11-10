import { describe, expect, test } from 'bun:test'
import { ProductRowSchema, validateCoordinate } from './storefrontPage'

function hex64(c: string) { return c.repeat(64) }

describe('ProductRowSchema', () => {
	test('accepts valid 30402 coordinates from any author', () => {
		const validRows = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') + ':my-listing' },
			{ type: 'product-row', coordinate: '30402:' + hex64('b') + ':another-product' },
		])
		expect(validRows.success).toBe(true)
	})

	test('accepts valid coordinate with dots and hyphens in d-tag', () => {
		const validRows = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('c') + ':d-tag.example' },
		])
		expect(validRows.success).toBe(true)
	})

	test('rejects non-30402 kind', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30405:' + hex64('a') + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('rejects malformed pubkey (too short)', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a').slice(0, 32) + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('rejects malformed pubkey (too long)', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') + 'a:listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('rejects malformed pubkey (uppercase)', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + 'A'.repeat(64) + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('rejects coordinate missing colon separator', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402-' + hex64('a') + '-listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('rejects coordinate with invalid d-tag characters', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') + 'bad tag!' },
		])
		expect(invalid.success).toBe(false)
	})

	test('rejects empty d-tag', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') + ':' },
		])
		expect(invalid.success).toBe(false)
	})
})

describe('validateCoordinate', () => {
	test('returns true for valid coordinates', () => {
		expect(validateCoordinate('30402:' + hex64('a') + ':listing')).toBe(true)
		expect(validateCoordinate('30402:' + hex64('0') + ':d-tag_1')).toBe(true)
	})

	test('returns false for empty string', () => {
		expect(validateCoordinate('')).toBe(false)
	})

	test('returns false for malformed coordinates', () => {
		expect(validateCoordinate('invalid')).toBe(false)
		expect(validateCoordinate('30405:' + hex64('a') + ':listing')).toBe(false)
		expect(validateCoordinate('30402:short:listing')).toBe(false)
	})

	test('returns false for null/undefined', () => {
		expect(validateCoordinate(null as unknown as string)).toBe(false)
		expect(validateCoordinate(undefined as unknown as string)).toBe(false)
	})
})

describe('foreign-author reference rendering', () => {
	test('accepts coordinate from a completely different author', () => {
		const anotherPubkey = hex64('2')
		const result = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: `30402:${anotherPubkey}:foreign-product` },
		])
		expect(result.success).toBe(true)
		expect(result.data).toEqual([
			{ type: 'product-row', coordinate: `30402:${anotherPubkey}:foreign-product` },
		])
	})

	test('accepts mixed coordinates from multiple authors', () => {
		const a = hex64('a')
		const b = hex64('b')
		const c = hex64('c')
		const result = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: `30402:${a}:product-a` },
			{ type: 'product-row', coordinate: `30402:${b}:product-b` },
			{ type: 'product-row', coordinate: `30402:${c}:product-c` },
		])
		expect(result.success).toBe(true)
		expect(result.data).toHaveLength(3)
	})
})

describe('unknown kind refusal', () => {
	test('refuses 30405 coordinates', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30405:' + hex64('a') + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('refuses 30406 coordinates', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30406:' + hex64('a') + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('refuses kind 1 coordinates', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '1:' + hex64('a') + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})
})

describe('malformed coordinate refusal', () => {
	test('refuses coordinate with only two parts', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') },
		])
		expect(invalid.success).toBe(false)
	})

	test('refuses coordinate with four parts', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') + ':tag:extra' },
		])
		expect(invalid.success).toBe(false)
	})

	test('refuses coordinate with non-hex pubkey', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + 'z'.repeat(64) + ':listing' },
		])
		expect(invalid.success).toBe(false)
	})

	test('refuses coordinate with spaces in d-tag', () => {
		const invalid = ProductRowSchema.safeParse([
			{ type: 'product-row', coordinate: '30402:' + hex64('a') + 'tag with spaces' },
		])
		expect(invalid.success).toBe(false)
	})
})
