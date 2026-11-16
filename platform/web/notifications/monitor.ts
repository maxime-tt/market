/**
 * platform/web/notifications/monitor.ts — the app's notification monitor (hook host).
 *
 * Moved verbatim from `src/hooks/useNotificationMonitor.ts` (store-drain C1 → I-c-notifications,
 * 2026-10-29). The only edits are this header and the import substitutions: every `@/…` specifier
 * replaced by its verified platform/sdk home — the auth composition root (`authStore`), the NDK
 * connection store (`ndkActions`), the app-config store, the auction/order read capabilities —
 * and the mechanism imports (`appNotifications`, `readMarks`, the producers, `AppNotificationEvent`)
 * now relative to this directory. The `@nostr-dev-kit/ndk` type imports are unchanged: the monitor
 * names its transport (subscribe/fetch through the NDK store), so it is a declared bridge in
 * `scripts/ndk-bridge-ledger.txt` and retires with the client-side NDK removal (ADR-0002).
 */
import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import { authStore } from '@platform/web/auth/authStore'
import { ARENA_AUCTION_BID_KIND, ARENA_AUCTION_CREATE_KIND, ARENA_VERDICT_KIND } from '@sdk/commerce/auctions/constants'
import { ndkActions } from '@platform/web/ndk/ndkStore'
import { appNotifications } from './instance'
import { produceAppNotification, reconcileAppNotificationCounts } from './producers'
import { readMarks } from './readMarks'
import type { AppNotificationEvent } from './rules'
import {
	PRODUCT_KIND,
	getSellerProductNotificationScope,
	registerSellerProductNotificationScope,
	type ProductNotificationScope,
	type ProductScopeTag,
} from './productNotificationScopes'
import { LIVE_ACTIVITY_KIND, LIVE_CHAT_KIND } from '@sdk/core/nostr/nip53'
import { configStore } from '@platform/web/config/appConfigStore'
import { ORDER_GENERAL_KIND, ORDER_MESSAGE_TYPE, ORDER_PROCESS_KIND } from '@sdk/commerce/orders/messaging/orderSchema'
import { fetchProductsByPubkey } from '@platform/web/products/productQuery'
import {
	arenaBidBinding,
	arenaBidPositions,
	arenaCreateIdentity,
	arenaPhaseWindow,
	arenaVerdictKey,
	type ArenaBidBinding,
	type ArenaCreateIdentity,
	type ArenaPhaseWindow,
	type ArenaPositionBid,
} from './arenaMonitorRules'
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk'

type NDKKind = NonNullable<NDKFilter['kinds']>[number]
const AUCTION_CREATE_KIND_NDK = ARENA_AUCTION_CREATE_KIND as NDKKind
const AUCTION_BID_KIND_NDK = ARENA_AUCTION_BID_KIND as NDKKind
const AUCTION_VERDICT_KIND_NDK = ARENA_VERDICT_KIND as NDKKind
const PRODUCT_KIND_NDK = PRODUCT_KIND as NDKKind
const COMMENT_KIND_NDK = 1111 as NDKKind
const LIVE_ACTIVITY_KIND_NDK = LIVE_ACTIVITY_KIND as unknown as NDKKind
const LIVE_CHAT_KIND_NDK = LIVE_CHAT_KIND as unknown as NDKKind

const AUCTION_MONITOR_LIMIT = 500
const AUCTION_FILTER_CHUNK_SIZE = 80

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)))

/** The monitor's clock, in whole seconds — the unit the notification instance is configured with. */
const nowSeconds = (): number => Math.floor(Date.now() / 1000)

const chunkValues = (values: string[], size: number): string[][] => {
	const chunks: string[][] = []
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size))
	}
	return chunks
}

const dedupeEvents = (events: NDKEvent[]): NDKEvent[] => {
	const seen = new Set<string>()
	return events.filter((event) => {
		if (!event.id || seen.has(event.id)) return false
		seen.add(event.id)
		return true
	})
}

/** One lot the monitor routes notifications for: its coordinate, its `d`, and its notification key. */
interface MonitoredLot {
	coordinate: string
	d: string
	key: string
}

/**
 * The `d` part of a `1440:<seller>:<d>` coordinate. A `d` may itself contain `:`, so the tail is
 * rejoined rather than sliced to a single field.
 */
const coordinateDTag = (coordinate: string): string => coordinate.split(':').slice(2).join(':')

const getAddressableEventCoordinate = (event: NDKEvent): string => {
	const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
	return dTag ? `${event.kind}:${event.pubkey}:${dTag}` : ''
}

const getTagValues = (event: NDKEvent, tagNames: string[]): string[] =>
	event.tags.filter((tag) => tagNames.includes(tag[0]) && Boolean(tag[1])).map((tag) => tag[1])

const resolveScopedKeyFromLookups = (values: string[], lookups: Array<Map<string, string>>): string => {
	for (const value of values) {
		for (const lookup of lookups) {
			const scopedKey = lookup.get(value)
			if (scopedKey) return scopedKey
		}
	}
	return ''
}

const makeTaggedAuctionFilters = ({
	kind,
	auctionRootEventIds,
	auctionCoordinates,
	since,
	authors,
}: {
	kind: NDKKind
	auctionRootEventIds: string[]
	auctionCoordinates: string[]
	since?: number
	authors?: string[]
}): NDKFilter[] => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [kind],
		limit: AUCTION_MONITOR_LIMIT,
		...(authors && authors.length > 0 ? { authors } : {}),
		...(typeof since === 'number' ? { since } : {}),
	}

	for (const eventIdChunk of chunkValues(auctionRootEventIds, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#e': eventIdChunk,
		})
	}

	for (const coordinateChunk of chunkValues(auctionCoordinates, AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			'#a': coordinateChunk,
		})
	}

	return filters
}

const makeTaggedValueFilters = ({
	kind,
	tagName,
	values,
	since,
	authors,
}: {
	kind: NDKKind
	tagName: '#a' | '#A' | '#e' | '#E'
	values: string[]
	since?: number
	authors?: string[]
}): NDKFilter[] => {
	const filters: NDKFilter[] = []
	const baseFilter = {
		kinds: [kind],
		limit: AUCTION_MONITOR_LIMIT,
		...(authors && authors.length > 0 ? { authors } : {}),
		...(typeof since === 'number' ? { since } : {}),
	}

	for (const valueChunk of chunkValues(uniqueStrings(values), AUCTION_FILTER_CHUNK_SIZE)) {
		filters.push({
			...baseFilter,
			[tagName]: valueChunk,
		})
	}

	return filters
}

