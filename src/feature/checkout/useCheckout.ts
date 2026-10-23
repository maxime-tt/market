import { useEffect, useMemo, useRef, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import {
	isCheckoutInvoiceComplete,
	isValidDigitalDeliveryContact,
	resolveCheckoutDeliveryRequirements,
	type CheckoutDeliveryRequirements,
	type PaymentInvoiceData,
} from '@sdk/commerce/checkout'
import type { SellerOrderPublishOutcome } from '@sdk/commerce/orders'
import type { PaymentContentRef } from '@/components/checkout/PaymentContent'
import type { CheckoutFormData } from '@/components/checkout/ShippingAddressForm'
import { authStore } from '@/lib/stores/auth'
import { cartActions, cartStore } from '@/lib/stores/cart'
import { parseNwcUri, useWallets } from '@/lib/stores/wallet'
import { persistInvoicesLocally, updatePersistedInvoiceLocally } from '@/lib/utils/invoiceStorage'
import type { OrderInvoiceSet } from '@/lib/utils/orderUtils'
import { publishOrderWorkflowWithDependencies } from '@/publish/orders'
import { publishPaymentReceipt } from '@/publish/payment'
import { getShippingEvent, getShippingService } from '@/queries/shipping'
import { useGenerateInvoiceMutation, type PaymentDetail } from '@/queries/payment'
import {
	type CheckoutStep,
	applyInvoiceStatusChange,
	canContinueToCheckout,
	clampInvoiceIndex,
	describeCheckoutStep,
	hasCheckoutArtifacts,
	resolveBackNavigation,
	resolveCheckoutProgress,
	resolveCheckoutStepNumber,
	resolveInvoiceOrderId,
	resolveInvoiceStepCount,
	resolveTotalInvoicesNeeded,
	resolveTotalSteps,
	resolveUnpaidInvoiceCount,
	shouldAllowCartEdits,
	shouldOfferPayAll,
} from './checkoutFlow'

/**
 * The checkout flow's host half.
 *
 * Everything that talks to the app — the cart, auth, wallet and NDK stores, the
 * shipping and payment queries, the invoice mutation, the order and receipt
 * publishing — lives here. Every decision that does not need React state is a
 * pure function in `./checkoutFlow`, which is where the transitions are tested:
 * the unit suite has no DOM renderer, so the money path is pinned by direct
 * calls rather than by driving the route.
 *
 * The route that consumes this hook is an assembler: it renders `ui/checkout`
 * views and passes this object's members down. It defines no presentation of its
 * own beyond its page container.
 *
 * Extracted from `platform/web/routes/checkout.tsx` (T3.1, wave 9 tail). The
 * effect ordering and the guards are carried over verbatim — in particular the
 * order-id gate before invoice generation and the "do not retry a partial order"
 * rule, both of which the tests in `checkoutFlow.test.ts` pin.
 */

const EMPTY_DELIVERY_REQUIREMENTS: CheckoutDeliveryRequirements = resolveCheckoutDeliveryRequirements({
	products: [],
	servicesByShippingRef: {},
})

export function useCheckout() {
	const { cart, totalInSats, productsBySeller, sellerData, v4vShares, isReconcilingRemoteCart } = useStore(cartStore)
	const { wallets, isInitialized: walletsInitialized, initialize: initializeWallets } = useWallets()
	const { user } = useStore(authStore)
	const navigate = useNavigate()

	const [currentStep, setCurrentStep] = useState<CheckoutStep>('shipping')
	const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(0)
	const [invoices, setInvoices] = useState<PaymentInvoiceData[]>([])
	const [shippingData, setShippingData] = useState<CheckoutFormData | null>(null)
	const [mobileOrderSummaryOpen, setMobileOrderSummaryOpen] = useState(false)
	const [selectedWallets, setSelectedWallets] = useState<Record<string, string>>({}) // sellerPubkey -> paymentDetailId
	const [availableWalletsBySeller, setAvailableWalletsBySeller] = useState<Record<string, PaymentDetail[]>>({})
	const [isCreatingOrder, setIsCreatingOrder] = useState(false)
	const [showLoginDialog, setShowLoginDialog] = useState(false)
	const [pendingContinueToPayment, setPendingContinueToPayment] = useState(false)
	const [deliveryRequirements, setDeliveryRequirements] = useState<CheckoutDeliveryRequirements>(EMPTY_DELIVERY_REQUIREMENTS)
	const [isDeliveryRequirementsLoading, setIsDeliveryRequirementsLoading] = useState(false)
	const [deliveryRequirementsError, setDeliveryRequirementsError] = useState<string | null>(null)
	const [partialOrderOutcome, setPartialOrderOutcome] = useState<Extract<SellerOrderPublishOutcome, { status: 'partial' }> | null>(null)
	/** Last payment failure, kept on screen instead of only flashing a toast. */
	const [paymentFailure, setPaymentFailure] = useState<string | null>(null)
	const [orderInvoiceSets, setOrderInvoiceSets] = useState<Record<string, OrderInvoiceSet>>({})
	const [specOrderIds, setSpecOrderIds] = useState<string[]>([])

	// Ref to control PaymentContent
	const paymentContentRef = useRef<PaymentContentRef>(null)

	// Use auto-animate with error handling to prevent DOM manipulation errors
	const [animationParent] = (() => {
		try {
			return useAutoAnimate()
		} catch (error) {
			console.warn('Auto-animate not available:', error)
			return [null]
		}
	})()

	const { mutateAsync: generateInvoice, isPending: isGeneratingInvoices } = useGenerateInvoiceMutation()

	const cartKey = Object.keys(cart.products).join(',')

	// Reset checkout state when component mounts or cart changes
	useEffect(() => {
		setCurrentStep('shipping')
		setCurrentInvoiceIndex(0)
		setInvoices([])
		setShippingData(null)
		setOrderInvoiceSets({})
		setSpecOrderIds([])
		setPartialOrderOutcome(null)
	}, [cartKey])

	// Initialize wallets on mount
	useEffect(() => {
		if (!walletsInitialized) {
			initializeWallets()
		}
	}, [walletsInitialized, initializeWallets])

	// Clear cart when component unmounts if checkout was completed
	useEffect(() => {
		return () => {
			if (currentStep === 'complete') {
				cartActions.clear()
			}
		}
	}, [currentStep])

	// Check for NWC availability based on configured wallets with valid URIs
	const nwcEnabled = useMemo(() => {
		if (!walletsInitialized) {
			return false
		}

		const validWallets = wallets.filter((wallet) => {
			if (!wallet.nwcUri) return false

			const parsed = parseNwcUri(wallet.nwcUri)
			return parsed !== null && parsed.pubkey && parsed.relay && parsed.secret
		})

		return validWallets.length > 0
	}, [walletsInitialized, wallets])

	const nwcWalletCount = useMemo(() => wallets.filter((wallet) => wallet.nwcUri && parseNwcUri(wallet.nwcUri)).length, [wallets])

	// Get the first valid NWC wallet URI to pass to payment processors
	const nwcWalletUri = useMemo(() => {
		if (!walletsInitialized) return null
		const validWallet = wallets.find((wallet) => {
			if (!wallet.nwcUri) return false
			const parsed = parseNwcUri(wallet.nwcUri)
			return parsed !== null && parsed.pubkey && parsed.relay && parsed.secret
		})
		return validWallet?.nwcUri || null
	}, [walletsInitialized, wallets])

	const cartProducts = useMemo(() => Object.values(cart.products), [cart.products])

	const isCartEmpty = useMemo(() => cartProducts.length === 0, [cartProducts])

	const hasAllShippingMethods = useMemo(() => cartProducts.every((product) => !!product.shippingMethodId), [cartProducts])

	useEffect(() => {
		let isCancelled = false

		const resolveDeliveryRequirements = async () => {
			if (cartProducts.length === 0) {
				setDeliveryRequirements(EMPTY_DELIVERY_REQUIREMENTS)
				setIsDeliveryRequirementsLoading(false)
				setDeliveryRequirementsError(null)
				return
			}

			if (!hasAllShippingMethods) {
				setDeliveryRequirements(
					resolveCheckoutDeliveryRequirements({
						products: cartProducts,
						servicesByShippingRef: {},
					}),
				)
				setIsDeliveryRequirementsLoading(false)
				setDeliveryRequirementsError(null)
				return
			}

			const shippingRefs = Array.from(new Set(cartProducts.map((product) => product.shippingMethodId?.trim()).filter(Boolean) as string[]))

			setIsDeliveryRequirementsLoading(true)
			setDeliveryRequirementsError(null)

			const servicesByShippingRef: Record<string, string | null> = {}

			try {
				await Promise.all(
					shippingRefs.map(async (shippingRef) => {
						const shippingEvent = await getShippingEvent(shippingRef)
						servicesByShippingRef[shippingRef] = shippingEvent ? getShippingService(shippingEvent)?.[1] || null : null
					}),
				)

				if (isCancelled) return

				setDeliveryRequirements(
					resolveCheckoutDeliveryRequirements({
						products: cartProducts,
						servicesByShippingRef,
					}),
				)
				setIsDeliveryRequirementsLoading(false)
			} catch (error) {
				console.error('Failed to resolve checkout delivery requirements:', error)
				if (isCancelled) return

				setDeliveryRequirements(
					resolveCheckoutDeliveryRequirements({
						products: cartProducts,
						servicesByShippingRef,
					}),
				)
				setDeliveryRequirementsError('Delivery requirements could not be verified. Please retry before continuing to payment.')
				setIsDeliveryRequirementsLoading(false)
			}
		}

		resolveDeliveryRequirements()

		return () => {
			isCancelled = true
		}
	}, [cartProducts, hasAllShippingMethods])

	const sellers = useMemo(() => Object.keys(productsBySeller), [productsBySeller])

	const totalInvoicesNeeded = useMemo(() => resolveTotalInvoicesNeeded(sellers, v4vShares), [sellers, v4vShares])

	// Keep the progress bar stable even while invoices are being generated
	const invoiceStepCount = useMemo(
		() => resolveInvoiceStepCount(invoices.length, totalInvoicesNeeded),
		[invoices.length, totalInvoicesNeeded],
	)

	const totalSteps = useMemo(() => resolveTotalSteps(invoiceStepCount), [invoiceStepCount])

	// Ensure currentInvoiceIndex stays within bounds
	const safeInvoiceIndex = useMemo(() => clampInvoiceIndex(currentInvoiceIndex, invoices.length), [currentInvoiceIndex, invoices.length])

	const currentStepNumber = useMemo(
		() => resolveCheckoutStepNumber(currentStep, invoices.length, safeInvoiceIndex, totalSteps),
		[currentStep, invoices.length, safeInvoiceIndex, totalSteps],
	)

	const progress = useMemo(() => resolveCheckoutProgress(currentStepNumber, totalSteps), [currentStepNumber, totalSteps])

	const stepDescription = useMemo(
		() => describeCheckoutStep(currentStep, safeInvoiceIndex, invoices),
		[currentStep, safeInvoiceIndex, invoices],
	)

	const artifactsExist = hasCheckoutArtifacts(specOrderIds, invoices.length)
	const isCartEditable = shouldAllowCartEdits(currentStep, artifactsExist)
	const unpaidInvoiceCount = useMemo(() => resolveUnpaidInvoiceCount(invoices), [invoices])
	const canOfferPayAll = shouldOfferPayAll(nwcEnabled, unpaidInvoiceCount)

	// Fetch available payment options when entering payment step (before invoice generation)
	useEffect(() => {
		if (currentStep === 'payment' && Object.keys(availableWalletsBySeller).length === 0 && sellers.length > 0) {
			const fetchPaymentOptions = async () => {
				const walletsBySeller: Record<string, PaymentDetail[]> = {}

				for (const sellerPubkey of sellers) {
					const sellerProducts = productsBySeller[sellerPubkey] || []
					const productIds = sellerProducts.map((p) => p.id)

					try {
						const { getAvailablePaymentOptions } = await import('@/queries/payment')
						const options = await getAvailablePaymentOptions(productIds, sellerPubkey)
						walletsBySeller[sellerPubkey] = options

						// Auto-select first wallet
						if (options.length > 0 && !selectedWallets[sellerPubkey]) {
							setSelectedWallets((prev) => ({ ...prev, [sellerPubkey]: options[0].id }))
						}
					} catch (error) {
						console.error(`Error fetching payment options for seller ${sellerPubkey}:`, error)
						walletsBySeller[sellerPubkey] = []
					}
				}

				setAvailableWalletsBySeller(walletsBySeller)
			}

			fetchPaymentOptions()
		}
	}, [currentStep, sellers, productsBySeller, availableWalletsBySeller, selectedWallets])

	// Generate Lightning invoices when moving to payment step
	useEffect(() => {
		const hasAllOrderIds = specOrderIds.length >= sellers.length && sellers.length > 0
		if (currentStep === 'payment' && invoices.length === 0 && sellers.length > 0 && !isGeneratingInvoices) {
			if (!hasAllOrderIds) {
				console.warn('Waiting for order IDs before generating invoices...')
				return
			}

			const generateInvoices = async () => {
				const newInvoices: PaymentInvoiceData[] = []
				let invoiceIndex = 0

				try {
					let sellerPosition = 0
					for (const sellerPubkey of sellers) {
						const sellerProducts = productsBySeller[sellerPubkey] || []
						const data = sellerData[sellerPubkey]
						const totalAmount = data?.satsTotal || 0
						const shippingAmount = data?.shippingSats || 0
						const productSubtotal = totalAmount - shippingAmount
						const shares = data?.shares
						const v4vRecipients = v4vShares[sellerPubkey] || []

						// Create invoice for seller's share
						const sellerAmount = shares?.sellerAmount || totalAmount
						const sellerItems = sellerProducts.map((product) => ({
							productId: product.id,
							name: `Product ${product.id.substring(0, 8)}...`,
							amount: product.amount,
							price: Math.floor(sellerAmount / sellerProducts.length),
						}))

						console.log(`Generating invoice for seller ${sellerPubkey.substring(0, 8)}... (${sellerAmount} sats)`)

						// Get the selected wallet for this seller (if any)
						const selectedWalletId = selectedWallets[sellerPubkey]

						const sellerInvoice = await generateInvoice({
							sellerPubkey,
							amountSats: sellerAmount,
							description: `Seller payment for ${sellerProducts.length} items`,
							invoiceId: `invoice-${invoiceIndex++}`,
							items: sellerItems,
							type: 'seller',
							selectedPaymentDetailId: selectedWalletId,
						})

						const sellerOrderId = specOrderIds[sellerPosition] || specOrderIds[0] || 'temp-order'

						// Convert to PaymentInvoiceData format
						const paymentInvoice: PaymentInvoiceData = {
							id: sellerInvoice.id,
							orderId: sellerOrderId,
							recipientPubkey: sellerInvoice.sellerPubkey,
							recipientName: sellerInvoice.sellerName,
							amount: sellerInvoice.amount,
							description: `Seller payment for ${sellerProducts.length} items`,
							bolt11: sellerInvoice.bolt11 || null,
							lightningAddress: sellerInvoice.lightningAddress || null,
							expiresAt: sellerInvoice.expiresAt,
							status: sellerInvoice.status === 'failed' ? 'failed' : (sellerInvoice.status as 'pending' | 'paid' | 'expired'),
							type: 'merchant',
							createdAt: Date.now(),
							isZap: sellerInvoice.isZap,
						}
						newInvoices.push(paymentInvoice)

						// Create invoices for each V4V recipient
						for (const recipient of v4vRecipients) {
							// Calculate the recipient's amount based on their percentage
							const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
							const calculatedAmount = productSubtotal * recipientPercentage

							// Round up to ensure minimum 1 sat for any V4V recipient with > 0% share
							const recipientAmount = recipientPercentage > 0 ? Math.max(1, Math.floor(calculatedAmount)) : 0

							console.log(
								`Processing V4V recipient ${recipient.name}: percentage=${recipient.percentage}%, calculated=${calculatedAmount.toFixed(2)}, final amount=${recipientAmount} sats`,
							)

							if (recipientAmount > 0) {
								console.log(`Generating V4V invoice for ${recipient.name} (${recipientAmount} sats)`)

								const recipientItems = [
									{
										productId: `v4v-${recipient.id}`,
										name: `V4V Share (${(recipientPercentage * 100).toFixed(1)}%)`,
										amount: 1,
										price: recipientAmount,
									},
								]

								try {
									const recipientInvoice = await generateInvoice({
										sellerPubkey: recipient.pubkey,
										amountSats: recipientAmount,
										description: `V4V payment to ${recipient.name}`,
										invoiceId: `invoice-${invoiceIndex++}`,
										items: recipientItems,
										type: 'v4v',
									})

									// Convert to PaymentInvoiceData format
									const v4vPaymentInvoice: PaymentInvoiceData = {
										id: recipientInvoice.id,
										orderId: sellerOrderId,
										recipientPubkey: recipient.pubkey,
										recipientName: recipient.name,
										amount: recipientAmount,
										description: `V4V payment to ${recipient.name}`,
										bolt11: recipientInvoice.bolt11 || null,
										lightningAddress: recipientInvoice.lightningAddress || null,
										expiresAt: recipientInvoice.expiresAt,
										status: recipientInvoice.status === 'failed' ? 'failed' : (recipientInvoice.status as 'pending' | 'paid' | 'expired'),
										type: 'v4v',
										createdAt: Date.now(),
										isZap: recipientInvoice.isZap ?? true,
									}
									newInvoices.push(v4vPaymentInvoice)
									console.log(`✅ Successfully generated V4V invoice for ${recipient.name}`)
								} catch (error) {
									console.error(`❌ Failed to generate V4V invoice for ${recipient.name}:`, error)
									// Continue processing other recipients instead of failing completely
								}
							} else {
								console.log(`⚠️ Skipping V4V recipient ${recipient.name} due to zero percentage`)
							}
						}
						sellerPosition += 1
					}

					console.log(`Generated ${newInvoices.length} invoices`)
					setInvoices(newInvoices)
					persistInvoicesLocally(newInvoices)
				} catch (error) {
					console.error('Failed to generate invoices:', error)
					// Fallback to empty invoices - the user can retry
					setInvoices([])
				}
			}

			generateInvoices()
		}
	}, [currentStep, sellers, productsBySeller, sellerData, v4vShares, invoices.length, isGeneratingInvoices, generateInvoice, specOrderIds])

	const form = useForm({
		defaultValues: {
			name: '',
			email: '',
			phone: '',
			firstLineOfAddress: '',
			zipPostcode: '',
			city: '',
			country: '',
			additionalInformation: '',
		} as CheckoutFormData,
		onSubmit: async ({ value }) => {
			if (!hasAllShippingMethods) return
			if (isDeliveryRequirementsLoading || deliveryRequirementsError || !deliveryRequirements.isResolved) {
				toast.error('Delivery requirements must be verified before checkout can continue.')
				return
			}
			if (deliveryRequirements.needsDigitalDeliveryContact && !isValidDigitalDeliveryContact(value.email)) {
				toast.error('Enter a valid digital delivery contact before checkout can continue.')
				return
			}

			setShippingData(value)
			setCurrentStep('summary')
		},
	})

	/**
	 * Apply one invoice's status change and advance the flow.
	 *
	 * The decision is `applyInvoiceStatusChange` (tested in `checkoutFlow.test.ts`);
	 * the state write keeps the route's original functional-updater shape so two
	 * payments landing in one tick chain instead of overwriting each other.
	 */
	const updateInvoiceStatus = (invoiceId: string, changes: Partial<PaymentInvoiceData>, options?: { skipAutoAdvance?: boolean }) => {
		let allCompleted = false
		let nextPendingIndex = -1

		setInvoices((prevInvoices) => {
			const result = applyInvoiceStatusChange(prevInvoices, invoiceId, changes, {
				fromIndex: safeInvoiceIndex,
				skipAutoAdvance: options?.skipAutoAdvance,
			})
			allCompleted = result.allCompleted
			nextPendingIndex = result.nextPendingIndex
			return result.invoices
		})

		if (allCompleted) {
			setCurrentStep('complete')
		} else if (!options?.skipAutoAdvance && nextPendingIndex !== -1) {
			// Small delay keeps UI transitions smooth
			setTimeout(() => setCurrentInvoiceIndex(nextPendingIndex), 200)
		}
	}

	const handlePaymentComplete = async (invoiceId: string, preimage: string, skipAutoAdvance = false) => {
		setPaymentFailure(null)

		// Find the invoice to get bolt11 for receipt creation
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		const resolvedOrderId = resolveInvoiceOrderId(invoice, specOrderIds)

		// Create payment receipt
		if (invoice) {
			try {
				await publishPaymentReceipt({
					invoice: { ...invoice, orderId: resolvedOrderId },
					preimage,
					bolt11: invoice.bolt11 || '',
				})
				updatePersistedInvoiceLocally(resolvedOrderId, invoice.id, {
					status: 'paid',
					preimage,
				})
			} catch (error) {
				console.error('Failed to publish payment receipt:', error)
				toast.error(`Failed to create receipt: ${error instanceof Error ? error.message : 'Unknown error'}`)
			}
		}

		updateInvoiceStatus(
			invoiceId,
			{
				status: 'paid' as const,
				preimage,
			},
			{ skipAutoAdvance },
		)
	}

	const handlePaymentFailed = (invoiceId: string, error: string) => {
		console.error(`Payment failed for invoice ${invoiceId}:`, error)
		setPaymentFailure(error)

		setInvoices((prev) =>
			prev.map((invoice) => {
				if (invoice.id === invoiceId) {
					updatePersistedInvoiceLocally(resolveInvoiceOrderId(invoice, specOrderIds), invoice.id, {
						status: 'failed',
					})
					return {
						...invoice,
						status: 'failed' as const,
					}
				}
				return invoice
			}),
		)

		toast.error(`Payment failed: ${error}`)
	}

	const handleSkipPayment = (invoiceId: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)

		if (invoice) {
			updatePersistedInvoiceLocally(resolveInvoiceOrderId(invoice, specOrderIds), invoice.id, {
				status: 'skipped',
			})
		}

		// Mark invoice as skipped to allow checkout to proceed
		updateInvoiceStatus(invoiceId, { status: 'skipped' })

		toast.info('Payment skipped - you can pay this invoice later from your order history')
	}

	// Safety net: if all invoices are done, move to completion even if a handler was missed
	useEffect(() => {
		if (currentStep === 'payment' && invoices.length > 0) {
			const allCompleted = invoices.every(isCheckoutInvoiceComplete)
			if (allCompleted) {
				setCurrentStep('complete')
			}
		}
	}, [currentStep, invoices])

	// Simplified pay all function using PaymentContent ref
	const handlePayAllInvoices = async () => {
		if (!nwcEnabled) {
			toast.error('NWC not available for bulk payments')
			return
		}

		if (!paymentContentRef.current) {
			toast.error('Payment interface not ready')
			return
		}

		try {
			await paymentContentRef.current.payAllWithNwc()
		} catch (error) {
			console.error('Bulk payment failed:', error)
			toast.error('Bulk payment failed')
		}
	}

	// Regenerate invoice when wallet selection changes
	const handleWalletChange = async (sellerPubkey: string, newWalletId: string) => {
		// Update selected wallet
		setSelectedWallets((prev) => ({ ...prev, [sellerPubkey]: newWalletId }))

		// Find the invoice for this seller
		const invoiceIndex = invoices.findIndex((inv) => inv.recipientPubkey === sellerPubkey && inv.type === 'merchant')
		if (invoiceIndex === -1) {
			console.warn(`No merchant invoice found for seller ${sellerPubkey}`)
			return
		}

		const oldInvoice = invoices[invoiceIndex]

		// Generate new invoice with selected wallet
		try {
			const sellerProducts = productsBySeller[sellerPubkey] || []
			const data = sellerData[sellerPubkey]
			const totalAmount = data?.satsTotal || 0
			const shares = data?.shares
			const sellerAmount = shares?.sellerAmount || totalAmount

			const sellerItems = sellerProducts.map((product) => ({
				productId: product.id,
				name: `Product ${product.id.substring(0, 8)}...`,
				amount: product.amount,
				price: Math.floor(sellerAmount / sellerProducts.length),
			}))

			const newInvoiceData = await generateInvoice({
				sellerPubkey,
				amountSats: sellerAmount,
				description: `Seller payment for ${sellerProducts.length} items`,
				invoiceId: oldInvoice.id, // Reuse same ID
				items: sellerItems,
				type: 'seller',
				selectedPaymentDetailId: newWalletId,
			})

			// Update the invoice in state
			setInvoices((prevInvoices) => {
				const updated = [...prevInvoices]
				updated[invoiceIndex] = {
					...oldInvoice,
					bolt11: newInvoiceData.bolt11,
					lightningAddress: newInvoiceData.lightningAddress,
					expiresAt: newInvoiceData.expiresAt,
					status: newInvoiceData.status === 'failed' ? 'failed' : (newInvoiceData.status as 'pending' | 'paid' | 'expired'),
					isZap: newInvoiceData.isZap ?? oldInvoice.isZap,
				}
				return updated
			})

			updatePersistedInvoiceLocally(resolveInvoiceOrderId(oldInvoice, specOrderIds), oldInvoice.id, {
				bolt11: newInvoiceData.bolt11 || undefined,
				lightningAddress: newInvoiceData.lightningAddress || undefined,
				expiresAt: newInvoiceData.expiresAt,
				isZap: newInvoiceData.isZap ?? oldInvoice.isZap,
				status: newInvoiceData.status === 'failed' ? 'failed' : (newInvoiceData.status as 'pending' | 'paid' | 'expired'),
			})

			console.log(`✅ Invoice regenerated successfully`)
		} catch (error) {
			console.error(`❌ Failed to regenerate invoice:`, error)
			toast.error('Failed to update payment wallet')
		}
	}

	const goBackToShopping = () => {
		// Clear cart when leaving checkout after completion
		if (currentStep === 'complete') {
			cartActions.clear()
		}
		navigate({ to: '/' })
	}

	const goToOrders = () => {
		// Clear cart when viewing orders after completion
		if (currentStep === 'complete') {
			cartActions.clear()
		}
		navigate({ to: '/dashboard/account/your-purchases' })
	}

	const goBackToPreviousStep = () => {
		const decision = resolveBackNavigation({
			step: currentStep,
			invoiceIndex: currentInvoiceIndex,
			invoiceCount: invoices.length,
			artifactsExist,
		})

		if (decision.blockedMessage) {
			toast.info(decision.blockedMessage)
			return
		}

		if (decision.step) setCurrentStep(decision.step)
		if (decision.invoiceIndex !== undefined) setCurrentInvoiceIndex(decision.invoiceIndex)
	}

	/** Whether the back control leaves checkout (shipping) or moves within it. */
	const backDecision = resolveBackNavigation({
		step: currentStep,
		invoiceIndex: currentInvoiceIndex,
		invoiceCount: invoices.length,
		artifactsExist,
	})

	const handleBackClick = () => {
		if (backDecision.leaveCheckout) {
			goBackToShopping()
		} else {
			goBackToPreviousStep()
		}
	}

	const canContinueToPayment = canContinueToCheckout({
		shippingData,
		hasPartialOrder: !!partialOrderOutcome,
		deliveryRequirements,
		isDeliveryRequirementsLoading,
		deliveryRequirementsError,
	})

	const proceedWithPayment = async () => {
		if (shippingData && sellers.length > 0 && specOrderIds.length === 0) {
			setIsCreatingOrder(true)
			try {
				const orderOutcome = await publishOrderWorkflowWithDependencies({
					shippingData,
					sellers,
					productsBySeller,
					sellerData,
					v4vShares,
				})
				if (orderOutcome.status === 'partial') {
					setPartialOrderOutcome(orderOutcome)
					toast.error(
						`Order creation partially succeeded: ${orderOutcome.orderIds.length} seller order(s) were published. Do not retry this checkout.`,
					)
					setIsCreatingOrder(false)
					return
				}
				if (orderOutcome.status === 'failed') throw new Error(orderOutcome.error)

				setSpecOrderIds(orderOutcome.orderIds)
				if (orderOutcome.paymentRequestFailures > 0) {
					toast.warning(
						`${orderOutcome.paymentRequestFailures} payment request(s) could not be published; orders were created and payment can be retried later.`,
					)
				}
			} catch (error) {
				console.error('Failed to create spec-compliant orders:', error)
				toast.error(`Order creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
				setIsCreatingOrder(false)
				return
			}
		}

		setCurrentStep('payment')
		setIsCreatingOrder(false)
	}

	const handleContinueToPayment = async () => {
		if (!canContinueToPayment) {
			toast.error('Delivery requirements must be completed before payment can be requested.')
			return
		}

		if (!user) {
			setPendingContinueToPayment(true)
			setShowLoginDialog(true)
			return
		}

		await proceedWithPayment()
	}

	// After login completes and cart reconciliation finishes, auto-proceed to payment
	useEffect(() => {
		if (!pendingContinueToPayment || !user || isReconcilingRemoteCart) return
		setPendingContinueToPayment(false)
		setShowLoginDialog(false)
		proceedWithPayment()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pendingContinueToPayment, user, isReconcilingRemoteCart])

	// When waiting for login, show a visual cue on the "Continue to Payment" button
	const isAwaitingAuth = pendingContinueToPayment && !user
	const isWaitingForReconciliation = pendingContinueToPayment && isReconcilingRemoteCart

	return {
		// step machine
		currentStep,
		setCurrentStep,
		currentInvoiceIndex,
		setCurrentInvoiceIndex,
		safeInvoiceIndex,
		currentStepNumber,
		totalSteps,
		progress,
		stepDescription,
		handleBackClick,
		// cart & totals
		totalInSats,
		isCartEmpty,
		hasAllShippingMethods,
		isCartEditable,
		sellers,
		// invoices
		invoices,
		isGeneratingInvoices,
		unpaidInvoiceCount,
		canOfferPayAll,
		retryInvoiceGeneration: () => setInvoices([]),
		// delivery
		deliveryRequirements,
		isDeliveryRequirementsLoading,
		deliveryRequirementsError,
		partialOrderOutcome,
		canContinueToPayment,
		// shipping form
		form,
		shippingData,
		handleContinueToPayment,
		isCreatingOrder,
		isAwaitingAuth,
		isWaitingForReconciliation,
		// wallets
		nwcEnabled,
		nwcWalletCount,
		nwcWalletUri,
		availableWalletsBySeller,
		selectedWallets,
		handleWalletChange,
		handlePayAllInvoices,
		paymentContentRef,
		// payment
		paymentFailure,
		setPaymentFailure,
		handlePaymentComplete,
		handlePaymentFailed,
		handleSkipPayment,
		// navigation
		goBackToShopping,
		goToOrders,
		goBackToPreviousStep,
		// layout
		animationParent,
		mobileOrderSummaryOpen,
		toggleMobileOrderSummary: () => setMobileOrderSummaryOpen((open) => !open),
		// auth
		showLoginDialog,
		handleLoginDialogOpenChange: (open: boolean) => {
			setShowLoginDialog(open)
			if (!open) setPendingContinueToPayment(false)
		},
	}
}

export type UseCheckoutResult = ReturnType<typeof useCheckout>
