/**
 * `scripts/auctions/live-funded-bid.test.ts` — the live funded-bid end-to-end.
 *
 * ## What this proves
 *
 * That a bid **assembled from the relay-read escrow terms** is accepted by
 * **consensus**: the chain's `checkSigAllLock` validates the escrow lock against
 * its own committed `Params.GroupKey`, so a bid that reaches committed state
 * proves the lock was built from the same FROST group key the validators hold —
 * the silent-stranding class this whole seam exists to prevent.
 *
 * It drives the app's own paths, not re-implementations:
 *
 * 1. `platform/web/auctions/relay/arenaParamsRead.ts` reads the escrow terms
 *    (kind 1448, `arena.params.v1`) from the relay;
 * 2. `arenaAuctionCreate.ts` publishes a kind-1440 lot from a fresh seller
 *    identity, and the chain's `/api/state` is polled until the coordinate
 *    `1440:<seller>:<d>` is committed;
 * 3. `arenaBidFund.ts` + `arenaBidFunding.ts` derive the locktime floor with
 *    `arenaBidLocktimeFloor`, lock the escrow at the test mint to the
 *    **relay-read** `group_key`, and build the pre-signed settle/refund
 *    templates;
 * 4. `arenaBidPublish.ts` publishes the kind-1441 bid, and `/api/state` is
 *    polled until the bid is committed **by event id**.
 *
 * ## Why it lives here and not in the unit suite
 *
 * `bun run test:unit` gathers `*.test.ts` under `contextvm sdk ui platform
 * styles` only. This file is under `scripts/`, so with `AUCTIONS_LIVE` unset the
 * unit suite is byte-identical to the tip it branched from. It is still type-
 * checked (`tsconfig.json` includes `**\/*.ts`), and it is gated with
 * `test.skipIf(!LIVE)` so running it by hand without the flag skips cleanly
 * instead of failing.
 *
 * ## Re-run
 *
 *     AUCTIONS_LIVE=1 bun test scripts/auctions/live-funded-bid.test.ts
 *
 * The chain gateway (`http://127.0.0.1:8090`), the relay
 * (`wss://relay.playday.it`) and the mint (`http://127.0.0.1:3338` ==
 * `https://mint.playday.it`, FakeWallet) must already be running — this test
 * starts nothing. It is opt-in because it publishes real (test) lots and bids to
 * the live relay and locks fake sats at the test mint; that is expected on this
 * dev-phase box.
 *
 * ## Money safety
 *
 * The lock runs exactly once and is never retried (a mint that timed out may
 * already have processed the swap; a second send commits a second escrow), and a
 * bid is published only after its escrow is locked.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MintQuoteState, Wallet, schnorrSignDigest, type P2PKOptions, type Proof } from '@cashu/cashu-ts'
import type { Event } from '@sdk/core/nostr-io'
import type { NostrEventLike } from '@sdk/core'
import { createEventReadContext, createMemoryEventStore, type EventReadContext } from '@sdk/core/event-store'
import {
	ARENA_ESCROW_TAG_ORDER,
	arenaWalletPubkey,
	parseArenaEscrowLock,
	type ArenaWalletSpendSigner,
} from '@platform/web/auctions/relay/arenaBidFunding'
import { readArenaParams, type ArenaParamsTerms } from '@platform/web/auctions/relay/arenaParamsRead'
import { publishArenaCreate } from '@platform/web/auctions/relay/arenaAuctionCreate'
import { assembleArenaBidFunding, type ArenaBidFundPorts } from '@platform/web/auctions/relay/arenaBidFund'
import type { ArenaEscrowSendManager } from '@platform/web/auctions/relay/arenaBidEscrow'
import { publishArenaBid, type ArenaBidPublisher, type ArenaBidSigner } from '@platform/web/auctions/relay/arenaBidPublish'
import { decodeArenaEvent, projectArenaEvents } from '@platform/web/auctions/relay/arenaAuctionRead'
import { findAuction, toAuctionDetailModel } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { readArenaReceipts, type ArenaReceiptEventLike } from '@platform/web/auctions/relay/arenaReceiptsRead'
import {
	createArenaReceiptClaims,
	loadArenaReceiptClaimRecord,
	saveArenaReceiptClaimRecord,
} from '@platform/web/auctions/relay/arenaReceiptClaims'

// =========================================================================
// Live configuration (opt-in)
// =========================================================================

const LIVE = process.env.AUCTIONS_LIVE === '1'

/** The relay the chain publishes to and ingests from (the app's `appRelay`). */
const RELAY = process.env.AUCTIONS_LIVE_RELAY ?? 'wss://relay.playday.it'
/** The chain gateway's committed state. */
const CHAIN_STATE_URL = process.env.AUCTIONS_LIVE_CHAIN_STATE ?? 'http://127.0.0.1:8090/api/state'
/**
 * The **retired** HTTP-era backend (`AUCTIONS_PROTOCOL_UPSTREAM_URL`'s default).
 * Its `/api/config` carries a `committee_public_key` fetched over HTTP — the
 * key the app used to lock escrows to and which this test asserts the relay no
 * longer names. It is the backend's own route (the app's `/api/auctions/*`
 * proxy is gone); reading it here is a contrast, never a fallback.
 */
