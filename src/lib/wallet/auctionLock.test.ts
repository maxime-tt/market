/**
 * Tests for the extracted auction lock — `lockAuctionBidFunds`, now in `auctionFunds.ts` behind
 * `AuctionLockHost`.
 *
 * This is money handling, so the tests pin the decisions that move sats:
 *
 *  - the P2PK lock construction — the swap is asked for a 1-of-1 lock to the path-oracle
 *    pubkey with the given locktime and refund key, and the secret the real cashu-ts builder
 *    produces from those options carries exactly `data` (lock key), a `locktime` tag and a
 *    `refund` tag, with no `n_sigs` (1-of-1);
 *  - the four-step mint-resolution order and the pre-mint validation errors (raw, retryable);
 *  - the durable-observation ordering — the STRICT pending-token write happens BEFORE the
 *    post-swap P2PK/DLEQ checks, so a bad-key leg is still reclaim-eligible, and a failed
 *    write is classified `pendingTokenPersisted: false`.
 *
 * No relay, no mint, no network: the host and the mint are stand-ins. The P2PK secret in the
 * fixtures is built with the REAL `@cashu/cashu-ts` `OutputData.createSingleP2PKData`, so the
 * construction assertion is against the same builder the wallet uses, not a hand-rolled copy.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { OutputData, type CashuWallet, type Proof } from '@cashu/cashu-ts'

import { AuctionBidLockMutationPossibleError, createAuctionLock } from './auctionFunds'
import type { AuctionFundsMintAccess, AuctionLockHost, AuctionLockWallet, LockAuctionBidFundsParams } from './auctionFunds'
import type { PendingToken } from './types'

// ---------- localStorage polyfill (the inherited modules read it) ----------

const installLocalStoragePolyfill = (): void => {
	if (typeof globalThis.localStorage !== 'undefined') return
	const store = new Map<string, string>()
	;(globalThis as { localStorage: Storage }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size
		},
	}
}
installLocalStoragePolyfill()

beforeEach(() => localStorage.clear())

// ---------- fixtures ----------

const MINT = 'https://mint.example'
const OTHER_MINT = 'https://other.example'
const KEYSET_ID = '00' + '1'.repeat(14)
const LOCK_PUBKEY = '02' + 'c'.repeat(64)
const REFUND_PUBKEY = '03' + 'e'.repeat(64)
const LOCKTIME = Math.floor(Date.now() / 1000) + 3_600

const inputProof = (amount: number): Proof => ({
	id: KEYSET_ID,
	amount,
	secret: 'input-secret',
	C: '02' + '7'.repeat(64),
	dleq: { e: 'aa', s: 'bb', r: 'cc' },
})

/** The real cashu-ts P2PK secret for the options the module asks the swap for. */
const p2pkSecretFor = (p2pk: { pubkey: string | string[]; locktime?: number; refundKeys?: string[] }): string =>
	new TextDecoder().decode(OutputData.createSingleP2PKData(p2pk, 500, KEYSET_ID).secret)

interface SwapCall {
	amount: number
	proofs: Proof[]
	p2pk?: { pubkey: string | string[]; locktime?: number; refundKeys?: string[]; requiredSignatures?: number }
}

/** A stub mint whose `swap` echoes the module's P2PK options into a real cashu-ts secret. */
const makeMint = (options: { returnPubkey?: string; swapError?: Error; dropDleq?: boolean } = {}) => {
	const swapCalls: SwapCall[] = []
	const cashuWallet = {
		swap: async (amount: number, proofs: Proof[], swapOptions?: { p2pk?: SwapCall['p2pk'] }): Promise<{ send: Proof[]; keep: Proof[] }> => {
			swapCalls.push({ amount, proofs, p2pk: swapOptions?.p2pk })
			if (options.swapError) throw options.swapError
			const p2pk = swapOptions?.p2pk
			if (!p2pk) throw new Error('test swap called without p2pk options')
			const effective = { ...p2pk, pubkey: options.returnPubkey ?? p2pk.pubkey }
			const locked: Proof = {
				id: KEYSET_ID,
				amount,
				secret: p2pkSecretFor(effective),
				C: '02' + '7'.repeat(64),
				...(options.dropDleq ? {} : { dleq: { e: 'aa', s: 'bb', r: 'cc' } }),
			}
			return { send: [locked], keep: [] }
		},
	} as unknown as CashuWallet
	const mint: AuctionFundsMintAccess = {
		cashuWalletForMint: async () => ({ cashuWallet, keysetId: KEYSET_ID }),
	}
	return { mint, swapCalls }
}

