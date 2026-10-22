/**
 * Tests for the extracted auction reclaim pair — the timelock refund of an unclaimed bid and
 * the throttled sweep, both now in `auctionFunds.ts` behind `AuctionReclaimHost`.
 *
 * This is a money path, so every test pins a decision the reclaim makes with sats: it refuses
 * before the timelock, it spends with the refund key the preference order resolves (bidder
 * record → pre-lock recovery record → the wallet's key map), it records the outcome and the
 * backoff, and it classifies a permanent mint refusal so the sweep gives up.
 *
 * No relay, no mint and no real Cashu token: the host and the mint are stand-ins, and the
 * tokens carry a caller-supplied mint URL so the receive never tries to decode them.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { Amount, type Proof, type Wallet } from '@cashu/cashu-ts'

import { authStore } from '../stores/auth'
import { persistPreLockRecoveryRecord, upsertBidderRecord } from '../auction/bidderRecords'
import {
	createAuctionReclaim,
	formatReclaimWaitSeconds,
	getAuctionReclaimReadyAt,
	AUCTION_RECLAIM_SKEW_BUFFER_SECONDS,
} from './auctionFunds'
import type { AuctionFundsWallet, AuctionReclaimHost } from './auctionFunds'
import type { PendingToken } from './types'

// ---------- localStorage polyfill (as in preLockRecoveryRecordBound.test.ts) ----------

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

const USER = 'f'.repeat(64)
const setAuthUser = (): void =>
	authStore.setState((s) => ({ ...s, user: { pubkey: USER } as unknown as NonNullable<typeof s.user>, isAuthenticated: true }))

beforeEach(() => {
	localStorage.clear()
	setAuthUser()
})

// ---------- fixtures ----------

const MINT = 'https://mint.example'
/** Real wall clock: the reclaim compares against `Date.now()`, so a fixed past epoch would
 *  make every "ready" token look future-locked. */
const NOW = Math.floor(Date.now() / 1000)
const WALLET_REFUND_KEY = 'aa'.repeat(32)
const BIDDER_REFUND_KEY = 'bb'.repeat(32)
const RECOVERY_REFUND_KEY = 'cc'.repeat(32)

const AUCTION_CONTEXT = (refundPubkey = '02' + 'a'.repeat(62)) => ({
	kind: 'auction_bid' as const,
	auctionEventId: '1'.repeat(64),
	sellerPubkey: 'a'.repeat(64),
	pathIssuerPubkey: 'b'.repeat(64),
	lockPubkey: '02' + 'c'.repeat(62),
	refundPubkey,
	locktime: NOW - 100,
})

const pendingToken = (overrides: Partial<PendingToken> = {}): PendingToken => ({
	id: 'p1',
	token: 'cashuB-dummy-token',
	amount: 21,
	mintUrl: MINT,
	createdAt: 0,
	status: 'pending',
	context: AUCTION_CONTEXT(),
	...overrides,
})

interface MintCall {
	token: string
	privkey?: string
}

const makeHost = (params: {
	tokens: PendingToken[]
	wallet?: AuctionFundsWallet | null
	ready?: boolean
	walletPrivkey?: string | null
	receiveFails?: Error
	overrides?: Partial<AuctionReclaimHost>
}) => {
	const mintCalls: MintCall[] = []
	const updates: { store: Proof[]; mint: string }[] = []
	const committed: PendingToken[][] = []
	let refreshCalls = 0
	let tokens = params.tokens

	const wallet: AuctionFundsWallet = {
		state: {
			dump: () => ({ proofs: [] }),
			getProofs: () => [],
			update: async (update) => {
				updates.push(update)
				return undefined
			},
		},
	}

	const host: AuctionReclaimHost = {
		getWallet: () => (params.wallet === undefined ? wallet : params.wallet),
		isWalletReady: () => params.ready ?? true,
		mint: {
			cashuWalletForMint: async () => ({
				cashuWallet: {
					receive: async (token: string, options: { privkey?: string }) => {
						mintCalls.push({ token, privkey: options?.privkey })
						if (params.receiveFails) throw params.receiveFails
						return [{ amount: Amount.from(21), id: '00', secret: 's', C: 'C' }] as unknown as Proof[]
					},
				} as unknown as Wallet,
				keysetId: undefined,
			}),
		},
		getWalletPrivkey: () => params.walletPrivkey ?? null,
		getWalletPrivkeyCount: () => 0,
		getPendingTokens: () => tokens,
		setPendingTokens: (next) => {
			committed.push(next)
			tokens = next
		},
		refresh: async () => {
			refreshCalls += 1
		},
		...params.overrides,
	}

	return { host, mintCalls, updates, committed, refreshCalls: () => refreshCalls }
}

