/**
 * `arenaReceiptClaims.test.ts` — the wallet's claim of the ecash a receipt
 * minted for it.
 *
 * The fixtures are shaped by the live receipts on the relay (`nak req -k 1443`
 * / `-k 1444`): an `out[]` entry per committed destination, each proof a
 * canonical NUT-10 `P2PK` secret locked to the recipient's compressed wallet
 * key with `sigflag: SIG_INPUTS`, at the mint's one keyset id. Every refusal
 * the claim can make is reached by name, and the at-most-once record is proven
 * to make a second run claim nothing.
 */
import { describe, expect, test } from 'bun:test'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Proof } from '@cashu/cashu-ts'
import { arenaWalletPubkey } from '@platform/web/auctions/relay/arenaBidFunding'
import {
	ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED,
	ARENA_CLAIM_REFUSAL_FOREIGN_KEY,
	ARENA_CLAIM_REFUSAL_FOREIGN_MINT,
	ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH,
	ARENA_CLAIM_REFUSAL_MALFORMED_P2PK,
	createArenaReceiptClaims,
	planArenaReceiptClaims,
	selectArenaReceiptClaim,
	type ArenaReceiptClaimRecord,
	type ArenaReceiptClaimsHost,
} from './arenaReceiptClaims'
import { arenaReceiptClaimStateFor } from './arenaReceiptClaimState'
import type { ArenaReceiptOutput, ParsedArenaReceipt } from './arenaReceiptsRead'

// =========================================================================
// Fixtures — the shapes the live receipts actually carry
// =========================================================================

/** The live mint's single keyset id (params `keyset_id` and every `out[].id`). */
const KEYSET = '0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1'
const OTHER_KEYSET = '00'.repeat(32)
const MINT = 'http://127.0.0.1:3338'
const OTHER_MINT = 'https://mint.example.it'

const K_PRIV = bytesToHex(new Uint8Array(32).fill(7))
const K = arenaWalletPubkey(K_PRIV)
const K2_PRIV = bytesToHex(new Uint8Array(32).fill(11))
const K2 = arenaWalletPubkey(K2_PRIV)

/** A canonical NUT-10 P2PK secret locked to `data`, exactly as the mint writes them. */
function p2pkSecret(data: string, over: { nonce?: string; sigflag?: string | null } = {}): string {
	const tags: string[][] = over.sigflag === null ? [] : [['sigflag', over.sigflag ?? 'SIG_INPUTS']]
	return JSON.stringify(['P2PK', { nonce: over.nonce ?? 'a'.repeat(64), data, tags }])
}

function out(over: Partial<ArenaReceiptOutput> & { recipient?: string | null; amount?: number | null }): ArenaReceiptOutput {
	return {
		recipient: over.recipient === undefined ? K : over.recipient,
		amount: over.amount === undefined ? 64 : over.amount,
		id: over.id === undefined ? KEYSET : over.id,
		secret: over.secret === undefined ? p2pkSecret(K) : over.secret,
		C: over.C === undefined ? '02' + 'b'.repeat(64) : over.C,
		dleq: over.dleq === undefined ? { e: '1'.repeat(64), s: '2'.repeat(64), r: '3'.repeat(64) } : over.dleq,
	}
}

function receipt(over: Partial<ParsedArenaReceipt> & { outputs?: ArenaReceiptOutput[] } = {}): ParsedArenaReceipt {
	const outputs = over.outputs ?? [out({})]
	const total = outputs.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
	return {
		eventId: over.eventId ?? 'e'.repeat(64),
		signerPubkey: over.signerPubkey ?? 's'.repeat(64),
		kind: over.kind ?? 1443,
		auctionId: over.auctionId ?? `1440:${K2}:d1`,
		bidId: over.bidId ?? 'bid-1',
		outcome: over.outcome ?? 'refund',
		height: over.height ?? 400,
		blockHash: over.blockHash ?? 'a'.repeat(64),
		settledAt: over.settledAt ?? 1_794_999_999,
		paramsVersion: over.paramsVersion ?? 'pv-1',
		outputs,
		total: over.total === undefined ? total : over.total,
		outputsWithoutAmount: over.outputsWithoutAmount ?? 0,
	}
}

// =========================================================================
// Selection
// =========================================================================

