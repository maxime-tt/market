/**
 * The rail that moved the money: a connected NWC wallet, an in-page WebLN provider, or the
 * app's own Cashu wallet.
 *
 * This names a *rail*, not the store the wallet keeps its proofs in: the app's Cashu rail is
 * the same rail whether the wallet is the relay-backed NIP-60 store or the local coco
 * repository behind it, so the name does not move when the storage does.
 *
 * Nothing persists it. `paymentProofToReceiptPreimage` writes no method for a `wallet_ack` —
 * a receipt carries a preimage or an event id, never a claim about which rail paid.
 */
export type WalletPaymentMethod = 'nwc' | 'webln' | 'cashu'

export type PaymentProof =
	| { type: 'preimage'; preimage: string }
	| { type: 'zap_receipt'; eventId: string; preimage?: string }
	| { type: 'wallet_ack'; method: WalletPaymentMethod; atMs: number }

/**
 * Encode a PaymentProof into the single string field we store today (`invoice.preimage`)
 * and publish in the `payment` tag of the receipt.
 */
export function paymentProofToReceiptPreimage(proof: PaymentProof): string {
	switch (proof.type) {
		case 'preimage':
			return proof.preimage
		case 'zap_receipt':
			// If the receipt includes a valid payment preimage, use it; otherwise store the receipt event id (no prefix).
			return proof.preimage || proof.eventId
		case 'wallet_ack':
			// Avoid type prefixes; an empty string is treated as "external-payment" by receipt consumers.
			return ''
	}
}
