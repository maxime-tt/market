/**
 * platform/web/notifications/types.ts — the app's configuration of the notification vocabulary.
 *
 * The core (`sdk/core/notifications`) names no domain: `TType` is an open string and `TPayload` is the host's
 * own shape. This module is the host's answer. It declares the app's notification types, the payload each one
 * carries, the opaque ledger scopes those payloads count under, and how each type is presented. Everything
 * here is derived from the behaviour of `src/lib/stores/notifications.ts` and `src/lib/stores/auctionWon.ts`
 * (see the module's own header note in `instance.ts` for the mapping), never invented.
 */
import type { Notification } from '@sdk/core'

/**
 * AppNotificationType — the app's concrete notification union.
 *
 * The old store declared `NotificationType = 'order' | 'message' | 'order-update'` but that union was never
 * consumed and had gone stale: the store's real state carries ten distinct counters plus the separate
 * auction-win queue, and the three declared members only name three of them. This union is the honest one —
 * one member per notification the app actually produces, keeping the three declared names as the order /
 * message / purchase streams and adding the auction and product streams the counters represent, plus the
 * active auction-win that used to live in its own store. Adding a member here is the one place a new
 * notification kind is declared.
 */
export type AppNotificationType =
	/** A new order where the signed-in user is the seller. Drives `unseenOrders`. */
	| 'order'
	/** A new message in a conversation the user is party to. Drives `unseenMessages` / `unseenByConversation`. */
	| 'message'
	/** An update to an order where the user is the buyer. Drives `unseenPurchases`. */
	| 'order-update'
	/** A new bid on an auction where the user is the seller. Drives `unseenAuctionBids`. */
	| 'auction-bid'
	/** A new live-chat comment on a seller's auction. Drives `unseenAuctionComments`. */
	| 'auction-comment'
	/** A new NIP-22 thread comment on a seller's auction. Drives `unseenAuctionEventComments`. */
	| 'auction-thread-comment'
	/** A new NIP-22 thread comment on a seller's product. Drives `unseenProductComments`. */
	| 'product-comment'
	/** A scheduled auction the seller owns that has just gone live. Drives `unseenAuctionLive`. */
	| 'auction-live'
	/** A scheduled auction the seller owns that has just ended and entered settlement. Drives `unseenAuctionSettlementBegins`. */
	| 'auction-settlement'
	/** A higher bid or a settlement on an auction the user has bid on. Drives `unseenBidUpdates`. */
	| 'bid-update'
	/** An auction the user won and must settle. The active modal queue — previously `auctionWonStore`. */
	| 'auction-won'

/** A new order where the user is the seller. Payload mirrors the order-creation event the monitor watches. */
export interface OrderPayload {
	/** The order process event id, when the monitor has one; the current increment call site does not carry it. */
	readonly orderId?: string
}

/** A new message. The conversation's other-party pubkey is both the payload's subject and the ledger scope. */
export interface MessagePayload {
	/** The sender's pubkey — the conversation key `unseenByConversation` and `lastSeenTimestamps.messages` use. */
	readonly pubkey: string
}

/** An update to an order where the user is the buyer (payment request, status or shipping update). */
export interface OrderUpdatePayload {
	/** The order process event id, when known. */
	readonly orderId?: string
}

/** A new bid on a seller's auction. */
export interface AuctionBidPayload {
	/** The seller-auction notification key the current store scopes counts and last-seen marks by. */
	readonly auctionKey: string
	/** The bid event id, when known. */
	readonly bidEventId?: string
}

/** A new live-chat comment on a seller's auction. */
export interface AuctionCommentPayload {
	/** The seller-auction notification key. */
	readonly auctionKey: string
}

/** A new NIP-22 thread comment on a seller's auction. */
export interface AuctionThreadCommentPayload {
	/** The seller-auction notification key. */
	readonly auctionKey: string
}

/** A new NIP-22 thread comment on a seller's product. */
export interface ProductCommentPayload {
	/** The seller-product notification key the current store scopes last-seen marks by. */
	readonly productKey: string
}

