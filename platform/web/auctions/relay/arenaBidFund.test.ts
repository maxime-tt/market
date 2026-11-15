/**
 * `platform/web/auctions/relay/arenaBidFund.test.ts` — the funding assembly seam.
 *
 * No network, no mint, no relay. Three doubles stand in for the outside world:
 * the config, the wallet (signer + manager) and the escrow send. The escrow
 * double is the one that matters: it builds its proofs **from the options the
 * seam actually sent to the mint** (`buildArenaEscrowLockOptions`, through the
 * real `cashu-ts` output builder), so every assertion about the lock — amount,
 * bidder key, committee key, locktime — is an assertion about what the mint was
 * asked for, not about what the seam believes it asked for.
 *
 * The happy paths go one step further: the assembled payload is handed to the
 * real `verifyArenaBidFunding` with the real terms, so "the seam produced a
 * funded bid" means "consensus would accept this bid".
 */
import { describe, expect, test } from 'bun:test'
import { OutputData, schnorrSignDigest, type Proof } from '@cashu/cashu-ts'
import {
	arenaBidLocktimeFloor,
	arenaWalletPubkey,
	buildArenaEscrowLockOptions,
	verifyArenaBidFunding,
	type ArenaWalletSpendSigner,
} from './arenaBidFunding'
import type { ArenaEscrowSendManager } from './arenaBidEscrow'
import {
	ARENA_BID_FUND_REFUSAL_TEXT,
	ArenaBidFundError,
	assembleArenaBidFunding,
	type ArenaBidFundConfig,
	type ArenaBidFundPorts,
	type ArenaBidFundRefusal,
	type ArenaBidFundTerms,
} from './arenaBidFund'

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
const OTHER_KEYSET = '00ffeeddccbbaa99'
const MINT = 'https://mint.test/Bitcoin'
const NOW = 1_700_000_000
const END_AT = NOW + 3_600
const WINDOW = 300
const AMOUNT = 1_000
const FIXTURE_C = `02${'ab'.repeat(32)}`

const signer: ArenaWalletSpendSigner = {
	pubkey: BIDDER,
	signDigest: (digest) => schnorrSignDigest(digest, BIDDER_SK),
}

/** A fixed lot that is open now and states every term the escrow needs. */
const fixedLot = (over: Partial<ArenaBidFundTerms> = {}): ArenaBidFundTerms => ({
	mode: 'fixed',
	endsAt: END_AT,
	windowSec: null,
	sellerWallet: SELLER,
	v4vSplit: null,
	...over,
})

const config = (over: Partial<ArenaBidFundConfig> = {}): ArenaBidFundConfig => ({
	committee_public_key: COMMITTEE,
	cashu_mint_url: MINT,
	...over,
})

/** Powers of two, as a mint's denomination split produces them. */
const denominations = (amount: number): number[] => {
	const out: number[] = []
	for (let bit = 1 << 30; bit >= 1; bit >>= 1) if (amount & bit) out.push(bit)
	return out
}

interface SentLock {
	mintUrl: string
	amount: number
	options: ReturnType<typeof buildArenaEscrowLockOptions>
}

/**
 * The Coco send double. It records every `init` (the mint's instruction) and
 * answers `execute` with proofs built from THAT instruction's own lock options,
 * so the proofs always describe the lock the seam asked for — which is exactly
 * what the real mint does.
 */
function escrowDouble(
	over: { keysetId?: string; keysetIds?: string[]; fail?: Error; proofs?: 'empty' | 'short'; blankId?: boolean } = {},
) {
	const sent: SentLock[] = []
	let executes = 0
	const manager: ArenaEscrowSendManager = {
		mint: { addMint: async () => ({}) },
		ops: {
			send: {
				init: async (mintUrl, amount, request) => {
					sent.push({ mintUrl, amount, options: request.methodData.options })
					return { id: `op-${sent.length}` }
				},
				prepare: async (operation) => ({ id: operation.id }),
				execute: async () => {
					executes += 1
					if (over.fail) throw over.fail
					const last = sent[sent.length - 1]
					if (over.proofs === 'empty') return { token: { proofs: [] } }
					const keysetIds = over.keysetIds ?? []
					const proofs = denominations(over.proofs === 'short' ? last.amount - 1 : last.amount).map((denomination, index) => {
						const keysetId = keysetIds[index] ?? over.keysetId ?? KEYSET
						const output = OutputData.createSingleP2PKData(last.options, denomination, keysetId)
						return {
							id: over.blankId ? '' : (keysetId as string),
							amount: denomination,
							secret: new TextDecoder().decode(output.secret),
							C: FIXTURE_C,
						} as unknown as Proof
					})
					return { token: { proofs } }
				},
			},
		},
	}
	return { manager, sent, executes: () => executes }
}

