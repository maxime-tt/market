/**
 * Tests for the extracted auction lock + settlement cluster — `lockAuctionBidFunds`,
 * `receiveLockedEcash` and `loadAuctionMintKeysets`, now in `auctionFunds.ts` behind
 * `AuctionLockHost` / `AuctionReceiveHost`.
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
 *    write is classified `pendingTokenPersisted: false`;
 *  - the settlement receipt — the mint receive is asked with the caller's spending key.
 *
 * No relay, no mint, no network: the host and the mint are stand-ins, and the settlement tests
 * pass a mint URL so the receive never tries to decode the token. The P2PK secret in the
 * fixtures is built with the REAL `@cashu/cashu-ts` `OutputData.createSingleP2PKData`, so the
 * construction assertion is against the same builder the wallet uses, not a hand-rolled copy.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { Amount, OutputData, type MintKeyset, type P2PKOptions, type Proof, type Wallet } from '@cashu/cashu-ts'

import { AuctionBidLockMutationPossibleError, createAuctionLock, createAuctionReceipt, loadAuctionMintKeysets } from './auctionFunds'
import type {
	AuctionFundsMintAccess,
	AuctionFundsWallet,
	AuctionLockHost,
	AuctionLockWallet,
	AuctionReceiveHost,
	LockAuctionBidFundsParams,
} from './auctionFunds'
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
/**
 * Valid compressed secp256k1 points. cashu-ts v5's P2PK output builder validates that a lock
 * pubkey is really on the curve, so these are the generator `G` (02-prefixed) and its negation
 * `-G` (03-prefixed, same x) rather than arbitrary hex.
 */
const GENERATOR_X = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const LOCK_PUBKEY = '02' + GENERATOR_X
const REFUND_PUBKEY = '03' + GENERATOR_X
/** A different valid pubkey (2G), for the wrong-key mint-misbehaviour case. */
const OTHER_PUBKEY = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
const LOCKTIME = Math.floor(Date.now() / 1000) + 3_600

const inputProof = (amount: number): Proof => ({
	id: KEYSET_ID,
	amount: Amount.from(amount),
	secret: 'input-secret',
	C: '02' + '7'.repeat(64),
	dleq: { e: 'aa', s: 'bb', r: 'cc' },
})

/** The real cashu-ts P2PK secret for the options the module asks the mint for. */
const p2pkSecretFor = (p2pk: P2PKOptions): string => new TextDecoder().decode(OutputData.createSingleP2PKData(p2pk, 500, KEYSET_ID).secret)

interface SendCall {
	amount: number
	proofs: Proof[]
	p2pk?: P2PKOptions
}

/**
 * A stub mint whose `send` echoes the module's v5 P2PK *output* options into a real cashu-ts
 * secret. cashu-ts v5 retired `Wallet.swap`; the lock now mints its fresh P2PK outputs through
 * `Wallet.send(amount, proofs, config, { send: { type: 'p2pk', options } })`.
 */
