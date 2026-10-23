import { describe, expect, test } from 'bun:test'
import { resolveCheckoutDeliveryRequirements, type CheckoutDeliveryRequirements, type PaymentInvoiceData } from '@sdk/commerce/checkout'
import type { V4VDTO } from '@/lib/stores/cart'
import {
	TEMP_ORDER_ID,
	applyInvoiceStatusChange,
	canContinueToCheckout,
	clampInvoiceIndex,
	describeCheckoutStep,
	hasCheckoutArtifacts,
	resolveBackNavigation,
	resolveCheckoutCardTitle,
	resolveCheckoutProgress,
	resolveCheckoutStepNumber,
	resolveInvoiceOrderId,
	resolveInvoiceStepCount,
	resolveSummaryCardTitle,
	resolveTotalInvoicesNeeded,
	resolveTotalSteps,
	resolveUnpaidInvoiceCount,
	shouldAllowCartEdits,
	shouldOfferPayAll,
} from './checkoutFlow'

/**
 * The checkout flow's transitions, pinned before the route is split.
 *
 * There was no route-level coverage for checkout at all: the whole money path
 * (cart -> orders -> invoices -> payment -> completion) lived inline in
 * `platform/web/routes/checkout.tsx` and could only be exercised by driving the
 * browser. These tests are the regression net for the extraction: they record
 * what the inline flow did, including the behaviours that look like accidents
 * but are deliberate (the `'temp-order'` placeholder, expired invoices not
 * blocking completion, the clamp on a shrinking invoice list).
 */

function invoice(overrides: Partial<PaymentInvoiceData> & { id: string }): PaymentInvoiceData {
	return {
		orderId: 'order-1',
		amount: 1000,
		description: 'Seller payment',
		recipientName: 'Seller',
		recipientPubkey: 'a'.repeat(64),
		status: 'pending',
		createdAt: 1_700_000_000_000,
		type: 'merchant',
		...overrides,
	}
}

function requirements(overrides: Partial<CheckoutDeliveryRequirements> = {}): CheckoutDeliveryRequirements {
	return {
		hasDigitalDelivery: false,
		hasPhysicalDelivery: false,
		hasPickupDelivery: false,
		needsDigitalDeliveryContact: false,
		needsPhysicalAddress: false,
		isResolved: true,
		unresolvedShippingRefs: [],
		...overrides,
	}
}

describe('resolveTotalInvoicesNeeded', () => {
	test('counts one merchant invoice per seller plus one per V4V recipient', () => {
		const shares: Record<string, V4VDTO[]> = {
			sellerA: [{ id: 'v1', name: 'Dev', pubkey: 'p1', percentage: 2 }],
			sellerB: [
				{ id: 'v2', name: 'Dev', pubkey: 'p2', percentage: 2 },
				{ id: 'v3', name: 'Dev', pubkey: 'p3', percentage: 1 },
			],
		}
		expect(resolveTotalInvoicesNeeded(['sellerA', 'sellerB'], shares)).toBe(2 + 3)
	})

	test('treats a seller with no V4V entry as one invoice', () => {
		expect(resolveTotalInvoicesNeeded(['solo'], {})).toBe(1)
	})

	test('is zero for an empty seller list', () => {
		expect(resolveTotalInvoicesNeeded([], {})).toBe(0)
	})
})

