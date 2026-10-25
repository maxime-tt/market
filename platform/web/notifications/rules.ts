/**
 * platform/web/notifications/rules.ts — the app's rules: pure `derive` functions that turn one app event into
 * zero or more notifications.
 *
 * These are the platform's configuration of *what counts as a notification*. They are NOT wired to live events
 * in this slice — the point is that they exist, are typed, and are unit-tested; the rewire slice feeds them
 * real events and applies the derived notifications (passive ones to the ledger, modal ones to the queue).
 *
 * Every rule is pure: the input carries `createdAt` (the value the caller's clock returned, in the same unit
 * the instance was configured with — the app uses whole seconds), so no rule reads a clock. A rule matches one
 * event `kind` and returns `[]` for every other kind, so the whole set can be run over one input union with
 * `deriveFromRules`. Each rule's doc names the current `notificationActions` call site it will replace.
 */
import { createNotification } from '@sdk/core'
import type { Notification, NotificationRule } from '@sdk/core'
import type { AppNotificationPayload, AppNotificationType } from './types'
import { notificationScopes } from './types'

/**
 * AppNotificationEvent — the discriminated union of app events a rule can derive from. Each member's fields are
 * exactly what the corresponding monitor handler has in hand when it calls the action today (see the rule docs).
 */
export type AppNotificationEvent =
	| { readonly kind: 'order'; readonly createdAt: number; readonly orderId?: string }
	| { readonly kind: 'message'; readonly createdAt: number; readonly pubkey: string }
	| { readonly kind: 'order-update'; readonly createdAt: number; readonly orderId?: string }
	| { readonly kind: 'auction-bid'; readonly createdAt: number; readonly auctionKey: string; readonly bidEventId?: string }
	| { readonly kind: 'auction-comment'; readonly createdAt: number; readonly auctionKey: string }
	| { readonly kind: 'auction-thread-comment'; readonly createdAt: number; readonly auctionKey: string }
	| { readonly kind: 'product-comment'; readonly createdAt: number; readonly productKey: string }
	| { readonly kind: 'auction-live'; readonly createdAt: number; readonly auctionKey: string }
	| { readonly kind: 'auction-settlement'; readonly createdAt: number; readonly auctionKey: string }
	| { readonly kind: 'bid-update'; readonly createdAt: number; readonly auctionKey?: string }
	| {
			readonly kind: 'auction-won'
			readonly createdAt: number
			readonly bidderPubkey: string
			readonly auctionRootEventId: string
			readonly bidEventId: string
			readonly bidAmount: number
	  }

/** A rule over the app's event union, the app's type union and the app's payload union. */
export type AppNotificationRule = NotificationRule<AppNotificationEvent, AppNotificationType, AppNotificationPayload>

/** Build one passive notification. Its `id` is deterministic — the type and scope — since counters are not de-duplicated by id. */
function passive(
	type: AppNotificationType,
	scope: string,
	payload: AppNotificationPayload,
	createdAt: number,
): Notification<AppNotificationType, AppNotificationPayload> {
	return createNotification<AppNotificationType, AppNotificationPayload>({
		id: `${type}:${scope}`,
		type,
		payload,
		scope,
		createdAt,
	})
}

/**
 * New order where the user is the seller.
 * Replaces `notificationActions.incrementUnseenOrders()` — `useNotificationMonitor.ts:1095`.
 */
export const orderRule: AppNotificationRule = {
	id: 'order',
	derive: (input) =>
		input.kind === 'order' ? [passive('order', notificationScopes.orders, { orderId: input.orderId }, input.createdAt)] : [],
}

/**
 * New message in a conversation the user is party to.
 * Replaces `notificationActions.incrementUnseenForConversation(senderPubkey)` — `useNotificationMonitor.ts:1119`.
 */
export const messageRule: AppNotificationRule = {
	id: 'message',
	derive: (input) =>
		input.kind === 'message'
			? [passive('message', notificationScopes.messages(input.pubkey), { pubkey: input.pubkey }, input.createdAt)]
			: [],
}

/**
 * Update to an order where the user is the buyer (payment request, status or shipping update).
 * Replaces `notificationActions.incrementUnseenPurchases()` — `useNotificationMonitor.ts:1152`.
 */
export const orderUpdateRule: AppNotificationRule = {
	id: 'order-update',
	derive: (input) =>
		input.kind === 'order-update'
			? [passive('order-update', notificationScopes.purchases, { orderId: input.orderId }, input.createdAt)]
			: [],
}

/**
 * New bid on a seller's auction.
 * Replaces `notificationActions.incrementUnseenAuctionBids(auctionKey)` — `useNotificationMonitor.ts:776`.
 */
export const auctionBidRule: AppNotificationRule = {
	id: 'auction-bid',
	derive: (input) =>
		input.kind === 'auction-bid'
			? [
					passive(
						'auction-bid',
						notificationScopes.auctionBids(input.auctionKey),
						{ auctionKey: input.auctionKey, bidEventId: input.bidEventId },
						input.createdAt,
					),
				]
			: [],
}

/**
 * New live-chat comment on a seller's auction.
 * Replaces `notificationActions.incrementUnseenAuctionComments(auctionKey)` — `useNotificationMonitor.ts:799`.
 */
