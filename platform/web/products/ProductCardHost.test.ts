import { describe, expect, test } from 'bun:test'
import { canAddToCart } from './ProductCardHost'

const BASE = {
	isOwnProduct: false,
	visibility: 'on-sale',
	isOutOfStock: false,
	stockQuantity: undefined as number | undefined,
	cartQuantity: 0,
}

describe('canAddToCart', () => {
	test('a plain in-stock product can be added', () => {
		expect(canAddToCart(BASE)).toBe(true)
	})
	test('the seller cannot add their own product', () => {
		expect(canAddToCart({ ...BASE, isOwnProduct: true })).toBe(false)
	})
	test('hidden and out-of-stock products cannot be added', () => {
		expect(canAddToCart({ ...BASE, visibility: 'hidden' })).toBe(false)
		expect(canAddToCart({ ...BASE, isOutOfStock: true })).toBe(false)
	})
	test('adding at the stock limit is blocked, below it is allowed', () => {
		expect(canAddToCart({ ...BASE, stockQuantity: 3, cartQuantity: 3 })).toBe(false)
		expect(canAddToCart({ ...BASE, stockQuantity: 3, cartQuantity: 2 })).toBe(true)
	})
	test('an untracked stock quantity is never a limit', () => {
		expect(canAddToCart({ ...BASE, stockQuantity: undefined, cartQuantity: 99 })).toBe(true)
	})
})