function ports(
	over: {
		config?: ArenaBidFundConfig | Error
		signer?: ArenaWalletSpendSigner | null
		manager?: ArenaEscrowSendManager | null
	} = {},
): ArenaBidFundPorts & { managerCalls: () => number; signerCalls: () => number } {
	let managerCalls = 0
	let signerCalls = 0
	return {
		readConfig: async () => {
			if (over.config instanceof Error) throw over.config
			return over.config ?? config()
		},
		readWalletSigner: () => {
			signerCalls += 1
			return over.signer === undefined ? signer : over.signer
		},
		readEscrowManager: () => {
			managerCalls += 1
			return over.manager === undefined ? escrowDouble().manager : over.manager
		},
		managerCalls: () => managerCalls,
		signerCalls: () => signerCalls,
	}
}

const refusalOf = async (promise: Promise<unknown>): Promise<ArenaBidFundRefusal> => {
	try {
		await promise
	} catch (error) {
		if (error instanceof ArenaBidFundError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a result')
}

// ---------- The lock, and the payload -------------------------------------

describe('a funded bid is assembled from the lock and the terms', () => {
	test('locks exactly the bid amount, once, at the floor, and the payload verifies', async () => {
		const escrow = escrowDouble()
		const result = await assembleArenaBidFunding(
			{ model: fixedLot(), amount: AMOUNT, now: NOW },
			ports({ manager: escrow.manager }),
		)

		// Exactly one send, for exactly the bid amount, to exactly the configured mint.
		expect(escrow.sent).toHaveLength(1)
		expect(escrow.sent[0].amount).toBe(AMOUNT)
		expect(escrow.sent[0].mintUrl).toBe(MINT)
		expect(escrow.executes()).toBe(1)

		// The lock the mint was asked to write is the 2-of-2 escrow at the floor.
		const floor = arenaBidLocktimeFloor({ mode: 'fixed', endAt: END_AT, now: NOW })
		expect(escrow.sent[0].options.data).toBe(BIDDER)
		expect(escrow.sent[0].options.pubkeys).toEqual([COMMITTEE])
		expect(escrow.sent[0].options.requiredSignatures).toBe(2)
		expect(escrow.sent[0].options.sigFlag).toBe('SIG_ALL')
		expect(escrow.sent[0].options.locktime).toBe(floor)
		expect(result.funding.locktime).toBe(floor)

		// The escrow carries the whole amount, under one keyset.
		expect(result.funding.proofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(AMOUNT)
		expect(new Set(result.funding.proofs.map((proof) => proof.id))).toEqual(new Set([KEYSET]))

		// The returned terms mirror the lot, and consensus accepts the payload.
		expect(result.fundingTerms).toEqual({
			bidderWallet: BIDDER,
			sellerWallet: SELLER,
			committeeKey: COMMITTEE,
			keysetId: KEYSET,
			minLocktime: floor,
			v4vSplit: undefined,
		})
		expect(verifyArenaBidFunding(result.funding, result.fundingTerms)).toBe(floor)
	})

	test('an anti-snipe bid inside the window locks against now + window, not the stated end', async () => {
		const lateNow = END_AT - 30 // 30 s left, inside a 300 s window
		const escrow = escrowDouble()
		const result = await assembleArenaBidFunding(
			{ model: fixedLot({ mode: 'antisnipe', windowSec: WINDOW }), amount: 64, now: lateNow },
			ports({ manager: escrow.manager }),
		)
		const floor = arenaBidLocktimeFloor({ mode: 'antisnipe', endAt: END_AT, windowSec: WINDOW, now: lateNow })
		expect(floor).toBe(lateNow + WINDOW + 900 + 15)
		expect(escrow.sent[0].options.locktime).toBe(floor)
		expect(verifyArenaBidFunding(result.funding, result.fundingTerms)).toBe(floor)
	})

	test('an anti-snipe bid far from the window still pays the safety margin on the stated end', async () => {
		const escrow = escrowDouble()
		await assembleArenaBidFunding({ model: fixedLot({ mode: 'antisnipe', windowSec: WINDOW }), amount: 64, now: NOW }, ports({ manager: escrow.manager }))
		expect(escrow.sent[0].options.locktime).toBe(END_AT + 900 + 15)
	})

	test('the committed v4v split reaches the settle template as its own outputs', async () => {
		const v4vSplit = [{ role: 'v4v', recipientPubkey: V4V, allocationBps: 500 }]
		const escrow = escrowDouble()
		const result = await assembleArenaBidFunding(
			{ model: fixedLot({ v4vSplit }), amount: AMOUNT, now: NOW },
			ports({ manager: escrow.manager }),
		)
		expect(result.fundingTerms.v4vSplit).toEqual(v4vSplit)
		const destinations = result.funding.outcome_templates.settle.outputs.map((output) => {
			const parsed = JSON.parse(output.secret) as [string, { data: string }]
			return { recipient: parsed[1].data, amount: output.amount }
		})
		// 500 bps of 1000 sats, with the seller taking the remainder (spec §6).
		expect(destinations).toEqual([
			{ recipient: V4V, amount: 50 },
			{ recipient: SELLER, amount: 950 },
		])
		expect(verifyArenaBidFunding(result.funding, result.fundingTerms)).toBe(result.funding.locktime)
	})

	test('cashu_mint_url wins over the legacy mint_url; the legacy name is used when it is absent', async () => {
		const preferred = escrowDouble()
		await assembleArenaBidFunding(
			{ model: fixedLot(), amount: 64, now: NOW },
			ports({ config: config({ cashu_mint_url: MINT, mint_url: 'https://legacy.test' }), manager: preferred.manager }),
		)
		expect(preferred.sent[0].mintUrl).toBe(MINT)

		const legacy = escrowDouble()
		await assembleArenaBidFunding(
			{ model: fixedLot(), amount: 64, now: NOW },
			ports({ config: { committee_public_key: COMMITTEE, mint_url: 'https://legacy.test' }, manager: legacy.manager }),
		)
		expect(legacy.sent[0].mintUrl).toBe('https://legacy.test')
	})
})

// ---------- Refusals, each one named --------------------------------------

describe('every precondition refuses by name, before any money moves', () => {
	const cases: {
		name: string
		refusal: ArenaBidFundRefusal
		model?: ArenaBidFundTerms | null
		amount?: number
		ports?: () => ReturnType<typeof ports>
	}[] = [
		{ name: 'the config cannot be read', refusal: 'fund.config-unreadable', ports: () => ports({ config: new Error('502 from /api/auctions/config') }) },
		{
			name: 'no committee key is configured',
			refusal: 'fund.committee-key-missing',
			ports: () => ports({ config: { committee_public_key: '', cashu_mint_url: MINT } }),
		},
		{
			name: 'the committee key is not a compressed secp256k1 key',
			refusal: 'fund.committee-key-missing',
			ports: () => ports({ config: config({ committee_public_key: 'committee' }) }),
		},
		{
			name: 'no mint is configured',
			refusal: 'fund.mint-url-missing',
			ports: () => ports({ config: { committee_public_key: COMMITTEE } }),
		},
		{
			name: 'the configured mint is not a url',
			refusal: 'fund.mint-url-missing',
			ports: () => ports({ config: config({ cashu_mint_url: 'mint.test' }) }),
		},
		{ name: 'the wallet has no spend key', refusal: 'fund.wallet-signer-missing', ports: () => ports({ signer: null }) },
		{ name: 'the Cashu wallet is not ready', refusal: 'fund.wallet-manager-missing', ports: () => ports({ manager: null }) },
		{ name: 'the lot states no end time', refusal: 'fund.no-end-time', model: fixedLot({ endsAt: null }) },
		{ name: 'nothing was read at all', refusal: 'fund.no-end-time', model: null },
		{ name: 'the lot states no mode', refusal: 'fund.unknown-mode', model: fixedLot({ mode: null }) },
		{ name: 'the lot states a mode the protocol does not define', refusal: 'fund.unknown-mode', model: fixedLot({ mode: 'dutch' }) },
		{ name: 'an anti-snipe lot states no window', refusal: 'fund.no-window', model: fixedLot({ mode: 'antisnipe', windowSec: null }) },
		{ name: 'the lot states no seller wallet', refusal: 'fund.seller-wallet-missing', model: fixedLot({ sellerWallet: null }) },
		{ name: 'the seller wallet is not a payment key', refusal: 'fund.seller-wallet-invalid', model: fixedLot({ sellerWallet: 'seller-alice' }) },
		{
			name: 'a v4v split row names an invalid recipient',
			refusal: 'fund.split-recipient-invalid',
			model: fixedLot({ v4vSplit: [{ role: 'v4v', recipientPubkey: 'not-a-key', allocationBps: 100 }] }),
		},
		{ name: 'the amount is zero', refusal: 'fund.amount-invalid', amount: 0 },
		{ name: 'the amount is fractional', refusal: 'fund.amount-invalid', amount: 10.5 },
	]

	for (const testCase of cases) {
		test(testCase.name, async () => {
			const escrow = escrowDouble()
			const built = testCase.ports?.() ?? ports({ manager: escrow.manager })
			expect(
				await refusalOf(
					assembleArenaBidFunding(
						{ model: testCase.model === undefined ? fixedLot() : testCase.model, amount: testCase.amount ?? AMOUNT, now: NOW },
						built,
					),
				),
			).toBe(testCase.refusal)
			// Nothing was locked: no send was even initialised.
			expect(escrow.sent).toHaveLength(0)
		})
	}

	test('the refusal names are all distinct, each carries its own text, and none is left unexercised', () => {
		const all = Object.keys(ARENA_BID_FUND_REFUSAL_TEXT) as ArenaBidFundRefusal[]
		expect(new Set(all).size).toBe(all.length)
		expect(new Set(Object.values(ARENA_BID_FUND_REFUSAL_TEXT)).size).toBe(all.length)
		// The refusals below are the ones the mint's answer can produce; they are
		// exercised by the next describe block.
		const covered = new Set(cases.map((testCase) => testCase.refusal))
		expect(all.filter((refusal) => !covered.has(refusal))).toEqual([
			'fund.escrow-empty',
			'fund.escrow-mismatch',
			'fund.mixed-keysets',
			'fund.keyset-id-invalid',
			'fund.lock-failed',
		])
	})
})

describe('what the mint answers is checked, and never retried', () => {
	test('a proof with no keyset id is refused', async () => {
		const escrow = escrowDouble({ blankId: true })
		expect(
			await refusalOf(assembleArenaBidFunding({ model: fixedLot(), amount: AMOUNT, now: NOW }, ports({ manager: escrow.manager }))),
		).toBe('fund.keyset-id-invalid')
	})

	test('a mixed-keyset escrow is refused', async () => {
		const escrow = escrowDouble({ keysetIds: [KEYSET, OTHER_KEYSET] })
		expect(
			await refusalOf(assembleArenaBidFunding({ model: fixedLot(), amount: AMOUNT, now: NOW }, ports({ manager: escrow.manager }))),
		).toBe('fund.mixed-keysets')
	})

	test('a mint that locks nothing is refused', async () => {
		const escrow = escrowDouble({ proofs: 'empty' })
		expect(
			await refusalOf(assembleArenaBidFunding({ model: fixedLot(), amount: AMOUNT, now: NOW }, ports({ manager: escrow.manager }))),
		).toBe('fund.escrow-empty')
	})

	test('an escrow that does not total the bid is refused', async () => {
		const escrow = escrowDouble({ proofs: 'short' })
		expect(
			await refusalOf(assembleArenaBidFunding({ model: fixedLot(), amount: AMOUNT, now: NOW }, ports({ manager: escrow.manager }))),
		).toBe('fund.escrow-mismatch')
	})

	test('a mint refusal is reported with its own words, and the lock is never retried', async () => {
		const escrow = escrowDouble({ fail: new Error('balance too low') })
		let caught: ArenaBidFundError | null = null
		try {
			await assembleArenaBidFunding({ model: fixedLot(), amount: AMOUNT, now: NOW }, ports({ manager: escrow.manager }))
		} catch (error) {
			if (!(error instanceof ArenaBidFundError)) throw error
			caught = error
		}
		expect(caught?.refusal).toBe('fund.lock-failed')
		expect(caught?.detail).toContain('balance too low')
		expect(caught?.message).toContain('nothing was published')
		// One init, one execute: a failed lock is reported, not re-attempted.
		expect(escrow.sent).toHaveLength(1)
		expect(escrow.executes()).toBe(1)
	})
})