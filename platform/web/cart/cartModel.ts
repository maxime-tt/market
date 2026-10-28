/**
 * The `NormalizedCart` type cluster, moved out of `src/lib/stores/cart.ts` in Wave D cart drain S0 so
 * the platform cart persistence layer can type its API without a `platform -> src` edge.
 */

export interface InvoiceMessage {
	id: string
	amount: number
	status?: string
	[key: string]: any
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'

export interface OrderMessage {
	id: string
	status: OrderStatus
	[key: string]: any
}

export interface V4VDTO {
	id: string
	name: string
	pubkey: string
	percentage: number
}

export interface CartProduct {
	id: string
	amount: number
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	shippingCostCurrency: string | null
	sellerPubkey: string
}

export interface CartSeller {
	pubkey: string
	productIds: string[]
	currency: string
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	shippingCostCurrency: string | null
	v4vShares: V4VDTO[]
}

export interface NormalizedCart {
	sellers: Record<string, CartSeller>
	products: Record<string, CartProduct>
	orders: Record<string, OrderMessage>
	invoices: Record<string, InvoiceMessage>
}
