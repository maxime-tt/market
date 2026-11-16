/**
 * The curation surfaces' kind registry.
 *
 * `TestLabelButton` and `TestLabelDialog` used to read "product, else auction"
 * straight off the kind number, so the retired 30408 listing was silently
 * treated as an auction and could publish a label at a coordinate nothing reads.
 * Both now resolve their copy slug through `testLabelItemSlug`, so this file
 * pins the single answer they share: the two registered kinds are accepted, the
 * retired kind and everything else are refused.
 */
import { describe, expect, test } from 'bun:test'
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import { TEST_LABEL_AUCTION_KIND, TEST_LABEL_PRODUCT_KIND } from '@sdk/config/test-label-constants'
import { testLabelItemSlug } from './testLabelItemKind'

/** Kind 30408 — the retired auction listing. */
const RETIRED_AUCTION_KIND = 30408

describe('testLabelItemSlug', () => {
	test('a product is a product', () => {
		expect(testLabelItemSlug(TEST_LABEL_PRODUCT_KIND)).toBe('product')
	})

	test('an arena auction lot is an auction', () => {
		expect(testLabelItemSlug(ARENA_AUCTION_CREATE_KIND)).toBe('auction')
		expect(TEST_LABEL_AUCTION_KIND).toBe(ARENA_AUCTION_CREATE_KIND)
	})

	test('the retired 30408 listing is refused, not relabeled as an auction', () => {
		expect(testLabelItemSlug(RETIRED_AUCTION_KIND)).toBeNull()
	})

	test('any other kind is refused', () => {
		for (const kind of [1, 5, 1985, 1441, 30023]) {
			expect(testLabelItemSlug(kind)).toBeNull()
		}
	})

	test('the answer is stable across calls — both surfaces get the same slug', () => {
		expect(testLabelItemSlug(ARENA_AUCTION_CREATE_KIND)).toBe(testLabelItemSlug(1440))
	})
})