export const auctionCommentRule: AppNotificationRule = {
	id: 'auction-comment',
	derive: (input) =>
		input.kind === 'auction-comment'
			? [
					passive(
						'auction-comment',
						notificationScopes.auctionComments(input.auctionKey),
						{ auctionKey: input.auctionKey },
						input.createdAt,
					),
				]
			: [],
}

/**
 * New NIP-22 thread comment on a seller's auction.
 * Replaces `notificationActions.incrementUnseenAuctionEventComments(auctionKey)` — `useNotificationMonitor.ts:887`.
 */
export const auctionThreadCommentRule: AppNotificationRule = {
	id: 'auction-thread-comment',
	derive: (input) =>
		input.kind === 'auction-thread-comment'
			? [
					passive(
						'auction-thread-comment',
						notificationScopes.auctionThreadComments(input.auctionKey),
						{ auctionKey: input.auctionKey },
						input.createdAt,
					),
				]
			: [],
}

/**
 * New NIP-22 thread comment on a seller's product.
 * Replaces `notificationActions.incrementUnseenProductComments()` — `useNotificationMonitor.ts:901`.
 *
 * RULED 2026-10-25 (owner): the count goes **per product**, matching the per-product last-seen mark it is
 * paired with. Today the two disagree — `unseenProductComments` is a single global counter while its last-seen
 * mark is per product — and the ruling makes them consistent at the finer grain. This IS a deliberate behaviour
 * change: a badge that used to show one global number now shows the current product's number. Read it with
 * `unseenProductCommentsFor(appNotifications, productKey)`; do NOT sum with `totalUnseen()`.
 */
export const productCommentRule: AppNotificationRule = {
	id: 'product-comment',
	derive: (input) =>
		input.kind === 'product-comment'
			? [
					passive(
						'product-comment',
						notificationScopes.productComments(input.productKey),
						{ productKey: input.productKey },
						input.createdAt,
					),
				]
			: [],
}

/**
 * A scheduled seller auction that has just gone live.
 * Replaces `notificationActions.incrementUnseenAuctionLive(auctionKey)` — `useNotificationMonitor.ts:399`.
 */
export const auctionLiveRule: AppNotificationRule = {
	id: 'auction-live',
	derive: (input) =>
		input.kind === 'auction-live'
			? [passive('auction-live', notificationScopes.auctionLive(input.auctionKey), { auctionKey: input.auctionKey }, input.createdAt)]
			: [],
}

/**
 * A scheduled seller auction that has just ended and entered settlement.
 * Replaces `notificationActions.incrementUnseenAuctionSettlementBegins(auctionKey)` — `useNotificationMonitor.ts:407`.
 */
export const auctionSettlementRule: AppNotificationRule = {
	id: 'auction-settlement',
	derive: (input) =>
		input.kind === 'auction-settlement'
			? [
					passive(
						'auction-settlement',
						notificationScopes.auctionSettlement(input.auctionKey),
						{ auctionKey: input.auctionKey },
						input.createdAt,
					),
				]
			: [],
}

/**
 * A higher bid or a settlement on an auction the user has bid on.
 * Replaces `notificationActions.incrementUnseenBidUpdates()` — `useNotificationMonitor.ts:788` (higher bid) and
 * `useNotificationMonitor.ts:953` (settlement).
 */
export const bidUpdateRule: AppNotificationRule = {
	id: 'bid-update',
	derive: (input) =>
		input.kind === 'bid-update'
			? [passive('bid-update', notificationScopes.bidUpdates, { auctionKey: input.auctionKey }, input.createdAt)]
			: [],
}

/**
 * An auction the user won — the active modal notification.
 * Replaces `auctionWonActions.enqueue(win)` — `useAuctionWinMonitor.ts:179`.
 *
 * Its id encodes the composite the old queue de-duplicated on: `bidderPubkey` AND `auctionRootEventId`
 * (`auctionWon.ts:19`). Its scope is the auction root event id, which is what `removeForAuction` filters by.
 */
export const auctionWonRule: AppNotificationRule = {
	id: 'auction-won',
	derive: (input) =>
		input.kind === 'auction-won'
			? [
					createNotification<AppNotificationType, AppNotificationPayload>({
						id: `auction-won:${input.auctionRootEventId}:${input.bidderPubkey}`,
						type: 'auction-won',
						payload: {
							bidderPubkey: input.bidderPubkey,
							auctionRootEventId: input.auctionRootEventId,
							bidEventId: input.bidEventId,
							bidAmount: input.bidAmount,
						},
						scope: notificationScopes.auctionWon(input.auctionRootEventId),
						createdAt: input.createdAt,
					}),
				]
			: [],
}

/**
 * Every app rule, in declaration order. Feed to `deriveFromRules(appNotificationRules, event)` to turn one app
 * event into the notifications it produces.
 */
export const appNotificationRules: readonly AppNotificationRule[] = [
	orderRule,
	messageRule,
	orderUpdateRule,
	auctionBidRule,
	auctionCommentRule,
	auctionThreadCommentRule,
	productCommentRule,
	auctionLiveRule,
	auctionSettlementRule,
	bidUpdateRule,
	auctionWonRule,
]
