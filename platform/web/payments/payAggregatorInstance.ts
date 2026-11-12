/**
 * platform/web/payments/payAggregatorInstance.ts — lazily-built PayAggregator singleton.
 *
 * Built from buildAggregatorWrappers(...) plus the durable LocalSetStore (set
 * records + hash/refund indexes), the durable LocalBolt11LegStore (bolt11 leg
 * records), a real WitnessVerifier, and the bolt11 adapter config.
 *
 * Durable stores: LocalSetStore and LocalBolt11LegStore from
 * payAggregatorStore.ts, both backed by localStorage.
 *
 * This is also the COMPOSITION POINT for the cashu rail: the wallet binding
 * (`platform/web/wallet/cocoWalletHost.ts`) is pure mechanism, so the app's own
 * lives are supplied here — the coco engine the app already runs (`cashuStore`'s
 * `manager`), the signed-in account it belongs to, the mint a leg falls back to,
 * the invoice/preimage decoders the bolt11 codec already uses, and two durable
 * localStorage stores for the host's command records and the wrapper's leg
 * records.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Invoice } from '@getalby/lightning-tools'
import { validatePreimage } from '@sdk/commerce/payments/preimage'
import type { CocoReconcilerStatus, CocoWalletHost, CocoWalletPortAdapter, WalletAccount } from '@sdk/core/cashu-wrapper'
import { PayAggregator, type SetStore, type WitnessVerifier } from '@sdk/core/wallet'
import { buildAggregatorWrappers, type Bolt11Wrapper, type PayAggregatorConfig } from './payAggregator'
import { LocalSetStore, LocalBolt11LegStore } from './payAggregatorStore'
import { authBinding } from '@platform/web/auth/authBinding'
import { cashuActions, cashuStore } from '@platform/web/wallet/cashuStore'
import { LocalCocoLegStore, LocalWalletOperationStore } from '@platform/web/wallet/cocoWalletStores'
import type { CocoWalletEngineSource } from '@platform/web/wallet/cocoWalletHost'

// ---------------------------------------------------------------------------
// BOLT11 invoice codec — the rail's own decoder (`@getalby/lightning-tools`,
// which the port deliberately does not import; see the codec's doc comment)
// ---------------------------------------------------------------------------

/**
 * Decode a bolt11 invoice's payment hash (hex). Throws on an undecodable
 * invoice — an unreadable invoice cannot be a leg, so this is never asserted
 * around.
 */
export const bolt11PaymentHash = (bolt11: string): string => new Invoice({ pr: bolt11 }).paymentHash

/**
 * The invoice's absolute expiry instant in Unix **milliseconds**. `timestamp` is
 * the invoice's creation instant (seconds) and `expiry` is its validity
 * **duration** (seconds), so the two are added — never confused.
 */
export const bolt11ExpiresAt = (bolt11: string): number => {
	const invoice = new Invoice({ pr: bolt11 })
	// BOLT11: an invoice that omits the `x` field expires 3600s after its timestamp.
	return invoice.expiryDate ? invoice.expiryDate.getTime() : (invoice.timestamp + 3600) * 1000
}

// ---------------------------------------------------------------------------
// The cashu rail's composition: the app's own coco engine, as the wallet host
// binding's engine source.
// ---------------------------------------------------------------------------

/**
 * The environment this build's cashu wallet belongs to. The host keys a runtime by the FULL account
 * identity (environment + account id), and here the account id is the signed-in pubkey — the same
 * identity key `sdk/config/cashu.ts` derives its IndexedDB database name from.
 */
const CASHU_WALLET_ENVIRONMENT_ID = 'plebeian-market'

/**
 * The composing app's declaration of the engine's own reconcilers (`#09f049`), which the wrapper
 * requires before a local read may be reported as a settlement.
 *
 * `sdk/config/cashu.ts`'s `initializeCoco` call passes the mint-operation watcher/processor and the
 * proof-state watcher, and DISABLES none of the three; coco's own `initializeCoco` enables every watcher
 * and processor it was not told to disable (`if (!config.watchers?.meltQuoteWatcher?.disabled) await
 * coco.enableMeltQuoteWatcher(...)`, and the same for the melt settlement processor). So the two
 * melt-side reconcilers this wallet runs are the engine's own, enabled — not an app-side equivalent.
 */
const CASHU_RECONCILERS: CocoReconcilerStatus = {
	proofStateWatcher: true,
	meltQuoteWatcher: true,
	meltSettlementProcessor: true,
}

/**
 * The signed-in pubkey as the cashu account, or null before the auth machine is composed.
 *
 * This is the SAME read `cashuStore.ts` uses for the store it assembled: `authBinding.getCurrentPubkey()`
 * throws `AuthMachineNotRegisteredError` before the machine is registered, and the wallet host must open
 * its runtime for exactly the identity the app's coco manager was initialised for.
 */
