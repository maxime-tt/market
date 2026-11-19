/**
 * `platform/web/auctions/relay/arenaBidFunding.test.ts` — the consolidated
 * protocol's bid funding payload.
 *
 * Every assertion here is against a **real** primitive, not a re-implementation
 * of one:
 *
 * - the lock secrets are produced by the pinned `cashu-ts` 5.0.0-rc.4 output
 *   builder, so "five tags in canonical order" is the wallet's actual output;
 * - the digest is checked against the reference chain's own golden vector
 *   (`chain/sigall.go` `sigAllGoldenDigest`), so client and validator are proven
 *   to agree on layout B before any bid exists;
 * - the template signatures are real BIP-340 signatures over the recomputed
 *   digest and are verified with the same key.
 *
 * The fixture `C` values are opaque 33-byte strings: nothing in this slice
 * verifies DLEQ (that is the mint's and the chain's job), and the templates
 * bind inputs by their committed secret exactly as consensus does.
 */
import { describe, expect, test } from 'bun:test'
import { OutputData, schnorrSignDigest } from '@cashu/cashu-ts'
import {
	ARENA_SIGALL_GOLDEN_DIGEST,
	ArenaBidFundingError,
	arenaBidLocktimeFloor,
	arenaDenominationSplit,
	arenaKeysetDenominations,
	arenaOutputBPoint,
	arenaSigAllDigest,
	arenaSettleDestinations,
	arenaWalletPubkey,
	buildArenaBidFunding,
	buildArenaEscrowLockOptions,
	buildArenaOutcomeTemplate,
	parseArenaEscrowLock,
	validateArenaEscrowLock,
	verifyArenaBidFunding,
	type ArenaBidFunding,
	type ArenaEscrowProof,
	type ArenaOutcomeTemplate,
	type ArenaWalletSpendSigner,
} from './arenaBidFunding'

// ---------- Fixtures -------------------------------------------------------

const BIDDER_SK = '11'.repeat(32)
const COMMITTEE_SK = '22'.repeat(32)
const SELLER_SK = '33'.repeat(32)
const V4V_SK = '44'.repeat(32)
const BIDDER = arenaWalletPubkey(BIDDER_SK)
const COMMITTEE = arenaWalletPubkey(COMMITTEE_SK)
const SELLER = arenaWalletPubkey(SELLER_SK)
const V4V = arenaWalletPubkey(V4V_SK)
const KEYSET = '009a1f293253e41e'
/** The pinned keyset's keys: the standard power-of-two denominations, 1 … 2048. */
const KEYSET_KEYS = Object.fromEntries(Array.from({ length: 12 }, (_, bit) => [String(1 << bit), `02${'0'.repeat(64)}`]))
/** A deliberately nonstandard keyset: 1, 5 and 25 only. */
const ODD_KEYS = { '1': `02${'1'.repeat(64)}`, '5': `02${'2'.repeat(64)}`, '25': `02${'3'.repeat(64)}` }
const LOCKTIME = 1_800_000_000
const FIXTURE_C = `02${'ab'.repeat(32)}`

const walletSigner: ArenaWalletSpendSigner = {
	pubkey: BIDDER,
	signDigest: (digest) => schnorrSignDigest(digest, BIDDER_SK),
}

/** Powers of two, in the order a mint's denomination split produces. */
const denominations = (amount: number): number[] => {
	const out: number[] = []
	for (let bit = 1 << 30; bit >= 1; bit >>= 1) if (amount & bit) out.push(bit)
	return out
}

/**
 * The proofs a Coco `p2pk` send of `amount` produces: one output per
 * denomination, each with the same canonical tags and its own nonce.
 */
function escrowProofs(
	amount: number,
	over: Partial<{ bidderWallet: string; committeeKey: string; locktime: number; keysetId: string }> = {},
): ArenaEscrowProof[] {
	const options = buildArenaEscrowLockOptions({
		bidderWallet: over.bidderWallet ?? BIDDER,
		committeeKey: over.committeeKey ?? COMMITTEE,
		locktime: over.locktime ?? LOCKTIME,
	})
	return denominations(amount).map((denomination) => {
		const output = OutputData.createSingleP2PKData(options, denomination, over.keysetId ?? KEYSET)
		return {
			id: over.keysetId ?? KEYSET,
			amount: denomination,
			secret: new TextDecoder().decode(output.secret),
			C: FIXTURE_C,
		}
	})
}

