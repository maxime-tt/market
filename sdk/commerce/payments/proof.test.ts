import { describe, expect, test } from 'bun:test'
import { paymentProofToReceiptPreimage } from './proof'

describe('paymentProofToReceiptPreimage', () => {
	test('preimage proof returns the preimage itself', () => {
		expect(paymentProofToReceiptPreimage({ type: 'preimage', preimage: 'abc123' })).toBe('abc123')
	})

	test('zap_receipt proof prefers its preimage when present', () => {
		expect(paymentProofToReceiptPreimage({ type: 'zap_receipt', eventId: 'event-1', preimage: 'def456' })).toBe('def456')
	})

	test('zap_receipt proof falls back to the receipt event id without preimage', () => {
		expect(paymentProofToReceiptPreimage({ type: 'zap_receipt', eventId: 'event-1' })).toBe('event-1')
	})

	test('wallet_ack proof encodes as empty string', () => {
		expect(paymentProofToReceiptPreimage({ type: 'wallet_ack', method: 'nwc', atMs: 1700000000000 })).toBe('')
	})

	test('every rail name encodes a wallet_ack as the empty string', () => {
		// The receipt never carries a rail name — the method is a classification for the caller,
		// not a wire field — so renaming a rail cannot change a published receipt.
		for (const method of ['nwc', 'webln', 'cashu'] as const) {
			expect(paymentProofToReceiptPreimage({ type: 'wallet_ack', method, atMs: 1700000000000 })).toBe('')
		}
	})
})