describe('progress accounting', () => {
	test('the progress bar keeps its width while invoices are still generating', () => {
		// No invoices yet: the expected count stands in, so the bar does not jump
		// back when generation finishes.
		expect(resolveInvoiceStepCount(0, 3)).toBe(3)
		expect(resolveInvoiceStepCount(3, 3)).toBe(3)
		// Fewer invoices than expected (a V4V recipient was skipped): the real
		// count wins, so the last step is not unreachable.
		expect(resolveInvoiceStepCount(2, 3)).toBe(2)
	})

	test('total steps is shipping + summary + invoices + complete', () => {
		expect(resolveTotalSteps(0)).toBe(3)
		expect(resolveTotalSteps(3)).toBe(6)
	})

	test('step numbers follow the flow, with payment offset by the invoice position', () => {
		expect(resolveCheckoutStepNumber('shipping', 0, 0, 6)).toBe(1)
		expect(resolveCheckoutStepNumber('summary', 0, 0, 6)).toBe(2)
		expect(resolveCheckoutStepNumber('payment', 0, 0, 6)).toBe(3)
		expect(resolveCheckoutStepNumber('payment', 3, 2, 6)).toBe(5)
		expect(resolveCheckoutStepNumber('complete', 3, 2, 6)).toBe(6)
	})

	test('clamps an index that outlived a shrinking invoice list', () => {
		expect(clampInvoiceIndex(4, 3)).toBe(2)
		expect(clampInvoiceIndex(1, 3)).toBe(1)
		expect(clampInvoiceIndex(0, 0)).toBe(0)
		expect(clampInvoiceIndex(5, 0)).toBe(0)
	})

	test('progress spans 0..100 and never divides by zero', () => {
		expect(resolveCheckoutProgress(1, 6)).toBe(0)
		expect(resolveCheckoutProgress(6, 6)).toBe(100)
		expect(resolveCheckoutProgress(1, 1)).toBe(100)
	})
})

describe('describeCheckoutStep', () => {
	test('names the shipping and summary steps', () => {
		expect(describeCheckoutStep('shipping', 0, [])).toBe('Enter shipping address')
		expect(describeCheckoutStep('summary', 0, [])).toBe('Review your order')
		expect(describeCheckoutStep('complete', 0, [])).toBe('Order complete')
	})

	test('reports invoice generation while the list is still empty', () => {
		expect(describeCheckoutStep('payment', 0, [])).toBe('Generating payment invoices...')
	})

	test('labels merchant and V4V invoices by position and recipient', () => {
		const invoices = [invoice({ id: 'i1', recipientName: 'Guitars' }), invoice({ id: 'i2', recipientName: 'Dev Fund', type: 'v4v' })]
		expect(describeCheckoutStep('payment', 0, invoices)).toBe('Payment 1 of 2: Guitars')
		expect(describeCheckoutStep('payment', 1, invoices)).toBe('V4V Payment 2 of 2: Dev Fund')
	})

	test('falls back to a position line when the index has no invoice yet', () => {
		expect(describeCheckoutStep('payment', 0, [invoice({ id: 'i1', recipientName: 'x' })]).length).toBeGreaterThan(0)
		expect(describeCheckoutStep('payment', 3, [])).toBe('Generating payment invoices...')
	})
})

describe('card titles', () => {
	test('the main card names the active step', () => {
		expect(resolveCheckoutCardTitle('shipping')).toBe('Shipping Address')
		expect(resolveCheckoutCardTitle('payment')).toBe('Invoices')
		expect(resolveCheckoutCardTitle('summary')).toBe('Order Summary')
		expect(resolveCheckoutCardTitle('complete')).toBe('Order Summary')
	})

	test('the summary card switches to payment details on the money step', () => {
		expect(resolveSummaryCardTitle('shipping')).toBe('Cart Summary')
		expect(resolveSummaryCardTitle('summary')).toBe('Cart Summary')
		expect(resolveSummaryCardTitle('payment')).toBe('Payment Details')
	})
})

describe('cart edit lock', () => {
	test('artifacts exist once an order id or an invoice is present', () => {
		expect(hasCheckoutArtifacts([], 0)).toBe(false)
		expect(hasCheckoutArtifacts(['o1'], 0)).toBe(true)
		expect(hasCheckoutArtifacts([], 1)).toBe(true)
	})

	test('quantities and shipping stay editable only on a clean shipping step', () => {
		expect(shouldAllowCartEdits('shipping', false)).toBe(true)
		expect(shouldAllowCartEdits('shipping', true)).toBe(false)
		expect(shouldAllowCartEdits('summary', false)).toBe(false)
		expect(shouldAllowCartEdits('payment', false)).toBe(false)
	})
})

describe('resolveInvoiceOrderId', () => {
	test('prefers the invoice order id once the order workflow has run', () => {
		expect(resolveInvoiceOrderId({ orderId: 'real-order' }, ['spec-order'])).toBe('real-order')
	})

	test('falls back past the temp placeholder to the spec order ids', () => {
		expect(resolveInvoiceOrderId({ orderId: TEMP_ORDER_ID }, ['spec-order'])).toBe('spec-order')
		expect(resolveInvoiceOrderId(undefined, ['spec-order'])).toBe('spec-order')
	})

	test('degrades to a literal when nothing is known yet', () => {
		expect(resolveInvoiceOrderId(undefined, [])).toBe('unknown-order')
		expect(resolveInvoiceOrderId({ orderId: TEMP_ORDER_ID }, [])).toBe('unknown-order')
	})
})