const terms = (over: Partial<Parameters<typeof verifyArenaBidFunding>[1]> = {}) => ({
	bidderWallet: BIDDER,
	sellerWallet: SELLER,
	committeeKey: COMMITTEE,
	keysetId: KEYSET,
	keys: KEYSET_KEYS,
	minLocktime: LOCKTIME,
	...over,
})

/** A canonical secret, for the refusal tests: every field is chosen by the test. */
const secretWith = (body: { nonce?: string; data?: string; tags: string[][] }): string =>
	JSON.stringify(['P2PK', { nonce: body.nonce ?? 'ab'.repeat(32), data: body.data ?? BIDDER, tags: body.tags }])

const canonicalTags = (over: Partial<Record<'locktime' | 'pubkeys' | 'n_sigs' | 'refund' | 'sigflag', string>> = {}) => [
	['locktime', over.locktime ?? String(LOCKTIME)],
	['pubkeys', over.pubkeys ?? COMMITTEE],
	['n_sigs', over.n_sigs ?? '2'],
	['refund', over.refund ?? BIDDER],
	['sigflag', over.sigflag ?? 'SIG_ALL'],
]

const refusalOf = (fn: () => unknown): string => {
	try {
		fn()
	} catch (error) {
		if (error instanceof ArenaBidFundingError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a result')
}

// ---------- The lock -------------------------------------------------------

describe('the escrow lock — exactly five tags, canonical order', () => {
	test('cashu-ts emits the accepted five-tag 2-of-2 SIG_ALL secret', () => {
		const options = buildArenaEscrowLockOptions({ bidderWallet: BIDDER, committeeKey: COMMITTEE, locktime: LOCKTIME })
		const secret = new TextDecoder().decode(OutputData.createSingleP2PKData(options, 64, KEYSET).secret)
		const parsed = JSON.parse(secret)
		expect(parsed[0]).toBe('P2PK')
		expect(parsed[1].nonce).toMatch(/^[0-9a-f]{64}$/)
		expect(parsed[1].data).toBe(BIDDER)
		expect(parsed[1].tags.map((tag: string[]) => tag[0])).toEqual(['locktime', 'pubkeys', 'n_sigs', 'refund', 'sigflag'])
		expect(parsed[1].tags).toHaveLength(5)
		expect(parsed[1].tags[0]).toEqual(['locktime', String(LOCKTIME)])
		expect(parsed[1].tags[1]).toEqual(['pubkeys', COMMITTEE])
		expect(parsed[1].tags[2]).toEqual(['n_sigs', '2'])
		expect(parsed[1].tags[3]).toEqual(['refund', BIDDER])
		expect(parsed[1].tags[4]).toEqual(['sigflag', 'SIG_ALL'])
	})

	test('the parser accepts it and returns its locktime and nonce', () => {
		const proof = escrowProofs(64)[0]
		const parsed = parseArenaEscrowLock(proof.secret, { bidderWallet: BIDDER, committeeKey: COMMITTEE, minLocktime: LOCKTIME })
		expect(parsed.locktime).toBe(LOCKTIME)
		expect(parsed.nonce).toMatch(/^[0-9a-f]{64}$/)
		expect(() =>
			validateArenaEscrowLock(escrowProofs(1000), { bidderWallet: BIDDER, committeeKey: COMMITTEE, minLocktime: LOCKTIME }),
		).not.toThrow()
	})

	const cases: { name: string; secret: string; minLocktime?: number; refusal: string }[] = [
		{
			name: 'a one-of-one lock (no pubkeys, no n_sigs)',
			secret: secretWith({
				tags: [
					['locktime', String(LOCKTIME)],
					['sigflag', 'SIG_ALL'],
				],
			}),
			refusal: 'lock.tag-count',
		},
		{
			name: 'a lock with n_sigs of 1',
			secret: secretWith({ tags: canonicalTags({ n_sigs: '1' }) }),
			refusal: 'lock.n-sigs-not-2',
		},
		{
			name: 'a lock whose pubkeys are not the committee',
			secret: secretWith({ tags: canonicalTags({ pubkeys: SELLER }) }),
			refusal: 'lock.pubkeys-not-committee',
		},
		{
			name: 'a six-tag lock carrying n_sigs_refund',
			secret: secretWith({
				tags: [...canonicalTags(), ['n_sigs_refund', '2']],
			}),
			refusal: 'lock.tag-count',
		},
		{
			name: 'a readable nonce',
			secret: secretWith({ nonce: 'v1', tags: canonicalTags() }),
			refusal: 'lock.bad-nonce',
		},
		{
			name: 'an uppercase nonce',
			secret: secretWith({ nonce: 'AB'.repeat(32), tags: canonicalTags() }),
			refusal: 'lock.bad-nonce',
		},
		{
			name: 'a non-canonical (whitespace) secret',
			secret: JSON.stringify(['P2PK', { nonce: 'ab'.repeat(32), data: BIDDER, tags: canonicalTags() }], null, 1),
			refusal: 'lock.not-canonical',
		},
		{
			name: 'data that is not the bidder wallet key',
			secret: secretWith({ data: SELLER, tags: canonicalTags() }),
			refusal: 'lock.data-not-bidder',
		},
		{
			name: 'a refund branch that is not the bidder',
			secret: secretWith({ tags: canonicalTags({ refund: SELLER }) }),
			refusal: 'lock.refund-not-bidder',
		},
		{
			name: 'SIG_INPUTS instead of SIG_ALL',
			secret: secretWith({ tags: canonicalTags({ sigflag: 'SIG_INPUTS' }) }),
			refusal: 'lock.not-sig-all',
		},
		{
			name: 'a tag with two values',
			secret: secretWith({ tags: [['locktime', String(LOCKTIME), 'extra'], ...canonicalTags().slice(1)] }),
			refusal: 'lock.tag-shape',
		},
		{
			name: 'the wrong first tag',
			secret: secretWith({ tags: [canonicalTags()[1], canonicalTags()[0], ...canonicalTags().slice(2)] }),
			refusal: 'lock.first-tag-not-locktime',
		},
		{
			name: 'a non-decimal locktime',
			secret: secretWith({ tags: canonicalTags({ locktime: `${LOCKTIME}.0` }) }),
			refusal: 'lock.locktime-not-integer',
		},
		{
			name: 'a locktime below the floor',
			secret: secretWith({ tags: canonicalTags({ locktime: String(LOCKTIME - 1) }) }),
			refusal: 'lock.locktime-below-floor',
		},
	]

	for (const { name, secret, minLocktime, refusal } of cases) {
		test(`refuses ${name} by name (${refusal})`, () => {
			expect(
				refusalOf(() =>
					parseArenaEscrowLock(secret, { bidderWallet: BIDDER, committeeKey: COMMITTEE, minLocktime: minLocktime ?? LOCKTIME }),
				),
			).toBe(refusal)
		})
	}

	test('refuses proofs that do not share one identical lock', () => {
		const proofs = [...escrowProofs(64), ...escrowProofs(1, { locktime: LOCKTIME + 1 })]
		expect(refusalOf(() => validateArenaEscrowLock(proofs, { bidderWallet: BIDDER, committeeKey: COMMITTEE, minLocktime: LOCKTIME }))).toBe(
			'lock.proofs-share-no-lock',
		)
	})

	test('refuses an empty proof set', () => {
		expect(refusalOf(() => validateArenaEscrowLock([], { bidderWallet: BIDDER, committeeKey: COMMITTEE, minLocktime: LOCKTIME }))).toBe(
			'lock.no-proofs',
		)
	})
})

// ---------- The locktime floor ---------------------------------------------

describe('the locktime floor — the end THIS bid establishes', () => {
	test('a fixed lot uses its own EndAt plus safety and latency', () => {
		expect(arenaBidLocktimeFloor({ mode: 'fixed', endAt: 1000, windowSec: 300, now: 500 })).toBe(1000 + 900 + 15)
	})

	test('an anti-snipe bid with plenty of time left uses EndAt', () => {
		expect(arenaBidLocktimeFloor({ mode: 'antisnipe', endAt: 2000, windowSec: 300, now: 500 })).toBe(2000 + 900 + 15)
	})

	test('an anti-snipe bid inside the window uses the admitting block plus windowSec, not the old EndAt', () => {
		// 60 s left, a 300 s window: the bid resets the clock to 900, so the lock
		// must clear 900 + 915, not 700 + 915. Checking the old end is the exact
		// bug spec §2.2 records. The end is established against the block that
		// ADMITS the bid (`now + latency`, the chain's own client), not the
		// bidder's clock — locking a latency short is refused by the chain.
		expect(arenaBidLocktimeFloor({ mode: 'antisnipe', endAt: 760, windowSec: 300, now: 700 })).toBe(700 + 15 + 300 + 900 + 15)
		expect(arenaBidLocktimeFloor({ mode: 'antisnipe', endAt: 760, windowSec: 300, now: 700 })).toBeGreaterThan(760 + 900 + 15)
	})

	test('the safety and latency are parameters, not assumptions', () => {
		expect(arenaBidLocktimeFloor({ mode: 'fixed', endAt: 1000, now: 1, settlementSafetySec: 10, bidToConsensusLatencySec: 2 })).toBe(1012)
	})
})

// ---------- The templates --------------------------------------------------

describe('the outcome templates', () => {
	test('the layout-B digest matches the reference chain golden vector', () => {
		expect(
			arenaSigAllDigest(
				[
					{ secret: 'sigall-golden-secret-0001', C: '02cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
					{ secret: 'sigall-golden-secret-0002', C: '03dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' },
				],
				[
					{ amount: 1, B_: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
					{ amount: 2, B_: '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
				],
			),
		).toBe(ARENA_SIGALL_GOLDEN_DIGEST)
	})

	test('B_ recomputes from the committed secret and opening', () => {
		const output = OutputData.createSingleP2PKData({ kind: 'P2PK', data: SELLER }, 64, KEYSET)
		const r = output.blindingFactor.toString(16).padStart(64, '0')
		expect(arenaOutputBPoint({ secret: new TextDecoder().decode(output.secret), r })).toBe(output.blindedMessage.B_)
	})

	test('settle pays the seller, refund pays the bidder, both sum to the bid', async () => {
		const proofs = escrowProofs(1000)
		const funding = await buildArenaBidFunding({
			proofs,
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		expect(funding.proofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(1000)
		expect(funding.outcome_templates.settle.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(1000)
		expect(funding.outcome_templates.refund.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(1000)
		expect(JSON.parse(funding.outcome_templates.settle.outputs[0].secret)[1].data).toBe(SELLER)
		expect(JSON.parse(funding.outcome_templates.refund.outputs[0].secret)[1].data).toBe(BIDDER)
		expect(funding.locktime).toBe(LOCKTIME)
		expect(() => verifyArenaBidFunding(funding, terms())).not.toThrow()
	})

	test('the v4v split is paid in order, with the seller remainder last', () => {
		expect(
			arenaSettleDestinations({
				amount: 1000,
				sellerWallet: SELLER,
				v4vSplit: [{ role: 'validator', recipientPubkey: V4V, allocationBps: 500 }],
			}),
		).toEqual([
			{ recipient: V4V, amount: 50 },
			{ recipient: SELLER, amount: 950 },
		])
	})

	test('a split that rounds a row to zero is refused by name', () => {
		expect(
			refusalOf(() =>
				arenaSettleDestinations({
					amount: 100,
					sellerWallet: SELLER,
					v4vSplit: [{ role: 'validator', recipientPubkey: V4V, allocationBps: 1 }],
				}),
			),
		).toBe('template.split-unrepresentable')
	})

	test('a settle template matches the committed split exactly', async () => {
		const split = [{ role: 'validator', recipientPubkey: V4V, allocationBps: 500 }]
		const funding = await buildArenaBidFunding({
			proofs: escrowProofs(1000),
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
			v4vSplit: split,
		})
		// The committed split's recipients are unchanged — one destination per
		// recipient — but each destination's amount is decomposed into the mint's
		// single-denomination outputs: the v4v row (50 sats) is 32+16+2, and the
		// seller's remainder (950 sats) is 512+256+128+32+16+4+2.
		const payouts = funding.outcome_templates.settle.outputs.map((output) => ({
			recipient: JSON.parse(output.secret)[1].data as string,
			amount: output.amount,
		}))
		expect(payouts).toEqual([
			{ recipient: V4V, amount: 32 },
			{ recipient: V4V, amount: 16 },
			{ recipient: V4V, amount: 2 },
			{ recipient: SELLER, amount: 512 },
			{ recipient: SELLER, amount: 256 },
			{ recipient: SELLER, amount: 128 },
			{ recipient: SELLER, amount: 32 },
			{ recipient: SELLER, amount: 16 },
			{ recipient: SELLER, amount: 4 },
			{ recipient: SELLER, amount: 2 },
		])
		expect(funding.outcome_templates.settle.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(1000)
		expect(() => verifyArenaBidFunding(funding, terms({ v4vSplit: split }))).not.toThrow()
	})

	test('a refund template that pays a split recipient is refused', async () => {
		const split = [{ role: 'validator', recipientPubkey: V4V, allocationBps: 500 }]
		const proofs = escrowProofs(1000)
		const refund = await buildArenaOutcomeTemplate({
			proofs,
			destinations: [{ recipient: V4V, amount: 1000 }],
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			signer: walletSigner,
		})
		const funding = (await buildArenaBidFunding({
			proofs,
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
			v4vSplit: split,
		})) as ArenaBidFunding
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, refund } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms({ v4vSplit: split })))).toBe('template.refund-pays-split')
	})

	test('an output that re-locks the escrow to the committee key is refused', async () => {
		const proofs = escrowProofs(1000)
		const settle = await buildArenaOutcomeTemplate({
			proofs,
			destinations: [{ recipient: COMMITTEE, amount: 1000 }],
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			signer: walletSigner,
		})
		const funding = await buildArenaBidFunding({
			proofs,
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, settle } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms()))).toBe('template.escrow-relock')
	})

	test('a template for the wrong destination is refused', async () => {
		const proofs = escrowProofs(1000)
		const settle = await buildArenaOutcomeTemplate({
			proofs,
			destinations: [{ recipient: V4V, amount: 1000 }],
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			signer: walletSigner,
		})
		const funding = await buildArenaBidFunding({
			proofs,
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, settle } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms()))).toBe('template.destination')
	})

	test('a changed digest is refused', async () => {
		const funding = await buildArenaBidFunding({
			proofs: escrowProofs(1000),
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		const settle: ArenaOutcomeTemplate = { ...funding.outcome_templates.settle, digest: 'ab'.repeat(32) }
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, settle } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms()))).toBe('template.digest')
	})

	test('a template not signed by the bidder is refused', async () => {
		const funding = await buildArenaBidFunding({
			proofs: escrowProofs(1000),
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		const wrongSigner: ArenaWalletSpendSigner = {
			pubkey: BIDDER,
			signDigest: (digest) => schnorrSignDigest(digest, SELLER_SK),
		}
		const settle = await buildArenaOutcomeTemplate({
			proofs: funding.proofs,
			destinations: [{ recipient: SELLER, amount: 1000 }],
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			signer: wrongSigner,
		})
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, settle } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms()))).toBe('template.not-signed-by-bidder')
	})

	test('a template whose inputs are not the committed proofs is refused', async () => {
		const funding = await buildArenaBidFunding({
			proofs: escrowProofs(1000),
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		const otherProofs = escrowProofs(1000)
		const settle = await buildArenaOutcomeTemplate({
			proofs: otherProofs,
			destinations: [{ recipient: SELLER, amount: 1000 }],
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			signer: walletSigner,
		})
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, settle } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms()))).toBe('template.inputs-not-committed-proofs')
	})
})

