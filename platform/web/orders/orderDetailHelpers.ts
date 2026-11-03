import type { PaymentInvoiceData } from '@sdk/commerce/checkout'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import {
	getOrderAmountSats,
	getOrderItems as readOrderItems,
	getOrderRecipientPubkey,
	getOrderReference,
	getOrderShippingReference,
} from '@sdk/commerce/orders'

export const getOrderId = (orderEvent: NostrEventLike): string => getOrderReference(orderEvent) || orderEvent.id

export const getTotalAmount = (orderEvent: NostrEventLike): number => parseInt(getOrderAmountSats(orderEvent) || '0')

export const getOrderItems = (orderEvent: NostrEventLike): Array<{ productRef: string; quantity: number }> => readOrderItems(orderEvent)

export const getSellerPubkey = (orderEvent: NostrEventLike): string => getOrderRecipientPubkey(orderEvent) || ''

export const getShippingRef = (orderEvent: NostrEventLike): string | undefined => getOrderShippingReference(orderEvent) ?? undefined

export const makeInvoiceKey = (invoice: PaymentInvoiceData) => {
	return `${invoice.orderId}:${invoice.recipientPubkey}:${invoice.amount}:${invoice.type}`
}

export { extractPaymentMethods, isPaymentCompleted, parseOrderAddress as parseAddress } from '@sdk/commerce/orders/orderDetail'
export { getInvoiceStatusColor as getStatusColor } from '@ui/orders/order-detail-views'
