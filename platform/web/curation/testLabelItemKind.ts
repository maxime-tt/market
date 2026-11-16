/**
 * platform/web/curation/testLabelItemKind.ts — which item kinds the curation
 * label surfaces accept, and the copy slug each one uses.
 *
 * ADR-0009 — one registry for both surfaces. `TestLabelButton` and
 * `TestLabelDialog` each used to decide "product or else auction" from the kind
 * alone, so any number that was not a product — including the retired 30408
 * listing — silently became an "auction" and could be published as a label
 * against a coordinate nothing reads. Resolving the slug here instead makes one
 * place answer the question for both, and makes a non-labelable kind a refusal
 * (`null`) rather than a guess.
 */
import { TEST_LABEL_AUCTION_KIND, TEST_LABEL_PRODUCT_KIND } from '@sdk/config/test-label-constants'

/** Copy slug for a labelable item: `product` or the arena auction lot. */
export type TestLabelItemSlug = 'product' | 'auction'

/**
 * Slug of the item kind, or `null` when the kind cannot carry a test label.
 *
 * Accepts exactly the two kinds in the registry — NIP-99 products (30402) and
 * arena auction lots (1440, `ARENA_AUCTION_CREATE_KIND`). The retired 30408
 * listing is not one of them.
 */
export const testLabelItemSlug = (kind: number): TestLabelItemSlug | null => {
	if (kind === TEST_LABEL_PRODUCT_KIND) return 'product'
	if (kind === TEST_LABEL_AUCTION_KIND) return 'auction'
	return null
}