interface Update extends Record<string, unknown> {
	mint: string
	store: Proof[]
	destroy?: Proof[]
}

const makeWallet = (proofsByMint: Record<string, Proof[]>) => {
	const updates: Update[] = []
	let publishCalls = 0
	const wallet: AuctionLockWallet = {
		state: {
			dump: () => ({ proofs: [] }),
			getProofs: (filter: { mint: string }) => proofsByMint[filter.mint] ?? [],
			update: async (update) => {
				updates.push(update as Update)
				return undefined
			},
		},
		publish: async () => {
			publishCalls += 1
		},
	}
	return { wallet, updates, publishCalls: () => publishCalls }
}

const baseParams = (overrides: Partial<LockAuctionBidFundsParams> = {}): LockAuctionBidFundsParams => ({
	amount: 500,
	preferredMints: [MINT],
	locktime: LOCKTIME,
	refundPubkey: REFUND_PUBKEY,
	lockPubkey: LOCK_PUBKEY,
	auctionEventId: '1'.repeat(64),
	auctionCoordinates: `30408:${'2'.repeat(64)}:auction-1`,
	sellerPubkey: '2'.repeat(64),
	derivationPath: 'm/1/2/3',
	childPubkey: LOCK_PUBKEY,
	...overrides,
})

interface MakeLockHostParams {
	wallet?: AuctionLockWallet | null
	ready?: boolean
	balances?: { totalBalance: number; mintBalances: Record<string, number> }
	defaultMint?: string | null
	tokens?: PendingToken[]
	/** Simulate the STRICT storage write failing (quota, etc.). */
	strictThrows?: boolean
	mint: AuctionFundsMintAccess
}

const makeLockHost = (params: MakeLockHostParams) => {
	let tokens = params.tokens ?? []
	const committed: PendingToken[][] = []
	const balanceWrites: { balance: number; mintBalances: Record<string, number> }[] = []

	const wallet: AuctionLockWallet = params.wallet === undefined || params.wallet === null ? makeWallet({}).wallet : params.wallet

	const host: AuctionLockHost = {
		getWallet: () => (params.wallet === null ? null : wallet),
		isWalletReady: () => params.ready ?? true,
		mint: params.mint,
		getBalances: () => params.balances ?? { totalBalance: 0, mintBalances: {} },
		getDefaultMint: () => params.defaultMint ?? null,
		getPendingTokens: () => tokens,
		setPendingTokens: (next) => {
			if (params.strictThrows) throw new Error('QuotaExceededError: setItem failed')
			committed.push(next)
			tokens = next
		},
		setWalletBalances: (update) => {
			balanceWrites.push(update)
		},
	}

	return { host, committed, balanceWrites }
}

// ---------- lock: P2PK construction ----------