const currentCashuAccount = (): WalletAccount | null => {
	try {
		const pubkey = authBinding.getCurrentPubkey()
		return pubkey ? { accountId: pubkey, environmentId: CASHU_WALLET_ENVIRONMENT_ID } : null
	} catch {
		return null
	}
}

/**
 * The app's own coco wallet as the binding's engine source. Nothing here creates an engine: the manager
 * is the one `cashuActions.initialize()` built and `cashuStore` holds, resolved PER CALL so a re-init or
 * an account switch is picked up rather than frozen.
 */
const cashuEngineSource: CocoWalletEngineSource = {
	identity: currentCashuAccount,
	current: () => cashuStore.state.manager,
	ensure: async () => {
		// The app's own bring-up, exactly as the deposit/withdraw hosts do it: idempotent, and without a
		// manager there is no wallet to melt from.
		if (cashuStore.state.status === 'idle') {
			await cashuActions.initialize()
		}
		return cashuStore.state.manager
	},
	close: () => cashuActions.reset(),
}

/** The invoice's own amount in sats, or null when it carries none (a NUT-11 amountless invoice). */
const invoiceAmountSats = (paymentRequest: string): number | null => {
	const invoice = new Invoice({ pr: paymentRequest.trim().replace(/^lightning:/i, '') })
	return invoice.satoshi > 0 ? invoice.satoshi : null
}

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
					// A preimage is valid when sha256(preimage bytes) === expectedPaymentHash.
					// When the witness carries the material (reference = the preimage as hex)
					// the hash is re-derived here.
					if (witness.reference) {
						try {
							const preimageBytes = hexToBytes(witness.reference)
							return bytesToHex(sha256(preimageBytes)) === expectedPaymentHash.toLowerCase()
						} catch {
							return false
						}
					}
					// Otherwise the rail's own attestation settles the leg: the bolt11 wrapper
					// validates the preimage against the invoice's recorded payment hash with
					// its codec BEFORE it records the settled rung — at `submit` for a
					// manual-preimage leg, at `reconcile` for an lnurl verification — and its
					// witness deliberately carries no copy of the reference. Only those two
					// rail-validated sources are accepted (owner ruling 2026-11-06); any other
					// source with no material stays unsettled.
					return witness.source === 'manual' || witness.source === 'lnurl_verify'
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
	cashu: { host: CocoWalletHost; portAdapter: CocoWalletPortAdapter } | null
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
	/** the cashu host binding and its wrapper port: what a caller opens and reconciles a cashu leg through */
	cashu: { host: CocoWalletHost; portAdapter: CocoWalletPortAdapter } | null
} {
	if (instance) {
		return instance
	}

	const setStore: SetStore = new LocalSetStore()

	// Create the verifier using real SHA-256 for preimage verification.
	const settlementVerifier = createSettlementVerifier()

	// Build bolt11 adapter config.
	const config: PayAggregatorConfig = {
		bolt11: {
			wrapperId: 'bolt11',
			store: new LocalBolt11LegStore(),
			storeKind: 'bolt11',
			codec: {
				paymentHash: bolt11PaymentHash,
				validatePreimage: (bolt11: string, preimage: string) => validatePreimage(bolt11, preimage),
				expiresAt: bolt11ExpiresAt,
			},
			ceiling: 1_000_000_000,
			reconcileDeadlineMs: 3_600_000,
			contractVersion: '1.0.0',
			now: () => Date.now(),
		},
		// The cashu rail: the app's own coco engine behind the wallet host binding. Its wrapper id and
		// method are distinct from the bolt11 and nip47 registrations because the aggregator's acceptance
		// gate keeps exactly one registration per method; `applicationId`/`operationKind` are the wallet
		// host keys an app caller must name when it opens a cashu leg.
		cashu: {
			engine: cashuEngineSource,
			reconcilers: CASHU_RECONCILERS,
			preferredMint: () => cashuStore.state.defaultMint,
			invoiceAmountSats,
			validatePreimage: (invoice: string, preimage: string) => validatePreimage(invoice, preimage),
			wrapperId: 'coco',
			method: 'cashu-melt',
			applicationId: 'market',
			operationKind: 'melt',
			legStore: new LocalCocoLegStore(),
			storeKind: 'localStorage',
			ceiling: 1_000_000_000,
			contractVersion: '1.0.0',
			walletStore: new LocalWalletOperationStore(),
			now: () => Date.now(),
		},
	}

	// Build the aggregator wrappers.
	const { wrappers, options, bolt11Wrapper, cashu } = buildAggregatorWrappers(config, settlementVerifier, setStore)

	const payAggregator = new PayAggregator(options)

	instance = { payAggregator, bolt11Wrapper, settlementVerifier, cashu }
	return instance
}

/**
 * Reset the singleton for testing.
 * The durable stores persist in localStorage; tests should clear them manually.
 */
export function resetPayAggregatorInstance(): void {
	instance = null
}
