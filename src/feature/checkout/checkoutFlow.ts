import {
	findNextActionableInvoiceIndex,
	isCheckoutInvoiceComplete,
	isValidDigitalDeliveryContact,
	type CheckoutDeliveryRequirements,
	type PaymentInvoiceData,
} from '@sdk/commerce/checkout'
import type { V4VDTO } from '@/lib/stores/cart'

/**
 * The checkout flow's pure transitions and derived values.
 *
 * `useCheckout` is the thin React binding around these functions: the hook owns
 * the stores, the queries, the invoice mutation and the effects, and delegates
 * every decision that does not need React state to this module. That split is
 * deliberate — the unit suite has no DOM renderer (no jsdom/happy-dom, no
 * `@testing-library/react`), so the money path's transitions are pinned here by
 * direct calls instead of by driving the route.
 *
 * Behaviour is carried over from `platform/web/routes/checkout.tsx` verbatim;
 * the module exists to make it testable, not to re-specify it. Where a rule is
 * subtle (the `'temp-order'` placeholder, the "expired does not block" rule,
 * the progress denominator) the test file records why.
 */

export type CheckoutStep = 'shipping' | 'summary' | 'payment' | 'complete'

/** Placeholder order id used before the seller-order workflow returns real ids. */
export const TEMP_ORDER_ID = 'temp-order'

const UNKNOWN_ORDER_ID = 'unknown-order'

export function resolveTotalInvoicesNeeded(sellers: readonly string[], v4vShares: Record<string, V4VDTO[]>): number {
	return sellers.reduce((total, sellerPubkey) => {
		// One invoice for the seller plus one for each V4V recipient.
		return total + 1 + (v4vShares[sellerPubkey]?.length ?? 0)
	}, 0)
}

/** Keep the progress bar stable while invoices are still being generated. */
export function resolveInvoiceStepCount(invoiceCount: number, expectedInvoiceCount: number): number {
	return invoiceCount > 0 ? invoiceCount : expectedInvoiceCount
}

/** shipping + summary + one step per invoice + complete. */
export function resolveTotalSteps(invoiceStepCount: number): number {
	return 2 + invoiceStepCount + 1
}

/** An out-of-range index (a shorter invoice list than when it was set) clamps, never throws. */
export function clampInvoiceIndex(index: number, invoiceCount: number): number {
	if (invoiceCount === 0) return 0
	return Math.min(index, invoiceCount - 1)
}

export function resolveCheckoutStepNumber(step: CheckoutStep, invoiceCount: number, safeInvoiceIndex: number, totalSteps: number): number {
	switch (step) {
		case 'shipping':
			return 1
		case 'summary':
			return 2
		case 'payment':
			// When invoices are still generating, stay on the first payment step.
			return 3 + (invoiceCount > 0 ? safeInvoiceIndex : 0)
		case 'complete':
			return totalSteps
		default:
			return 1
	}
}

export function resolveCheckoutProgress(currentStepNumber: number, totalSteps: number): number {
	if (totalSteps <= 1) return 100
	return ((currentStepNumber - 1) / (totalSteps - 1)) * 100
}

export function describeCheckoutStep(step: CheckoutStep, safeInvoiceIndex: number, invoices: readonly PaymentInvoiceData[]): string {
	switch (step) {
		case 'shipping':
			return 'Enter shipping address'
		case 'summary':
			return 'Review your order'
		case 'payment': {
			if (invoices.length === 0) return 'Generating payment invoices...'

			const currentInvoice = invoices[safeInvoiceIndex]
			if (currentInvoice) {
				const invoiceTypeLabel = currentInvoice.type === 'v4v' ? 'V4V Payment' : 'Payment'
				return `${invoiceTypeLabel} ${safeInvoiceIndex + 1} of ${invoices.length}: ${currentInvoice.recipientName}`
			}
			return `Processing Lightning payments (${safeInvoiceIndex + 1} of ${invoices.length})`
		}
		case 'complete':
			return 'Order complete'
		default:
			return 'Checkout'
	}
}

export function resolveCheckoutCardTitle(step: CheckoutStep): string {
	if (step === 'shipping') return 'Shipping Address'
	if (step === 'payment') return 'Invoices'
	return 'Order Summary'
}

export function resolveSummaryCardTitle(step: CheckoutStep): string {
	return step === 'payment' ? 'Payment Details' : 'Cart Summary'
}

export function hasCheckoutArtifacts(specOrderIds: readonly string[], invoiceCount: number): boolean {
	return specOrderIds.length > 0 || invoiceCount > 0
}

/** Cart edits are only allowed before any order or invoice exists, on the shipping step. */
export function shouldAllowCartEdits(step: CheckoutStep, artifactsExist: boolean): boolean {
	return step === 'shipping' && !artifactsExist
}