describe('lockAuctionBidFunds — the P2PK lock construction', () => {
	test('asks the mint for a 1-of-1 lock to the path-oracle pubkey with the locktime and refund key', async () => {
		const { mint, swapCalls } = makeMint()
		const spent = inputProof(1_000)
		const { host, committed, balanceWrites } = makeLockHost({
			balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } },
			mint,
		})
		// A wallet that actually holds the input proof so selection has something to spend.
		const real = makeWallet({ [MINT]: [spent] })
		const lockHost: AuctionLockHost = { ...host, getWallet: () => real.wallet }

		const result = await createAuctionLock(lockHost).lockAuctionBidFunds(baseParams())

		// 1-of-1 P2PK, exactly the store's construction: lock pubkey, locktime, refund key.
		expect(swapCalls).toHaveLength(1)
		expect(swapCalls[0].amount).toBe(500)
		expect(swapCalls[0].p2pk).toEqual({
			pubkey: LOCK_PUBKEY,
			locktime: LOCKTIME,
			refundKeys: [REFUND_PUBKEY],
		})
		// No requiredSignatures override — NUT-11 1-of-1 default.
		expect('requiredSignatures' in (swapCalls[0].p2pk as object)).toBe(false)

		// The secret the real cashu-ts builder produces from those options.
		const secret = JSON.parse(result.proofs[0].secret) as [string, { data: string; tags: string[][] }]
		expect(secret[0]).toBe('P2PK')
		expect(secret[1].data).toBe(LOCK_PUBKEY)
		expect(secret[1].tags).toContainEqual(['locktime', String(LOCKTIME)])
		expect(secret[1].tags).toContainEqual(['refund', REFUND_PUBKEY])
		// 1-of-1: no n_sigs tag.
		expect(secret[1].tags.some((tag) => tag[0] === 'n_sigs')).toBe(false)

		// The result carries the lock identity and the money amounts.
		expect(result.amount).toBe(500)
		expect(result.mintUrl).toBe(MINT)
		expect(result.lockPubkey).toBe(LOCK_PUBKEY)
		expect(result.locktime).toBe(LOCKTIME)
		expect(result.refundPubkey).toBe(REFUND_PUBKEY)
		expect(result.keyScheme).toBe('hd_p2pk')
		expect(result.childPubkey).toBe(LOCK_PUBKEY)
		expect(result.commitment).toHaveLength(64)

		// Durable observation: the STRICT pending token is written before returning.
		expect(committed).toHaveLength(1)
		expect(committed[0][0].amount).toBe(500)
		expect(committed[0][0].status).toBe('pending')
		expect(committed[0][0].context?.kind).toBe('auction_bid')
		expect(committed[0][0].context?.locktime).toBe(LOCKTIME)

		// The spent inputs are destroyed locally, and the store's balance view is written back.
		expect(real.updates).toEqual([{ mint: MINT, store: [], destroy: [spent] }])
		expect(real.publishCalls()).toBe(1)
		expect(balanceWrites).toHaveLength(1)
	})
})

// ---------- lock: mint resolution + pre-mint validation ----------

describe('lockAuctionBidFunds — mint resolution and pre-mint validation', () => {
	test('rejects an amount below the auction leg minimum before any mint call', async () => {
		const { mint, swapCalls } = makeMint()
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		await expect(createAuctionLock(host).lockAuctionBidFunds(baseParams({ amount: 1 }))).rejects.toThrow(/at least/)
		expect(swapCalls).toHaveLength(0)
	})

	test('rejects a not-ready wallet before any mint call', async () => {
		const { mint, swapCalls } = makeMint()
		const { host } = makeLockHost({ mint, ready: false, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		await expect(createAuctionLock(host).lockAuctionBidFunds(baseParams())).rejects.toThrow('NIP-60 wallet not ready')
		expect(swapCalls).toHaveLength(0)
	})

	test('preferredMints are walked in order and the first funded one wins', async () => {
		const { mint, swapCalls } = makeMint()
		const spent = inputProof(1_000)
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 0, [OTHER_MINT]: 1_000 } } })
		const real = makeWallet({ [OTHER_MINT]: [spent] })

		const result = await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(
			baseParams({ preferredMints: [MINT, OTHER_MINT] }),
		)

		expect(result.mintUrl).toBe(OTHER_MINT)
		expect(swapCalls).toHaveLength(1)
	})

	test('no trusted mint with enough balance throws a raw error listing the balances', async () => {
		const { mint, swapCalls } = makeMint()
		const { host } = makeLockHost({ mint, balances: { totalBalance: 100, mintBalances: { [MINT]: 100 } } })

		await expect(createAuctionLock(host).lockAuctionBidFunds(baseParams({ preferredMints: [MINT] }))).rejects.toThrow(
			/No trusted mint has 500 sats/,
		)
		expect(swapCalls).toHaveLength(0)
	})

	test('falls back to the wallet default mint when no preferred list is given', async () => {
		const { mint, swapCalls } = makeMint()
		const spent = inputProof(1_000)
		const { host } = makeLockHost({
			mint,
			defaultMint: MINT,
			balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } },
		})
		const real = makeWallet({ [MINT]: [spent] })

		const result = await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(
			baseParams({ preferredMints: undefined }),
		)

		expect(result.mintUrl).toBe(MINT)
		expect(swapCalls).toHaveLength(1)
	})

	test('normalizes a padded, upper-case refund and lock pubkey before locking', async () => {
		const { mint, swapCalls } = makeMint()
		const spent = inputProof(1_000)
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })
		const real = makeWallet({ [MINT]: [spent] })

		const result = await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(
			baseParams({
				refundPubkey: `  ${'03' + 'E'.repeat(64)}  `,
				lockPubkey: `  ${'02' + 'C'.repeat(64)}  `,
			}),
		)

		expect(result.refundPubkey).toBe('03' + 'e'.repeat(64))
		expect(result.lockPubkey).toBe('02' + 'c'.repeat(64))
		expect(swapCalls[0].p2pk?.refundKeys).toEqual(['03' + 'e'.repeat(64)])
		expect(swapCalls[0].p2pk?.pubkey).toBe('02' + 'c'.repeat(64))
	})
})

