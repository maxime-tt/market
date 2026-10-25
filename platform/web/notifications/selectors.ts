/**
 * platform/web/notifications/selectors.ts — the app's derived reads: turn the ledger's opaque scope counts back
 * into the ten counters (and the per-conversation map) the surfaces show.
 *
 * The ledger counts under an opaque string (`orders`, `messages:<pubkey>`, `auction-bids:<auctionKey>`, …). A
 * surface never hand-builds a scope key; it reads one of these selectors, which are the sole place the mapping
 * from scope to counter lives. They are pure functions over the snapshot's `counts` (never hooks), so they can
 * be unit-tested without React and called from any consumer.
 *
 * This module reproduces the legacy store's `NotificationState` counters EXACTLY (see
 * `src/lib/stores/notifications.ts`): the legacy global counters for the scoped families are the SUM of their
 * per-scope breakdown (`sumScopedUnseenCounts`, `notifications.ts:21`), so `unseenMessages` is the sum of the
 * `messages:*` scopes, `unseenAuctionBids` the sum of `auction-bids:*`, and so on. `unseenProductComments` is
 * likewise the sum of the `product-comments:*` scopes — the aggregate the legacy global counter held. (A
 * per-product surface reads ONE of those scopes with `unseenProductCommentsFor`; the owner's per-product ruling
 * is about the per-product grain, and the aggregate is unchanged — see `reads.ts`.)
 */
import type { LedgerSnapshot } from '@sdk/core'
import { notificationScopes } from './types'

/** The ledger counts of one snapshot: the raw `scope -> count` map. */
export type LedgerCounts = Readonly<Record<string, number>>

/**
 * The `<family>:` prefix of each scoped family, derived from the scope builders themselves so a rename cannot
 * drift the selector away from what the producers write.
 */
const messagesPrefix = notificationScopes.messages('')
const auctionBidsPrefix = notificationScopes.auctionBids('')
const auctionCommentsPrefix = notificationScopes.auctionComments('')
const auctionThreadCommentsPrefix = notificationScopes.auctionThreadComments('')
const productCommentsPrefix = notificationScopes.productComments('')
const auctionLivePrefix = notificationScopes.auctionLive('')
const auctionSettlementPrefix = notificationScopes.auctionSettlement('')

/** Sum every count whose scope begins with `prefix`. */
function sumFamily(counts: LedgerCounts, prefix: string): number {
	let sum = 0
	for (const [scope, count] of Object.entries(counts)) {
		if (scope.startsWith(prefix)) sum += Math.max(0, count)
	}
	return sum
}

/** The per-conversation count for one pubkey — the legacy `unseenByConversation[pubkey] || 0`. */
export function unseenMessagesFor(counts: LedgerCounts, pubkey: string): number {
	return counts[notificationScopes.messages(pubkey)] ?? 0
}

/** The per-conversation map, keyed by the sender pubkey — the legacy `unseenByConversation`. */
export function unseenByConversationFromCounts(counts: LedgerCounts): Record<string, number> {
	const byConversation: Record<string, number> = {}
	for (const [scope, count] of Object.entries(counts)) {
		if (!scope.startsWith(messagesPrefix)) continue
		byConversation[scope.slice(messagesPrefix.length)] = count
	}
	return byConversation
}

/**
 * AppUnseenCounts — the ten counters every badge surface reads, in the legacy store's names, plus the derived
 * total. This is a plain value, not a store, so a component selects it from the ledger snapshot.
 */
export interface AppUnseenCounts {
	readonly unseenOrders: number
	readonly unseenMessages: number
	readonly unseenPurchases: number
	readonly unseenAuctionBids: number
	readonly unseenAuctionComments: number
	readonly unseenAuctionEventComments: number
	readonly unseenProductComments: number
	readonly unseenAuctionLive: number
	readonly unseenAuctionSettlementBegins: number
	readonly unseenBidUpdates: number
	/** Per-conversation backlog, keyed by sender pubkey — the legacy `unseenByConversation`. */
	readonly unseenByConversation: Readonly<Record<string, number>>
	/** The sum the header's single dashboard badge shows — the legacy `totalNotifications`. */
	readonly unseenTotal: number
}

/**
 * Derive the ten counters from a ledger's `counts`. The three unscoped counters (`orders`, `purchases`,
 * `bid-updates`) read their key directly; the seven scoped families are summed; the product-comment family is
 * summed to the aggregate (its per-product grain is read one scope at a time, elsewhere).
 */
export function appUnseenCounts(counts: LedgerCounts): AppUnseenCounts {
	const unseenOrders = counts[notificationScopes.orders] ?? 0
	const unseenPurchases = counts[notificationScopes.purchases] ?? 0
	const unseenBidUpdates = counts[notificationScopes.bidUpdates] ?? 0
	const unseenMessages = sumFamily(counts, messagesPrefix)
	const unseenAuctionBids = sumFamily(counts, auctionBidsPrefix)
	const unseenAuctionComments = sumFamily(counts, auctionCommentsPrefix)
	const unseenAuctionEventComments = sumFamily(counts, auctionThreadCommentsPrefix)
	const unseenProductComments = sumFamily(counts, productCommentsPrefix)
	const unseenAuctionLive = sumFamily(counts, auctionLivePrefix)
	const unseenAuctionSettlementBegins = sumFamily(counts, auctionSettlementPrefix)

	return {
		unseenOrders,
		unseenMessages,
		unseenPurchases,
		unseenAuctionBids,
		unseenAuctionComments,
		unseenAuctionEventComments,
		unseenProductComments,
		unseenAuctionLive,
		unseenAuctionSettlementBegins,
		unseenBidUpdates,
		unseenByConversation: unseenByConversationFromCounts(counts),
		unseenTotal:
			unseenOrders +
			unseenMessages +
			unseenPurchases +
			unseenAuctionBids +
			unseenAuctionComments +
			unseenAuctionEventComments +
			unseenProductComments +
			unseenAuctionLive +
			unseenAuctionSettlementBegins +
			unseenBidUpdates,
	}
}

/** Convenience: derive the counters straight from a ledger snapshot. */
export function appUnseenCountsFromLedger(ledger: LedgerSnapshot): AppUnseenCounts {
	return appUnseenCounts(ledger.counts)
}
