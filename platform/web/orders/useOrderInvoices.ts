import { getPersistedInvoicesForOrder, persistInvoicesLocally, updatePersistedInvoiceLocally } from '@platform/web/payments/invoiceStorage'
import type { PaymentInvoiceData } from '@sdk/commerce/checkout'
import type { V4VDTO } from '@platform/web/cart/cartStore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useGenerateInvoiceMutation } from '@platform/web/payments/paymentQuery'
import { publishPaymentReceipt } from '@platform/web/payments/paymentPublish'
import { getPayAggregatorInstance } from '@platform/web/payments/payAggregatorInstance'
import { persistSetForOrder, resolveSetIdForOrder } from '@platform/web/payments/payAggregatorStore'
import type { LegIntent, RefundRequest, SetHandle, SetState } from '@sdk/core/wallet'
import { useQueryClient } from '@tanstack/react-query'
import { orderKeys } from '@sdk/core/query/queryKeyFactory'
import { extractPaymentMethods, getOrderId, getSellerPubkey, isPaymentCompleted, makeInvoiceKey } from './orderDetailHelpers'
import type { OrderWithRelatedEvents } from '@platform/web/orders/ordersQuery'
import type { InvoiceWithSource } from '@sdk/commerce/orders/orderDetail'

export type { InvoiceWithSource } from '@sdk/commerce/orders/orderDetail'

interface UseOrderInvoicesParams {
	order: OrderWithRelatedEvents
	sellerV4VShares: V4VDTO[]
	userPubkey?: string
}