// ---------- lock: mutation-possible classification ----------

describe('lockAuctionBidFunds — the irreversible mint boundary', () => {
	test('a wrong-key lock outcome is mutation-possible WITH the durable-observation flag set', async () => {
		const { mint } = makeMint({ returnPubkey: '02' + 'd'.repeat(64) })
		const spent = inputProof(1_000)
		const real = makeWallet({ [MINT]: [spent] })
		const { host, committed } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		let caught: unknown
		try {
			await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(baseParams())
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(AuctionBidLockMutationPossibleError)
		const err = caught as AuctionBidLockMutationPossibleError
		expect((err.cause as Error).message).toContain('wrong P2PK pubkey')
		// The STRICT pending-token write ran BEFORE the assert → the leg is reclaim-eligible.
		expect(err.pendingTokenPersisted).toBe(true)
		expect(committed).toHaveLength(1)
	})

	test('a missing DLEQ on the freshly issued output fails closed after the durable write', async () => {
		const { mint } = makeMint({ dropDleq: true })
		const spent = inputProof(1_000)
		const real = makeWallet({ [MINT]: [spent] })
		const { host, committed } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		let caught: unknown
		try {
			await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(baseParams())
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(AuctionBidLockMutationPossibleError)
		expect((caught as AuctionBidLockMutationPossibleError).pendingTokenPersisted).toBe(true)
		expect(committed).toHaveLength(1)
	})

	test('a failed STRICT pending-token write is mutation-possible WITHOUT the flag (record-only leg)', async () => {
		const { mint, swapCalls } = makeMint()
		const spent = inputProof(1_000)
		const real = makeWallet({ [MINT]: [spent] })
		const { host } = makeLockHost({
			mint,
			balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } },
			strictThrows: true,
		})

		let caught: unknown
		try {
			await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(baseParams())
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(AuctionBidLockMutationPossibleError)
		const err = caught as AuctionBidLockMutationPossibleError
		expect(err.pendingTokenPersisted).toBe(false)
		expect((err.cause as Error).message).toContain('QuotaExceededError')
		// The swap ran exactly once — no hidden retry.
		expect(swapCalls).toHaveLength(1)
	})

	test('a swap failure is wrapped with the fields a caller needs to reason about the leg', async () => {
		const { mint } = makeMint({ swapError: new Error('mint 503') })
		const spent = inputProof(1_000)
		const real = makeWallet({ [MINT]: [spent] })
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		let caught: unknown
		try {
			await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(baseParams())
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(AuctionBidLockMutationPossibleError)
		const err = caught as AuctionBidLockMutationPossibleError
		expect(err.mintUrl).toBe(MINT)
		expect(err.amount).toBe(500)
		expect(err.lockPubkey).toBe(LOCK_PUBKEY)
		expect(err.refundPubkey).toBe(REFUND_PUBKEY)
		expect(err.locktime).toBe(LOCKTIME)
		expect(err.pendingTokenPersisted).toBe(false)
	})
})