describe('unpaid invoice accounting', () => {
	test('counts pending and failed invoices only', () => {
		const invoices = [
			invoice({ id: 'i1', status: 'pending' }),
			invoice({ id: 'i2', status: 'failed' }),
			invoice({ id: 'i3', status: 'paid' }),
			invoice({ id: 'i4', status: 'skipped' }),
			invoice({ id: 'i5', status: 'expired' }),
		]
		expect(resolveUnpaidInvoiceCount(invoices)).toBe(2)
	})

	test('bulk payment needs a wallet and more than one unpaid invoice', () => {
		expect(shouldOfferPayAll(true, 2)).toBe(true)
		expect(shouldOfferPayAll(true, 1)).toBe(false)
		expect(shouldOfferPayAll(false, 3)).toBe(false)
	})
})

describe('applyInvoiceStatusChange', () => {
	test('marks paid and advances to the next actionable invoice', () => {
		const invoices = [invoice({ id: 'i1' }), invoice({ id: 'i2' }), invoice({ id: 'i3' })]
		const result = applyInvoiceStatusChange(invoices, 'i1', { status: 'paid' }, { fromIndex: 0 })

		expect(result.invoices[0]?.status).toBe('paid')
		expect(result.allCompleted).toBe(false)
		expect(result.nextPendingIndex).toBe(1)
	})

	test('expired and skipped invoices do not block completion; the last one completes the flow', () => {
		const invoices = [invoice({ id: 'i1' }), invoice({ id: 'i2' })]
		const afterFirst = applyInvoiceStatusChange(invoices, 'i1', { status: 'expired' }, { fromIndex: 0 })
		expect(afterFirst.allCompleted).toBe(false)
		expect(afterFirst.nextPendingIndex).toBe(1)

		const afterSecond = applyInvoiceStatusChange(afterFirst.invoices, 'i2', { status: 'skipped' }, { fromIndex: 1 })
		expect(afterSecond.allCompleted).toBe(true)
		expect(afterSecond.nextPendingIndex).toBe(-1)
	})

	test('bulk payment skips auto-advance but still reports completion', () => {
		const invoices = [invoice({ id: 'i1' }), invoice({ id: 'i2', status: 'paid' })]
		const result = applyInvoiceStatusChange(invoices, 'i1', { status: 'paid' }, { fromIndex: 0, skipAutoAdvance: true })

		expect(result.allCompleted).toBe(true)
		expect(result.nextPendingIndex).toBe(-1)
	})

	test('finds the changed invoice by id, wrapping past the end of the list', () => {
		// The flow position said index 0 (invoice i1) but i3 was the one that
		// changed; the search must follow the id, not the stale index — and from
		// the last invoice it wraps, so the still-pending i1 is what comes next.
		const invoices = [invoice({ id: 'i1' }), invoice({ id: 'i2' }), invoice({ id: 'i3' })]
		const result = applyInvoiceStatusChange(invoices, 'i3', { status: 'paid' }, { fromIndex: 0 })
		expect(result.nextPendingIndex).toBe(0)
	})

	test('an unknown invoice id falls back to the flow index for the wrap search', () => {
		const invoices = [invoice({ id: 'i1' }), invoice({ id: 'i2' })]
		const result = applyInvoiceStatusChange(invoices, 'missing', { status: 'paid' }, { fromIndex: 0 })
		expect(result.invoices.every((entry) => entry.status === 'pending')).toBe(true)
		expect(result.nextPendingIndex).toBe(1)
	})

	test('wraps to an earlier unpaid invoice instead of stalling', () => {
		const invoices = [invoice({ id: 'i1', status: 'failed' }), invoice({ id: 'i2', status: 'failed' })]
		const result = applyInvoiceStatusChange(invoices, 'i2', { status: 'paid' }, { fromIndex: 1 })
		expect(result.nextPendingIndex).toBe(0)
	})

	test('an empty list is never "complete" and offers no advance', () => {
		const result = applyInvoiceStatusChange([], 'i1', { status: 'paid' }, { fromIndex: 0 })
		expect(result.allCompleted).toBe(false)
		expect(result.nextPendingIndex).toBe(-1)
	})

	test('does not mutate the input list', () => {
		const invoices = [invoice({ id: 'i1' })]
		applyInvoiceStatusChange(invoices, 'i1', { status: 'paid' }, { fromIndex: 0 })
		expect(invoices[0]?.status).toBe('pending')
	})
})

