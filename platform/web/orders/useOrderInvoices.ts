import { getPersistedInvoicesForOrder, persistInvoicesLocally, updatePersistedInvoiceLocally } from '@platform/web/payments/invoiceStorage'
import type { PaymentInvoiceData } from '@sdk/commerce/checkout'
import type { V4VDTO } from '@platform/web/cart/cartStore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useGenerateInvoiceMutation } from '@platform/web/payments/paymentQuery'
import { getPayAggregatorInstance } from '@platform/web/payments/payAggregatorInstance'
import { resolveSetIdForOrder } from '@platform/web/payments/payAggregatorStore'
import { useQueryClient } from '@tanstack/react-query'
import { orderKeys } from '@sdk/core/query/queryKeyFactory'
import { extractPaymentMethods, getOrderId, getSellerPubkey, isPaymentCompleted, makeInvoiceKey } from './orderDetailHelpers'
import type { OrderWithRelatedEvents } from '@platform/web/orders/ordersQuery'
import type { SetIntent, RefundRequest } from '@sdk/core/wallet'
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

			if (invoice) {
				try {
					const { payAggregator, bolt11Wrapper } = getPayAggregatorInstance()

					// Build a SetIntent with a single bolt11 leg
					const intent: SetIntent = {
						orderId,
						totalSat: invoice.amount,
						legs: [
							{
								wrapperId: 'bolt11',
								legId: invoice.id,
								method: 'bolt11',
								frozenShare: invoice.amount,
								expectedPaymentHash: invoice.bolt11 || '',
								authorityKind: 'remote-and-observable' as const,
								operations: ['obtain', 'submit', 'reconcile'] as const,
								plan: ['obtain', 'submit', 'reconcile'] as const,
							},
						],
					}

					const handle = await payAggregator.pay(intent)

					// Submit the bolt11 leg with the preimage to settle it
					await bolt11Wrapper.submit(
						{
							wrapperId: 'bolt11',
							legId: invoice.id,
							method: 'bolt11',
							authorityKind: 'remote-and-observable',
							operations: ['obtain', 'submit', 'reconcile'],
							plan: ['obtain', 'submit', 'reconcile'],
							reference: invoice.bolt11 || '',
						},
						preimage,
					)

					// Reconcile to read back the settled state
					await payAggregator.reconcile(handle.setId)

					updatePersistedInvoiceLocally(orderId, invoiceId, {
						status: 'paid',
						preimage,
					})
				} catch (error) {
					console.error('Failed to process payment via aggregator:', error)
					toast.error(`Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`)
				}
			}

			refreshLocalInvoices()
		},
		[orderId, enrichedInvoices, refreshLocalInvoices],
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

	// Derive set verdict from the orderId → setId mapping for this order
	const [setVerdict, setSetVerdict] = useState<{ state: string | null; settled: boolean }>({
		state: null,
		settled: false,
	})

	useEffect(() => {
		const setId = resolveSetIdForOrder(orderId)
		if (!setId) {
			setSetVerdict({ state: null, settled: false })
			return
		}

		let cancelled = false
		const fetchSetVerdict = async () => {
			try {
				const { payAggregator } = getPayAggregatorInstance()
				const handle = await payAggregator.status(setId)
				if (!cancelled) {
					setSetVerdict({ state: handle.state, settled: handle.state === 'complete' })
				}
			} catch {
				if (!cancelled) {
					setSetVerdict({ state: null, settled: false })
				}
			}
		}
		fetchSetVerdict()

		// Refresh periodically for live settlement updates
		const interval = setInterval(fetchSetVerdict, 10000)
		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [orderId])

	// Open a refund set for this order
	const openRefund = useCallback(
		async (refundTotalSat: number) => {
			try {
				const { payAggregator } = getPayAggregatorInstance()
				const purchaseSetId = resolveSetIdForOrder(orderId)
				if (!purchaseSetId) {
					toast.error('No purchase set found for this order')
					return
				}
				const handle = await payAggregator.openRefund({
					purchaseSetId,
					refundTotalSat,
					legs: [],
				} as RefundRequest)
				toast.success('Refund set opened successfully')
				return handle
			} catch (error) {
				console.error('Failed to open refund:', error)
				toast.error(`Failed to open refund: ${error instanceof Error ? error.message : 'Unknown error'}`)
				return null
			}
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
		setVerdict,
		openRefund,
		handleGenerateNewInvoice,
		handlePaymentComplete,
		handlePaymentFailed,
		refreshLocalInvoices,
	}
}
