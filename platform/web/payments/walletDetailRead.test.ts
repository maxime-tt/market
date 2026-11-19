import { describe, expect, test } from 'bun:test'
import { RELAY_TAG_INDEX_VALUE_MAX_LENGTH } from '@sdk/core/nostr/nip53'
import { WALLET_DETAIL_LABEL, walletDetailEventsFor, walletDetailReadFilters, type WalletDetailTarget } from './walletDetailRead'

const USER = '0e2f9ac8135df7157c2d57dab59396955145251bd8335ecafb1fceab46d1f5ed'
const PAYMENT_DETAIL_D = '7a19b2b1-a414-45c9-9c17-2adb6a3d39d5'
const OTHER_D = '0453d4aa-85f2-4bc9-bf28-0664abcc31b1'
const COORDINATE = `30078:${USER}:${PAYMENT_DETAIL_D}`

const target: WalletDetailTarget = { userPubkey: USER, paymentDetailDTag: PAYMENT_DETAIL_D }

const walletDetailEvent = (tags: string[][], id = 'event-1') => ({
	id,
	tags,
	kind: 30078,
	pubkey: 'app',
})

describe('the wallet detail coordinate the record is scoped to', () => {
	test('the payment detail d tag makes a coordinate longer than the relay indexes', () => {
		expect(COORDINATE).toHaveLength(107)
		expect(COORDINATE.length).toBeGreaterThan(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
	})

	test('an event id in the d tag position would not even be a payment detail coordinate', () => {
		// The read used to be handed `paymentDetail.id` (a 64-hex event id), so it asked for
		// `30078:<user>:<event id>` — 135 characters, and not the coordinate any record carries.
		const eventIdCoordinate = `30078:${USER}:${'c5f0a247f5266e4c9a8cb311c03513033838e11754cd6b3b6c9083d04a4d6c4c'}`
		expect(eventIdCoordinate).toHaveLength(135)
		expect(eventIdCoordinate).not.toBe(COORDINATE)
	})
})

describe('the wallet detail read filters', () => {
	test('keeps #a and adds the indexed l label', () => {
		expect(walletDetailReadFilters(target)).toEqual([
			{ kinds: [30078], '#l': [WALLET_DETAIL_LABEL] },
			{ kinds: [30078], '#a': [COORDINATE] },
		])
	})

	test('the label clause is the one that fits the index budget', () => {
		expect(WALLET_DETAIL_LABEL.length).toBeLessThanOrEqual(RELAY_TAG_INDEX_VALUE_MAX_LENGTH)
	})

	test('a target without a user or a d tag states no filter at all', () => {
		expect(walletDetailReadFilters({ userPubkey: '', paymentDetailDTag: PAYMENT_DETAIL_D })).toEqual([])
		expect(walletDetailReadFilters({ userPubkey: USER, paymentDetailDTag: '' })).toEqual([])
	})
})

describe('binding the broad label read to one payment detail', () => {
	test('keeps the event that names this payment detail', () => {
		const event = walletDetailEvent([['d', 'random-uuid'], ['l', WALLET_DETAIL_LABEL], ['a', COORDINATE]])
		expect(walletDetailEventsFor([event], target)).toEqual([event])
	})

	test('drops a record that names another payment detail of the same user', () => {
		const other = walletDetailEvent([['l', WALLET_DETAIL_LABEL], ['a', `30078:${USER}:${OTHER_D}`]])
		const event = walletDetailEvent([['l', WALLET_DETAIL_LABEL], ['a', COORDINATE]])
		expect(walletDetailEventsFor([other, event], target)).toEqual([event])
	})

	test('drops a record scoped to another user', () => {
		const otherUser = walletDetailEvent([['l', WALLET_DETAIL_LABEL], ['a', `30078:${OTHER_D}:${PAYMENT_DETAIL_D}`]])
		expect(walletDetailEventsFor([otherUser], target)).toEqual([])
	})

	test('an event id in the coordinate position never matches', () => {
		const wrong = walletDetailEvent([['l', WALLET_DETAIL_LABEL], ['a', `30078:${USER}:c5f0a247f5266e4c9a8cb311c03513033838e11754cd6b3b6c9083d04a4d6c4c`]])
		expect(walletDetailEventsFor([wrong], target)).toEqual([])
	})
})