describe('resolveBackNavigation', () => {
	test('leaves checkout from the shipping step', () => {
		expect(resolveBackNavigation({ step: 'shipping', invoiceIndex: 0, invoiceCount: 0, artifactsExist: false })).toEqual({
			leaveCheckout: true,
		})
	})

	test('refuses to re-open the shipping step once orders exist', () => {
		const decision = resolveBackNavigation({ step: 'summary', invoiceIndex: 0, invoiceCount: 1, artifactsExist: true })
		expect(decision.blockedMessage).toBe('Cart edits are locked after order creation.')
		expect(decision.step).toBeUndefined()
	})

	test('a clean summary returns to shipping', () => {
		expect(resolveBackNavigation({ step: 'summary', invoiceIndex: 0, invoiceCount: 0, artifactsExist: false })).toEqual({
			step: 'shipping',
		})
	})

	test('payment walks its invoices before falling back to the summary', () => {
		expect(resolveBackNavigation({ step: 'payment', invoiceIndex: 2, invoiceCount: 3, artifactsExist: true })).toEqual({
			invoiceIndex: 1,
		})
		expect(resolveBackNavigation({ step: 'payment', invoiceIndex: 0, invoiceCount: 3, artifactsExist: true })).toEqual({
			step: 'summary',
		})
	})

	test('the complete step returns to the final invoice', () => {
		expect(resolveBackNavigation({ step: 'complete', invoiceIndex: 0, invoiceCount: 3, artifactsExist: true })).toEqual({
			step: 'payment',
			invoiceIndex: 2,
		})
		expect(resolveBackNavigation({ step: 'complete', invoiceIndex: 0, invoiceCount: 0, artifactsExist: false })).toEqual({
			step: 'payment',
			invoiceIndex: 0,
		})
	})
})

describe('canContinueToCheckout', () => {
	const base = {
		shippingData: { email: 'buyer@example.test' },
		hasPartialOrder: false,
		deliveryRequirements: requirements(),
		isDeliveryRequirementsLoading: false,
		deliveryRequirementsError: null,
	}

	test('allows a resolved, loaded flow with shipping data captured', () => {
		expect(canContinueToCheckout(base)).toBe(true)
	})

	test('blocks without shipping data', () => {
		expect(canContinueToCheckout({ ...base, shippingData: null })).toBe(false)
	})

	test('blocks while requirements resolve, on error, or when unresolved', () => {
		expect(canContinueToCheckout({ ...base, isDeliveryRequirementsLoading: true })).toBe(false)
		expect(canContinueToCheckout({ ...base, deliveryRequirementsError: 'failed' })).toBe(false)
		expect(canContinueToCheckout({ ...base, deliveryRequirements: requirements({ isResolved: false }) })).toBe(false)
	})

	test('blocks after a partial order, which must not be retried', () => {
		expect(canContinueToCheckout({ ...base, hasPartialOrder: true })).toBe(false)
	})

	test('a digital product needs a valid contact, even when everything else is green', () => {
		const digital = requirements({ hasDigitalDelivery: true, needsDigitalDeliveryContact: true })
		expect(canContinueToCheckout({ ...base, deliveryRequirements: digital, shippingData: { email: 'not-an-email' } })).toBe(false)
		expect(canContinueToCheckout({ ...base, deliveryRequirements: digital, shippingData: { email: 'buyer@example.test' } })).toBe(true)
	})

	test('agrees with the sdk resolver on what "unresolved" means', () => {
		// The route used to inline this rule; it now reads `isResolved` from the sdk.
		const unresolved = resolveCheckoutDeliveryRequirements({
			products: [{ id: 'p1', shippingMethodId: null }],
			servicesByShippingRef: {},
		})
		expect(canContinueToCheckout({ ...base, deliveryRequirements: unresolved })).toBe(false)
	})
})