const makeMint = (options: { returnPubkey?: string; sendError?: Error; dropDleq?: boolean } = {}) => {
	const sendCalls: SendCall[] = []
	const cashuWallet = {
		send: async (
			amount: number,
			proofs: Proof[],
			_config?: unknown,
			outputConfig?: { send?: { type: string; options: P2PKOptions } },
		): Promise<{ send: Proof[]; keep: Proof[] }> => {
			const p2pk = outputConfig?.send?.type === 'p2pk' ? outputConfig.send.options : undefined
			sendCalls.push({ amount, proofs, p2pk })
			if (options.sendError) throw options.sendError
			if (!p2pk) throw new Error('test send called without p2pk output options')
			const effective: P2PKOptions = { ...p2pk, data: options.returnPubkey ?? p2pk.data }
			const locked: Proof = {
				id: KEYSET_ID,
				amount: Amount.from(amount),
				secret: p2pkSecretFor(effective),
				C: '02' + '7'.repeat(64),
				...(options.dropDleq ? {} : { dleq: { e: 'aa', s: 'bb', r: 'cc' } }),
			}
			return { send: [locked], keep: [] }
		},
	} as unknown as Wallet
	const mint: AuctionFundsMintAccess = {
		cashuWalletForMint: async () => ({ cashuWallet, keysetId: KEYSET_ID }),
	}
	return { mint, sendCalls }
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
		const { mint, sendCalls } = makeMint()
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
		expect(sendCalls).toHaveLength(1)
		expect(sendCalls[0].amount).toBe(500)
		expect(sendCalls[0].p2pk).toEqual({
			kind: 'P2PK',
			data: LOCK_PUBKEY,
			locktime: LOCKTIME,
			refundKeys: [REFUND_PUBKEY],
		})
		// No requiredSignatures override — NUT-11 1-of-1 default.
		expect('requiredSignatures' in (sendCalls[0].p2pk as object)).toBe(false)

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
		const { mint, sendCalls } = makeMint()
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		await expect(createAuctionLock(host).lockAuctionBidFunds(baseParams({ amount: 1 }))).rejects.toThrow(/at least/)
		expect(sendCalls).toHaveLength(0)
	})

	test('rejects a not-ready wallet before any mint call', async () => {
		const { mint, sendCalls } = makeMint()
		const { host } = makeLockHost({ mint, ready: false, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })

		await expect(createAuctionLock(host).lockAuctionBidFunds(baseParams())).rejects.toThrow('NIP-60 wallet not ready')
		expect(sendCalls).toHaveLength(0)
	})

	test('preferredMints are walked in order and the first funded one wins', async () => {
		const { mint, sendCalls } = makeMint()
		const spent = inputProof(1_000)
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 0, [OTHER_MINT]: 1_000 } } })
		const real = makeWallet({ [OTHER_MINT]: [spent] })

		const result = await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(
			baseParams({ preferredMints: [MINT, OTHER_MINT] }),
		)

		expect(result.mintUrl).toBe(OTHER_MINT)
		expect(sendCalls).toHaveLength(1)
	})

	test('no trusted mint with enough balance throws a raw error listing the balances', async () => {
		const { mint, sendCalls } = makeMint()
		const { host } = makeLockHost({ mint, balances: { totalBalance: 100, mintBalances: { [MINT]: 100 } } })

		await expect(createAuctionLock(host).lockAuctionBidFunds(baseParams({ preferredMints: [MINT] }))).rejects.toThrow(
			/No trusted mint has 500 sats/,
		)
		expect(sendCalls).toHaveLength(0)
	})

	test('falls back to the wallet default mint when no preferred list is given', async () => {
		const { mint, sendCalls } = makeMint()
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
		expect(sendCalls).toHaveLength(1)
	})

	test('normalizes a padded, upper-case refund and lock pubkey before locking', async () => {
		const { mint, sendCalls } = makeMint()
		const spent = inputProof(1_000)
		const { host } = makeLockHost({ mint, balances: { totalBalance: 1_000, mintBalances: { [MINT]: 1_000 } } })
		const real = makeWallet({ [MINT]: [spent] })

		const result = await createAuctionLock({ ...host, getWallet: () => real.wallet }).lockAuctionBidFunds(
			baseParams({
				refundPubkey: `  ${('03' + GENERATOR_X).toUpperCase()}  `,
				lockPubkey: `  ${('02' + GENERATOR_X).toUpperCase()}  `,
			}),
		)

		expect(result.refundPubkey).toBe(REFUND_PUBKEY)
		expect(result.lockPubkey).toBe(LOCK_PUBKEY)
		expect(sendCalls[0].p2pk?.refundKeys).toEqual([REFUND_PUBKEY])
		expect(sendCalls[0].p2pk?.data).toBe(LOCK_PUBKEY)
	})
})

// ---------- lock: mutation-possible classification ----------