export function useOrderInvoices({ order, sellerV4VShares, userPubkey }: UseOrderInvoicesParams) {
	const { mutateAsync: generateInvoice } = useGenerateInvoiceMutation()
	const queryClient = useQueryClient()
	const [generatingInvoices, setGeneratingInvoices] = useState<Set<string>>(new Set())
	const [localInvoices, setLocalInvoices] = useState<PaymentInvoiceData[]>([])

	const orderEvent = order.order
	const orderId = getOrderId(orderEvent)
	const sellerPubkey = getSellerPubkey(orderEvent)
	const buyerPubkey = orderEvent.pubkey
	const isBuyer = buyerPubkey === userPubkey

	// Refresh local invoices from storage
	const refreshLocalInvoices = useCallback(() => {
		if (!isBuyer || !orderId) return
		const stored = getPersistedInvoicesForOrder(orderId)
		setLocalInvoices(stored)
	}, [isBuyer, orderId])

	useEffect(() => {
		refreshLocalInvoices()
	}, [refreshLocalInvoices])

	// Build invoices from payment requests
	const invoicesFromPaymentRequests = useMemo(() => {
		const paymentReceipts = order.paymentReceipts || []

		if (!order.paymentRequests || order.paymentRequests.length === 0) {
			return []
		}

		const invoices: PaymentInvoiceData[] = []

		order.paymentRequests.forEach((paymentRequest) => {
			const amountTag = paymentRequest.tags.find((tag) => tag[0] === 'amount')
			const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0

			if (amount <= 0) return

			const paymentMethods = extractPaymentMethods(paymentRequest)
			const lightningPayment = paymentMethods.find((p) => p.type === 'lightning')
			const isCompleted = isPaymentCompleted(paymentRequest, paymentReceipts)

			const recipientPubkey = paymentRequest.tags.find((tag) => tag[0] === 'recipient')?.[1] || paymentRequest.pubkey
			const isSellerPayment = recipientPubkey === sellerPubkey

			let recipientName = 'Merchant'
			if (!isSellerPayment) {
				const v4vRecipient = sellerV4VShares.find((share) => share.pubkey === recipientPubkey)
				recipientName = v4vRecipient ? v4vRecipient.name : 'V4V Recipient'
			}

			const expirationTag = paymentRequest.tags.find((tag) => tag[0] === 'expiration')
			const expirationValue = expirationTag?.[1]
			const expiresAt = expirationValue ? parseInt(expirationValue, 10) : Math.floor(Date.now() / 1000) + 3600

			const lightningAddress = lightningPayment?.details || ''
			const isBolt11 = lightningAddress.toLowerCase().startsWith('lnbc') || lightningAddress.toLowerCase().startsWith('lntb')
			const actualBolt11 = isBolt11 ? lightningAddress : ''
			const actualLightningAddress = !isBolt11 ? lightningAddress : ''

			invoices.push({
				id: paymentRequest.id,
				orderId: orderId,
				bolt11: actualBolt11,
				amount,
				description: isSellerPayment ? 'Merchant Payment' : 'V4V Community Payment',
				recipientName,
				status: isCompleted ? 'paid' : expiresAt < Math.floor(Date.now() / 1000) ? 'expired' : 'pending',
				expiresAt,
				createdAt: paymentRequest.created_at || Math.floor(Date.now() / 1000),
				lightningAddress: actualLightningAddress,
				recipientPubkey,
				type: isSellerPayment ? 'merchant' : 'v4v',
			})
		})

		return invoices
	}, [order.paymentRequests, order.paymentReceipts, orderId, sellerV4VShares, sellerPubkey])

	// Map local invoices by key
	const localInvoicesByKey = useMemo(() => {
		const map: Record<string, PaymentInvoiceData[]> = {}

		localInvoices.forEach((invoice) => {
			if (invoice.orderId !== orderId) return
			const key = makeInvoiceKey(invoice)
			if (!map[key]) {
				map[key] = []
			}
			map[key].push(invoice)
		})

		Object.values(map).forEach((list) =>
			list.sort((a, b) => {
				const aTime = a.updatedAt || a.createdAt || 0
				const bTime = b.updatedAt || b.createdAt || 0
				return bTime - aTime
			}),
		)

		return map
	}, [localInvoices, orderId])

	// Enriched invoices combining request data with local storage
	const enrichedInvoices: InvoiceWithSource[] = useMemo(() => {
		return invoicesFromPaymentRequests.map((invoice) => {
			const key = makeInvoiceKey(invoice)
			const localCopies = localInvoicesByKey[key] || []
			const latestLocal = localCopies[0]

			return {
				...invoice,
				status: latestLocal?.status ?? invoice.status,
				bolt11: latestLocal?.bolt11 || invoice.bolt11,
				lightningAddress: latestLocal?.lightningAddress || invoice.lightningAddress,
				preimage: latestLocal?.preimage || invoice.preimage,
				isZap: latestLocal?.isZap ?? invoice.isZap,
				source: latestLocal ? 'both' : 'request',
				localCopies,
			}
		})
	}, [invoicesFromPaymentRequests, localInvoicesByKey])

	// Generate a new invoice
	const handleGenerateNewInvoice = useCallback(
		async (invoice: PaymentInvoiceData) => {
			setGeneratingInvoices((prev) => new Set(prev).add(invoice.id))

			try {
				const recipientPubkey = invoice.recipientPubkey || sellerPubkey
				const newInvoiceData = await generateInvoice({
					sellerPubkey: recipientPubkey,
					amountSats: invoice.amount,
					description: invoice.description || 'Payment',
					invoiceId: invoice.id,
					items: [],
					type: invoice.type === 'merchant' ? 'seller' : invoice.type,
				})

				const newPersistedInvoice: PaymentInvoiceData = {
					id: newInvoiceData.id,
					orderId,
					recipientPubkey,
					recipientName: invoice.recipientName,
					amount: invoice.amount,
					description: invoice.description,
					bolt11: newInvoiceData.bolt11 || null,
					lightningAddress: newInvoiceData.lightningAddress || invoice.lightningAddress || null,
					expiresAt: newInvoiceData.expiresAt,
					status: newInvoiceData.status === 'failed' ? 'expired' : (newInvoiceData.status as 'pending' | 'paid' | 'expired'),
					type: invoice.type,
					createdAt: Date.now(),
					isZap: newInvoiceData.isZap,
				}

				persistInvoicesLocally([newPersistedInvoice])
				refreshLocalInvoices()

				toast.success(`New invoice generated for ${invoice.recipientName}`)
			} catch (error) {
				console.error('Failed to generate new invoice:', error)
				toast.error(`Failed to generate new invoice: ${error instanceof Error ? error.message : 'Unknown error'}`)
			} finally {
				setGeneratingInvoices((prev) => {
					const newSet = new Set(prev)
					newSet.delete(invoice.id)
					return newSet
				})
			}
		},
		[orderId, sellerPubkey, generateInvoice, refreshLocalInvoices],
	)

	// Handle payment completion
	const handlePaymentComplete = useCallback(
		async (invoiceId: string, preimage: string, dialogInvoices: PaymentInvoiceData[]) => {
			toast.success('Payment completed successfully!')

			const invoice = enrichedInvoices.find((inv) => inv.id === invoiceId) || dialogInvoices.find((inv) => inv.id === invoiceId)

			if (invoice && invoice.bolt11) {
				try {
					await publishPaymentReceipt({
						invoice: {
							orderId,
							recipientPubkey: invoice.recipientPubkey,
							amount: invoice.amount,
							description: invoice.description,
							id: invoice.id,
							bolt11: invoice.bolt11,
						},
						preimage,
						bolt11: invoice.bolt11,
					})

					queryClient.invalidateQueries({ queryKey: orderKeys.details(orderId) })

					// Record the settlement with the pay aggregator. The receipt above stays
					// the network proof; this is the settlement record the verdict below
					// reads. The leg id and its expected hash are the invoice's PAYMENT
					// HASH — decoded from the bolt11, never the invoice string itself. A
					// failure here is logged and never blocks the order.
					try {
						const { payAggregator, bolt11Wrapper } = getPayAggregatorInstance()
						// Obtain the leg from the rail first: `obtain` decodes the invoice's
						// payment hash, writes the leg record before any money moves, and returns
						// the quote the set is declared with. The invoice string is never used as
						// the expected hash.
						const obtained = await bolt11Wrapper.obtain({
							kind: 'manual-preimage',
							amountSat: invoice.amount,
							description: invoice.description,
							bolt11: invoice.bolt11,
						})
						if ('refused' in obtained) {
							throw new Error(`bolt11 leg refused: ${obtained.reason} (${obtained.field})`)
						}
						const leg: LegIntent = {
							wrapperId: obtained.wrapperId,
							legId: obtained.legId,
							method: obtained.method,
							frozenShare: invoice.amount,
							expectedPaymentHash: obtained.legId,
							authorityKind: obtained.authorityKind,
							operations: obtained.operations,
							plan: obtained.plan,
						}
						const handle = await payAggregator.pay({ orderId, totalSat: invoice.amount, legs: [leg] })
						await bolt11Wrapper.submit(obtained, preimage)
						await payAggregator.reconcile(handle.setId)
						persistSetForOrder(orderId, handle.setId)
					} catch (aggregationError) {
						console.error('Failed to record the settlement with the pay aggregator:', aggregationError)
					}
				} catch (err) {
					console.error('Failed to publish payment receipt:', err)
				}
			}

			updatePersistedInvoiceLocally(orderId, invoiceId, {
				status: 'paid',
				preimage,
			})
			refreshLocalInvoices()
		},
		[orderId, enrichedInvoices, queryClient, refreshLocalInvoices],
	)

	// Handle payment failure
	const handlePaymentFailed = useCallback(
		(invoiceId: string, error: string) => {
			console.error(`Payment failed for invoice ${invoiceId}:`, error)
			toast.error(`Payment failed: ${error}`)
			updatePersistedInvoiceLocally(orderId, invoiceId, {
				status: 'expired',
			})
			refreshLocalInvoices()
		},
		[orderId, refreshLocalInvoices],
	)

	// Calculate payment statistics
	const paidInvoices = enrichedInvoices.filter((invoice) => invoice.status === 'paid')
	const incompleteInvoices = enrichedInvoices.filter((invoice) => invoice.status !== 'paid')
	const totalInvoices = enrichedInvoices.length
	const paymentProgress = totalInvoices > 0 ? (paidInvoices.length / totalInvoices) * 100 : 0

	// The set verdict for this order, read from the pay aggregator's own store. It is
	// re-read when the paid-invoice count changes — never polled.
	const [setVerdict, setSetVerdict] = useState<{ setId: string | null; state: SetState | null }>({
		setId: null,
		state: null,
	})

	useEffect(() => {
		const setId = resolveSetIdForOrder(orderId)
		if (!setId) {
			setSetVerdict({ setId: null, state: null })
			return
		}

		let cancelled = false
		void getPayAggregatorInstance()
			.payAggregator.status(setId)
			.then(
				(handle) => {
					if (!cancelled) setSetVerdict({ setId, state: handle.state })
				},
				(error: unknown) => {
					console.error('Failed to read the payment set verdict:', error)
					if (!cancelled) setSetVerdict({ setId, state: null })
				},
			)

		return () => {
			cancelled = true
		}
	}, [orderId, paidInvoices.length])

	// Open the refund set for this order. The caller supplies the refund legs (it owns
	// the refund invoice); this hook owns only the order→set correlation.
	const openRefund = useCallback(
		async (request: Omit<RefundRequest, 'purchaseSetId'>): Promise<SetHandle> => {
			const purchaseSetId = resolveSetIdForOrder(orderId)
			if (!purchaseSetId) {
				throw new Error('No purchase set is recorded for this order')
			}
			return getPayAggregatorInstance().payAggregator.openRefund({ ...request, purchaseSetId })
		},
		[orderId],
	)

	return {
		enrichedInvoices,
		paidInvoices,
		incompleteInvoices,
		totalInvoices,
		paymentProgress,
		generatingInvoices,
		handleGenerateNewInvoice,
		handlePaymentComplete,
		handlePaymentFailed,
		refreshLocalInvoices,
		setVerdict,
		openRefund,
	}
}
