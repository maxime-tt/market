/**
 * The settlement chain checkout and orders drive, through the ports as designed:
 *
 *   wrapper.obtain({ bolt11 })              -> the quote (its legId IS the decoded payment hash)
 *   aggregator.pay(intent built from it)    -> the set is opened, the hash claimed
 *   wrapper.submit(quote, preimage)         -> the witness is recorded
 *   aggregator.reconcile(setId)             -> the verdict, from sha256(preimage)
 *
 * The production codec's decoding is pinned against a real invoice; the chain itself is
 * driven with an injected codec — the port's own shape, exactly as
 * `sdk/core/bolt11-wrapper/ts/wrapper.test.ts` does — because a bolt11 whose preimage we
 * hold cannot be minted here.
 */
import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MemorySetStore, PayAggregator } from '@sdk/core/wallet'
import { buildAggregatorWrappers, type Bolt11Wrapper, type PayAggregatorConfig } from './payAggregator'
import { bolt11ExpiresAt, bolt11PaymentHash, createSettlementVerifier } from './payAggregatorInstance'
import { LocalBolt11LegStore } from './payAggregatorStore'

/**
 * A real invoice the repo already carries (`sdk/commerce/payments/zapRead.test.ts`).
 * Its payment hash and expiry were read from `light-bolt11-decoder` — a different
 * implementation from the codec's `@getalby/lightning-tools` — so these assertions
 * cross-check two decoders instead of restating one.
 */
const SAMPLE_BOLT11 =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'
const SAMPLE_PAYMENT_HASH = 'f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5'
const SAMPLE_EXPIRES_AT_MS = (1648859703 + 172800) * 1000

describe('the production bolt11 codec', () => {
	test('decodes the invoice payment hash', () => {
		expect(bolt11PaymentHash(SAMPLE_BOLT11)).toBe(SAMPLE_PAYMENT_HASH)
	})

	test('decodes the expiry window as an absolute instant', () => {
		expect(bolt11ExpiresAt(SAMPLE_BOLT11)).toBe(SAMPLE_EXPIRES_AT_MS)
	})

	test('throws on an undecodable invoice instead of inventing a hash', () => {
		expect(() => bolt11PaymentHash('lnbc1-not-an-invoice')).toThrow()
	})
})