// ---------- reclaimToken ----------

describe('reclaimToken', () => {
	test('refuses before the timelock expires, and touches nothing', async () => {
		const { host, mintCalls, committed } = makeHost({
			tokens: [pendingToken({ context: { ...AUCTION_CONTEXT(), locktime: NOW + 10_000 } })],
			walletPrivkey: WALLET_REFUND_KEY,
		})
		const reclaim = createAuctionReclaim(host)

		await expect(reclaim.reclaimToken('p1')).rejects.toThrow(/^Bid refund opens in /)
		expect(mintCalls).toHaveLength(0)
		expect(committed).toHaveLength(0)
	})

	test('throws when the wallet is not initialized', async () => {
		const { host } = makeHost({ tokens: [pendingToken()], wallet: null })
		await expect(createAuctionReclaim(host).reclaimToken('p1')).rejects.toThrow('Wallet not initialized')
	})

	test('throws for an unknown token id', async () => {
		const { host } = makeHost({ tokens: [pendingToken()] })
		await expect(createAuctionReclaim(host).reclaimToken('nope')).rejects.toThrow('Pending token not found')
	})

	test('spends with the wallet key when it is the only refund key, and marks the token reclaimed', async () => {
		const { host, mintCalls, committed, refreshCalls } = makeHost({
			tokens: [pendingToken()],
			walletPrivkey: WALLET_REFUND_KEY,
		})
		const reclaim = createAuctionReclaim(host)

		await reclaim.reclaimToken('p1')

		expect(mintCalls).toEqual([{ token: 'cashuB-dummy-token', privkey: WALLET_REFUND_KEY }])
		expect(committed.at(-1)?.[0]?.status).toBe('reclaimed')
		expect(committed.at(-1)?.[0]?.reclaimPermanentlyFailed).toBe(false)
		expect(refreshCalls()).toBe(1)
	})

	test("prefers the bidder record's refund key over the wallet's", async () => {
		const refundPubkey = AUCTION_CONTEXT().refundPubkey
		upsertBidderRecord({
			bidEventId: '2'.repeat(64),
			auctionRootEventId: '1'.repeat(64),
			auctionCoordinate: `30408:${'a'.repeat(64)}:x`,
			sellerPubkey: 'a'.repeat(64),
			p2pkXpub: 'xpub',
			derivationPath: "m/30408'/0'/0'/0/0",
			childPubkey: '02' + 'c'.repeat(62),
			refundPubkey,
			refundPrivateKey: BIDDER_REFUND_KEY,
			mintUrl: MINT,
			amount: 21,
			legLockedAmount: 21,
			prevBidEventId: null,
			locktime: NOW - 100,
			proofs: [],
			lockSecrets: [],
			proofYs: [],
			createdAt: 0,
			status: 'live',
		})
		const { host, mintCalls } = makeHost({ tokens: [pendingToken()], walletPrivkey: WALLET_REFUND_KEY })

		await createAuctionReclaim(host).reclaimToken('p1')

		expect(mintCalls[0]?.privkey).toBe(BIDDER_REFUND_KEY)
	})

	test('prefers the pre-lock recovery record over the wallet key when there is no bidder record', async () => {
		const refundPubkey = AUCTION_CONTEXT().refundPubkey
		persistPreLockRecoveryRecord({
			id: 'r1',
			createdAt: 0,
			auctionEventId: '1'.repeat(64),
			auctionCoordinates: `30408:${'a'.repeat(64)}:x`,
			sellerPubkey: 'a'.repeat(64),
			p2pkXpub: 'xpub',
			derivationPath: "m/30408'/0'/0'/0/0",
			childPubkey: '02' + 'c'.repeat(62),
			refundPubkey,
			refundPrivateKey: RECOVERY_REFUND_KEY,
			mintUrl: MINT,
			legLockAmount: 21,
			cumulativeAmount: 21,
			locktime: NOW - 100,
			prevBidEventId: null,
		})
		const { host, mintCalls } = makeHost({ tokens: [pendingToken()], walletPrivkey: WALLET_REFUND_KEY })

		await createAuctionReclaim(host).reclaimToken('p1')

		expect(mintCalls[0]?.privkey).toBe(RECOVERY_REFUND_KEY)
	})

	test('an auction token with no refund key anywhere is marked permanently failed and never reaches the mint', async () => {
		const { host, mintCalls, committed } = makeHost({ tokens: [pendingToken()], walletPrivkey: null })
		const reclaim = createAuctionReclaim(host)

		await expect(reclaim.reclaimToken('p1')).rejects.toThrow(/does not hold the refund private key/)
		expect(mintCalls).toHaveLength(0)
		expect(committed).toHaveLength(1)
		expect(committed[0][0]?.reclaimPermanentlyFailed).toBe(true)
		expect(committed[0][0]?.reclaimAttempts).toBe(1)
	})

	test('a manual retry does not set the permanent flag on a missing refund key', async () => {
		const { host, committed } = makeHost({ tokens: [pendingToken()], walletPrivkey: null })

		await expect(createAuctionReclaim(host).reclaimToken('p1', { manual: true })).rejects.toThrow(/does not hold the refund private key/)

		expect(committed[0][0]?.reclaimPermanentlyFailed).toBe(false)
	})

	test('a permanent mint refusal is recorded as permanent and rethrown', async () => {
		const { host, committed } = makeHost({
			tokens: [pendingToken()],
			walletPrivkey: WALLET_REFUND_KEY,
			receiveFails: new Error('witness is missing for p2pk signature'),
		})
		const reclaim = createAuctionReclaim(host)

		await expect(reclaim.reclaimToken('p1')).rejects.toThrow('witness is missing for p2pk signature')
		expect(committed.at(-1)?.[0]?.reclaimPermanentlyFailed).toBe(true)
		expect(committed.at(-1)?.[0]?.reclaimAttempts).toBe(1)
	})

	test('a manual retry clears the permanent flag even on a permanent mint refusal', async () => {
		const { host, committed } = makeHost({
			tokens: [pendingToken()],
			walletPrivkey: WALLET_REFUND_KEY,
			receiveFails: new Error('witness is missing for p2pk signature'),
		})

		await expect(createAuctionReclaim(host).reclaimToken('p1', { manual: true })).rejects.toThrow('witness is missing')

		expect(committed.at(-1)?.[0]?.reclaimPermanentlyFailed).toBe(false)
	})
})

