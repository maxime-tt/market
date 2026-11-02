import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import {
	CART_PERSISTENCE_VERSION,
	MAX_PERSISTED_CART_ITEMS,
	MAX_PERSISTED_CART_ITEM_QUANTITY,
	PersistedCartContentSchema,
	PersistedCartItemSchema,
	ProductRefSchema,
	ShippingRefSchema,
	parseCartPersistenceContent,
	isValidCartProductRef,
	isValidCartShippingRef,
	isValidCartPubkey,
	type PersistedCartContent,
	type PersistedCartItem,
} from '@sdk/commerce/cart/cartIntent'

export { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND } from '@sdk/commerce/cart/cartSnapshotPublish'
import { CART_PERSISTENCE_D_TAG, CART_PERSISTENCE_KIND } from '@sdk/commerce/cart/cartSnapshotPublish'

export {
	CART_PERSISTENCE_VERSION,
	MAX_PERSISTED_CART_ITEMS,
	MAX_PERSISTED_CART_ITEM_QUANTITY,
	PersistedCartContentSchema,
	PersistedCartItemSchema,
	ProductRefSchema,
	ShippingRefSchema,
	parseCartPersistenceContent,
	isValidCartProductRef,
	isValidCartShippingRef,
	isValidCartPubkey,
}
export type { PersistedCartContent, PersistedCartItem }

export function getCartPersistenceDTag(event: Pick<NostrEventLike, 'tags'> | null | undefined): string | undefined {
	return event?.tags.find((tag) => tag[0] === 'd')?.[1]
}

export function isCartPersistenceEvent(event: Pick<NostrEventLike, 'kind' | 'tags'> | null | undefined): boolean {
	return event?.kind === CART_PERSISTENCE_KIND
}

export function isExpectedCartSnapshot(event: Pick<NostrEventLike, 'kind' | 'tags'> | null | undefined): boolean {
	return isCartPersistenceEvent(event) && getCartPersistenceDTag(event) === CART_PERSISTENCE_D_TAG
}

export { normalizePersistedCart, normalizeShippingForRestore, createCartIntent } from '@sdk/commerce/cart/cartIntent'