describe('selectArenaReceiptClaim — a refund receipt for this key', () => {
	test('selects exactly its outputs and totals them', () => {
		const parsed = receipt({ outputs: [out({ amount: 64 }), out({ amount: 32 }), out({ amount: 4 })] })
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K, expectedKeysetId: KEYSET })
		expect(refusals).toEqual([])
		expect(claimable).toHaveLength(3)
		expect(claimable.reduce((sum, entry) => sum + entry.amount, 0)).toBe(100)
		expect(claimable.every((entry) => entry.keysetId === KEYSET)).toBe(true)
	})

	test('an output for another key is refused by name, ours is still claimed', () => {
		const parsed = receipt({
			outputs: [out({ amount: 64 }), out({ amount: 32, recipient: K2, secret: p2pkSecret(K2) })],
		})
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K })
		expect(claimable).toHaveLength(1)
		expect(claimable[0].amount).toBe(64)
		expect(refusals).toHaveLength(1)
		expect(refusals[0].refusal).toBe(ARENA_CLAIM_REFUSAL_FOREIGN_KEY)
	})

	test('a malformed P2PK secret is refused', () => {
		const parsed = receipt({ outputs: [out({ secret: 'not-a-p2pk-secret' })] })
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K })
		expect(claimable).toEqual([])
		expect(refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_MALFORMED_P2PK])
	})

	test('a secret locked to another key behind our recipient is refused', () => {
		// The recipient field names us, but the lock inside is to K2 — the proof
		// would never be spendable by our key, so it is refused, not attempted.
		const parsed = receipt({ outputs: [out({ secret: p2pkSecret(K2) })] })
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K })
		expect(claimable).toEqual([])
		expect(refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_MALFORMED_P2PK])
	})

	test('a non-canonical / non-P2PK JSON secret is refused', () => {
		const parsed = receipt({ outputs: [out({ secret: JSON.stringify(['HTLC', { data: K }]) })] })
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K })
		expect(claimable).toEqual([])
		expect(refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_MALFORMED_P2PK])
	})

	test('a mismatched keyset is refused', () => {
		const parsed = receipt({ outputs: [out({ id: OTHER_KEYSET })] })
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K, expectedKeysetId: KEYSET })
		expect(claimable).toEqual([])
		expect(refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH])
	})

	test('an entry with no recipient or no amount is refused', () => {
		const parsed = receipt({ outputs: [out({ recipient: null }), out({ amount: null })] })
		const { claimable, refusals } = selectArenaReceiptClaim(parsed, { walletP2pk: K })
		expect(claimable).toEqual([])
		expect(refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_MALFORMED_P2PK, ARENA_CLAIM_REFUSAL_MALFORMED_P2PK])
	})
})

// =========================================================================
// Planning — no-op and at-most-once
// =========================================================================

describe('planArenaReceiptClaims', () => {
	test('a receipt with no outputs for this key is a no-op, not an error', () => {
		const otherKey = receipt({ outputs: [out({ recipient: K2, secret: p2pkSecret(K2) })] })
		const plan = planArenaReceiptClaims([otherKey], { walletP2pk: K, isClaimed: () => false })
		expect(plan.moves).toEqual([])
		// The entry for the other key is still named — refused, not silently dropped.
		expect(plan.refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_FOREIGN_KEY])
	})

	test('a second run over the same receipt claims nothing twice', () => {
		const parsed = receipt({ outputs: [out({ amount: 64 }), out({ amount: 32 })] })
		const first = planArenaReceiptClaims([parsed], { walletP2pk: K, isClaimed: () => false })
		expect(first.moves).toHaveLength(1)
		expect(first.moves[0].amount).toBe(96)

		// After the move is recorded, the same receipt yields no move at all.
		const claimed = new Set(first.moves.map((move) => move.moveKey))
		const second = planArenaReceiptClaims([parsed], { walletP2pk: K, isClaimed: (key) => claimed.has(key) })
		expect(second.moves).toEqual([])
		expect(second.refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED])
	})
})

// =========================================================================
// The service — the receive leg, the record, the mint refusal
// =========================================================================

/** A fake wallet source that holds its proofs, in the shape `auctionFunds` reads. */
function fakeWallet(proofs: Proof[]) {
	let held = proofs
	return {
		state: {
			dump: () => ({ proofs: [{ mint: MINT, proofs: held }] }),
			getProofs: (filter: { mint: string }) => (filter.mint === MINT ? held : []),
			update: async (update: { store: Proof[]; mint: string; destroy?: Proof[] }) => {
				const destroyed = new Set((update.destroy ?? []).map((proof) => proof.secret))
				held = [...held.filter((proof) => !destroyed.has(proof.secret)), ...update.store]
			},
		},
		getHeld: () => held,
	}
}