describe('the settlement chain', () => {
	const PREIMAGE = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
	const REFERENCE = 'lnbc-synthetic-invoice'
	const PAYMENT_HASH = bytesToHex(sha256(Buffer.from(PREIMAGE, 'hex')))
	const AMOUNT_SAT = 2_000

	/** Build the aggregator over the real verifier and a memory set store. */
	const build = (
		paymentHash: (bolt11: string) => string = () => PAYMENT_HASH,
		validatePreimage: (bolt11: string, preimage: string) => boolean = () => true,
	) => {
		const config: PayAggregatorConfig = {
			bolt11: {
				wrapperId: 'bolt11',
				store: new LocalBolt11LegStore(),
				storeKind: 'bolt11',
				codec: {
					paymentHash,
					validatePreimage,
					expiresAt: () => Date.now() + 3_600_000,
				},
				ceiling: 1_000_000_000,
				reconcileDeadlineMs: 3_600_000,
				contractVersion: '1.0.0',
				now: () => Date.now(),
			},
		}
		const { options, bolt11Wrapper } = buildAggregatorWrappers(config, createSettlementVerifier(), new MemorySetStore())
		return { aggregator: new PayAggregator(options), bolt11Wrapper }
	}

	/** The flow the consumers run: obtain the leg, declare the set from its quote. */
	const pay = async (aggregator: PayAggregator, bolt11Wrapper: Bolt11Wrapper, orderId: string) => {
		const obtained = await bolt11Wrapper.obtain({ kind: 'manual-preimage', amountSat: AMOUNT_SAT, bolt11: REFERENCE })
		if ('refused' in obtained) throw new Error(`obtain refused: ${obtained.reason} (${obtained.field})`)

		const handle = await aggregator.pay({
			orderId,
			totalSat: AMOUNT_SAT,
			legs: [
				{
					wrapperId: obtained.wrapperId,
					legId: obtained.legId,
					method: obtained.method,
					frozenShare: AMOUNT_SAT,
					expectedPaymentHash: obtained.legId,
					authorityKind: obtained.authorityKind,
					operations: obtained.operations,
					plan: obtained.plan,
				},
			],
		})
		return { quote: obtained, handle }
	}

	test('the quote identifies the leg by the decoded payment hash', async () => {
		const { aggregator, bolt11Wrapper } = build()
		const { quote } = await pay(aggregator, bolt11Wrapper, 'order-quote')
		expect(quote.legId).toBe(PAYMENT_HASH)
	})

	test('the rail settles the leg when the preimage validates against the invoice', async () => {
		const { aggregator, bolt11Wrapper } = build()
		const { quote } = await pay(aggregator, bolt11Wrapper, 'order-rail-settled')

		const handle = await bolt11Wrapper.submit(quote, PREIMAGE)

		// The rail's own verdict: its codec validated the preimage against the payment
		// hash recorded at obtain, so the leg reaches the cryptographic rung.
		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('preimage')
	})

	test('the set reaches `complete` from the rail-validated preimage (owner ruling 2026-11-06)', async () => {
		const { aggregator, bolt11Wrapper } = build()
		const { quote, handle } = await pay(aggregator, bolt11Wrapper, 'order-settled')

		await bolt11Wrapper.submit(quote, PREIMAGE)
		const settled = await aggregator.reconcile(handle.setId)

		// The rail validated the preimage against the invoice's payment hash before it
		// recorded the settled rung, so its attestation closes the leg. The witness
		// carries no material to re-derive, which is why the verifier accepts exactly
		// the rail-validated sources (`manual`, `lnurl_verify`) and nothing else.
		expect(settled.state).toBe('complete')
	})

	test('an unknown source claiming a preimage with no material stays unsettled', () => {
		const verifier = createSettlementVerifier()
		expect(verifier.verify(PAYMENT_HASH, { kind: 'preimage', source: 'some-other-rail' })).toBe(false)
	})

	test('a witness that carries material is still re-derived, not trusted', () => {
		const verifier = createSettlementVerifier()
		expect(verifier.verify(PAYMENT_HASH, { kind: 'preimage', source: 'manual', reference: PREIMAGE })).toBe(true)
		expect(verifier.verify(PAYMENT_HASH, { kind: 'preimage', source: 'manual', reference: 'deadbeef' })).toBe(false)
	})

	test('the witness the rail returns carries no preimage material', async () => {
		// The gap that blocks the aggregator from settling a bolt11 leg: the rail's
		// witness is `{kind, source, observedAt}` with **no `reference`**, while the
		// aggregator's verifier port can only check `sha256(witness.reference)` against
		// the expected payment hash — it is handed the witness and nothing else, and it
		// deliberately holds no reference of its own. This test pins the rail's shape so
		// the mismatch cannot be fixed silently on one side.
		const { aggregator, bolt11Wrapper } = build()
		const { quote } = await pay(aggregator, bolt11Wrapper, 'order-witness-shape')

		const handle = await bolt11Wrapper.submit(quote, PREIMAGE)

		expect(handle.witness).toBeDefined()
		expect(handle.witness?.reference).toBeUndefined()
	})

	test('the rail settles nothing when its codec cannot validate the preimage', async () => {
		const { aggregator, bolt11Wrapper } = build(undefined, () => false)
		const { quote, handle } = await pay(aggregator, bolt11Wrapper, 'order-rail-refused')

		const submitted = await bolt11Wrapper.submit(quote, PREIMAGE)
		expect(submitted.rung).not.toBe('witnessed-settled')

		const verdict = await aggregator.reconcile(handle.setId)
		expect(verdict.state).not.toBe('complete')
	})

	test('a rail-attested preimage settles even when the expected hash disagrees (the ruled tradeoff)', async () => {
		// Owner ruling 2026-11-06 accepts the rail's attestation. Its consequence is
		// recorded here rather than left implicit: for this witness kind the aggregator
		// does not consult `expectedPaymentHash` — the check that matters is the rail's
		// own, against the invoice's payment hash, at `submit`. Everything else about the
		// leg (its amount, its claim on that hash, the set's arithmetic) is unchanged.
		const { aggregator, bolt11Wrapper } = build(() => REFERENCE)
		const { quote, handle } = await pay(aggregator, bolt11Wrapper, 'order-attested')

		await bolt11Wrapper.submit(quote, PREIMAGE)
		const verdict = await aggregator.reconcile(handle.setId)

		expect(verdict.state).toBe('complete')
	})
})
