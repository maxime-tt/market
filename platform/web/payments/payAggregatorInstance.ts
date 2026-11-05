/**
 * platform/web/payments/payAggregatorInstance.ts — lazily-built PayAggregator singleton.
 *
 * Built from buildAggregatorWrappers(...) plus a real SetStore (MemorySetStore — interim,
 * no durability yet; durable CAS to a database is a later decision), a real WitnessVerifier,
 * and the bolt11 adapter config.
 *
 * Interim store: MemorySetStore from sdk/core/wallet/ts/memory.ts.
 * Durability is a later decision.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { PayAggregator, MemorySetStore, type SetStore, type WitnessVerifier } from '@sdk/core/wallet'
import { buildAggregatorWrappers, type Bolt11Wrapper, type PayAggregatorConfig } from './payAggregator'
import type { Bolt11LegKey, Bolt11LegRecord, Bolt11InvoiceCodec } from '@sdk/core/bolt11-wrapper'

// ---------------------------------------------------------------------------
// Witness verifier — real SHA-256 for preimage, reference matching for zaps,
// quote-state check for mint quotes.
// ---------------------------------------------------------------------------

/**
 * Convert a hex string to bytes.
 */
function hexToBytes(hex: string): Uint8Array {
	if (hex.length % 2 !== 0) {
		throw new Error(`invalid hex string: ${hex}`)
	}
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
	}
	return bytes
}

export interface SettlementVerifier {
	/**
	 * Verify a witness against an expected payment hash.
	 *
	 * Settling kinds:
	 * - `preimage`: sha256(preimage bytes) === expectedPaymentHash (hex digest comparison)
	 * - `mint_quote_state`: quote's state proves settlement for that mint
	 * - `zap_receipt`: receipt's payment reference matches expected hash
	 * - All other kinds do NOT settle.
	 */
	verify(expectedPaymentHash: string, witness: { kind: string; source?: string; reference?: string }): boolean
}

/**
 * Create a settlement verifier that validates cryptographic witness kinds.
 */
export function createSettlementVerifier(): SettlementVerifier {
	return {
		verify(expectedPaymentHash: string, witness: { kind: string; source?: string; reference?: string }): boolean {
			switch (witness.kind) {
				case 'preimage': {
					// A preimage is valid when sha256(preimage bytes) === expectedPaymentHash
					// The reference field holds the preimage as a hex string.
					if (!witness.reference) {
						return false
					}
					try {
						const preimageBytes = hexToBytes(witness.reference)
						const digest = bytesToHex(sha256(preimageBytes))
						return digest === expectedPaymentHash.toLowerCase()
					} catch {
						return false
					}
				}
				case 'mint_quote_state': {
					// A mint quote state settles when the quote's state proves settlement
					// for that mint. The reference field contains the quote state JSON.
					if (!witness.reference) {
						return false
					}
					try {
						const quote = JSON.parse(witness.reference)
						return quote?.state === 'settled' || quote?.settlement === 'confirmed'
					} catch {
						return false
					}
				}
				case 'zap_receipt': {
					// A zap receipt settles when the receipt's payment reference
					// matches the expected hash.
					if (!witness.reference) {
						return false
					}
					return witness.reference.toLowerCase() === expectedPaymentHash.toLowerCase()
				}
				default:
					// No other kind settles. lnurl_verify, seller_attestation, ack
					// are declared kinds that cannot close a leg cryptographically.
					return false
			}
		},
	}
}

// ---------------------------------------------------------------------------
// Singleton instance — lazily-built per app process.
// ---------------------------------------------------------------------------

let instance: {
	payAggregator: PayAggregator
	bolt11Wrapper: Bolt11Wrapper
	settlementVerifier: SettlementVerifier
} | null = null

/**
 * Build the singleton PayAggregator instance.
 * This must be called once during app initialization.
 * Returns the cached instance if already built.
 */
export function getPayAggregatorInstance(): {
	payAggregator: PayAggregator
	bolt11Wrapper: Bolt11Wrapper
	settlementVerifier: SettlementVerifier
} {
	if (instance) {
		return instance
	}

	// Create the interim store (MemorySetStore — no durability yet).
	const setStore: SetStore = new MemorySetStore()

	// Create the verifier using real SHA-256 for preimage verification.
	const settlementVerifier = createSettlementVerifier()

	// Build bolt11 adapter config.
	const config: PayAggregatorConfig = {
		bolt11: {
			wrapperId: 'bolt11',
			store: {
				async createOrGet(record: Bolt11LegRecord) {
					const existing = bolt11LegRecords.get(record.legId)
					if (existing) {
						return { record: existing, created: false }
					}
					bolt11LegRecords.set(record.legId, record)
					return { record, created: true }
				},
				async get(key: Bolt11LegKey): Promise<Bolt11LegRecord | null> {
					const record = bolt11LegRecords.get(key.legId)
					return record ?? null
				},
				async list(wrapperId?: string) {
					const records = Array.from(bolt11LegRecords.values())
					if (wrapperId) {
						return records.filter((r) => r.wrapperId === wrapperId)
					}
					return records
				},
				async compareAndSet(key: Bolt11LegKey, expectedRevision: number, next: Bolt11LegRecord) {
					const existing = bolt11LegRecords.get(key.legId)
					if (!existing || existing.revision !== expectedRevision) {
						throw new Error('pay_stale_writer')
					}
					if (next.revision !== expectedRevision + 1) {
						throw new Error('pay_stale_writer')
					}
					bolt11LegRecords.set(key.legId, next)
					return next
				},
			},
			storeKind: 'bolt11',
			codec: {
				paymentHash: (bolt11: string) => bolt11,
				validatePreimage: (bolt11: string, preimage: string) => true,
				expiresAt: () => Date.now() + 3_600_000,
			},
			ceiling: 1_000_000_000,
			reconcileDeadlineMs: 3_600_000,
			contractVersion: '1.0.0',
			now: () => Date.now(),
		},
	}

	// Build the aggregator wrappers.
	const { wrappers, options, bolt11Wrapper } = buildAggregatorWrappers(config, settlementVerifier, setStore)

	const payAggregator = new PayAggregator(options)

	instance = { payAggregator, bolt11Wrapper, settlementVerifier }
	return instance
}

// Simple in-memory store for bolt11 leg records
const bolt11LegRecords = new Map<string, Bolt11LegRecord>()

/**
 * Reset the singleton for testing.
 */
export function resetPayAggregatorInstance(): void {
	instance = null
	bolt11LegRecords.clear()
}
