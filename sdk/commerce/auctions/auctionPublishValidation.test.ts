import { describe, expect, test } from 'bun:test'
import {
	AUCTION_MAX_ANTISNIPE_WINDOW_SEC,
	AUCTION_MAX_DURATION_SEC,
	AUCTION_MIN_ANTISNIPE_WINDOW_SEC,
	AUCTION_MIN_DURATION_SEC,
	AUCTION_V4V_TOTAL_BPS,
	ArenaCreateRefusalError,
	auctionFormToCreateInput,
	getArenaCreateIssues,
	normalizeArenaCreateInput,
	validateArenaCreateInput,
	type ArenaCreateRules,
	type ArenaCreateValidationInput,
} from '@sdk/commerce/auctions/auctionPublishValidation'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'

/**
 * `sdk/commerce/auctions/auctionPublishValidation.ts` — the create rule.
 *
 * The point of these tests is that the rule refuses **by name** and parses rather than
 * coerces: a typed `"0"` increment is a named refusal, not a silent 0 on the wire.
 */
const WALLET = '02' + 'ab'.repeat(32)

const base: ArenaCreateValidationInput = {
	auctionId: 'lot-1',
	title: 'Title',
	description: 'Description',
	imageUrl: 'https://img.example/1.png',
	category: 'Collectibles',
	name: 'Studio',
	startPrice: '1000',
	minIncrement: '100',
	mode: 'fixed',
	windowSec: '',
	durationSec: 3600,
	v4vSplit: [],
}

const validate = (over: Partial<ArenaCreateValidationInput> = {}, sellerWallet: string | null = WALLET) =>
	validateArenaCreateInput({ ...base, ...over }, { sellerWallet })

/** The chain's real published create rules (kind 1448), as the form reads them. */
const PUBLISHED_RULES: ArenaCreateRules = {
	max_title_chars: 120,
	max_description_chars: 2000,
	max_image_chars: 500,
	max_category_chars: 40,
	max_name_chars: 40,
	image_rule: 'same-site-or-https',
	start_price_min: 1,
	start_price_max: 10_000_000,
	increment_min: 1,
	increment_max: 1_000_000,
}

const validateWithRules = (over: Partial<ArenaCreateValidationInput> = {}, rules: ArenaCreateRules | null = PUBLISHED_RULES) =>
	validateArenaCreateInput({ ...base, ...over }, { sellerWallet: WALLET, rules })

