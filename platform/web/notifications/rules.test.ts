import { describe, expect, test } from 'bun:test'
import { deriveFromRules } from '@sdk/core'
import {
	appNotificationRules,
	auctionBidRule,
	auctionCommentRule,
	auctionLiveRule,
	auctionSettlementRule,
	auctionThreadCommentRule,
	auctionWonRule,
	bidUpdateRule,
	messageRule,
	orderRule,
	orderUpdateRule,
	productCommentRule,
} from './rules'
import type { AppNotificationEvent } from './rules'
import { notificationScopes } from './types'

describe('the app rules — passive counters', () => {
	test('orderRule derives one global-scoped order notification', () => {
		const derived = orderRule.derive({ kind: 'order', createdAt: 10, orderId: 'o1' })
		expect(derived).toHaveLength(1)
		expect(derived[0]).toMatchObject({ type: 'order', scope: 'orders', createdAt: 10, payload: { orderId: 'o1' } })
		expect(derived[0].read).toBe(false)
	})

	test('messageRule scopes by the conversation pubkey', () => {
		const derived = messageRule.derive({ kind: 'message', createdAt: 11, pubkey: 'alice' })
		expect(derived).toHaveLength(1)
		expect(derived[0]).toMatchObject({ type: 'message', scope: 'messages:alice', payload: { pubkey: 'alice' } })
	})

	test('orderUpdateRule derives a global purchases-scoped notification', () => {
		const derived = orderUpdateRule.derive({ kind: 'order-update', createdAt: 12, orderId: 'o2' })
		expect(derived[0]).toMatchObject({ type: 'order-update', scope: 'purchases', payload: { orderId: 'o2' } })
	})

	test('auctionBidRule scopes by auction key', () => {
		const derived = auctionBidRule.derive({ kind: 'auction-bid', createdAt: 13, auctionKey: 'auc-1', bidEventId: 'b1' })
		expect(derived[0]).toMatchObject({
			type: 'auction-bid',
			scope: 'auction-bids:auc-1',
			payload: { auctionKey: 'auc-1', bidEventId: 'b1' },
		})
	})

	test('auctionCommentRule scopes by auction key', () => {
		const derived = auctionCommentRule.derive({ kind: 'auction-comment', createdAt: 14, auctionKey: 'auc-1' })
		expect(derived[0]).toMatchObject({ type: 'auction-comment', scope: 'auction-comments:auc-1' })
	})

	test('auctionThreadCommentRule scopes by auction key', () => {
		const derived = auctionThreadCommentRule.derive({ kind: 'auction-thread-comment', createdAt: 15, auctionKey: 'auc-1' })
		expect(derived[0]).toMatchObject({ type: 'auction-thread-comment', scope: 'auction-thread-comments:auc-1' })
	})

	test('productCommentRule scopes by product key', () => {
		const derived = productCommentRule.derive({ kind: 'product-comment', createdAt: 15, productKey: 'prod-1' })
		expect(derived[0]).toMatchObject({ type: 'product-comment', scope: 'product-comments:prod-1' })
	})

	test('auctionLiveRule scopes by auction key', () => {
		const derived = auctionLiveRule.derive({ kind: 'auction-live', createdAt: 16, auctionKey: 'auc-1' })
		expect(derived[0]).toMatchObject({ type: 'auction-live', scope: 'auction-live:auc-1' })
	})

	test('auctionSettlementRule scopes by auction key', () => {
		const derived = auctionSettlementRule.derive({ kind: 'auction-settlement', createdAt: 17, auctionKey: 'auc-1' })
		expect(derived[0]).toMatchObject({ type: 'auction-settlement', scope: 'auction-settlement:auc-1' })
	})

	test('bidUpdateRule uses the single global scope', () => {
		const derived = bidUpdateRule.derive({ kind: 'bid-update', createdAt: 18, auctionKey: 'auc-1' })
		expect(derived[0]).toMatchObject({ type: 'bid-update', scope: 'bid-updates' })
	})
})

describe('the app rules — the active auction win', () => {
	test('auctionWonRule encodes the composite identity the old queue de-duplicated on', () => {
		const derived = auctionWonRule.derive({
			kind: 'auction-won',
			createdAt: 20,
			bidderPubkey: 'me',
			auctionRootEventId: 'root-1',
			bidEventId: 'bid-1',
			bidAmount: 5000,
		})
		expect(derived).toHaveLength(1)
		expect(derived[0]).toMatchObject({
			id: 'auction-won:root-1:me',
			type: 'auction-won',
			scope: 'auction-won:root-1',
			payload: { bidderPubkey: 'me', auctionRootEventId: 'root-1', bidEventId: 'bid-1', bidAmount: 5000 },
		})
	})

	test('two wins on the same auction by the same bidder share an id (de-dup), a different bidder does not', () => {
		const base = { kind: 'auction-won', createdAt: 20, auctionRootEventId: 'root-1', bidEventId: 'bid-1', bidAmount: 5000 } as const
		const first = auctionWonRule.derive({ ...base, bidderPubkey: 'me' })
		const again = auctionWonRule.derive({ ...base, bidderPubkey: 'me' })
		const other = auctionWonRule.derive({ ...base, bidderPubkey: 'someone-else' })
		expect(first[0].id).toBe(again[0].id)
		expect(first[0].id).not.toBe(other[0].id)
	})
})

describe('the app rules — dispatch over the whole set', () => {
	test('a single event derives exactly one notification from the rule that owns its kind', () => {
		const derived = deriveFromRules<AppNotificationEvent>(appNotificationRules, {
			kind: 'auction-bid',
			createdAt: 30,
			auctionKey: 'auc-9',
		})
		expect(derived).toHaveLength(1)
		expect(derived[0].type).toBe('auction-bid')
	})

	test('every event kind derives exactly one notification', () => {
		const events: AppNotificationEvent[] = [
			{ kind: 'order', createdAt: 1 },
			{ kind: 'message', createdAt: 1, pubkey: 'p' },
			{ kind: 'order-update', createdAt: 1 },
			{ kind: 'auction-bid', createdAt: 1, auctionKey: 'a' },
			{ kind: 'auction-comment', createdAt: 1, auctionKey: 'a' },
			{ kind: 'auction-thread-comment', createdAt: 1, auctionKey: 'a' },
			{ kind: 'product-comment', createdAt: 1, productKey: 'p' },
			{ kind: 'auction-live', createdAt: 1, auctionKey: 'a' },
			{ kind: 'auction-settlement', createdAt: 1, auctionKey: 'a' },
			{ kind: 'bid-update', createdAt: 1 },
			{ kind: 'auction-won', createdAt: 1, bidderPubkey: 'me', auctionRootEventId: 'r', bidEventId: 'b', bidAmount: 1 },
		]
		for (const event of events) {
			expect(deriveFromRules<AppNotificationEvent>(appNotificationRules, event)).toHaveLength(1)
		}
	})

	test('a non-matching kind derives nothing', () => {
		expect(orderRule.derive({ kind: 'message', createdAt: 1, pubkey: 'p' })).toEqual([])
	})

	test('scope builders are the ones the rules use', () => {
		expect(notificationScopes.messages('x')).toBe('messages:x')
		expect(notificationScopes.auctionWon('root')).toBe('auction-won:root')
	})
})