// ---------- autoReclaimTimelockedBids ----------

describe('autoReclaimTimelockedBids', () => {
	test('does nothing when the wallet is absent or not ready', async () => {
		const absent = makeHost({ tokens: [pendingToken()], wallet: null, walletPrivkey: WALLET_REFUND_KEY })
		await createAuctionReclaim(absent.host).autoReclaimTimelockedBids()
		expect(absent.mintCalls).toHaveLength(0)

		const notReady = makeHost({ tokens: [pendingToken()], ready: false, walletPrivkey: WALLET_REFUND_KEY })
		await createAuctionReclaim(notReady.host).autoReclaimTimelockedBids()
		expect(notReady.mintCalls).toHaveLength(0)
	})

	test('sweeps a ready token and marks it reclaimed', async () => {
		const { host, mintCalls, committed } = makeHost({ tokens: [pendingToken()], walletPrivkey: WALLET_REFUND_KEY })

		await createAuctionReclaim(host).autoReclaimTimelockedBids()

		expect(mintCalls).toHaveLength(1)
		expect(committed.at(-1)?.[0]?.status).toBe('reclaimed')
	})

	test('skips a token still inside its backoff window', async () => {
		const token = pendingToken({ reclaimAttempts: 1, lastReclaimAttemptAt: Math.floor(Date.now() / 1000) })
		const { host, mintCalls } = makeHost({ tokens: [token], walletPrivkey: WALLET_REFUND_KEY })

		await createAuctionReclaim(host).autoReclaimTimelockedBids()

		expect(mintCalls).toHaveLength(0)
	})

	test('skips a token the sweep already gave up on', async () => {
		const token = pendingToken({ reclaimPermanentlyFailed: true })
		const { host, mintCalls } = makeHost({ tokens: [token], walletPrivkey: WALLET_REFUND_KEY })

		await createAuctionReclaim(host).autoReclaimTimelockedBids()

		expect(mintCalls).toHaveLength(0)
	})

	test('is throttled to one sweep per interval', async () => {
		const { host, mintCalls } = makeHost({ tokens: [pendingToken()], walletPrivkey: WALLET_REFUND_KEY })
		const reclaim = createAuctionReclaim(host)

		await reclaim.autoReclaimTimelockedBids()
		await reclaim.autoReclaimTimelockedBids()

		expect(mintCalls).toHaveLength(1)
	})
})

// ---------- moved helpers ----------

describe('reclaim timing helpers', () => {
	test('the ready-at always adds the skew buffer on top of the context locktime', () => {
		expect(getAuctionReclaimReadyAt('not-a-token', 500)).toBe(500 + AUCTION_RECLAIM_SKEW_BUFFER_SECONDS)
	})

	test('formats the wait label by magnitude', () => {
		expect(formatReclaimWaitSeconds(0)).toBe('a moment')
		expect(formatReclaimWaitSeconds(30)).toBe('30s')
		expect(formatReclaimWaitSeconds(90)).toBe('2m')
		expect(formatReclaimWaitSeconds(7200)).toBe('2h')
	})
})
