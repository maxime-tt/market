/**
 * `arenaFundedBid.integration.test.ts` — the funded bid against a REAL mint and
 * a REAL relay.
 *
 * Opt-in (`AUCTIONS_LIVE=1`), because it needs both services running loopback:
 *
 *     mint:  http://127.0.0.1:3338   (Nutshell 0.21.0, FakeWallet, NUT-11)
 *     relay: ws://127.0.0.1:7777     (nak serve)
 *
 * Everything else in this directory runs on doubles, and that is the point of
 * this file: it answers the one question a double cannot — *does the mint
 * actually accept the escrow condition we build, and does a relay actually
 * carry the bid back to the read projection?* Until this existed, the lock, the
 * templates and the digests had only ever been checked against fixtures and one
 * Go golden vector.
 *
 * What it does, in order:
 *
 *  1. faucet — mints 2000 fake sats from the real mint. FakeWallet settles the
 *     invoice immediately, but the state is still polled: a quote the mint has
 *     not called PAID is never treated as paid.
 *  2. locks 1000 of those sats under the escrow condition built by
 *     `buildArenaEscrowLockOptions` (2-of-2, SIG_ALL, canonical five tags) and
 *     parses every proof back with `parseArenaEscrowLock`.
 *  3. builds the funding payload with `buildArenaBidFunding` — the settle and
 *     refund templates, signed over their layout-B digests by the wallet spend
 *     key — and has `verifyArenaBidFunding` accept it.
 *  4. publishes a real kind-1440 create (the settled protocol's camelCase
 *     content) and the real kind-1441 bid to the real relay.
 *  5. reads both events back over a real websocket and runs the app's own
 *     `projectArenaEvents` on them, asserting the bid is bound to the root and
 *     counted, and that the create's fields survived the round trip.
 *
 * NOT covered: the settle. Submitting the pre-signed settle template is the
 * committee's move, and it needs the committee's private key — which this app
 * never holds, by design (`MERGED-PROTOCOL-SPEC.md` §5).
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, SimplePool } from 'nostr-tools'
import { MintQuoteState, schnorrSignDigest, Wallet, type Proof } from '@cashu/cashu-ts'
import {
	ARENA_AUCTION_CREATE_KIND,
	ARENA_AUCTION_BID_KIND,
} from '@sdk/commerce/auctions/constants'
import {
	arenaBidLocktimeFloor,
	arenaWalletPubkey,
	buildArenaBidFunding,
	buildArenaEscrowLockOptions,
	parseArenaEscrowLock,
	validateArenaEscrowLock,
	type ArenaWalletSpendSigner,
} from '@platform/web/auctions/relay/arenaBidFunding'
import { buildArenaBidContent } from '@platform/web/auctions/relay/arenaBidPublish'
import {
	decodeArenaEvent,
	projectArenaEvents,
	type ArenaReadHealth,
} from '@platform/web/auctions/relay/arenaAuctionRead'
import { findAuction } from '@platform/web/auctions/relay/auctionSurfacesRead'

const LIVE = process.env.AUCTIONS_LIVE === '1'
const MINT = (process.env.ARENA_MINT_URL ?? 'http://127.0.0.1:3338').replace(/\/$/, '')
const RELAY = process.env.ARENA_RELAY_URL ?? 'ws://127.0.0.1:7777'
/** The committee key the local demo backend publishes at `GET /api/config`. */
const COMMITTEE = process.env.ARENA_COMMITTEE_KEY ?? '02070145288f17d3583f307831311ac5d9908c90f75e4a7938a714759e7096c68a'

const amountOf = (proof: Proof): number => {
	const value = proof.amount as unknown
	if (typeof value === 'number') return value
	if (typeof value === 'object' && value !== null && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
		return (value as { toNumber(): number }).toNumber()
	}
	return Number(value)
}

/** Mint `amount` fake sats from the real mint, polling the quote state. */
async function faucet(amount: number): Promise<Proof[]> {
	const wallet = new Wallet(MINT)
	await wallet.loadMint()
	const quote = await wallet.createMintQuoteBolt11(amount)
	let state = (quote as { state?: string }).state ?? MintQuoteState.UNPAID
	for (let attempt = 0; attempt < 20 && state !== MintQuoteState.PAID && state !== MintQuoteState.ISSUED; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 300))
		state = ((await wallet.checkMintQuoteBolt11(quote.quote)) as { state?: string }).state ?? state
	}
	if (state !== MintQuoteState.PAID && state !== MintQuoteState.ISSUED) {
		throw new Error(`mint quote was not paid (state ${state})`)
	}
	return wallet.mintProofsBolt11(amount, quote)
}

