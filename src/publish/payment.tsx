import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import { parseNwcUri } from '@/lib/stores/wallet'
import { type PaymentDetailsMethod } from '@/lib/constants'
import { paymentDetailsKeys } from '@/queries/queryKeyFactory'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { NWCClient } from '@getalby/sdk/nwc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { validatePreimage } from '@/lib/utils/payment.utils'
import { createBuyerPaymentReceiptTemplate } from '@sdk/commerce/orders'

/**
 * Interface for publishing payment details.
 *
 * `paymentMethod` is `PaymentDetailsMethod` (`@/lib/constants`) rather than the
 * `PaymentMethod` alias: this lived in `@/queries/payment` and the alias stayed
 * there with the read-side types, and importing it back is the edge this move
 * removes.
 */
export interface PublishPaymentDetailParams {
	paymentMethod: PaymentDetailsMethod
	paymentDetail: string
	coordinates?: string | string[] // Optional product/collection coordinates (single or multiple)
	appPubkey?: string // Optional app pubkey
	dTag?: string // Optional d tag for replaceable events (for updates)
	isDefault?: boolean // Whether this is the default payment method
}

/**
 * Publishes payment details.
 *
 * Moved here from `@/queries/payment`, which is where the read side lives and
 * where it had no business being: the queries module imported it back to build
 * its rich/update variants, and this module imported it to wrap it in a
 * mutation — a cycle between a read file and a publish file.
 */
export const publishPaymentDetail = async (params: PublishPaymentDetailParams): Promise<string> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('No signer available to publish payment details')

		// Get user
		const user = await signer.user()
		if (!user) throw new Error('User not available')

		// Get app pubkey
		const appPubkey = params.appPubkey || configStore.state.config.appPublicKey
		if (!appPubkey) throw new Error('App public key not available')

		// Create the content object
		const contentObj = {
			payment_method: params.paymentMethod,
			payment_detail: params.paymentDetail,
			is_default: params.isDefault || false,
		}

		// Payment details are public (Lightning addresses, BTC addresses)
		// No encryption needed - buyers need to read these to generate invoices
		const contentStr = JSON.stringify(contentObj)

		// Create the event
		const event = new NDKEvent(ndk)
		event.kind = NDKKind.AppSpecificData
		event.content = contentStr
		event.tags = [
			['d', params.dTag || uuidv4()],
			['l', 'payment_detail'],
			['p', appPubkey], // Reference to the app
		]

		// Add coordinates if provided (can be single string or array)
		if (params.coordinates) {
			const coordinatesArray = Array.isArray(params.coordinates) ? params.coordinates : [params.coordinates]
			coordinatesArray.forEach((coord) => {
				event.tags.push(['a', coord])
			})
		}

		// Sign and publish
		await event.sign(signer)
		await ndkActions.publishEvent(event)

		return event.id
	} catch (error) {
		console.error('Error publishing payment details:', error)
		throw new Error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * React query mutation hook for publishing payment details
 */
export const usePublishPaymentDetail = () => {
	return useMutation({
		mutationKey: paymentDetailsKeys.publish(),
		mutationFn: publishPaymentDetail,
		onSuccess: (eventId) => {
			toast.success('Payment details saved successfully')
			return eventId
		},
		onError: (error) => {
			console.error('Failed to publish payment details:', error)
			toast.error('Failed to save payment details')
		},
	})
}

/**
 * Mutation hook for publishing payment details with query invalidation
 * This wraps the query function with additional functionality
 */
export const usePublishPaymentDetailMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (params: PublishPaymentDetailParams) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			// Get app pubkey if not provided
			if (!params.appPubkey) {
				const appPubkey = configStore.state.config.appPublicKey
				if (!appPubkey) {
					throw new Error('App public key is required')
				}
				params.appPubkey = appPubkey
			}

			return publishPaymentDetail(params)
		},

		onSuccess: async (eventId, params) => {
			// Get current user pubkey
			let userPubkey = ''
			if (signer) {
				const user = await signer.user()
				if (user && user.pubkey) {
					userPubkey = user.pubkey
				}
			}

			// Invalidate relevant queries
			if (userPubkey) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(userPubkey) })
			}

			if (params.coordinates) {
				queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(params.coordinates) })
			}

			toast.success('Payment details published successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to publish payment details:', error)
			toast.error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Helper function for creating lightning payment details
 */
export const useLightningPaymentDetailMutation = () => {
	const publishPaymentDetailMutation = usePublishPaymentDetailMutation()

	return useMutation({
		mutationFn: async (params: { lightningAddress: string; coordinates?: string; appPubkey?: string }) => {
			return publishPaymentDetailMutation.mutateAsync({
				paymentMethod: 'ln',
				paymentDetail: params.lightningAddress,
				coordinates: params.coordinates,
				appPubkey: params.appPubkey,
			})
		},

		onSuccess: (eventId) => {
			toast.success('Lightning payment details saved')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to save lightning payment details:', error)
			toast.error('Failed to save lightning payment details')
		},
	})
}

/**
 * Helper function for creating on-chain payment details
 */