/** A fake mint client: answers the keyset list and mints fixed proofs on receive. */
function fakeMintAccess(opts: { serves: boolean; received?: Proof[] }) {
	return {
		cashuWalletForMint: async (_mintUrl: string) => ({
			cashuWallet: {
				mint: { getKeySets: async () => ({ keysets: opts.serves ? [{ id: KEYSET }] : [{ id: OTHER_KEYSET }] }) },
				receive: async () => opts.received ?? [{ id: KEYSET, amount: { toNumber: () => 96 }, secret: 'out', C: '02' + 'c'.repeat(64) }],
			},
		}),
	} as unknown as import('@sdk/commerce/payments/wallet/auctionFunds').AuctionFundsMintAccess
}

function fakeHost(over: Partial<ArenaReceiptClaimsHost> & { mint: ArenaReceiptClaimsHost['mint'] }): {
	host: ArenaReceiptClaimsHost
	getRecord: () => ArenaReceiptClaimRecord
} {
	let record: ArenaReceiptClaimRecord = []
	const host: ArenaReceiptClaimsHost = {
		getWallet: () => fakeWallet([]),
		isWalletReady: () => true,
		getWalletP2pk: () => K,
		getWalletPrivkey: (pubkey) => (pubkey === K ? K_PRIV : null),
		getExpectedMintUrl: () => MINT,
		getWalletMints: () => [MINT],
		getExpectedKeysetId: () => KEYSET,
		getClaimRecord: () => record,
		setClaimRecord: (next) => {
			record = next
		},
		refresh: async () => {},
		now: () => 1_800_000_000_000,
		...over,
	}
	return { host, getRecord: () => record }
}

describe('createArenaReceiptClaims — the money leg', () => {
	test("claims this key's move and records it so a second run claims nothing", async () => {
		const wallet = fakeWallet([])
		const parsed = receipt({ outputs: [out({ amount: 64 }), out({ amount: 32 })] })
		const { host, getRecord } = fakeHost({ mint: fakeMintAccess({ serves: true }) })
		host.getWallet = () => wallet

		const claims = createArenaReceiptClaims(host)
		const first = await claims.claimReceipts([parsed])
		expect(first.claimed).toHaveLength(1)
		expect(first.claimed[0].bidId).toBe('bid-1')
		expect(first.claimed[0].amount).toBe(96)
		// The move is recorded with the identity of the proofs spent.
		const record = getRecord()
		expect(record).toHaveLength(1)
		expect(record[0].moveKey).toBe('bid-1\u0000refund')
		expect(record[0].eventId).toBe(parsed.eventId)
		expect(record[0].spentSecrets).toHaveLength(2)

		const second = await claims.claimReceipts([parsed])
		expect(second.claimed).toEqual([])
		expect(second.refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_ALREADY_CLAIMED])
		// Still one record: nothing was written twice.
		expect(getRecord()).toHaveLength(1)
	})

	test('refuses a foreign mint before any receive', async () => {
		let received = 0
		const parsed = receipt({ outputs: [out({ amount: 64 })] })
		const mint = fakeMintAccess({ serves: true })
		const original = mint.cashuWalletForMint
		mint.cashuWalletForMint = async (url: string) => {
			const wallet = await original(url)
			wallet.cashuWallet.receive = async () => {
				received += 1
				return []
			}
			return wallet
		}
		// The app holds no params read and no mint that serves the keyset, so it
		// cannot name the mint the receipt moved at.
		const { host } = fakeHost({ mint })
		const run = await createArenaReceiptClaims({ ...host, getExpectedMintUrl: () => null, getWalletMints: () => [] }).claimReceipts([
			parsed,
		])
		expect(run.claimed).toEqual([])
		expect(run.refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_FOREIGN_MINT])
		expect(received).toBe(0)
	})

	test('refuses a mint that does not serve the receipt keyset', async () => {
		const parsed = receipt({ outputs: [out({ amount: 64 })] })
		const { host } = fakeHost({ mint: fakeMintAccess({ serves: false }) })
		const run = await createArenaReceiptClaims(host).claimReceipts([parsed])
		expect(run.claimed).toEqual([])
		expect(run.refusals.map((entry) => entry.refusal)).toEqual([ARENA_CLAIM_REFUSAL_FOREIGN_MINT])
	})

	test('does nothing when the wallet holds no key for the recipient', async () => {
		const parsed = receipt({ outputs: [out({ amount: 64 })] })
		const { host } = fakeHost({ mint: fakeMintAccess({ serves: true }) })
		const run = await createArenaReceiptClaims({ ...host, getWalletPrivkey: () => null }).claimReceipts([parsed])
		expect(run.claimed).toEqual([])
		expect(run.skipped).toBe(1)
	})
})

