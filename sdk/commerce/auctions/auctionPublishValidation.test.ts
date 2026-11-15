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
		expect(refusalOf(() => validate({ v4vSplit: [{ role: 'charity' as 'validator', recipientPubkey: 'aa'.repeat(32), allocationBps: '10' }] }))).toBe(
			'create.unknown-split-role',
		)
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