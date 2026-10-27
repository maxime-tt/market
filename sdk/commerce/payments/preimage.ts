/**
 * sdk/commerce/payments/preimage.ts — BOLT11 preimage validation.
 *
 * Moved here (store drain D2, slice 14) from `src/lib/utils/payment.utils.ts` so the
 * Platform payment publish binding (`platform/web/payments/paymentPublish.ts`) can
 * validate a wallet's returned preimage without a counted `platform -> src` edge. It
 * depends on nothing but `@getalby/lightning-tools`, so the SDK is its natural owner;
 * `src/lib/utils/payment.utils.ts` re-exports it so existing callers are unchanged.
 */
import { Invoice } from '@getalby/lightning-tools'

/**
 * Validate a preimage against an invoice's payment hash
 * Returns true if SHA256(preimage) === payment_hash
 */
export function validatePreimage(bolt11: string, preimage: string): boolean {
	try {
		const invoice = new Invoice({ pr: bolt11 })
		return invoice.validatePreimage(preimage)
	} catch {
		return false
	}
}