export const useOnChainPaymentDetailMutation = () => {
	const publishPaymentDetailMutation = usePublishPaymentDetailMutation()

	return useMutation({
		mutationFn: async (params: { bitcoinAddress: string; coordinates?: string; appPubkey?: string }) => {
			return publishPaymentDetailMutation.mutateAsync({
				paymentMethod: 'on-chain',
				paymentDetail: params.bitcoinAddress,
				coordinates: params.coordinates,
				appPubkey: params.appPubkey,
			})
		},

		onSuccess: (eventId) => {
			toast.success('Bitcoin address saved')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to save bitcoin address:', error)
			toast.error('Failed to save bitcoin address')
		},
	})
}

export interface PayWithNwcParams {
	bolt11: string
	nwcUri: string
	userPubkey: string
	recipientPubkey: string
	invoiceId: string
	amount: number
	description: string
}

/**
 * Pays an invoice using an NWC connection via direct NIP-47 pay_invoice method
 * @returns The payment preimage on success
 */
export const payInvoiceWithNwc = async (params: PayWithNwcParams): Promise<string> => {
	const { bolt11, nwcUri, userPubkey } = params

	// Parse the NWC URI to get the relay URL
	const parsedUri = parseNwcUri(nwcUri)
	if (!parsedUri || !parsedUri.relay) {
		throw new Error('Failed to parse NWC URI or missing relay URL')
	}

	// The NWC URI carries its own client secret (NIP-47) and that secret is what the wallet
	// service authenticates -- @nostr-dev-kit/wallet read it from the URI and ignored the app
	// signer, so this client keeps the same payment identity. It also runs its own relay pool,
	// which is why the dedicated NDK instance and its signer wiring are gone.
	const nwcWalletForPayment = new NWCClient({ nostrWalletConnectUrl: nwcUri })

	// Wait for a connected relay
	const timeout = 10000 // 10 seconds
	const startTime = Date.now()

	while (!nwcWalletForPayment.connected) {
		if (Date.now() - startTime > timeout) {
			throw new Error('NWC wallet connection timeout')
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}

	console.log(`Initiating NWC pay_invoice request for ${params.amount} sats`)

	try {
		const response = await nwcWalletForPayment.payInvoice({
			invoice: bolt11,
		})

		const candidate =
			response?.preimage ||
			// Some wallets may use different keys (or nest results)
			(response as any)?.payment_preimage ||
			(response as any)?.paymentPreimage ||
			(response as any)?.preimageHex ||
			(response as any)?.preimage_hex ||
			(response as any)?.result?.preimage ||
			undefined

		if (typeof candidate === 'string' && candidate.length > 0 && validatePreimage(bolt11, candidate)) {
			console.log(`✅ NWC payment successful, preimage: ${candidate.substring(0, 16)}...`)
			return candidate
		}

		// Some wallets (e.g. Primal) may not return a real Lightning preimage.
		// Treat the successful response as an ACK and rely on zap receipts / other signals for confirmation.
		return 'external-payment'
	} catch (error) {
		console.error('❌ NWC payment failed:', error)
		throw new Error(`NWC payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
	} finally {
		// the client stays open for the session; it is closed when the wallet is removed
	}
}

/**
 * Initiates a payment using a WebLN-compatible browser extension (e.g., Alby).
 * @param bolt11 The BOLT11 payment request string.
 * @returns A promise that resolves with the payment preimage if successful.
 * @throws If WebLN is not available or the payment fails.
 */
export const payInvoiceWithWebln = async (bolt11: string): Promise<string> => {
	if (!window.webln) {
		throw new Error('WebLN not available. Please install a WebLN-compatible wallet extension.')
	}

	await window.webln.enable()
	const result = await window.webln.sendPayment(bolt11)

	const candidate = result?.preimage
	if (typeof candidate === 'string' && candidate.length > 0 && validatePreimage(bolt11, candidate)) {
		return candidate
	}

	// WebLN is expected to return a preimage, but fall back to a generic proof string if missing/invalid.
	return 'external-payment'
}

/**
 * Parameters for publishing a payment receipt
 */
export interface PublishPaymentReceiptParams {
	invoice: {
		orderId: string
		recipientPubkey?: string
		amount: number
		description?: string
		id: string
		bolt11?: string
	}
	preimage: string
	bolt11: string
}

/**
 * Publishes a payment receipt (Kind 17) to the Nostr network
 * This creates a proof of payment for the order
 */
export const publishPaymentReceipt = async (params: PublishPaymentReceiptParams): Promise<string> => {
	const { invoice, preimage, bolt11 } = params

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available')

	// Get current user
	const user = await signer.user()
	if (!user) throw new Error('No user available')

	// Build the event through SDK rules, then sign and publish at the app boundary.
	const event = new (await import('@nostr-dev-kit/ndk')).NDKEvent(ndk)
	const template = createBuyerPaymentReceiptTemplate({
		merchantPubkey: invoice.recipientPubkey || '',
		orderId: invoice.orderId,
		amountSats: invoice.amount,
		bolt11,
		proof: preimage,
		createdAt: Math.floor(Date.now() / 1000),
		content: invoice.description,
	})
	event.kind = template.kind
	event.content = template.content
	event.tags = template.tags
	event.created_at = template.created_at

	try {
		await event.sign(signer)
		await ndkActions.publishEvent(event)

		console.log(`✅ Payment receipt published for order ${invoice.orderId}`)
		return event.id
	} catch (error) {
		console.error('❌ Failed to publish payment receipt:', error)
		throw new Error(`Failed to publish payment receipt: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}