/** A scheduled seller auction that has just gone live. */
export interface AuctionLivePayload {
	/** The seller-auction notification key. */
	readonly auctionKey: string
}

/** A scheduled seller auction that has just ended and entered settlement. */
export interface AuctionSettlementPayload {
	/** The seller-auction notification key. */
	readonly auctionKey: string
}

/** A higher bid or settlement on an auction the user has bid on. */
export interface BidUpdatePayload {
	/** The auction notification key, when known; the current store keeps this counter global. */
	readonly auctionKey?: string
}

/** An auction the user won. The shape is `auctionWon.ts`'s `AuctionWonPayload`, verbatim. */
export interface AuctionWonPayload {
	readonly bidderPubkey: string
	readonly auctionRootEventId: string
	readonly bidEventId: string
	readonly bidAmount: number
}

/** AppNotificationPayload — the union every app notification's `payload` is drawn from. */
export type AppNotificationPayload =
	| OrderPayload
	| MessagePayload
	| OrderUpdatePayload
	| AuctionBidPayload
	| AuctionCommentPayload
	| AuctionThreadCommentPayload
	| ProductCommentPayload
	| AuctionLivePayload
	| AuctionSettlementPayload
	| BidUpdatePayload
	| AuctionWonPayload

/** An app notification record: the core's record, parameterised with the app's type union and payload union. */
export type AppNotification = Notification<AppNotificationType, AppNotificationPayload>

/**
 * The opaque ledger scopes the app counts under. The core counts under an opaque string, so the app namespaces
 * its scopes by kind here; each builder returns the exact key the corresponding counter uses today. Global
 * counters (orders, purchases, bid updates) use a constant scope; per-subject counters (messages, auctions,
 * products) embed the subject key.
 */
export const notificationScopes = {
	/** Global — mirrors the single `unseenOrders` counter. */
	orders: 'orders',
	/** Global — mirrors the single `unseenPurchases` counter. */
	purchases: 'purchases',
	/** Global — mirrors the single `unseenBidUpdates` counter (the store keeps no per-auction breakdown). */
	bidUpdates: 'bid-updates',
	/** Per-conversation — mirrors `unseenByConversation[pubkey]`. */
	messages: (pubkey: string) => `messages:${pubkey}`,
	/** Per-auction — mirrors `unseenAuctionBidsByAuction[auctionKey]`. */
	auctionBids: (auctionKey: string) => `auction-bids:${auctionKey}`,
	/** Per-auction — mirrors `unseenAuctionCommentsByAuction[auctionKey]`. */
	auctionComments: (auctionKey: string) => `auction-comments:${auctionKey}`,
	/** Per-auction — mirrors `unseenAuctionEventCommentsByAuction[auctionKey]`. */
	auctionThreadComments: (auctionKey: string) => `auction-thread-comments:${auctionKey}`,
	/** Per-product — see the note in `rules.ts`: the store's count is global but its last-seen mark is per-product. */
	productComments: (productKey: string) => `product-comments:${productKey}`,
	/** Per-auction — mirrors `unseenAuctionLiveByAuction[auctionKey]`. */
	auctionLive: (auctionKey: string) => `auction-live:${auctionKey}`,
	/** Per-auction — mirrors `unseenAuctionSettlementBeginsByAuction[auctionKey]`. */
	auctionSettlement: (auctionKey: string) => `auction-settlement:${auctionKey}`,
	/** Per-auction — the active queue's scope, keyed on the auction root event id (what `removeForAuction` filters by). */
	auctionWon: (auctionRootEventId: string) => `auction-won:${auctionRootEventId}`,
} as const

/**
 * NotificationPresentation — how a type is surfaced. `modal` types demand the user's attention in an overlay
 * and live in the active queue; `passive` types are counters the user reads from badges and live in the ledger.
 * This is the seam the modal policy is built on; nothing here renders.
 */
export type NotificationPresentation = 'modal' | 'passive'