const LEGACY_HTTP_CONFIG_URL = process.env.AUCTIONS_LIVE_LEGACY_CONFIG ?? 'http://127.0.0.1:8080/api/config'

/** Bounded deadlines, stated in the report and on failure. */
const CREATE_COMMIT_DEADLINE_MS = 60_000
const BID_COMMIT_DEADLINE_MS = 90_000
const MINT_QUOTE_DEADLINE_MS = 30_000
const TEST_TIMEOUT_MS = 240_000

const BID_AMOUNT_SATS = 64
const DURATION_SEC = 3600

// =========================================================================
// Small helpers
// =========================================================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nowSec = () => Math.floor(Date.now() / 1000)
const xOnly = (compressed: string) => compressed.toLowerCase().slice(2)

/** A relay publisher over a real socket, in the shape both publish paths expect. */
function nostrPublisher(pool: SimplePool): ArenaBidPublisher {
	return {
		publish: async (event: Event) => {
			try {
				await Promise.any(pool.publish([RELAY], event as unknown as Parameters<SimplePool['publish']>[1]))
				return { id: event.id, acks: [{ url: RELAY, accepted: true }] }
			} catch (error) {
				return { id: event.id, acks: [{ url: RELAY, accepted: false, message: error instanceof Error ? error.message : String(error) }] }
			}
		},
	}
}

interface ChainState {
	height: number
	time: number
	params: { groupKey?: string; mintUrl?: string; keysetId?: string }
	auctions: Record<string, unknown>
	bids: Record<string, unknown>
}

async function fetchChainState(): Promise<ChainState> {
	const response = await fetch(CHAIN_STATE_URL)
	if (!response.ok) throw new Error(`chain state answered ${response.status} at ${CHAIN_STATE_URL}`)
	return (await response.json()) as ChainState
}

/**
 * Poll the chain's `/api/state` on a **bounded** deadline. Returns the number of
 * polls it took, or throws naming the deadline it gave up at.
 */
async function pollChainUntil(
	found: (state: ChainState) => boolean,
	deadlineMs: number,
	what: string,
): Promise<{ polls: number; state: ChainState }> {
	const deadline = Date.now() + deadlineMs
	let polls = 0
	let last: ChainState | null = null
	while (Date.now() < deadline) {
		last = await fetchChainState()
		polls += 1
		if (found(last)) return { polls, state: last }
		await sleep(1000)
	}
	throw new Error(`the chain did not commit ${what} within ${deadlineMs} ms (${polls} polls, last height ${last?.height ?? 'unknown'})`)
}

/** The escrow send port `arenaBidEscrow` declares, bound to a live cashu-ts wallet. */
function escrowManagerOverCashu(wallet: Wallet, proofs: Proof[]): ArenaEscrowSendManager {
	let pending: { amount: number; options: P2PKOptions } | null = null
	return {
		mint: { addMint: async () => ({}) },
		ops: {
			send: {
				init: async (_mintUrl, amount, request) => {
					pending = { amount, options: request.methodData.options }
					return { id: 'escrow' }
				},
				prepare: async (operation) => operation,
				execute: async () => {
					if (pending === null) throw new Error('the escrow send was not initialized')
					const { amount, options } = pending
					const { send } = await wallet.send(amount, proofs, {}, { send: { type: 'p2pk', options } })
					pending = null
					return { token: { proofs: send } }
				},
			},
		},
	}
}

// =========================================================================
// The live end-to-end
// =========================================================================