describe('lockAuctionBidFunds — the irreversible mint boundary', () => {
	test('a wrong-key lock outcome is mutation-possible WITH the durable-observation flag set', async () => {
		const { mint } = makeMint({ returnPubkey: OTHER_PUBKEY })
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
		const { mint, sendCalls } = makeMint()
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
		expect(sendCalls).toHaveLength(1)
	})

	test('a swap failure is wrapped with the fields a caller needs to reason about the leg', async () => {
		const { mint } = makeMint({ sendError: new Error('mint 503') })
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

// ---------- settlement: receiveLockedEcash ----------

describe('receiveLockedEcash — the settlement spend', () => {
	const makeReceiveHost = (params: { wallet?: AuctionFundsWallet | null; receiveError?: Error } = {}) => {
		const receiveCalls: { token: string; privkey?: string; keysetId?: string }[] = []
		let refreshCalls = 0
		const wallet: AuctionFundsWallet = {
			state: {
				dump: () => ({ proofs: [] }),
				getProofs: () => [],
				update: async () => undefined,
			},
		}
		const cashuWallet = {
			receive: async (token: string, options: { privkey?: string; keysetId?: string }) => {
				receiveCalls.push({ token, privkey: options?.privkey, keysetId: options?.keysetId })
				if (params.receiveError) throw params.receiveError
				return [{ id: KEYSET_ID, amount: Amount.from(500), secret: 's', C: '02' + '7'.repeat(64) }] as unknown as Proof[]
			},
		} as unknown as Wallet
		const host: AuctionReceiveHost = {
			getWallet: () => (params.wallet === null ? null : (params.wallet ?? wallet)),
			mint: { cashuWalletForMint: async () => ({ cashuWallet, keysetId: KEYSET_ID }) },
			refresh: async () => {
				refreshCalls += 1
			},
		}
		return { host, receiveCalls, refreshCalls: () => refreshCalls }
	}

	test('with no wallet it warns and returns false without touching the mint', async () => {
		const { host, receiveCalls, refreshCalls } = makeReceiveHost({ wallet: null })
		const ok = await createAuctionReceipt(host).receiveLockedEcash('cashuB-token', 'aa'.repeat(32), MINT)
		expect(ok).toBe(false)
		expect(receiveCalls).toHaveLength(0)
		expect(refreshCalls()).toBe(0)
	})

	test('spends with the caller-supplied key and refreshes', async () => {
		const { host, receiveCalls, refreshCalls } = makeReceiveHost()
		const ok = await createAuctionReceipt(host).receiveLockedEcash('cashuB-token', 'aa'.repeat(32), MINT)
		expect(ok).toBe(true)
		expect(receiveCalls).toEqual([{ token: 'cashuB-token', privkey: 'aa'.repeat(32), keysetId: KEYSET_ID }])
		expect(refreshCalls()).toBe(1)
	})

	test('a mint failure propagates unchanged (the caller owns the leg outcome)', async () => {
		const { host, refreshCalls } = makeReceiveHost({ receiveError: new Error('witness is missing for p2pk signature') })
		await expect(createAuctionReceipt(host).receiveLockedEcash('cashuB-token', 'aa'.repeat(32), MINT)).rejects.toThrow(
			'witness is missing for p2pk signature',
		)
		expect(refreshCalls()).toBe(0)
	})
})

// ---------- loadAuctionMintKeysets ----------

describe('loadAuctionMintKeysets', () => {
	test('returns the mint keysets', async () => {
		const keysets = [{ id: KEYSET_ID }] as unknown as MintKeyset[]
		const mint: AuctionFundsMintAccess = {
			cashuWalletForMint: async () => ({
				cashuWallet: { mint: { getKeySets: async () => ({ keysets }) } } as unknown as Wallet,
				keysetId: KEYSET_ID,
			}),
		}
		await expect(loadAuctionMintKeysets(mint, MINT)).resolves.toEqual(keysets)
	})

	test('returns an empty array when the mint call fails', async () => {
		const mint: AuctionFundsMintAccess = {
			cashuWalletForMint: async () => {
				throw new Error('mint unreachable')
			},
		}
		await expect(loadAuctionMintKeysets(mint, MINT)).resolves.toEqual([])
	})
})