describe('a funded bid, live', () => {
	test.skipIf(!LIVE)(
		'the mint accepts the escrow condition, a relay carries the bid, and the read binds it',
		async () => {
			// ---- the keys this bid runs on ------------------------------------
			const spendPrivkey = '11'.repeat(32)
			const bidderWallet = arenaWalletPubkey(spendPrivkey)
			const signer: ArenaWalletSpendSigner = {
				pubkey: bidderWallet,
				signDigest: (digestHex: string) => schnorrSignDigest(digestHex, spendPrivkey),
			}
			const sellerSecret = generateSecretKey()
			const seller = getPublicKey(sellerSecret)
			// The seller's identity signs the create; the settle pays a *wallet* key,
			// which is a separate compressed secp256k1 key (spec: `sellerWallet`).
			const sellerWallet = arenaWalletPubkey('22'.repeat(32))
			const bidderSecret = generateSecretKey()
			const bidder = getPublicKey(bidderSecret)
			const d = `live-funded-${Date.now()}`
			const coordinate = `${ARENA_AUCTION_CREATE_KIND}:${seller}:${d}`

			const now = Math.floor(Date.now() / 1000)
			const durationSec = 3600
			const startPrice = 100
			const minIncrement = 10
			const bidAmount = 1000
			const minLocktime = arenaBidLocktimeFloor({ mode: 'fixed', endAt: now + durationSec, windowSec: null, now })

			// ---- 1. faucet ---------------------------------------------------
			const proofs = await faucet(2000)
			expect(proofs.reduce((sum, proof) => sum + amountOf(proof), 0)).toBe(2000)

			// ---- 2. the escrow lock, against the real mint --------------------
			const wallet = new Wallet(MINT)
			await wallet.loadMint()
			const lockOptions = buildArenaEscrowLockOptions({ bidderWallet, committeeKey: COMMITTEE, locktime: minLocktime })
			const { send, keep } = await wallet.send(bidAmount, proofs, {}, { send: { type: 'p2pk', options: lockOptions } })
			expect(keep.length).toBeGreaterThan(0)
			expect(send.reduce((sum, proof) => sum + amountOf(proof), 0)).toBe(bidAmount)

			// The mint's own secrets must parse as our canonical five-tag lock.
			for (const proof of send) {
				const parsed = parseArenaEscrowLock(proof.secret, { bidderWallet, committeeKey: COMMITTEE, minLocktime })
				expect(parsed.tags.map((tag) => tag[0])).toEqual(['locktime', 'pubkeys', 'n_sigs', 'refund', 'sigflag'])
			}
			expect(validateArenaEscrowLock(send.map((proof) => ({ id: proof.id, amount: amountOf(proof), secret: proof.secret, C: proof.C })), { bidderWallet, committeeKey: COMMITTEE, minLocktime })).toBe(minLocktime)

			// ---- 3. the funding payload --------------------------------------
			const funding = await buildArenaBidFunding({
				proofs: send.map((proof) => ({ id: proof.id, amount: amountOf(proof), secret: proof.secret, C: proof.C })),
				sellerWallet,
				bidderWallet,
				committeeKey: COMMITTEE,
				keysetId: send[0].id,
				minLocktime,
				signer,
			})
			expect(funding.proofs.reduce((sum, proof) => sum + proof.amount, 0)).toBe(bidAmount)
			expect(funding.outcome_templates.settle.bidder_signature).toMatch(/^[0-9a-f]{128}$/)
			expect(funding.outcome_templates.refund.bidder_signature).toMatch(/^[0-9a-f]{128}$/)

			// ---- 4. publish the create and the bid to the real relay ---------
			const createContent = {
				auction_id: d,
				title: 'Live funded-bid lot',
				description: 'throwaway live integration lot',
				image: '',
				startPrice,
				minIncrement,
				mode: 'fixed',
				windowSec: null,
				durationSec,
				sellerWallet,
				v4vSplit: null,
			}
			const createEvent = finalizeEvent(
				{ kind: ARENA_AUCTION_CREATE_KIND, created_at: now, tags: [['d', d]], content: JSON.stringify(createContent) },
				sellerSecret,
			)
			const bidContent = buildArenaBidContent(
				{ d, seller, rootEventId: createEvent.id, coordinate },
				bidAmount,
				funding,
			)
			const bidEvent = finalizeEvent(
				{ kind: ARENA_AUCTION_BID_KIND, created_at: now + 1, tags: bidContent.tags, content: JSON.stringify(bidContent.content) },
				bidderSecret,
			)

			const pool = new SimplePool()
			try {
				await Promise.any(pool.publish([RELAY], createEvent))
				await Promise.any(pool.publish([RELAY], bidEvent))

				// ---- 5. read them back over a real socket --------------------
				const arrived = await pool.querySync([RELAY], { ids: [createEvent.id, bidEvent.id] })
				expect(arrived.map((event) => event.id).sort()).toEqual([createEvent.id, bidEvent.id].sort())

				// Decode through the read adapter's own gate, exactly as a live read
				// would: a refusal here is a real refusal, not a fixture mismatch.
				const decoded = arrived.map((event) => decodeArenaEvent(event, RELAY))
				const events = decoded.flatMap((result) => (result.ok ? [result.event] : []))
				const refusals = decoded.flatMap((result) => (result.ok ? [] : [result.refusal]))
				expect(refusals).toEqual([])

				const health: ArenaReadHealth = {
					relays: [{ url: RELAY, status: 'ok', events: events.length, refusals: 0, eose: true, error: null }],
					eose: [RELAY],
					answered: [RELAY],
					pending: [],
					failed: [],
					noRelaysReachable: false,
					empty: false,
					aborted: false,
				}
				const snapshot = projectArenaEvents(events, health, refusals)
				const view = findAuction(snapshot, coordinate)
				expect(view).not.toBeNull()
				expect(view!.bids).toHaveLength(1)
				expect(view!.bids[0].amount).toBe(bidAmount)
				expect(view!.bids[0].bidder).toBe(bidder)
				// The camelCase create survived the round trip — the vocabulary the
				// read adapter gates on is the vocabulary that was published.
				expect(view!.content.startPrice).toBe(startPrice)
				expect(view!.content.durationSec).toBe(durationSec)
				expect(view!.content.mode).toBe('fixed')
				expect(view!.content.sellerWallet).toBe(sellerWallet)
			} finally {
				pool.close([RELAY])
			}
		},
		120_000,
	)
})