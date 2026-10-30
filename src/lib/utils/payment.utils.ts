import { validatePreimage } from '@sdk/commerce/payments/preimage'
import { walletActions } from '@/lib/stores/wallet'
import type { SignerCapability } from '@sdk/core/signer'
import type { WalletPaymentMethod } from '@/lib/payments/proof'

/** Re-exported so the helper's home is the SDK while existing callers keep this path. */
export { validatePreimage }

// WebLN types
declare global {
	interface Window {
		webln?: {
			enable(): Promise<void>
			sendPayment(paymentRequest: string): Promise<{ preimage?: string }>
		}
	}
}

function extractPreimageCandidate(result: unknown): string | undefined {
	if (!result || typeof result !== 'object') return undefined
	const r = result as Record<string, unknown>

	const candidates = [
		r.preimage,
		r.payment_preimage,
		r.paymentPreimage,
		r.preimage_hex,
		r.preimageHex,
		(r.result as any)?.preimage,
		(r.response as any)?.preimage,
	].filter((v): v is string => typeof v === 'string' && v.length > 0)

	return candidates[0]
}

export interface WalletPayResult {
	ok: boolean
	ack: boolean
	preimage?: string
	method: WalletPaymentMethod
	error?: string
}

/**
 * Handle NWC (Nostr Wallet Connect) payment
 * @param bolt11 The BOLT11 invoice to pay
 * @param nwcWalletUri The NWC wallet connection URI
 * @param signer The active signer capability (a cache-identity object for the NWC client factory)
 * @param options Additional options
 * @returns WalletPayResult with a validated preimage if available
 */
export async function handleNWCPayment(
	bolt11: string,
	nwcWalletUri: string,
	signer: SignerCapability,
	options: { acceptAck?: boolean } = {},
): Promise<WalletPayResult> {
	const method: WalletPaymentMethod = 'nwc'
	const nwcClient = await walletActions.getOrCreateNwcClient(nwcWalletUri, signer)
	if (!nwcClient) {
		return { ok: false, ack: false, method, error: 'Invalid NWC wallet configuration' }
	}

	try {
		const response = await nwcClient.wallet.payInvoice({ invoice: bolt11 })
		const candidate = extractPreimageCandidate(response)
		if (candidate) {
			const isValid = validatePreimage(bolt11, candidate)
			if (isValid) {
				return { ok: true, ack: true, preimage: candidate, method }
			}
			console.warn('NWC returned an invalid preimage; treating as wallet ACK only')
		}

		if (options.acceptAck) {
			return { ok: true, ack: true, method }
		}
		return { ok: false, ack: true, method, error: 'No valid preimage returned from wallet' }
	} catch (err) {
		return { ok: false, ack: false, method, error: (err as Error).message || 'NWC payment failed' }
	}
}

/**
 * Handle WebLN payment via browser extension (e.g., Alby)
 * @param bolt11 The BOLT11 invoice to pay
 * @param options Additional options
 * @returns WalletPayResult with a validated preimage if available
 */
export async function handleWebLNPayment(bolt11: string, options: { acceptAck?: boolean } = {}): Promise<WalletPayResult> {
	const method: WalletPaymentMethod = 'webln'
	if (!window.webln) {
		return { ok: false, ack: false, method, error: 'WebLN not available' }
	}

	try {
		await window.webln.enable()
		const result = await window.webln.sendPayment(bolt11)
		const candidate = extractPreimageCandidate(result)
		if (candidate) {
			const isValid = validatePreimage(bolt11, candidate)
			if (isValid) {
				return { ok: true, ack: true, preimage: candidate, method }
			}
			console.warn('WebLN returned an invalid preimage; treating as wallet ACK only')
		}

		if (options.acceptAck) {
			return { ok: true, ack: true, method }
		}
		return { ok: false, ack: true, method, error: 'No valid preimage returned from wallet' }
	} catch (err) {
		return { ok: false, ack: false, method, error: (err as Error).message || 'WebLN payment failed' }
	}
}

/**
 * Check if WebLN is available in the browser
 */
export function hasWebLN(): boolean {
	return typeof window !== 'undefined' && !!window.webln
}