/** An invoice carries its own order id once the order workflow has run; before that it is a placeholder. */
export function resolveInvoiceOrderId(invoice: { orderId?: string } | undefined, specOrderIds: readonly string[]): string {
	const orderId = invoice?.orderId
	if (orderId && orderId !== TEMP_ORDER_ID) return orderId
	return specOrderIds[0] || UNKNOWN_ORDER_ID
}

export function resolveUnpaidInvoiceCount(invoices: readonly PaymentInvoiceData[]): number {
	return invoices.filter((invoice) => invoice.status === 'pending' || invoice.status === 'failed').length
}

/** Bulk NWC payment is offered only when there is a usable wallet and more than one invoice to pay. */
export function shouldOfferPayAll(nwcEnabled: boolean, unpaidInvoiceCount: number): boolean {
	return nwcEnabled && unpaidInvoiceCount > 1
}

export interface InvoiceStatusChangeResult {
	invoices: PaymentInvoiceData[]
	/** Every invoice is terminal (paid, skipped or expired). */
	allCompleted: boolean
	/**
	 * The next pending/failed index within the updated list, or `-1` when there is
	 * nothing to advance to. `-1` is the sdk's own sentinel
	 * (`findNextActionableInvoiceIndex`), kept here so the hook's guard is the same
	 * check the inline route used.
	 */
	nextPendingIndex: number
}

/**
 * Apply one invoice's status change and decide what the flow does next.
 *
 * `fromIndex` is the flow's current invoice position, used only when the changed
 * invoice is no longer findable in the list. Auto-advance is skipped for the
 * bulk-NWC path, which walks the list itself.
 */
export function applyInvoiceStatusChange(
	invoices: readonly PaymentInvoiceData[],
	invoiceId: string,
	changes: Partial<PaymentInvoiceData>,
	options: { fromIndex: number; skipAutoAdvance?: boolean },
): InvoiceStatusChangeResult {
	const updated = invoices.map((invoice) => (invoice.id === invoiceId ? { ...invoice, ...changes } : invoice))

	const allCompleted = updated.length > 0 && updated.every(isCheckoutInvoiceComplete)

	if (options.skipAutoAdvance || allCompleted) {
		return { invoices: updated, allCompleted, nextPendingIndex: -1 }
	}

	const changedIndex = updated.findIndex((invoice) => invoice.id === invoiceId)
	const nextPendingIndex = findNextActionableInvoiceIndex(updated, changedIndex === -1 ? options.fromIndex : changedIndex)

	return { invoices: updated, allCompleted, nextPendingIndex }
}

export interface BackNavigationDecision {
	/** The shipping step is the checkout's entry point; going back leaves for the shop. */
	leaveCheckout?: boolean
	step?: CheckoutStep
	invoiceIndex?: number
	/** Set when the move is refused; the caller surfaces it (the route toasts it). */
	blockedMessage?: string
}

/**
 * Where the back control goes. Refusals are decisions, not exceptions: the route
 * owns the toast wording so the flow module stays free of UI concerns.
 */
export function resolveBackNavigation(input: {
	step: CheckoutStep
	invoiceIndex: number
	invoiceCount: number
	artifactsExist: boolean
}): BackNavigationDecision {
	const { step, invoiceIndex, invoiceCount, artifactsExist } = input

	if (step === 'shipping') return { leaveCheckout: true }

	if (step === 'summary') {
		if (artifactsExist) return { blockedMessage: 'Cart edits are locked after order creation.' }
		return { step: 'shipping' }
	}

	if (step === 'payment') {
		if (invoiceIndex > 0) return { invoiceIndex: invoiceIndex - 1 }
		return { step: 'summary' }
	}

	if (step === 'complete') {
		return { step: 'payment', invoiceIndex: invoiceCount > 0 ? invoiceCount - 1 : 0 }
	}

	return {}
}

/** The summary step's gate: shipping data captured and delivery requirements verified. */
export function canContinueToCheckout(input: {
	shippingData: { email: string } | null
	hasPartialOrder: boolean
	deliveryRequirements: CheckoutDeliveryRequirements
	isDeliveryRequirementsLoading: boolean
	deliveryRequirementsError: string | null
}): boolean {
	const { shippingData, hasPartialOrder, deliveryRequirements, isDeliveryRequirementsLoading, deliveryRequirementsError } = input

	return (
		!!shippingData &&
		!hasPartialOrder &&
		deliveryRequirements.isResolved &&
		!isDeliveryRequirementsLoading &&
		!deliveryRequirementsError &&
		(!deliveryRequirements.needsDigitalDeliveryContact || isValidDigitalDeliveryContact(shippingData.email))
	)
}