describe('live funded bid (chain + mint + relay)', () => {
	test.skipIf(!LIVE)(
		'a bid assembled from the relay-read params is committed by consensus',
		async () => {
			const pool = new SimplePool()
			const report: Record<string, unknown> = { relay: RELAY, chainStateUrl: CHAIN_STATE_URL }
			try {
				// ---- 1. Read the escrow terms from the relay with the app's own reader ----
				const store = createMemoryEventStore()
				const stream: EventReadContext<NostrEventLike>['stream'] = async function* () {
					const raw = await pool.querySync([RELAY], { kinds: [1448] }, { maxWait: 8000 })
					for (const event of raw) yield { type: 'event', event: event as unknown as NostrEventLike }
					yield { type: 'caught-up', info: { eose: [RELAY], pending: [], complete: true } }
				}
				const context = createEventReadContext({ store, stream })
				const { params: read, refusals } = await readArenaParams({ context, deadlineMs: 8000 })
				if (read === null)
					throw new Error(`no anchored arena.params.v1 reading arrived on ${RELAY} (refusals: ${JSON.stringify(refusals)})`)

				const terms: ArenaParamsTerms = read.terms
				report.paramsRead = {
					eventId: read.eventId,
					signer: read.signerPubkey,
					height: read.height,
					appHash: read.appHash,
					paramsVersion: read.paramsVersion, // opaque token: carried, never recomputed
					groupKey: terms.group_key,
					mintUrl: terms.mint_url,
					keysetId: terms.keyset_id,
					minWindowSec: terms.min_window_sec,
					maxWindowSec: terms.max_window_sec,
					minDurationSec: terms.min_duration_sec,
					maxDurationSec: terms.max_duration_sec,
					maxProofs: terms.max_proofs,
					threshold: terms.threshold,
					settlementSafetySec: terms.settlement_safety_sec,
					bidToConsensusLatencySec: terms.bid_to_consensus_latency_sec,
					refusals,
				}

				// Every term the escrow needs must be present; nothing is defaulted.
				expect(terms.group_key).toMatch(/^0[23][0-9a-f]{64}$/)
				expect(terms.mint_url).toMatch(/^https?:\/\//)
				expect(terms.keyset_id).not.toBeNull()
				expect(terms.min_window_sec).not.toBeNull()
				expect(terms.max_window_sec).not.toBeNull()
				expect(terms.min_duration_sec).not.toBeNull()
				expect(terms.max_duration_sec).not.toBeNull()
				expect(terms.max_proofs).not.toBeNull()
				expect(terms.threshold).not.toBeNull()
				// A live reading is anchored high, never at a foreign test chain's height 2/20.
				expect(read.height).toBeGreaterThan(100)

				// ---- 2. The terms are the chain's own, not the retired HTTP-era key ----
				const chain = await fetchChainState()
				const chainGroupKey = chain.params.groupKey
				if (typeof chainGroupKey !== 'string') throw new Error('the chain state carries no params.groupKey')
				expect(chainGroupKey).toMatch(/^0[23][0-9a-f]{64}$/)
				expect(terms.group_key).toBe(chainGroupKey)
				report.chainGroupKey = chainGroupKey

				let legacyKey: string | null = null
				try {
					const legacyResponse = await fetch(LEGACY_HTTP_CONFIG_URL)
					if (legacyResponse.ok) {
						const legacy = (await legacyResponse.json()) as { committee_public_key?: string }
						legacyKey = typeof legacy.committee_public_key === 'string' ? legacy.committee_public_key : null
					}
				} catch {
					legacyKey = null
				}
				report.legacyHttpCommitteeKey = legacyKey
				if (legacyKey !== null) {
					expect(legacyKey).not.toBe(chainGroupKey)
					expect(terms.group_key).not.toBe(legacyKey)
				}

				// ---- 3. Publish a lot (kind 1440) from a fresh seller identity ----
				const sellerSk = generateSecretKey()
				const sellerPubkey = getPublicKey(sellerSk)
				const sellerWalletPrivate = bytesToHex(generateSecretKey())
				const sellerWallet = arenaWalletPubkey(sellerWalletPrivate)
				const d = `wse-live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
				const coordinate = `1440:${sellerPubkey}:${d}`

				const publisher = nostrPublisher(pool)
				const createSigner = {
					pubkey: sellerPubkey,
					sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
						finalizeEvent(template, sellerSk) as unknown as Event,
				}
				const createResult = await publishArenaCreate(
					{
						auctionId: d,
						title: 'WS-E live funded-bid lot',
						description: 'Published by scripts/auctions/live-funded-bid.test.ts.',
						imageUrl: 'https://picsum.photos/seed/wse-live/200',
						category: 'Test',
						name: 'WS-E live',
						startPrice: String(BID_AMOUNT_SATS),
						minIncrement: '8',
						mode: 'fixed',
						windowSec: '',
						durationSec: DURATION_SEC,
						v4vSplit: [],
					},
					{ sellerPubkey, sellerWallet, signer: createSigner, publisher, relays: [RELAY], now: nowSec() },
				)
				report.lot = {
					eventId: createResult.eventId,
					coordinate,
					d,
					seller: sellerPubkey,
					sellerWallet,
					acceptedBy: createResult.acceptedBy,
				}
				expect(createResult.outcome).toBe('accepted')

				// A relay publish alone is not commitment: poll the chain until the coordinate appears.
				const createCommit = await pollChainUntil(
					(state) => coordinate in state.auctions,
					CREATE_COMMIT_DEADLINE_MS,
					`the lot ${coordinate}`,
				)
				report.lotCommit = { polls: createCommit.polls, deadlineMs: CREATE_COMMIT_DEADLINE_MS, height: createCommit.state.height }

				// ---- 4. Mint test sats and lock the escrow to the RELAY-READ group_key ----
				const mintUrl = terms.mint_url as string
				const wallet = new Wallet(mintUrl)
				await wallet.loadMint() // required before wallet.keysetId
				const quote = await wallet.createMintQuoteBolt11(BID_AMOUNT_SATS)
				let quoteState = quote.state
				const mintDeadline = Date.now() + MINT_QUOTE_DEADLINE_MS
				while (quoteState !== MintQuoteState.PAID && quoteState !== MintQuoteState.ISSUED) {
					if (Date.now() > mintDeadline)
						throw new Error(`the mint quote ${quote.quote} was not PAID/ISSUED within ${MINT_QUOTE_DEADLINE_MS} ms`)
					await sleep(300)
					quoteState = (await wallet.checkMintQuoteBolt11(quote.quote)).state
				}
				const proofs = await wallet.mintProofsBolt11(BID_AMOUNT_SATS, quote)
				report.mint = { mintUrl, keysetId: wallet.keysetId, quoteId: quote.quote, quoteState, proofs: proofs.length }

				// The model the bid is checked against, read back with the app's own projection.
				const [rawCreate] = await pool.querySync([RELAY], { ids: [createResult.eventId] }, { maxWait: 8000 })
				expect(rawCreate).toBeDefined()
				const decoded = decodeArenaEvent(rawCreate as unknown as NostrEventLike, RELAY)
				expect(decoded.ok).toBe(true)
				if (!decoded.ok) throw new Error(`the read gate refused our own create: ${decoded.refusal}`)
				const snapshot = projectArenaEvents([decoded.event])
				const view = findAuction(snapshot, coordinate)
				expect(view).not.toBeNull()
				if (view === null) throw new Error(`the projection did not deliver ${coordinate}`)
				const now = nowSec()
				const model = toAuctionDetailModel(view, { now, status: 'settled' })

				// The bidder's wallet spend key and its signer, plus its Nostr identity (a different key).
				const bidderWalletPrivate = bytesToHex(generateSecretKey())
				const bidderWallet = arenaWalletPubkey(bidderWalletPrivate)
				const walletSigner: ArenaWalletSpendSigner = {
					pubkey: bidderWallet,
					signDigest: (digestHex: string) => schnorrSignDigest(digestHex, bidderWalletPrivate),
				}
				const bidderNostrSk = generateSecretKey()
				const bidderNostrPubkey = getPublicKey(bidderNostrSk)

				// The ports are the app's own assembly seam; `readConfig` maps the relay-read
				// terms exactly as `AuctionBidHost` does.
				const ports: ArenaBidFundPorts = {
					readConfig: async () => ({
						committee_public_key: terms.group_key,
						mint_url: terms.mint_url,
						keyset_id: terms.keyset_id,
						keys: terms.keys,
						settlement_safety_sec: terms.settlement_safety_sec,
						bid_to_consensus_latency_sec: terms.bid_to_consensus_latency_sec,
						min_window_sec: terms.min_window_sec,
						max_window_sec: terms.max_window_sec,
						min_duration_sec: terms.min_duration_sec,
						max_duration_sec: terms.max_duration_sec,
						max_proofs: terms.max_proofs,
						threshold: terms.threshold,
					}),
					readWalletSigner: () => walletSigner,
					readEscrowManager: () => escrowManagerOverCashu(wallet, proofs),
				}

				// Lock exactly once, to the relay-read group_key, with the app's own floor.
				const { funding, fundingTerms } = await assembleArenaBidFunding({ model, amount: BID_AMOUNT_SATS, now }, ports)

				// The returned proofs carry the five canonical lock tags, in order, n_sigs=2,
				// and pubkeys == the published group_key.
				expect(funding.proofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(BID_AMOUNT_SATS)
				expect(funding.proofs.length).toBeGreaterThan(0)
				for (const proof of funding.proofs) {
					const lock = parseArenaEscrowLock(proof.secret, {
						bidderWallet,
						committeeKey: terms.group_key as string,
						minLocktime: funding.locktime,
					})
					expect(lock.tags.map((tag) => tag[0])).toEqual([...ARENA_ESCROW_TAG_ORDER])
					expect(lock.tags.find((tag) => tag[0] === 'n_sigs')?.[1]).toBe('2')
					const pubkeysTag = lock.tags.find((tag) => tag[0] === 'pubkeys')
					expect(pubkeysTag).toBeDefined()
					expect(xOnly(pubkeysTag?.[1] as string)).toBe(xOnly(terms.group_key as string))
					expect(xOnly(lock.tags.find((tag) => tag[0] === 'refund')?.[1] as string)).toBe(xOnly(bidderWallet))
					expect(lock.tags.find((tag) => tag[0] === 'sigflag')?.[1]).toBe('SIG_ALL')
				}
				report.escrow = {
					locktime: funding.locktime,
					proofCount: funding.proofs.length,
					proofAmounts: funding.proofs.map((proof) => proof.amount),
					proofCarriesDleq: funding.proofs.every((proof) => proof.dleq !== null && proof.dleq !== undefined),
					firstProofSecretTags: JSON.parse(funding.proofs[0].secret) as unknown,
				}
				// The chain proves each committed proof is a real mint signature (NUT-12)
				// before admission; a proof without its DLEQ is refused `missing DLEQ proof`.
				expect(funding.proofs.every((proof) => proof.dleq && proof.dleq.e && proof.dleq.s && proof.dleq.r)).toBe(true)

				// ---- 5. Publish the bid (kind 1441) through the app's own path ----
				const bidSigner: ArenaBidSigner = {
					pubkey: bidderNostrPubkey,
					sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
						finalizeEvent(template, bidderNostrSk) as unknown as Event,
				}
				const bidResult = await publishArenaBid(
					{ model, status: 'settled', bidder: { pubkey: bidderNostrPubkey, wallet: 'ready' }, raw: String(BID_AMOUNT_SATS) },
					{ signer: bidSigner, publisher, relays: [RELAY], now, funding, fundingTerms },
				)
				report.bid = { eventId: bidResult.eventId, outcome: bidResult.outcome, acceptedBy: bidResult.acceptedBy }
				expect(bidResult.outcome).toBe('accepted')

				// The load-bearing assertion: the chain commits the bid by event id. The chain
				// validates the lock against its own Params.GroupKey, so a committed bid proves
				// the lock was built from the key the validators actually hold.
				const bidCommit = await pollChainUntil(
					(state) => bidResult.eventId in state.bids,
					BID_COMMIT_DEADLINE_MS,
					`the bid ${bidResult.eventId}`,
				)
				report.bidCommit = { polls: bidCommit.polls, deadlineMs: BID_COMMIT_DEADLINE_MS, height: bidCommit.state.height }
				const committedBid = bidCommit.state.bids[bidResult.eventId] as { auction?: string; wallet?: string; amount?: number } | undefined
				report.committedBid = committedBid ?? null
				expect(committedBid?.auction).toBe(coordinate)
				expect(committedBid?.wallet).toBe(bidderWallet)

				// ---- 6. Name every artifact published ----
				console.log(`WS-E live funded bid — ARTIFACTS\n${JSON.stringify(report, null, 2)}`)
			} finally {
				pool.close([RELAY])
			}
		},
		TEST_TIMEOUT_MS,
	)
})

// =========================================================================
// Live acceptance — the wallet claims the refund the validators minted for it
// =========================================================================

/**
 * A minimal `localStorage` so the claim's real user-scoped persistence
 * (`loadUserData`/`saveUserData`) runs under bun/node exactly as it does in the
 * browser. The record surviving between the two claim runs IS the point: a
 * restart cannot claim twice.
 */
function installLocalStorageShim(): void {
	const store = new Map<string, string>()
	;(globalThis as unknown as { localStorage: unknown }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size
		},
	}
}

/** A wallet source over a cashu-ts wallet and its own proof list — the shape the rails read. */
function trackedWallet(mintUrl: string, initial: Proof[]) {
	let held = [...initial]
	return {
		state: {
			dump: () => ({ proofs: [{ mint: mintUrl, proofs: held }] }),
			getProofs: (filter: { mint: string }) => (filter.mint === mintUrl ? held : []),
			update: async (update: { store: Proof[]; mint: string; destroy?: Proof[] }) => {
				const destroyed = new Set((update.destroy ?? []).map((proof) => proof.secret))
				held = [...held.filter((proof) => !destroyed.has(proof.secret)), ...update.store]
			},
		},
		getProofs: () => held,
		balance: () => held.reduce((sum, proof) => sum + proof.amount.toNumber(), 0),
	}
}

/** The escrow send port, bound to a tracked source so the change lands back in it. */
function escrowManagerForSource(cashuWallet: Wallet, source: ReturnType<typeof trackedWallet>, mintUrl: string): ArenaEscrowSendManager {
	let pending: { amount: number; options: P2PKOptions } | null = null
	return {
		mint: { addMint: async () => ({}) },
		ops: {
			send: {
				init: async (_mintUrl, amount, request) => {
					pending = { amount, options: request.methodData.options }
					return { id: 'escrow' }
				},
				prepare: async (operation) => operation,
				execute: async () => {
					if (pending === null) throw new Error('the escrow send was not initialized')
					const { amount, options } = pending
					const held = source.getProofs()
					const { send, keep } = await cashuWallet.send(amount, held, {}, { send: { type: 'p2pk', options } })
					await source.state.update({ store: keep, mint: mintUrl, destroy: held })
					pending = null
					return { token: { proofs: send } }
				},
			},
		},
	}
}

/** Poll the relay for the receipt events whose `bid` tag is `bidId`, on a bounded deadline. */
async function pollRelayForBidReceipts(
	pool: SimplePool,
	kind: number,
	bidId: string,
	deadlineMs: number,
): Promise<{
	polls: number
	events: { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }[]
}> {
	const deadline = Date.now() + deadlineMs
	let polls = 0
	while (Date.now() < deadline) {
		const raw = await pool.querySync([RELAY], { kinds: [kind], limit: 100 }, { maxWait: 6000 })
		polls += 1
		const matches = raw.filter((event) => event.tags.some((tag) => tag[0] === 'bid' && tag[1] === bidId))
		if (matches.length > 0) {
			return {
				polls,
				events: matches.map((event) => ({
					id: event.id,
					pubkey: event.pubkey,
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags as string[][],
					content: event.content,
					sig: event.sig ?? '',
				})),
			}
		}
		await sleep(1000)
	}
	throw new Error(`no kind-${kind} receipt for bid ${bidId} arrived on ${RELAY} within ${deadlineMs} ms (${polls} polls)`)
}

describe('live funded bid — the recipient claims the refund the validators minted for it', () => {
	test.skipIf(!LIVE)(
		"an outbid bidder's wallet claims its kind-1443 refund automatically, and only once",
		async () => {
			installLocalStorageShim()
			const pool = new SimplePool()
			const report: Record<string, unknown> = { relay: RELAY, chainStateUrl: CHAIN_STATE_URL }
			try {
				// ---- 1. The escrow terms, read the app's way ----
				const store = createMemoryEventStore()
				const stream: EventReadContext<NostrEventLike>['stream'] = async function* () {
					const raw = await pool.querySync([RELAY], { kinds: [1448] }, { maxWait: 8000 })
					for (const event of raw) yield { type: 'event', event: event as unknown as NostrEventLike }
					yield { type: 'caught-up', info: { eose: [RELAY], pending: [], complete: true } }
				}
				const { params: read } = await readArenaParams({ context: createEventReadContext({ store, stream }), deadlineMs: 8000 })
				if (read === null) throw new Error(`no anchored arena.params.v1 reading arrived on ${RELAY}`)
				const terms: ArenaParamsTerms = read.terms
				if (typeof terms.mint_url !== 'string' || typeof terms.keyset_id !== 'string' || typeof terms.group_key !== 'string')
					throw new Error('the params reading is missing mint_url / keyset_id / group_key')
				const mintUrl = terms.mint_url
				const keysetId = terms.keyset_id
				report.params = { eventId: read.eventId, height: read.height, mintUrl, keysetId, groupKey: terms.group_key }

				// ---- 2. A lot from a fresh seller ----
				const sellerSk = generateSecretKey()
				const sellerPubkey = getPublicKey(sellerSk)
				const sellerWalletPrivate = bytesToHex(generateSecretKey())
				const sellerWallet = arenaWalletPubkey(sellerWalletPrivate)
				const d = `wsc-claim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
				const coordinate = `1440:${sellerPubkey}:${d}`
				const publisher = nostrPublisher(pool)
				const createResult = await publishArenaCreate(
					{
						auctionId: d,
						title: 'WS-G live receipt-claim lot',
						description: 'Published by scripts/auctions/live-funded-bid.test.ts.',
						imageUrl: 'https://picsum.photos/seed/wsc-claim/200',
						category: 'Test',
						name: 'WS-G live',
						startPrice: String(BID_AMOUNT_SATS),
						minIncrement: '8',
						mode: 'fixed',
						windowSec: '',
						durationSec: DURATION_SEC,
						v4vSplit: [],
					},
					{
						sellerPubkey,
						sellerWallet,
						signer: {
							pubkey: sellerPubkey,
							sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
								finalizeEvent(template, sellerSk) as unknown as Event,
						},
						publisher,
						relays: [RELAY],
						now: nowSec(),
					},
				)
				report.lot = { eventId: createResult.eventId, coordinate, seller: sellerPubkey, sellerWallet }
				expect(createResult.outcome).toBe('accepted')
				await pollChainUntil((state) => coordinate in state.auctions, CREATE_COMMIT_DEADLINE_MS, `the lot ${coordinate}`)

				// The model both bids are assembled against, from the app's own projection.
				const [rawCreate] = await pool.querySync([RELAY], { ids: [createResult.eventId] }, { maxWait: 8000 })
				const decoded = decodeArenaEvent(rawCreate as unknown as NostrEventLike, RELAY)
				if (!decoded.ok) throw new Error(`the read gate refused our own create: ${decoded.refusal}`)
				const view = findAuction(projectArenaEvents([decoded.event]), coordinate)
				if (view === null) throw new Error(`the projection did not deliver ${coordinate}`)
				const model = toAuctionDetailModel(view, { now: nowSec(), status: 'settled' })

				const cashuWallet = new Wallet(mintUrl)
				await cashuWallet.loadMint()

				/** Fund one bid from a fresh wallet key and publish it; poll until consensus commits it. */
				const fundAndPublishBid = async (amount: number, label: string) => {
					const walletPrivate = bytesToHex(generateSecretKey())
					const walletPub = arenaWalletPubkey(walletPrivate)
					const quote = await cashuWallet.createMintQuoteBolt11(amount)
					let quoteState = quote.state
					const mintDeadline = Date.now() + MINT_QUOTE_DEADLINE_MS
					while (quoteState !== MintQuoteState.PAID && quoteState !== MintQuoteState.ISSUED) {
						if (Date.now() > mintDeadline)
							throw new Error(`the mint quote ${quote.quote} was not PAID/ISSUED within ${MINT_QUOTE_DEADLINE_MS} ms`)
						await sleep(300)
						quoteState = (await cashuWallet.checkMintQuoteBolt11(quote.quote)).state
					}
					const funded = await cashuWallet.mintProofsBolt11(amount, quote)
					const source = trackedWallet(mintUrl, funded)
					const walletSigner: ArenaWalletSpendSigner = {
						pubkey: walletPub,
						signDigest: (digestHex: string) => schnorrSignDigest(digestHex, walletPrivate),
					}
					const bidderNostrSk = generateSecretKey()
					const bidderNostrPubkey = getPublicKey(bidderNostrSk)
					const ports: ArenaBidFundPorts = {
						readConfig: async () => ({
							committee_public_key: terms.group_key as string,
							mint_url: terms.mint_url,
							keyset_id: terms.keyset_id,
							keys: terms.keys,
							settlement_safety_sec: terms.settlement_safety_sec,
							bid_to_consensus_latency_sec: terms.bid_to_consensus_latency_sec,
							min_window_sec: terms.min_window_sec,
							max_window_sec: terms.max_window_sec,
							min_duration_sec: terms.min_duration_sec,
							max_duration_sec: terms.max_duration_sec,
							max_proofs: terms.max_proofs,
							threshold: terms.threshold,
						}),
						readWalletSigner: () => walletSigner,
						readEscrowManager: () => escrowManagerForSource(cashuWallet, source, mintUrl),
					}
					const { funding, fundingTerms } = await assembleArenaBidFunding({ model, amount, now: nowSec() }, ports)
					const bidResult = await publishArenaBid(
						{ model, status: 'settled', bidder: { pubkey: bidderNostrPubkey, wallet: 'ready' }, raw: String(amount) },
						{
							signer: {
								pubkey: bidderNostrPubkey,
								sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
									finalizeEvent(template, bidderNostrSk) as unknown as Event,
							},
							publisher,
							relays: [RELAY],
							now: nowSec(),
							funding,
							fundingTerms,
						},
					)
					expect(bidResult.outcome).toBe('accepted')
					await pollChainUntil(
						(state) => bidResult.eventId in state.bids,
						BID_COMMIT_DEADLINE_MS,
						`the bid ${label} (${bidResult.eventId})`,
					)
					return { bidEventId: bidResult.eventId, walletPrivate, walletPub, source, quoteId: quote.quote }
				}

				// ---- 3. Bid A from wallet key K, then a HIGHER bid B from K2 ----
				const K = await fundAndPublishBid(BID_AMOUNT_SATS, 'A')
				report.bidA = { eventId: K.bidEventId, wallet: K.walletPub, amount: BID_AMOUNT_SATS, quoteId: K.quoteId }
				const balanceBefore = K.source.balance()
				expect(balanceBefore).toBe(0) // A's whole escrow left K's wallet

				const B = await fundAndPublishBid(BID_AMOUNT_SATS + 8, 'B')
				report.bidB = { eventId: B.bidEventId, wallet: B.walletPub, amount: BID_AMOUNT_SATS + 8, quoteId: B.quoteId }

				// ---- 4. The read: A's kind-1443 refund, addressed to K ----
				const refundPoll = await pollRelayForBidReceipts(pool, 1443, K.bidEventId, BID_COMMIT_DEADLINE_MS)
				// Keep ONLY what the read verifies — kind, signature, schema, outcome, anchor.
				const { receipts, refusals } = readArenaReceipts(refundPoll.events as ArenaReceiptEventLike[], {})
				report.refundRead = { polls: refundPoll.polls, verifiedReceipts: receipts.length, refusals }
				expect(receipts.length).toBeGreaterThan(0)
				const refund = receipts.find((receipt) => receipt.outcome === 'refund' && receipt.bidId === K.bidEventId)
				if (refund === undefined) throw new Error(`the read delivered no verified refund receipt for K's bid ${K.bidEventId}`)
				const refundTotal = refund.outputs
					.filter((output) => output.recipient === K.walletPub)
					.reduce((sum, output) => sum + (output.amount ?? 0), 0)
				report.refundReceipt = {
					eventId: refund.eventId,
					bidId: refund.bidId,
					outcome: refund.outcome,
					height: refund.height,
					outputs: refund.outputs.map((output) => ({ recipient: output.recipient, amount: output.amount, id: output.id })),
					refundTotal,
				}
				expect(refundTotal).toBeGreaterThan(0)

				// ---- 5. The claim: swap K's refund into K's wallet, automatically ----
				const claimHost = (recordPubkey: string) => ({
					getWallet: () => K.source,
					isWalletReady: () => true,
					mint: { cashuWalletForMint: async () => ({ cashuWallet, keysetId }) },
					getWalletP2pk: () => K.walletPub,
					getWalletPrivkey: (pubkey: string) => (pubkey === K.walletPub ? K.walletPrivate : null),
					getExpectedMintUrl: () => mintUrl,
					getWalletMints: () => [mintUrl],
					getExpectedKeysetId: () => keysetId,
					getClaimRecord: () => loadArenaReceiptClaimRecord(recordPubkey),
					setClaimRecord: (record: ReturnType<typeof loadArenaReceiptClaimRecord>) => saveArenaReceiptClaimRecord(record, recordPubkey),
					refresh: async () => {},
					now: () => Date.now(),
				})
				const claim = createArenaReceiptClaims(claimHost('claim-test-user'))

				const firstRun = await claim.claimReceipts([refund])
				const balanceAfter = K.source.balance()
				report.claim = {
					claimed: firstRun.claimed,
					refusals: firstRun.refusals,
					balanceBefore,
					balanceAfter,
					delta: balanceAfter - balanceBefore,
				}
				// The load-bearing assertion: K's balance rose by exactly the refund,
				// with no manual action — the read delivered it and the wallet took it.
				expect(firstRun.claimed).toHaveLength(1)
				expect(firstRun.claimed[0].bidId).toBe(K.bidEventId)
				expect(balanceAfter - balanceBefore).toBe(refundTotal)

				// ---- 6. A second run claims nothing, silently ----
				const secondRun = await claim.claimReceipts([refund])
				report.secondRun = { claimed: secondRun.claimed, refusals: secondRun.refusals, balanceAfter: K.source.balance() }
				expect(secondRun.claimed).toEqual([])
				expect(secondRun.refusals.map((entry) => entry.refusal)).toEqual(['arena.claim.already_claimed'])
				expect(K.source.balance()).toBe(balanceAfter)

				console.log(`WS-G live receipt claim — ARTIFACTS\n${JSON.stringify(report, null, 2)}`)
			} finally {
				pool.close([RELAY])
			}
		},
		TEST_TIMEOUT_MS,
	)
})

afterAll(() => {
	if (!LIVE) console.log('AUCTIONS_LIVE is unset — the live funded-bid end-to-end was skipped.')
})