const refusalOf = (run: () => unknown): string => {
	try {
		run()
	} catch (error) {
		if (error instanceof ArenaCreateRefusalError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal')
}

describe('the protocol limits', () => {
	test('are the settled ones', () => {
		expect(AUCTION_MIN_DURATION_SEC).toBe(20)
		expect(AUCTION_MAX_DURATION_SEC).toBe(259_200)
		expect(AUCTION_MIN_ANTISNIPE_WINDOW_SEC).toBe(60)
		expect(AUCTION_MAX_ANTISNIPE_WINDOW_SEC).toBe(900)
		expect(AUCTION_V4V_TOTAL_BPS).toBe(10_000)
	})
})

describe('parsing', () => {
	test('turns the form strings into the protocol numbers', () => {
		const value = validate({ mode: 'antisnipe', windowSec: '300' })
		expect(value.startPrice).toBe(1000)
		expect(value.minIncrement).toBe(100)
		expect(value.durationSec).toBe(3600)
		expect(value.mode).toBe('antisnipe')
		expect(value.windowSec).toBe(300)
		expect(value.sellerWallet).toBe(WALLET)
	})

	test('a fixed-time auction publishes windowSec 0 whatever the form held', () => {
		expect(validate({ mode: 'fixed', windowSec: '900' }).windowSec).toBe(0)
	})

	test('drops blank split rows but refuses a typed one', () => {
		expect(validate({ v4vSplit: [{ role: 'validator', recipientPubkey: '', allocationBps: '' }] }).v4vSplit).toEqual([])
		expect(refusalOf(() => validate({ v4vSplit: [{ role: 'v4v', recipientPubkey: 'zz', allocationBps: '10' }] }))).toBe(
			'create.bad-split-recipient',
		)
	})
})

describe('refusals', () => {
	test('identity', () => {
		expect(refusalOf(() => validate({ auctionId: '' }))).toBe('create.no-auction-id')
		expect(refusalOf(() => validate({ auctionId: 'has spaces' }))).toBe('create.bad-auction-id')
		expect(refusalOf(() => validate({ auctionId: 'x'.repeat(65) }))).toBe('create.bad-auction-id')
		expect(() => validate({ auctionId: 'A-Z_a-z-09' })).not.toThrow()
	})

	test('display fields', () => {
		expect(refusalOf(() => validate({ title: '  ' }))).toBe('create.no-title')
		expect(refusalOf(() => validate({ description: '' }))).toBe('create.no-description')
		expect(refusalOf(() => validate({ imageUrl: '' }))).toBe('create.no-image')
	})

	test('money and time', () => {
		expect(refusalOf(() => validate({ startPrice: null }))).toBe('create.no-start-price')
		expect(refusalOf(() => validate({ startPrice: '0' }))).toBe('create.start-price-not-positive')
		expect(refusalOf(() => validate({ startPrice: '1.5' }))).toBe('create.start-price-not-positive')
		expect(refusalOf(() => validate({ minIncrement: '' }))).toBe('create.increment-not-positive')
		expect(refusalOf(() => validate({ durationSec: null }))).toBe('create.no-duration')
		expect(refusalOf(() => validate({ durationSec: 19 }))).toBe('create.duration-out-of-range')
		expect(refusalOf(() => validate({ durationSec: 259_201 }))).toBe('create.duration-out-of-range')
		expect(validate({ durationSec: 259_200 }).durationSec).toBe(259_200)
	})

	test('mode and window', () => {
		expect(refusalOf(() => validate({ mode: 'sealed' }))).toBe('create.unknown-mode')
		expect(refusalOf(() => validate({ mode: 'antisnipe', windowSec: '59' }))).toBe('create.window-out-of-range')
		expect(refusalOf(() => validate({ mode: 'antisnipe', windowSec: '901' }))).toBe('create.window-out-of-range')
	})

	test('the split', () => {
		expect(refusalOf(() => validate({ v4vSplit: [{ role: 'validator', recipientPubkey: 'aa'.repeat(32), allocationBps: '0' }] }))).toBe(
			'create.split-bps-not-positive',
		)
		expect(
			refusalOf(() => validate({ v4vSplit: [{ role: 'charity' as 'validator', recipientPubkey: 'aa'.repeat(32), allocationBps: '10' }] })),
		).toBe('create.unknown-split-role')
		expect(
			refusalOf(() =>
				validate({
					v4vSplit: [{ role: 'validator', recipientPubkey: 'aa'.repeat(32), allocationBps: '10001' }],
				}),
			),
		).toBe('create.split-exceeds-total')
	})

	test('the seller wallet', () => {
		expect(refusalOf(() => validate({}, null))).toBe('create.no-seller-wallet')
		expect(refusalOf(() => validate({}, '   '))).toBe('create.no-seller-wallet')
	})
})

describe('the editor-facing views', () => {
	test('getArenaCreateIssues reports every field at once and never throws', () => {
		const issues = getArenaCreateIssues({ ...base, title: '', startPrice: '' }, { sellerWallet: WALLET })
		expect(issues.map((issue) => issue.refusal).sort()).toEqual(['create.no-start-price', 'create.no-title'])
	})

	test('normalizeArenaCreateInput is the result form of the same rule', () => {
		expect(normalizeArenaCreateInput({ ...base, title: '' }, { sellerWallet: WALLET }).ok).toBe(false)
	})

	test('auctionFormToCreateInput forwards every field the form holds', () => {
		const formData: AuctionFormData = {
			auctionId: 'lot-9',
			title: 'T',
			description: 'D',
			imageUrl: 'https://img.example/9.png',
			category: 'Art',
			name: 'N',
			startPrice: '500',
			minIncrement: '25',
			mode: 'antisnipe',
			windowSec: '120',
			durationSec: 600,
			v4vSplit: [{ role: 'v4v', recipientPubkey: 'aa'.repeat(32), allocationBps: '50' }],
		}
		expect(auctionFormToCreateInput(formData)).toEqual({
			auctionId: 'lot-9',
			title: 'T',
			description: 'D',
			imageUrl: 'https://img.example/9.png',
			category: 'Art',
			name: 'N',
			startPrice: '500',
			minIncrement: '25',
			mode: 'antisnipe',
			windowSec: '120',
			durationSec: 600,
			v4vSplit: formData.v4vSplit,
		})
	})
})

// =========================================================================
// The chain's published create rules (kind 1448) are the pre-flight
// =========================================================================

describe('the chain-published create rules drive the pre-flight', () => {
	test('a 121-character title is refused with the published max_title_chars, not a hardcoded 120', () => {
		// The rule is the wire's own value: changing the published limit changes
		// the refusal, with no client edit.
		const title = 'x'.repeat(121)
		expect(refusalOf(() => validateWithRules({ title }))).toBe('create.title-too-long')
		expect(validateWithRules({ title: 'x'.repeat(120) }).title).toBe('x'.repeat(120))

		// A different published limit (say 5) refuses a 6-character title and
		// accepts a 5-character one — proof the number comes from the rules.
		expect(refusalOf(() => validateWithRules({ title: 'x'.repeat(6) }, { max_title_chars: 5 }))).toBe('create.title-too-long')
		expect(validateWithRules({ title: 'x'.repeat(5) }, { max_title_chars: 5 }).title).toBe('x'.repeat(5))
	})

	test('each published character limit is enforced by its own name', () => {
		expect(refusalOf(() => validateWithRules({ description: 'x'.repeat(2001) }))).toBe('create.description-too-long')
		expect(refusalOf(() => validateWithRules({ imageUrl: `https://e/${'x'.repeat(500)}` }))).toBe('create.image-too-long')
		expect(refusalOf(() => validateWithRules({ category: 'x'.repeat(41) }))).toBe('create.category-too-long')
		expect(refusalOf(() => validateWithRules({ name: 'x'.repeat(41) }))).toBe('create.name-too-long')
	})

	test('the price and increment bounds are enforced by their own names', () => {
		expect(refusalOf(() => validateWithRules({ startPrice: '10000001' }))).toBe('create.start-price-above-max')
		expect(refusalOf(() => validateWithRules({ startPrice: '0' }, { start_price_min: 1 }))).toBe('create.start-price-not-positive')
		expect(refusalOf(() => validateWithRules({ minIncrement: '1000001' }))).toBe('create.increment-above-max')
		// `start_price_min` above zero is the one case the base rule cannot catch.
		expect(refusalOf(() => validateWithRules({ startPrice: '3' }, { start_price_min: 5 }))).toBe('create.start-price-below-min')
		expect(validateWithRules({ startPrice: '3' }, { start_price_min: 1 }).startPrice).toBe(3)
	})

	test('the image rule is a name: same-site-or-https accepts https and same-site paths, refuses the rest', () => {
		expect(validateWithRules({ imageUrl: 'https://img.example/1.png' }).image).toBe('https://img.example/1.png')
		expect(validateWithRules({ imageUrl: '/uploads/1.png' }).image).toBe('/uploads/1.png')
		expect(validateWithRules({ imageUrl: './1.png' }).image).toBe('./1.png')
		expect(refusalOf(() => validateWithRules({ imageUrl: 'http://img.example/1.png' }))).toBe('create.image-rule-violated')
		expect(refusalOf(() => validateWithRules({ imageUrl: '//evil.example/1.png' }))).toBe('create.image-rule-violated')
		expect(refusalOf(() => validateWithRules({ imageUrl: 'javascript:alert(1)' }))).toBe('create.image-rule-violated')
	})

	test('a rule the reading did not carry is not checked — never a substituted default', () => {
		// No rules at all: every rule-based check is skipped, the base rule still holds.
		expect(validateWithRules({ title: 'x'.repeat(200) }, null).title).toBe('x'.repeat(200))
		// A null rule inside a reading is also not checked.
		expect(validateWithRules({ title: 'x'.repeat(200) }, { ...PUBLISHED_RULES, max_title_chars: null }).title).toBe('x'.repeat(200))
	})
})