// ---------- The payout is decomposed into the mint's denominations ----------

describe('a payout is decomposed into the mint keyset’s denominations', () => {
	test('a 100-sat destination becomes 64 + 32 + 4, and an 80-sat destination 64 + 16', async () => {
		const decomposeDestination = (amount: number) =>
			buildArenaOutcomeTemplate({
				proofs: escrowProofs(amount),
				destinations: [{ recipient: SELLER, amount }],
				keysetId: KEYSET,
				keys: KEYSET_KEYS,
				signer: walletSigner,
			})
		expect((await decomposeDestination(100)).outputs.map((output) => output.amount)).toEqual([64, 32, 4])
		expect((await decomposeDestination(80)).outputs.map((output) => output.amount)).toEqual([64, 16])
	})

	test('the decomposed outputs still reconcile with the locked inputs', async () => {
		const proofs = escrowProofs(100)
		const template = await buildArenaOutcomeTemplate({
			proofs,
			destinations: [{ recipient: SELLER, amount: 100 }],
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			signer: walletSigner,
		})
		const locked = proofs.reduce((sum, proof) => sum + proof.amount, 0)
		expect(template.inputs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(locked)
		expect(template.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(locked)
		// And every output is a denomination the keyset actually has.
		const denominations = new Set(arenaKeysetDenominations(KEYSET_KEYS))
		for (const output of template.outputs) expect(denominations.has(output.amount)).toBe(true)
	})

	test('a v4v split keeps exactly one destination per recipient, and decomposes each', async () => {
		const other = arenaWalletPubkey('55'.repeat(32))
		const split = [
			{ role: 'validator', recipientPubkey: V4V, allocationBps: 2500 },
			{ role: 'v4v', recipientPubkey: other, allocationBps: 2500 },
		]
		// Still one destination per recipient: the two split rows, then the seller remainder.
		expect(arenaSettleDestinations({ amount: 100, sellerWallet: SELLER, v4vSplit: split })).toEqual([
			{ recipient: V4V, amount: 25 },
			{ recipient: other, amount: 25 },
			{ recipient: SELLER, amount: 50 },
		])
		const funding = await buildArenaBidFunding({
			proofs: escrowProofs(100),
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
			v4vSplit: split,
		})
		const payouts = funding.outcome_templates.settle.outputs.map((output) => ({
			recipient: JSON.parse(output.secret)[1].data as string,
			amount: output.amount,
		}))
		// 25 = 16+8+1 for each split row, 50 = 32+16+2 for the seller remainder.
		expect(payouts).toEqual([
			{ recipient: V4V, amount: 16 },
			{ recipient: V4V, amount: 8 },
			{ recipient: V4V, amount: 1 },
			{ recipient: other, amount: 16 },
			{ recipient: other, amount: 8 },
			{ recipient: other, amount: 1 },
			{ recipient: SELLER, amount: 32 },
			{ recipient: SELLER, amount: 16 },
			{ recipient: SELLER, amount: 2 },
		])
		expect(() => verifyArenaBidFunding(funding, terms({ v4vSplit: split }))).not.toThrow()
	})

	test('the split follows the injected keyset, not a hardcoded power-of-two list', async () => {
		expect(arenaDenominationSplit(100, ODD_KEYS)).toEqual([25, 25, 25, 25])
		expect(arenaDenominationSplit(80, ODD_KEYS)).toEqual([25, 25, 25, 5])
		const template = await buildArenaOutcomeTemplate({
			proofs: escrowProofs(80),
			destinations: [{ recipient: SELLER, amount: 80 }],
			keysetId: KEYSET,
			keys: ODD_KEYS,
			signer: walletSigner,
		})
		expect(template.outputs.map((output) => output.amount)).toEqual([25, 25, 25, 5])
		expect(template.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(80)
	})

	test('an amount the keyset cannot make is refused, and no template is produced', async () => {
		// A keyset with no 1-sat key: 3 sats cannot be made from 5 and 25.
		const noOnes = { '5': `02${'5'.repeat(64)}`, '25': `02${'6'.repeat(64)}` }
		expect(refusalOf(() => arenaDenominationSplit(3, noOnes))).toBe('template.amount-unrepresentable')
		await expect(
			buildArenaOutcomeTemplate({
				proofs: escrowProofs(3),
				destinations: [{ recipient: SELLER, amount: 3 }],
				keysetId: KEYSET,
				keys: noOnes,
				signer: walletSigner,
			}),
		).rejects.toBeInstanceOf(ArenaBidFundingError)
	})

	test('a zero, negative or non-integer amount is refused by name', () => {
		expect(refusalOf(() => arenaDenominationSplit(0, KEYSET_KEYS))).toBe('template.amount-unrepresentable')
		expect(refusalOf(() => arenaDenominationSplit(-4, KEYSET_KEYS))).toBe('template.amount-unrepresentable')
		expect(refusalOf(() => arenaDenominationSplit(1.5, KEYSET_KEYS))).toBe('template.amount-unrepresentable')
	})

	test('a keyset naming no usable denomination is refused by name', () => {
		expect(refusalOf(() => arenaDenominationSplit(10, {}))).toBe('template.keyset-unusable')
		expect(refusalOf(() => arenaDenominationSplit(10, { '0': KEYSET_KEYS['1'] }))).toBe('template.keyset-unusable')
	})

	test('a single-output settle template is refused against the pinned keyset', async () => {
		// A keyset under which 1,000 is a single denomination builds the shape that
		// can never settle; verifying it against the real power-of-two keyset must
		// fail, because the expected payout there is six outputs.
		const funding = await buildArenaBidFunding({
			proofs: escrowProofs(1000),
			sellerWallet: SELLER,
			bidderWallet: BIDDER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			keys: KEYSET_KEYS,
			minLocktime: LOCKTIME,
			signer: walletSigner,
		})
		const single = await buildArenaOutcomeTemplate({
			proofs: funding.proofs,
			destinations: [{ recipient: SELLER, amount: 1000 }],
			keysetId: KEYSET,
			keys: { '1000': KEYSET_KEYS['512'] },
			signer: walletSigner,
		})
		expect(single.outputs.map((output) => output.amount)).toEqual([1000])
		const tampered = { ...funding, outcome_templates: { ...funding.outcome_templates, settle: single } }
		expect(refusalOf(() => verifyArenaBidFunding(tampered, terms()))).toBe('template.amount')
	})
})