const getTrustedAuthorsForKind = (kind: NDKKind): string[] | undefined => {
	if (kind !== LIVE_ACTIVITY_KIND_NDK) return undefined

	const cvmServerPubkey = configStore.state.config.cvmServerPubkey?.trim()
	return cvmServerPubkey ? [cvmServerPubkey] : undefined
}

const fetchTaggedAuctionEvents = async ({
	kind,
	auctionRootEventIds,
	auctionCoordinates,
	since,
}: {
	kind: NDKKind
	auctionRootEventIds: string[]
	auctionCoordinates: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const trustedAuthors = getTrustedAuthorsForKind(kind)
	const filters = makeTaggedAuctionFilters({
		kind,
		auctionRootEventIds,
		auctionCoordinates,
		since,
		authors: trustedAuthors,
	})
	if (filters.length === 0) return []

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return dedupeEvents(Array.from(events))
}

const fetchTaggedEvents = async ({
	kind,
	tagName,
	values,
	since,
	authors,
}: {
	kind: NDKKind
	tagName: '#a' | '#A' | '#e' | '#E'
	values: string[]
	since?: number
	authors?: string[]
}): Promise<NDKEvent[]> => {
	const filters = makeTaggedValueFilters({
		kind,
		tagName,
		values,
		since,
		authors,
	})
	if (filters.length === 0) return []

	const events = await ndkActions.fetchEventsWithTimeout(filters.length === 1 ? filters[0] : filters, { timeoutMs: 8000 })
	return dedupeEvents(Array.from(events))
}

const fetchAddressableCommentEvents = async ({
	targetEventIds,
	targetCoordinates,
	since,
}: {
	targetEventIds: string[]
	targetCoordinates: string[]
	since?: number
}): Promise<NDKEvent[]> => {
	const [byCoordinates, byUpperCoordinates, byUpperEventIds] = await Promise.all([
		fetchTaggedEvents({
			kind: COMMENT_KIND_NDK,
			tagName: '#a',
			values: targetCoordinates,
			since,
		}),
		fetchTaggedEvents({
			kind: COMMENT_KIND_NDK,
			tagName: '#A',
			values: targetCoordinates,
			since,
		}),
		fetchTaggedEvents({
			kind: COMMENT_KIND_NDK,
			tagName: '#E',
			values: targetEventIds,
			since,
		}),
	])

	return dedupeEvents([...byCoordinates, ...byUpperCoordinates, ...byUpperEventIds])
}

/**
 * Monitor nostr events and update notification counts in real-time
 * This hook should be used once at the app/dashboard level
 */
export const useNotificationMonitor = () => {
	const { user } = useStore(authStore)
	const subscriptionsRef = useRef<NDKSubscription[]>([])
	const isMonitoringRef = useRef(false)

	useEffect(() => {
		// Only run once an authenticated user is present. The legacy `isInitialized` gate went with the store
		// (C3): read state seeds synchronously at module load, so there is nothing to wait for but `user`.
		if (!user?.pubkey || isMonitoringRef.current) {
			return
		}

		const ndk = ndkActions.getNDK()
		if (!ndk) return

		let isCancelled = false
		const subscriptionSince = Math.floor(Date.now() / 1000)
		const seenAuctionEventIds = new Set<string>()
		const seenAuctionCommentEventIds = new Set<string>()
		const seenAuctionThreadCommentEventIds = new Set<string>()
		const seenBidEventIds = new Set<string>()
		const seenProductCommentEventIds = new Set<string>()
		const seenVerdictEventIds = new Set<string>()
		const scheduledAuctionLiveKeys = new Set<string>()
		const scheduledAuctionSettlementKeys = new Set<string>()
		const subscribedSellerAuctionRootEventIds = new Set<string>()
		const subscribedSellerAuctionCoordinates = new Set<string>()
		const subscribedSellerLiveActivityCoordinates = new Set<string>()
		const subscribedSellerProductEventIds = new Set<string>()
		const subscribedSellerProductCoordinates = new Set<string>()
		const refreshedSellerProductEventIds = new Set<string>()
		const phaseTimeoutIds: number[] = []

		// Mark as monitoring to prevent duplicate subscriptions
		isMonitoringRef.current = true

		console.log('[NotificationMonitor] Starting notification monitoring for user:', user.pubkey)

		// Helper to check if an event is newer than last seen
		const isNewOrder = (event: NDKEvent): boolean => {
			const lastSeen = readMarks.getLastSeenOrders()
			return (event.created_at || 0) > lastSeen
		}

		const isNewMessage = (event: NDKEvent, pubkey: string): boolean => {
			const lastSeen = readMarks.getLastSeenForConversation(pubkey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewPurchaseUpdate = (event: NDKEvent): boolean => {
			const lastSeen = readMarks.getLastSeenPurchases()
			return (event.created_at || 0) > lastSeen
		}

		const isNewAuctionBid = (event: NDKEvent, auctionKey?: string): boolean => {
			const lastSeen = readMarks.getLastSeenAuctionBids(auctionKey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewBidUpdate = (event: NDKEvent): boolean => {
			const lastSeen = readMarks.getLastSeenBidUpdates()
			return (event.created_at || 0) > lastSeen
		}

		const isNewAuctionComment = (event: NDKEvent, auctionKey?: string): boolean => {
			const lastSeen = readMarks.getLastSeenAuctionComments(auctionKey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewAuctionEventComment = (event: NDKEvent, auctionKey?: string): boolean => {
			const lastSeen = readMarks.getLastSeenAuctionEventComments(auctionKey)
			return (event.created_at || 0) > lastSeen
		}

		const isNewProductComment = (event: NDKEvent, productKey?: string): boolean => {
			const lastSeen = readMarks.getLastSeenProductComments(productKey)
			return (event.created_at || 0) > lastSeen
		}

		const subscribeToTaggedAuctionEvents = ({
			kind,
			tagName,
			values,
			onEvent,
		}: {
			kind: NDKKind
			tagName: '#e' | '#a' | '#A' | '#E'
			values: string[]
			onEvent: (event: NDKEvent) => void
		}) => {
			if (isCancelled || values.length === 0) return

			const trustedAuthors = getTrustedAuthorsForKind(kind)

			for (const valueChunk of chunkValues(uniqueStrings(values), AUCTION_FILTER_CHUNK_SIZE)) {
				const filter = {
					kinds: [kind],
					[tagName]: valueChunk,
					...(trustedAuthors ? { authors: trustedAuthors } : {}),
					since: subscriptionSince,
				} as NDKFilter

				const subscription = ndk.subscribe(filter, {
					closeOnEose: false,
				})

				subscription.on('event', onEvent)
				subscriptionsRef.current.push(subscription)
			}
		}

		const scheduleAuctionPhaseNotification = (auctionKey: string, window: ArenaPhaseWindow) => {
			if (!auctionKey) return

			const scheduleAt = (runAt: number | null, scheduledKeys: Set<string>, callback: () => void) => {
				if (runAt === null || !runAt || runAt <= Math.floor(Date.now() / 1000) || scheduledKeys.has(auctionKey)) return
				scheduledKeys.add(auctionKey)
				const timeoutId = window.setTimeout(
					() => {
						scheduledKeys.delete(auctionKey)
						if (isCancelled) return
						callback()
					},
					Math.max(0, runAt * 1000 - Date.now()),
				)
				phaseTimeoutIds.push(timeoutId)
			}

			if (window.startAt > readMarks.getLastSeenAuctionLive(auctionKey)) {
				scheduleAt(window.startAt, scheduledAuctionLiveKeys, () => {
					console.log('[NotificationMonitor] Seller auction went live:', auctionKey)
					produceAppNotification({ kind: 'auction-live', auctionKey, createdAt: nowSeconds() })
				})
			}

			if (window.cutoffAt !== null && window.cutoffAt > readMarks.getLastSeenAuctionSettlementBegins(auctionKey)) {
				scheduleAt(window.cutoffAt, scheduledAuctionSettlementKeys, () => {
					console.log('[NotificationMonitor] Seller auction entered settlement:', auctionKey)
					produceAppNotification({ kind: 'auction-settlement', auctionKey, createdAt: nowSeconds() })
				})
			}
		}

		// Initial fetch to calculate current unseen counts and set up auction-specific subscriptions
		const initializeNotifications = async () => {
			try {
				const initializationStartedAt = Math.floor(Date.now() / 1000)
				// Fetch recent orders where user is seller (recipient)
				const orderFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const orderEvents = await ndk.fetchEvents(orderFilter)

				// Filter for order creation events
				const newOrders = Array.from(orderEvents).filter((event) => {
					const typeTag = event.tags.find((tag) => tag[0] === 'type')
					return typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION && isNewOrder(event)
				})

				// Fetch recent messages (kind 14)
				const messageFilter: NDKFilter = {
					kinds: [ORDER_GENERAL_KIND],
					'#p': [user.pubkey],
					limit: 100,
				}

				const messageEvents = await ndk.fetchEvents(messageFilter)

				// Group messages by sender and count unseen per conversation
				const conversationCounts: Record<string, number> = {}
				let totalUnseenMessages = 0

				Array.from(messageEvents).forEach((event) => {
					const senderPubkey = event.pubkey
					if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
						conversationCounts[senderPubkey] = (conversationCounts[senderPubkey] || 0) + 1
						totalUnseenMessages++
					}
				})

				// Fetch recent purchase updates (orders where user is buyer)
				const purchaseFilter: NDKFilter = {
					kinds: [ORDER_PROCESS_KIND],
					authors: [user.pubkey],
					limit: 100,
				}

				const purchaseEvents = await ndk.fetchEvents(purchaseFilter)

				// Filter for purchase updates (payment requests, status updates, shipping updates)
				// Exclude order creation events since those are initiated by the buyer
				const newPurchaseUpdates = Array.from(purchaseEvents).filter((event) => {
					const typeTag = event.tags.find((tag) => tag[0] === 'type')
					const isUpdate =
						typeTag?.[1] === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST ||
						typeTag?.[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE ||
						typeTag?.[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE

					// Only count if it's an update type AND it's from the seller (not the buyer)
					return isUpdate && event.pubkey !== user.pubkey && isNewPurchaseUpdate(event)
				})

				// Seller scope: the user's own arena lots. A 1440 is a regular kind, so one lot can
				// arrive as several versions; they collapse onto the lot's coordinate, and the root
				// (the earliest version carrying no superseding `e` tag) is the one that announces a
				// phase — an update never re-announces a start it did not begin.
				const sellerCreateEvents = Array.from(
					await ndk.fetchEvents({ kinds: [AUCTION_CREATE_KIND_NDK], authors: [user.pubkey], limit: AUCTION_MONITOR_LIMIT }),
				)
				const sellerProducts = await fetchProductsByPubkey(user.pubkey, true, 500)
				const sellerAuctionKeyByRootEventId = new Map<string, string>()
				const sellerAuctionKeyByCoordinate = new Map<string, string>()
				const sellerLotRoots = new Map<string, { event: NDKEvent; identity: ArenaCreateIdentity }>()
				const sellerProductKeyByEventId = new Map<string, string>()
				const sellerProductKeyByCoordinate = new Map<string, string>()

				for (const event of sellerCreateEvents) {
					const identity = arenaCreateIdentity(event)
					if (!identity) continue

					// Every version of a lot routes to the lot's coordinate.
					sellerAuctionKeyByCoordinate.set(identity.coordinate, identity.coordinate)
					if (identity.supersedes) continue

					// 1440 is regular, so the root is the EARLIEST version with no `e` tag
					// (`arenaAuctionRead.ts`, "1440 is regular, so 'latest version wins' is built here").
					const prior = sellerLotRoots.get(identity.coordinate)
					if (!prior || (event.created_at ?? 0) < (prior.event.created_at ?? 0)) {
						sellerLotRoots.set(identity.coordinate, { event, identity })
					}
				}

				const sellerLots: MonitoredLot[] = []
				const sellerPhaseWindows = new Map<string, ArenaPhaseWindow>()
				for (const [coordinate, { event, identity }] of sellerLotRoots) {
					sellerLots.push({ coordinate, d: identity.d, key: coordinate })
					sellerAuctionKeyByRootEventId.set(event.id, coordinate)
					const phaseWindow = arenaPhaseWindow(event)
					if (phaseWindow) sellerPhaseWindows.set(coordinate, phaseWindow)
				}

				// Bind a 1441 to one of the seller's lots: `a` coordinate first, then the `e` root,
				// then a `d` that exactly one of the seller's lots carries — the same order the read
				// adapter binds bids (`arenaAuctionRead.ts`, "bind bids to auctions").
				const sellerAuctionKeyForBid = (event: NDKEvent): string => {
					const binding = arenaBidBinding(event)
					if (!binding) return ''
					if (binding.coordinate) {
						const byCoordinate = sellerAuctionKeyByCoordinate.get(binding.coordinate)
						if (byCoordinate) return byCoordinate
					}
					if (binding.rootEventId) {
						const byRoot = sellerAuctionKeyByRootEventId.get(binding.rootEventId)
						if (byRoot) return byRoot
					}
					if (binding.auctionId) {
						const matches = sellerLots.filter((lot) => lot.d === binding.auctionId)
						if (matches.length === 1) return matches[0].key
					}
					return ''
				}

				const sellerProductScopes = sellerProducts
					.map((product) => getSellerProductNotificationScope(product, user.pubkey))
					.filter((scope): scope is ProductNotificationScope => Boolean(scope))

				for (const { eventId, coordinate, productKey } of sellerProductScopes) {
					sellerProductKeyByEventId.set(eventId, productKey)
					if (coordinate) sellerProductKeyByCoordinate.set(coordinate, productKey)
				}

				const sellerAuctionRootEventIds = Array.from(sellerAuctionKeyByRootEventId.keys())
				const sellerAuctionCoordinates = sellerLots.map((lot) => lot.coordinate)
				const sellerProductEventIds = uniqueStrings(sellerProductScopes.map((scope) => scope.eventId))
				const sellerProductCoordinates = uniqueStrings(sellerProductScopes.map((scope) => scope.coordinate))
				const sellerBidEvents = await fetchTaggedAuctionEvents({
					kind: AUCTION_BID_KIND_NDK,
					auctionRootEventIds: sellerAuctionRootEventIds,
					auctionCoordinates: sellerAuctionCoordinates,
					since: readMarks.getLastSeenAuctionBids() + 1,
				})
				const sellerLiveActivityEvents = await fetchTaggedAuctionEvents({
					kind: LIVE_ACTIVITY_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: sellerAuctionCoordinates,
				})
				const sellerLiveActivityCoords = uniqueStrings(
					sellerLiveActivityEvents.map((event) => getAddressableEventCoordinate(event)).filter(Boolean),
				)
				const sellerAuctionKeyByLiveActivityCoordinate = new Map<string, string>()
				for (const event of sellerLiveActivityEvents) {
					const liveActivityCoordinate = getAddressableEventCoordinate(event)
					if (!liveActivityCoordinate) continue

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (auctionKey) sellerAuctionKeyByLiveActivityCoordinate.set(liveActivityCoordinate, auctionKey)
				}
				const sellerLiveChatEvents = await fetchTaggedAuctionEvents({
					kind: LIVE_CHAT_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: sellerLiveActivityCoords,
					since: readMarks.getLastSeenAuctionComments() + 1,
				})
				const [sellerAuctionCommentEvents, sellerProductCommentEvents] = await Promise.all([
					fetchAddressableCommentEvents({
						targetEventIds: sellerAuctionRootEventIds,
						targetCoordinates: sellerAuctionCoordinates,
						since: readMarks.getLastSeenAuctionEventComments() + 1,
					}),
					fetchAddressableCommentEvents({
						targetEventIds: sellerProductEventIds,
						targetCoordinates: sellerProductCoordinates,
						since: readMarks.getLastSeenProductComments() + 1,
					}),
				])

				const newSellerBidEvents = sellerBidEvents.filter((event) => {
					seenAuctionEventIds.add(event.id)
					const auctionKey = sellerAuctionKeyForBid(event)
					return event.pubkey !== user.pubkey && !!auctionKey && isNewAuctionBid(event, auctionKey)
				})

				const newSellerBidCountsByAuction = newSellerBidEvents.reduce<Record<string, number>>((counts, event) => {
					const auctionKey = sellerAuctionKeyForBid(event)
					if (!auctionKey) return counts
					counts[auctionKey] = (counts[auctionKey] || 0) + 1
					return counts
				}, {})

				const newSellerLiveChatCountsByAuction: Record<string, number> = {}
				const newSellerLiveChatEvents = sellerLiveChatEvents.filter((event) => {
					seenAuctionCommentEventIds.add(event.id)
					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A']), [sellerAuctionKeyByLiveActivityCoordinate])
					if (event.pubkey === user.pubkey || !auctionKey || !isNewAuctionComment(event, auctionKey)) return false

					newSellerLiveChatCountsByAuction[auctionKey] = (newSellerLiveChatCountsByAuction[auctionKey] || 0) + 1
					return true
				})

				const newSellerAuctionCommentCountsByAuction: Record<string, number> = {}
				const newSellerAuctionCommentEvents = sellerAuctionCommentEvents.filter((event) => {
					seenAuctionThreadCommentEventIds.add(event.id)
					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (event.pubkey === user.pubkey || !auctionKey || !isNewAuctionEventComment(event, auctionKey)) return false

					newSellerAuctionCommentCountsByAuction[auctionKey] = (newSellerAuctionCommentCountsByAuction[auctionKey] || 0) + 1
					return true
				})

				const newSellerProductCommentEvents = sellerProductCommentEvents.filter((event) => {
					seenProductCommentEventIds.add(event.id)
					const productKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerProductKeyByCoordinate,
						sellerProductKeyByEventId,
					])
					return event.pubkey !== user.pubkey && !!productKey && isNewProductComment(event, productKey)
				})

				const unseenAuctionLiveCountsByAuction: Record<string, number> = {}
				for (const lot of sellerLots) {
					const phaseWindow = sellerPhaseWindows.get(lot.coordinate)
					if (!phaseWindow) continue
					if (phaseWindow.startAt > readMarks.getLastSeenAuctionLive(lot.key) && phaseWindow.startAt <= initializationStartedAt) {
						unseenAuctionLiveCountsByAuction[lot.key] = 1
					}
				}

				const unseenAuctionSettlementBeginsCountsByAuction: Record<string, number> = {}
				for (const lot of sellerLots) {
					const phaseWindow = sellerPhaseWindows.get(lot.coordinate)
					if (!phaseWindow || phaseWindow.cutoffAt === null) continue
					if (
						phaseWindow.cutoffAt > readMarks.getLastSeenAuctionSettlementBegins(lot.key) &&
						phaseWindow.cutoffAt <= initializationStartedAt
					) {
						unseenAuctionSettlementBeginsCountsByAuction[lot.key] = 1
					}
				}

				// Watched scope: the lots this user has bid on. A 1441's amount is a DELTA added to the
				// bidder's position, so "a higher bid" is only meaningful on summed positions: read every
				// bid for the watched lots and project positions the way the read adapter does, then
				// compare totals.
				const ownBidEvents = Array.from(
					await ndk.fetchEvents({ kinds: [AUCTION_BID_KIND_NDK], authors: [user.pubkey], limit: AUCTION_MONITOR_LIMIT }),
				)
				const watchedLotsByCoordinate = new Map<string, MonitoredLot>()
				for (const event of ownBidEvents) {
					const binding = arenaBidBinding(event)
					if (!binding?.coordinate || watchedLotsByCoordinate.has(binding.coordinate)) continue
					watchedLotsByCoordinate.set(binding.coordinate, {
						coordinate: binding.coordinate,
						d: binding.auctionId || coordinateDTag(binding.coordinate),
						key: binding.coordinate,
					})
				}
				const watchedLots = Array.from(watchedLotsByCoordinate.values())
				const watchedCoordinates = watchedLots.map((lot) => lot.coordinate)

				const watchedBidFeed: Array<{ event: NDKEvent; binding: ArenaBidBinding }> = []
				for (const event of await fetchTaggedAuctionEvents({
					kind: AUCTION_BID_KIND_NDK,
					auctionRootEventIds: [],
					auctionCoordinates: watchedCoordinates,
				})) {
					const binding = arenaBidBinding(event)
					if (binding?.coordinate) watchedBidFeed.push({ event, binding })
				}

				// Positions are derived once and then kept current by the live subscription below, so
				// every comparison runs on the latest totals rather than on one event's delta.
				const watchedPositions = arenaBidPositions(watchedBidFeed.map(({ event, binding }) => ({ ...binding, bidder: event.pubkey })))
				const ownPositionAt = (coordinate: string): number => watchedPositions[coordinate]?.[user.pubkey] ?? 0
				const bidderOutbidsOwnPosition = (event: NDKEvent, binding: ArenaBidBinding): boolean => {
					if (!binding.coordinate) return false
					const ownPosition = ownPositionAt(binding.coordinate)
					return ownPosition > 0 && (watchedPositions[binding.coordinate]?.[event.pubkey] ?? 0) > ownPosition
				}

				const lastSeenBidUpdates = readMarks.getLastSeenBidUpdates()
				const newHigherBidEvents = watchedBidFeed.filter(
					({ event, binding }) =>
						event.pubkey !== user.pubkey &&
						(event.created_at ?? 0) > lastSeenBidUpdates &&
						bidderOutbidsOwnPosition(event, binding),
				)

				// The terminal event of an arena lot is its 1445 verdict. A verdict names its lot by the
				// `auction` tag (a `d` or a coordinate) — not an `a`/`e` tag — so no relay-side filter can
				// narrow it and the watched window is read and bound locally (`arenaVerdictKey`).
				const watchedVerdictEvents = Array.from(
					await ndk.fetchEvents({
						kinds: [AUCTION_VERDICT_KIND_NDK],
						since: lastSeenBidUpdates + 1,
						limit: AUCTION_MONITOR_LIMIT,
					}),
				).filter((event) => event.pubkey !== user.pubkey && isNewBidUpdate(event) && !!arenaVerdictKey(event, watchedLots))
				const newVerdictEvents = watchedVerdictEvents.filter((event) => {
					seenVerdictEventIds.add(event.id)
					return true
				})

				if (isCancelled) return

				// Reconcile lifecycle transitions that can happen while async initialization
				// is still fetching relay data. This bounded window closes gaps where a
				// transition can be missed by both initial counting and one-shot timer setup.
				const initializationCompletedAt = Math.floor(Date.now() / 1000)
				let reconciledAuctionLiveCount = 0
				let reconciledAuctionSettlementBeginsCount = 0

				for (const lot of sellerLots) {
					const phaseWindow = sellerPhaseWindows.get(lot.coordinate)
					if (!phaseWindow) continue

					if (
						phaseWindow.startAt > initializationStartedAt &&
						phaseWindow.startAt <= initializationCompletedAt &&
						phaseWindow.startAt > readMarks.getLastSeenAuctionLive(lot.key)
					) {
						if (!unseenAuctionLiveCountsByAuction[lot.key]) reconciledAuctionLiveCount++
						unseenAuctionLiveCountsByAuction[lot.key] = 1
					}

					if (
						phaseWindow.cutoffAt !== null &&
						phaseWindow.cutoffAt > initializationStartedAt &&
						phaseWindow.cutoffAt <= initializationCompletedAt &&
						phaseWindow.cutoffAt > readMarks.getLastSeenAuctionSettlementBegins(lot.key)
					) {
						if (!unseenAuctionSettlementBeginsCountsByAuction[lot.key]) reconciledAuctionSettlementBeginsCount++
						unseenAuctionSettlementBeginsCountsByAuction[lot.key] = 1
					}
				}

				const unseenAuctionLiveCount = Object.values(unseenAuctionLiveCountsByAuction).reduce((sum, count) => sum + count, 0)
				const unseenAuctionSettlementBeginsCount = Object.values(unseenAuctionSettlementBeginsCountsByAuction).reduce(
					(sum, count) => sum + count,
					0,
				)

				// Feed the mechanism the events this pass counted. `reconcileAppNotificationCounts` is an
				// OVERWRITE rather than an accumulation — so re-running the initial sync (on account change)
				// resets the derived counts instead of doubling them.
				const nowForBulk = nowSeconds()
				const bulkEvents: AppNotificationEvent[] = []
				for (const event of newOrders) bulkEvents.push({ kind: 'order', createdAt: event.created_at || nowForBulk })
				for (const event of messageEvents) {
					const senderPubkey = event.pubkey
					if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
						bulkEvents.push({ kind: 'message', pubkey: senderPubkey, createdAt: event.created_at || nowForBulk })
					}
				}
				for (const event of newPurchaseUpdates) bulkEvents.push({ kind: 'order-update', createdAt: event.created_at || nowForBulk })
				for (const event of newSellerBidEvents) {
					const auctionKey = sellerAuctionKeyForBid(event)
					if (auctionKey)
						bulkEvents.push({ kind: 'auction-bid', auctionKey, bidEventId: event.id, createdAt: event.created_at || nowForBulk })
				}
				for (const event of newSellerLiveChatEvents) {
					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A']), [sellerAuctionKeyByLiveActivityCoordinate])
					if (auctionKey) bulkEvents.push({ kind: 'auction-comment', auctionKey, createdAt: event.created_at || nowForBulk })
				}
				for (const event of newSellerAuctionCommentEvents) {
					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (auctionKey) bulkEvents.push({ kind: 'auction-thread-comment', auctionKey, createdAt: event.created_at || nowForBulk })
				}
				for (const event of newSellerProductCommentEvents) {
					const productKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerProductKeyByCoordinate,
						sellerProductKeyByEventId,
					])
					if (productKey) bulkEvents.push({ kind: 'product-comment', productKey, createdAt: event.created_at || nowForBulk })
				}
				for (const auctionKey of Object.keys(unseenAuctionLiveCountsByAuction)) {
					bulkEvents.push({ kind: 'auction-live', auctionKey, createdAt: nowForBulk })
				}
				for (const auctionKey of Object.keys(unseenAuctionSettlementBeginsCountsByAuction)) {
					bulkEvents.push({ kind: 'auction-settlement', auctionKey, createdAt: nowForBulk })
				}
				for (const event of newHigherBidEvents) bulkEvents.push({ kind: 'bid-update', createdAt: event.created_at || nowForBulk })
				for (const event of newVerdictEvents) bulkEvents.push({ kind: 'bid-update', createdAt: event.created_at || nowForBulk })
				reconcileAppNotificationCounts(appNotifications, bulkEvents)

				console.log('[NotificationMonitor] Initial counts:', {
					orders: newOrders.length,
					messages: totalUnseenMessages,
					purchases: newPurchaseUpdates.length,
					auctionBids: newSellerBidEvents.length,
					auctionComments: newSellerLiveChatEvents.length,
					auctionEventComments: newSellerAuctionCommentEvents.length,
					productComments: newSellerProductCommentEvents.length,
					auctionLive: unseenAuctionLiveCount,
					auctionSettlementBegins: unseenAuctionSettlementBeginsCount,
					bidUpdates: newHigherBidEvents.length + newVerdictEvents.length,
					reconciledAuctionLive: reconciledAuctionLiveCount,
					reconciledAuctionSettlementBegins: reconciledAuctionSettlementBeginsCount,
					initializationWindowSeconds: Math.max(0, initializationCompletedAt - initializationStartedAt),
					conversations: Object.keys(conversationCounts).length,
				})

				for (const lot of sellerLots) {
					const phaseWindow = sellerPhaseWindows.get(lot.coordinate)
					if (phaseWindow) scheduleAuctionPhaseNotification(lot.key, phaseWindow)
				}

				const handleSellerBidEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionEventIds.has(event.id)) return
					seenAuctionEventIds.add(event.id)

					const auctionKey = sellerAuctionKeyForBid(event)
					if (event.pubkey === user.pubkey || !auctionKey || !isNewAuctionBid(event, auctionKey)) return

					console.log('[NotificationMonitor] New auction bid received:', event.id)
					produceAppNotification({ kind: 'auction-bid', auctionKey, bidEventId: event.id, createdAt: event.created_at || nowSeconds() })
				}

				const handleWatchedBidEvent = (event: NDKEvent) => {
					if (!event.id || seenBidEventIds.has(event.id)) return
					seenBidEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isNewBidUpdate(event)) return

					const binding = arenaBidBinding(event)
					if (!binding || !watchedLotsByCoordinate.has(binding.coordinate)) return

					// Fold the live delta into the projection BEFORE comparing: the arena's bid model
					// is additive, so one bid's `amount` is not a position on its own.
					if (binding.amount !== null) {
						const lot = (watchedPositions[binding.coordinate] ??= {})
						lot[event.pubkey] = (lot[event.pubkey] ?? 0) + binding.amount
					}
					if (!bidderOutbidsOwnPosition(event, binding)) return

					console.log('[NotificationMonitor] New higher bid on watched auction:', event.id)
					produceAppNotification({ kind: 'bid-update', createdAt: event.created_at || nowSeconds() })
				}

				const handleSellerLiveChatEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionCommentEventIds.has(event.id)) return
					seenAuctionCommentEventIds.add(event.id)

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A']), [sellerAuctionKeyByLiveActivityCoordinate])
					if (event.pubkey === user.pubkey || !auctionKey || !isNewAuctionComment(event, auctionKey)) return

					console.log('[NotificationMonitor] New live chat comment on seller auction:', event.id)
					produceAppNotification({ kind: 'auction-comment', auctionKey, createdAt: event.created_at || nowSeconds() })
				}

				const subscribeSellerLiveActivityCoordinate = (liveActivityCoordinate: string) => {
					if (!liveActivityCoordinate || subscribedSellerLiveActivityCoordinates.has(liveActivityCoordinate)) return
					subscribedSellerLiveActivityCoordinates.add(liveActivityCoordinate)

					subscribeToTaggedAuctionEvents({
						kind: LIVE_CHAT_KIND_NDK,
						tagName: '#a',
						values: [liveActivityCoordinate],
						onEvent: handleSellerLiveChatEvent,
					})
				}

				const handleSellerLiveActivityEvent = (event: NDKEvent) => {
					const liveActivityCoordinate = getAddressableEventCoordinate(event)
					if (!liveActivityCoordinate) return

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (!auctionKey) return

					sellerAuctionKeyByLiveActivityCoordinate.set(liveActivityCoordinate, auctionKey)
					subscribeSellerLiveActivityCoordinate(liveActivityCoordinate)
				}

				const subscribeSellerAuctionRootScope = (auctionRootEventId: string) => {
					if (!auctionRootEventId || subscribedSellerAuctionRootEventIds.has(auctionRootEventId)) return
					subscribedSellerAuctionRootEventIds.add(auctionRootEventId)

					subscribeToTaggedAuctionEvents({
						kind: AUCTION_BID_KIND_NDK,
						tagName: '#e',
						values: [auctionRootEventId],
						onEvent: handleSellerBidEvent,
					})
					subscribeToTaggedAuctionEvents({
						kind: COMMENT_KIND_NDK,
						tagName: '#E',
						values: [auctionRootEventId],
						onEvent: handleSellerAuctionCommentEvent,
					})
				}

				const subscribeSellerAuctionCoordinateScope = (auctionCoordinate: string) => {
					if (!auctionCoordinate || subscribedSellerAuctionCoordinates.has(auctionCoordinate)) return
					subscribedSellerAuctionCoordinates.add(auctionCoordinate)

					subscribeToTaggedAuctionEvents({
						kind: AUCTION_BID_KIND_NDK,
						tagName: '#a',
						values: [auctionCoordinate],
						onEvent: handleSellerBidEvent,
					})
					subscribeToTaggedAuctionEvents({
						kind: COMMENT_KIND_NDK,
						tagName: '#a',
						values: [auctionCoordinate],
						onEvent: handleSellerAuctionCommentEvent,
					})
					subscribeToTaggedAuctionEvents({
						kind: COMMENT_KIND_NDK,
						tagName: '#A',
						values: [auctionCoordinate],
						onEvent: handleSellerAuctionCommentEvent,
					})
					subscribeToTaggedAuctionEvents({
						kind: LIVE_ACTIVITY_KIND_NDK,
						tagName: '#a',
						values: [auctionCoordinate],
						onEvent: handleSellerLiveActivityEvent,
					})
				}

				const handleSellerAuctionCommentEvent = (event: NDKEvent) => {
					if (!event.id || seenAuctionThreadCommentEventIds.has(event.id)) return
					seenAuctionThreadCommentEventIds.add(event.id)

					const auctionKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerAuctionKeyByCoordinate,
						sellerAuctionKeyByRootEventId,
					])
					if (event.pubkey === user.pubkey || !auctionKey || !isNewAuctionEventComment(event, auctionKey)) return

					console.log('[NotificationMonitor] New thread comment on seller auction:', event.id)
					produceAppNotification({ kind: 'auction-thread-comment', auctionKey, createdAt: event.created_at || nowSeconds() })
				}

				const handleSellerProductCommentEvent = (event: NDKEvent) => {
					if (!event.id || seenProductCommentEventIds.has(event.id)) return
					seenProductCommentEventIds.add(event.id)

					const productKey = resolveScopedKeyFromLookups(getTagValues(event, ['a', 'A', 'e', 'E']), [
						sellerProductKeyByCoordinate,
						sellerProductKeyByEventId,
					])
					if (event.pubkey === user.pubkey || !productKey || !isNewProductComment(event, productKey)) return

					console.log('[NotificationMonitor] New thread comment on seller product:', event.id)
					produceAppNotification({ kind: 'product-comment', productKey, createdAt: event.created_at || nowSeconds() })
				}

				const subscribeSellerProductScope = (tagName: ProductScopeTag, value: string) => {
					subscribeToTaggedAuctionEvents({
						kind: COMMENT_KIND_NDK,
						tagName,
						values: [value],
						onEvent: handleSellerProductCommentEvent,
					})
				}

				const sellerProductScopeRegistry = {
					productKeyByEventId: sellerProductKeyByEventId,
					productKeyByCoordinate: sellerProductKeyByCoordinate,
					subscribedEventIds: subscribedSellerProductEventIds,
					subscribedCoordinates: subscribedSellerProductCoordinates,
				}

				const handleOwnProductEvent = (event: NDKEvent, refreshComments = false) => {
					const productKey = registerSellerProductNotificationScope(
						event,
						user.pubkey,
						sellerProductScopeRegistry,
						subscribeSellerProductScope,
					)
					if (!productKey || !refreshComments || refreshedSellerProductEventIds.has(event.id)) return

					const scope = getSellerProductNotificationScope(event, user.pubkey)
					if (!scope) return
					refreshedSellerProductEventIds.add(event.id)

					const { eventId, coordinate } = scope
					void fetchAddressableCommentEvents({
						targetEventIds: eventId ? [eventId] : [],
						targetCoordinates: coordinate ? [coordinate] : [],
						since: readMarks.getLastSeenProductComments(productKey) + 1,
					})
						.then((events) => {
							events.forEach(handleSellerProductCommentEvent)
						})
						.catch((error) => {
							console.error('[NotificationMonitor] Failed to refresh comment scopes for new product:', error)
						})
				}

				const handleWatchedVerdictEvent = (event: NDKEvent) => {
					if (!event.id || seenVerdictEventIds.has(event.id)) return
					seenVerdictEventIds.add(event.id)
					if (event.pubkey === user.pubkey || !isNewBidUpdate(event)) return
					if (!arenaVerdictKey(event, watchedLots)) return

					console.log('[NotificationMonitor] New verdict on watched auction:', event.id)
					produceAppNotification({ kind: 'bid-update', createdAt: event.created_at || nowSeconds() })
				}

				const handleOwnAuctionEvent = (event: NDKEvent) => {
					if (event.pubkey !== user.pubkey) return

					const identity = arenaCreateIdentity(event)
					if (!identity) return

					const auctionKey = identity.coordinate
					sellerAuctionKeyByCoordinate.set(identity.coordinate, auctionKey)

					// A lot's scopes and its phase hang off its ROOT create: a later version (one that
					// names a root in its `e` tag) edits display fields and announces nothing.
					if (identity.supersedes) return

					sellerAuctionKeyByRootEventId.set(event.id, auctionKey)
					subscribeSellerAuctionRootScope(event.id)
					subscribeSellerAuctionCoordinateScope(identity.coordinate)

					void fetchTaggedAuctionEvents({
						kind: LIVE_ACTIVITY_KIND_NDK,
						auctionRootEventIds: [],
						auctionCoordinates: [identity.coordinate],
					})
						.then((events) => {
							events.forEach(handleSellerLiveActivityEvent)
						})
						.catch((error) => {
							console.error('[NotificationMonitor] Failed to refresh live-activity scopes for new auction:', error)
						})

					const phaseWindow = arenaPhaseWindow(event)
					if (phaseWindow) scheduleAuctionPhaseNotification(auctionKey, phaseWindow)
				}

				sellerAuctionRootEventIds.forEach(subscribeSellerAuctionRootScope)
				sellerAuctionCoordinates.forEach(subscribeSellerAuctionCoordinateScope)
				sellerLiveActivityCoords.forEach(subscribeSellerLiveActivityCoordinate)
				subscribeToTaggedAuctionEvents({
					kind: AUCTION_BID_KIND_NDK,
					tagName: '#a',
					values: watchedCoordinates,
					onEvent: handleWatchedBidEvent,
				})
				// Verdicts are subscribed unfiltered and bound locally: their lot reference is the
				// `auction` tag (a `d` or a coordinate), which the relay cannot index, so an `#a`
				// filter here would silently match nothing.
				const watchedVerdictSubscription = ndk.subscribe(
					{
						kinds: [AUCTION_VERDICT_KIND_NDK],
						since: subscriptionSince,
					},
					{
						closeOnEose: false,
					},
				)

				watchedVerdictSubscription.on('event', handleWatchedVerdictEvent)
				subscriptionsRef.current.push(watchedVerdictSubscription)
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#a',
					values: sellerProductCoordinates,
					onEvent: handleSellerProductCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#A',
					values: sellerProductCoordinates,
					onEvent: handleSellerProductCommentEvent,
				})
				subscribeToTaggedAuctionEvents({
					kind: COMMENT_KIND_NDK,
					tagName: '#E',
					values: sellerProductEventIds,
					onEvent: handleSellerProductCommentEvent,
				})

				sellerProductEventIds.forEach((eventId) => subscribedSellerProductEventIds.add(eventId))
				sellerProductCoordinates.forEach((coordinate) => subscribedSellerProductCoordinates.add(coordinate))

				const auctionListingSubscription = ndk.subscribe(
					{
						kinds: [AUCTION_CREATE_KIND_NDK],
						authors: [user.pubkey],
						since: subscriptionSince,
					},
					{
						closeOnEose: false,
					},
				)

				auctionListingSubscription.on('event', handleOwnAuctionEvent)
				subscriptionsRef.current.push(auctionListingSubscription)

				const productListingSubscription = ndk.subscribe(
					{
						kinds: [PRODUCT_KIND_NDK],
						authors: [user.pubkey],
						since: subscriptionSince,
					},
					{
						closeOnEose: false,
					},
				)

				productListingSubscription.on('event', (event) => handleOwnProductEvent(event, true))
				subscriptionsRef.current.push(productListingSubscription)

				console.log('[NotificationMonitor] Subscriptions active:', subscriptionsRef.current.length)
			} catch (error) {
				console.error('[NotificationMonitor] Failed to initialize notifications:', error)
			}
		}

		// Start initial fetch
		initializeNotifications()

		// Set up real-time subscriptions

		// 1. Subscribe to new orders where user is seller
		const orderSubscription = ndk.subscribe(
			{
				kinds: [ORDER_PROCESS_KIND],
				'#p': [user.pubkey],
				since: subscriptionSince, // Only new events from now
			},
			{
				closeOnEose: false,
			},
		)

		orderSubscription.on('event', (event: NDKEvent) => {
			// Check if it's an order creation event
			const typeTag = event.tags.find((tag) => tag[0] === 'type')
			if (typeTag?.[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) {
				// Only increment if it's newer than last seen
				if (isNewOrder(event)) {
					console.log('[NotificationMonitor] New order received:', event.id)
					produceAppNotification({ kind: 'order', createdAt: event.created_at || nowSeconds() })
				}
			}
		})

		subscriptionsRef.current.push(orderSubscription)

		// 2. Subscribe to new messages where user is recipient
		const messageSubscription = ndk.subscribe(
			{
				kinds: [ORDER_GENERAL_KIND],
				'#p': [user.pubkey],
				since: subscriptionSince, // Only new events from now
			},
			{
				closeOnEose: false,
			},
		)

		messageSubscription.on('event', (event: NDKEvent) => {
			const senderPubkey = event.pubkey
			// Don't count messages we sent
			if (senderPubkey !== user.pubkey && isNewMessage(event, senderPubkey)) {
				console.log('[NotificationMonitor] New message received from:', senderPubkey)
				produceAppNotification({ kind: 'message', pubkey: senderPubkey, createdAt: event.created_at || nowSeconds() })
			}
		})

		subscriptionsRef.current.push(messageSubscription)

		// 3. Subscribe to purchase updates (orders where user is buyer)
		// Listen for events tagged with user's pubkey that are updates from sellers
		const purchaseUpdateSubscription = ndk.subscribe(
			{
				kinds: [ORDER_PROCESS_KIND],
				'#p': [user.pubkey],
				since: subscriptionSince,
			},
			{
				closeOnEose: false,
			},
		)

		purchaseUpdateSubscription.on('event', (event: NDKEvent) => {
			// Only count if event is from someone else (the seller)
			if (event.pubkey === user.pubkey) return

			const typeTag = event.tags.find((tag) => tag[0] === 'type')

			// Handle purchase-related updates (seller sending updates to buyer)
			if (typeTag) {
				switch (typeTag[1]) {
					case ORDER_MESSAGE_TYPE.PAYMENT_REQUEST:
					case ORDER_MESSAGE_TYPE.STATUS_UPDATE:
					case ORDER_MESSAGE_TYPE.SHIPPING_UPDATE:
						if (isNewPurchaseUpdate(event)) {
							console.log('[NotificationMonitor] Purchase update received:', typeTag[1], event.id)
							produceAppNotification({ kind: 'order-update', createdAt: event.created_at || nowSeconds() })
						}
						break
					case ORDER_MESSAGE_TYPE.ORDER_CREATION:
						// This is a new order where user is seller - already handled above
						break
				}
			}
		})

		subscriptionsRef.current.push(purchaseUpdateSubscription)

		console.log('[NotificationMonitor] Base subscriptions active:', subscriptionsRef.current.length)

		// Cleanup function
		return () => {
			console.log('[NotificationMonitor] Stopping notification monitoring')
			isCancelled = true
			phaseTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
			subscriptionsRef.current.forEach((sub) => {
				sub.stop()
			})
			subscriptionsRef.current = []
			isMonitoringRef.current = false
		}
	}, [user?.pubkey])
}
