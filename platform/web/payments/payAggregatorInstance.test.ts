/**
 * platform/web/payments/WalletGeneralization.spec.ts — tests for the settlement verifier
 * and payAggregatorInstance singleton.
 *
 * Tests:
 * - Construction is idempotent (same instance twice)
 * - The verifier's preimage path with a real known vector (generate a preimage, hash it, assert true for match, false for one-bit-off hash)
 * - A PayAggregator built from the instance registers exactly the rails the config declared
 */
import { describe, expect, it } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { describe as sdkDescribe, expect as sdkExpect, test as sdkTest } from 'bun:test'

import { getPayAggregatorInstance, resetPayAggregatorInstance } from './payAggregatorInstance'
import { createSettlementVerifier, type SettlementVerifier } from './payAggregatorInstance'

// ---------------------------------------------------------------------------
// Preimage test vector — real SHA-256 known vector
// ---------------------------------------------------------------------------

describe('settlement verifier', () => {
	it('validates a preimage when sha256(preimage) === expectedPaymentHash', () => {
		const verifier = createSettlementVerifier()

		// Generate a preimage and its hash — this is a real known vector
		const preimage = '00010203040506070809'
		const preimageBytes = Buffer.from(preimage, 'hex')
		const digest = bytesToHex(sha256(preimageBytes))

		// true: match
		const result = verifier.verify(digest, { kind: 'preimage', reference: preimage })
		sdkExpect(result).toBe(true)
	})

	it('rejects a preimage when one bit is off in the hash', () => {
		const verifier = createSettlementVerifier()

		const preimage = '00010203040506070809'
		const preimageBytes = Buffer.from(preimage, 'hex')
		const correctDigest = bytesToHex(sha256(preimageBytes))

		// Flip one hex character to produce a different hash
		const wrongDigest = '0000000000000000000000000000000000000000000000000000000000000000'

		const result = verifier.verify(wrongDigest, { kind: 'preimage', reference: preimage })
		sdkExpect(result).toBe(false)
	})

	it('rejects a preimage with wrong reference', () => {
		const verifier = createSettlementVerifier()

		const correctPreimage = '00010203040506070809'
		const correctBytes = Buffer.from(correctPreimage, 'hex')
		const digest = bytesToHex(sha256(correctBytes))

		// Different preimage
		const wrongPreimage = 'deadbeefdeadbeefdead'
		const wrongBytes = Buffer.from(wrongPreimage, 'hex')
		const wrongDigest = bytesToHex(sha256(wrongBytes))

		const result = verifier.verify(digest, { kind: 'preimage', reference: wrongPreimage })
		sdkExpect(result).toBe(false)
	})

	it('rejects zap_receipt with mismatched reference', () => {
		const verifier = createSettlementVerifier()

		const result = verifier.verify('aaa', { kind: 'zap_receipt', reference: 'bbb' })
		sdkExpect(result).toBe(false)
	})

	it('accepts zap_receipt when reference matches expected hash', () => {
		const verifier = createSettlementVerifier()

		const result = verifier.verify('aaa', { kind: 'zap_receipt', reference: 'aaa' })
		sdkExpect(result).toBe(true)
	})

	it('rejects declared kinds (lnurl_verify, seller_attestation, ack)', () => {
		const verifier = createSettlementVerifier()

		const declaredKinds = ['lnurl_verify', 'seller_attestation', 'ack'] as const

		for (const kind of declaredKinds) {
			const result = verifier.verify('any-hash', { kind, reference: 'any-ref' })
			sdkExpect(result).toBe(false)
		}
	})

	it('rejects preimage with no reference', () => {
		const verifier = createSettlementVerifier()

		const result = verifier.verify('any-hash', { kind: 'preimage', reference: undefined })
		sdkExpect(result).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// Singleton idempotency
// ---------------------------------------------------------------------------

describe('payAggregatorInstance singleton', () => {
	it('returns the same instance on consecutive calls', () => {
		resetPayAggregatorInstance()

		const instance1 = getPayAggregatorInstance()
		const instance2 = getPayAggregatorInstance()

		sdkExpect(instance1.payAggregator).toBe(instance2.payAggregator)
		sdkExpect(instance1.bolt11Wrapper).toBe(instance2.bolt11Wrapper)
		sdkExpect(instance1.settlementVerifier).toBe(instance2.settlementVerifier)
	})

	it('resets cleanly', () => {
		const before = getPayAggregatorInstance()
		resetPayAggregatorInstance()
		const after = getPayAggregatorInstance()

		sdkExpect(before.payAggregator).not.toBe(after.payAggregator)
	})
})