// =========================================================================
// The pre-state the wins surface renders — the same selection, pure
// =========================================================================

describe('arenaReceiptClaimStateFor — the claim state before any claim runs', () => {
	const moveKeyFor = (parsed: ParsedArenaReceipt) => `${parsed.bidId}\u0000${parsed.outcome}`
	const claimedRecord = (parsed: ParsedArenaReceipt): ArenaReceiptClaimRecord => [
		{
			moveKey: moveKeyFor(parsed),
			bidId: parsed.bidId,
			outcome: parsed.outcome,
			eventId: parsed.eventId,
			auctionId: parsed.auctionId,
			amount: 96,
			spentSecrets: ['s'],
			claimedAt: 1,
		},
	]

	test('a receipt with entries for this key is claimable, with the move amount', () => {
		const parsed = receipt({ outputs: [out({ amount: 64 }), out({ amount: 32 })] })
		const state = arenaReceiptClaimStateFor({ receipt: parsed, record: [], walletP2pk: K, walletMints: [MINT] })
		expect(state).toEqual({ kind: 'claimable', amountSats: 96, moveKey: moveKeyFor(parsed), keysetId: KEYSET })
	})

	test('a move already in the persisted record reads Claimed, never claimable', () => {
		const parsed = receipt({ outputs: [out({ amount: 64 })] })
		const state = arenaReceiptClaimStateFor({ receipt: parsed, record: claimedRecord(parsed), walletP2pk: K, walletMints: [MINT] })
		expect(state).toEqual({ kind: 'claimed' })
	})

	test('a receipt whose entries are all another key’s is refused foreign_key', () => {
		const parsed = receipt({ outputs: [out({ recipient: K2, secret: p2pkSecret(K2) })] })
		const state = arenaReceiptClaimStateFor({ receipt: parsed, record: [], walletP2pk: K, walletMints: [MINT] })
		expect(state.kind).toBe('refused')
		if (state.kind !== 'refused') return
		expect(state.refusal).toBe(ARENA_CLAIM_REFUSAL_FOREIGN_KEY)
	})

	test('a claimable move with no candidate mint is refused foreign_mint', () => {
		const parsed = receipt({ outputs: [out({ amount: 64 })] })
		const state = arenaReceiptClaimStateFor({ receipt: parsed, record: [], walletP2pk: K, walletMints: [] })
		expect(state.kind).toBe('refused')
		if (state.kind !== 'refused') return
		expect(state.refusal).toBe(ARENA_CLAIM_REFUSAL_FOREIGN_MINT)
	})

	test('a keyset the app does not expect is refused keyset_mismatch', () => {
		const parsed = receipt({ outputs: [out({ id: OTHER_KEYSET })] })
		const state = arenaReceiptClaimStateFor({
			receipt: parsed,
			record: [],
			walletP2pk: K,
			expectedKeysetId: KEYSET,
			walletMints: [MINT],
		})
		expect(state.kind).toBe('refused')
		if (state.kind !== 'refused') return
		expect(state.refusal).toBe(ARENA_CLAIM_REFUSAL_KEYSET_MISMATCH)
	})

	test('no receipt is stated as no-receipt, never as a claim or a refusal', () => {
		expect(arenaReceiptClaimStateFor({ receipt: null, record: [], walletP2pk: K, walletMints: [MINT] })).toEqual({ kind: 'no-receipt' })
	})

	test('an unknown wallet key offers no action', () => {
		const parsed = receipt({ outputs: [out({ amount: 64 })] })
		expect(arenaReceiptClaimStateFor({ receipt: parsed, record: [], walletP2pk: null, walletMints: [MINT] })).toEqual({
			kind: 'wallet-unavailable',
		})
	})
})
