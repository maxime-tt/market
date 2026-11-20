/**
 * `scripts/auctions/live-lifecycle.test.ts` — the Phase E **lifecycle** live
 * end-to-end: one opt-in test that walks create → A funds and bids → B outbids
 * → A is refunded → a distinct sniper bids inside the anti-snipe window (the
 * chain voids a rebid from its own leader) → the lot closes → a verdict names
 * the sniper → a settle receipt pays the seller → the seller claims → the
 * sniper's own claim message reaches the seller → a create the published rules
 * refuse is named verbatim.
 *
 * ## Every step is asserted from the wire, never from the app's optimism
 *
 * The three authorities are the **relay** (event ids, kinds, tags, content),
 * the **chain's committed state** (`/api/state`: auctions, bids, rejections)
 * and the **mint** (NUT-07 proof states). The app's own readers are driven
 * where a step is *only* observable in the app, and the weaker evidence is
 * named aloud in the report.
 *
 * ## Opt-in, and invisible to the ordinary suite
 *
 * `bun run test:unit` gathers `*.test.ts` under `contextvm sdk ui platform
 * styles` only. This file is under `scripts/`, so with `AUCTIONS_LIVE` unset the
 * unit suite is byte-identical to the tip it branched from. It is still
 * type-checked, and gated with `test.skipIf(!LIVE)`.
 *
 * ## Re-run
 *
 *     AUCTIONS_LIVE=1 bun test scripts/auctions/live-lifecycle.test.ts
 *
 * The chain gateway (`http://127.0.0.1:8090`), the relay
 * (`wss://relay.playday.it`) and the mint (`http://127.0.0.1:3338` ==
 * `https://mint.playday.it`, FakeWallet) must already be running — this test
 * starts nothing. It is opt-in because it publishes real (test) lots and bids
 * to the live relay and locks fake sats at the test mint.
 *
 * ## Money safety
 *
 * Each escrow lock runs exactly once and is never retried (a mint that timed
 * out may already have processed the swap), and a bid is published only after
 * its escrow is locked.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MintQuoteState, Wallet, schnorrSignDigest, type Proof } from '@cashu/cashu-ts'
import type { Event } from '@sdk/core/nostr-io'
import type { NostrEventLike } from '@sdk/core'
import { createEventReadContext, createMemoryEventStore, type EventReadContext } from '@sdk/core/event-store'
import { NIP59_GIFT_WRAP_KIND } from '@sdk/core/nostr/nip59'
import { ORDER_PROCESS_KIND } from '@sdk/commerce/orders/messaging/orderSchema'
import {
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_CREATE_KIND,
	ARENA_LOT_STATE_KIND,
	ARENA_REFUSED_KIND,
} from '@sdk/commerce/auctions/constants'
import { getArenaCreateIssues } from '@sdk/commerce/auctions/auctionPublishValidation'
import { arenaWalletPubkey, type ArenaWalletSpendSigner } from '@platform/web/auctions/relay/arenaBidFunding'
import { readArenaParams, type ArenaParamsTerms } from '@platform/web/auctions/relay/arenaParamsRead'
import { arenaCreateRulesFromParams, publishArenaCreate } from '@platform/web/auctions/relay/arenaAuctionCreate'
import { assembleArenaBidFunding, type ArenaBidFundPorts } from '@platform/web/auctions/relay/arenaBidFund'
import { buildArenaBidContent, diagnosePublishedBid, publishArenaBid } from '@platform/web/auctions/relay/arenaBidPublish'
import { decodeArenaEvent, projectArenaEvents } from '@platform/web/auctions/relay/arenaAuctionRead'
import { auctionEndsAt, endSourceOf, findAuction, toAuctionDetailModel } from '@platform/web/auctions/relay/auctionSurfacesRead'
import { readArenaReceipts, type ArenaReceiptEventLike } from '@platform/web/auctions/relay/arenaReceiptsRead'
import {
	createArenaReceiptClaims,
	loadArenaReceiptClaimRecord,
	saveArenaReceiptClaimRecord,
} from '@platform/web/auctions/relay/arenaReceiptClaims'
import { parseArenaRefusalEvent } from '@sdk/commerce/auctions/arena'
import {
	buildAuctionClaimPublicMarkerTags,
	createPrivateAuctionClaimMessage,
	decryptPrivateAuctionClaimMessage,
	getAuctionClaimPublicMarkerFields,
	privateAuctionClaimMatchesPublicMarker,
} from '@sdk/commerce/auctions/privateAuctionClaimMessage'
import { formatClaimAddress, winningBidderOf, winningVerdictOf } from '@platform/web/dashboard/auctionFulfilment'
import {
	checkProofsSpent,
	escrowManagerForSource,
	fetchChainState,
	installLocalStorageShim,
	nostrPublisher,
	nowSec,
	pollChainUntil,
	pollRelayForBidReceipts,
	readChainAdvancing,
	sleep,
	trackedWallet,
	type RawRelayEvent,
} from './liveArenaHarness'

// =========================================================================
// Live configuration (opt-in)
// =========================================================================

const LIVE = process.env.AUCTIONS_LIVE === '1'

const RELAY = process.env.AUCTIONS_LIVE_RELAY ?? 'wss://relay.playday.it'
const CHAIN_STATE_URL = process.env.AUCTIONS_LIVE_CHAIN_STATE ?? 'http://127.0.0.1:8090/api/state'

const CREATE_COMMIT_DEADLINE_MS = 60_000
const BID_COMMIT_DEADLINE_MS = 90_000
const MINT_QUOTE_DEADLINE_MS = 30_000
/** Long enough for the whole walk (a short lot, an extension, a close, a settle, a claim). */
const TEST_TIMEOUT_MS = 600_000

/** A short lot with an anti-snipe window so the extension step has something to move. */
const DURATION_SEC = 240
const WINDOW_SEC = 120

const START_PRICE_SATS = 64
const MIN_INCREMENT_SATS = 8
const BID_A_SATS = START_PRICE_SATS
const BID_B_SATS = START_PRICE_SATS + MIN_INCREMENT_SATS
const BID_EXTEND_SATS = BID_B_SATS + MIN_INCREMENT_SATS
/** Above the current leader, so the ONLY reason the chain can refuse it is the dropped DLEQ. */
const ADMISSION_SATS = BID_EXTEND_SATS + MIN_INCREMENT_SATS

const SHIPPING_NAME = 'Wren Lifecycle'
const SHIPPING_FIRST_LINE = '14 Example Row'
const SHIPPING_CITY = 'Testville'
const SHIPPING_POSTCODE = 'TE5 7ST'
const SHIPPING_COUNTRY = 'Testland'

// =========================================================================
// Small local helpers
// =========================================================================

const publisher = (pool: SimplePool) => nostrPublisher(pool, RELAY)

/** One raw relay event by id, or `null` when the relay did not serve it — read back, never assumed. */
async function fetchRawById(pool: SimplePool, id: string): Promise<RawRelayEvent | null> {
	const [raw] = await pool.querySync([RELAY], { ids: [id] }, { maxWait: 8000 })
	if (raw === undefined) return null
	return {
		id: raw.id,
		pubkey: raw.pubkey,
		kind: raw.kind,
		created_at: raw.created_at,
		tags: raw.tags as string[][],
		content: raw.content,
		sig: raw.sig ?? '',
	}
}

const asRaw = (event: {
	id: string
	pubkey: string
	kind: number
	created_at: number
	tags: readonly string[][]
	content: string
	sig?: string
}): RawRelayEvent => ({
	id: event.id,
	pubkey: event.pubkey,
	kind: event.kind,
	created_at: event.created_at,
	tags: event.tags as string[][],
	content: event.content,
	sig: event.sig ?? '',
})

/** Decode a batch of raw relay events with the app's own gate, then project them. */
function projectRaws(raws: readonly RawRelayEvent[]): { snapshot: ReturnType<typeof projectArenaEvents>; refusedEvents: string[] } {
	const decoded: Parameters<typeof projectArenaEvents>[0][number][] = []
	const refusedEvents: string[] = []
	for (const raw of raws) {
		const result = decodeArenaEvent(raw as unknown as NostrEventLike, RELAY)
		if (result.ok) decoded.push(result.event)
		else refusedEvents.push(`${raw.id}:${result.refusal.reason}`)
	}
	return { snapshot: projectArenaEvents(decoded), refusedEvents }
}

// =========================================================================
// The lifecycle
// =========================================================================

describe('live lifecycle (chain + mint + relay)', () => {
	test.skipIf(!LIVE)(
		'the whole lot lifecycle is committed, refunded, extended, settled and claimed — all from the wire',
		async () => {
			installLocalStorageShim()
			const pool = new SimplePool()
			const T0 = Date.now()
			const mark = (label: string) => console.log(`[lifecycle] ${label} t+${((Date.now() - T0) / 1000).toFixed(1)}s`)
			const report: Record<string, unknown> = {
				relay: RELAY,
				chainStateUrl: CHAIN_STATE_URL,
				durationSec: DURATION_SEC,
				windowSec: WINDOW_SEC,
			}
			try {
				// ---- 1. The escrow terms, read the app's own way, from the relay ----
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

				const chainAtStart = await fetchChainState(CHAIN_STATE_URL)
				const chainGroupKey = chainAtStart.params.groupKey
				if (typeof chainGroupKey !== 'string') throw new Error('the chain state carries no params.groupKey')
				expect(terms.group_key).toBe(chainGroupKey)
				expect(read.height).toBeGreaterThan(100)
				const mintUrl = terms.mint_url
				const keysetId = terms.keyset_id
				report.params = { eventId: read.eventId, height: read.height, mintUrl, keysetId, groupKey: terms.group_key }

				// The chain's published create rules, mapped by the app exactly as the editor does.
				const rules = arenaCreateRulesFromParams(terms)
				expect(rules.max_title_chars).not.toBeNull()

				const cashuWallet = new Wallet(mintUrl)
				await cashuWallet.loadMint()

				// ---- 2. A short anti-snipe lot from a fresh seller ----
				const sellerSk = generateSecretKey()
				const sellerPubkey = getPublicKey(sellerSk)
				const sellerWalletPrivate = bytesToHex(generateSecretKey())
				const sellerWallet = arenaWalletPubkey(sellerWalletPrivate)
				const d = `wsl-lifecycle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
				const coordinate = `1440:${sellerPubkey}:${d}`

				const createForm = {
					auctionId: d,
					title: 'WS-E lifecycle lot',
					description: 'Published by scripts/auctions/live-lifecycle.test.ts.',
					imageUrl: 'https://picsum.photos/seed/wsl-lifecycle/200',
					category: 'Test',
					name: 'WS-E lifecycle',
					startPrice: String(START_PRICE_SATS),
					minIncrement: String(MIN_INCREMENT_SATS),
					mode: 'antisnipe',
					windowSec: String(WINDOW_SEC),
					durationSec: String(DURATION_SEC),
					v4vSplit: [],
				}

				// The app's own pre-flight, run against the chain's published rules: this valid
				// create passes here, and the same call refuses the too-long title in step 11.
				const createIssues = getArenaCreateIssues(createForm, { sellerWallet, rules })
				expect(createIssues).toEqual([])
				report.createPreflight = { issues: createIssues.length, rulesChecked: rules.max_title_chars }

				const createResult = await publishArenaCreate(createForm, {
					sellerPubkey,
					sellerWallet,
					signer: {
						pubkey: sellerPubkey,
						sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
							finalizeEvent(template, sellerSk) as unknown as Event,
					},
					publisher: publisher(pool),
					relays: [RELAY],
					now: nowSec(),
				})
				expect(createResult.outcome).toBe('accepted')
				const createCommit = await pollChainUntil(
					CHAIN_STATE_URL,
					(state) => coordinate in state.auctions,
					CREATE_COMMIT_DEADLINE_MS,
					`the lot ${coordinate}`,
				)
				const committedLot = createCommit.state.auctions[coordinate] as { endAt: number; status: string; mode: string; windowSec: number }
				const createDerivedEnd = committedLot.endAt
				expect(committedLot.mode).toBe('antisnipe')
				expect(committedLot.windowSec).toBe(WINDOW_SEC)
				report.lot = {
					eventId: createResult.eventId,
					coordinate,
					seller: sellerPubkey,
					sellerWallet,
					createDerivedEnd,
					createdHeight: createCommit.state.height,
				}

				// The model the bids are assembled against, from the app's own projection.
				const createRaw = await fetchRawById(pool, createResult.eventId)
				if (createRaw === null) throw new Error(`the relay did not serve back the create ${createResult.eventId}`)
				const createView = findAuction(projectRaws([createRaw]).snapshot, coordinate)
				if (createView === null) throw new Error(`the projection did not deliver ${coordinate}`)
				const model = toAuctionDetailModel(createView, { now: nowSec(), status: 'settled' })

				/** Lock a fresh escrow at the mint and build the funding payload, without publishing a bid. */
				const lockEscrow = async (amount: number) => {
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
					return { funding, fundingTerms, source, preLockProofs: funded, walletPrivate, walletPub, quoteId: quote.quote }
				}

				/** Publish one funded bid through the app's own path and poll until consensus commits it. */
				const publishFundedBid = async (
					amount: number,
					label: string,
					lock: Awaited<ReturnType<typeof lockEscrow>>,
					nostrSk: Uint8Array,
				) => {
					const bidderNostrPubkey = getPublicKey(nostrSk)
					const bidResult = await publishArenaBid(
						{ model, status: 'settled', bidder: { pubkey: bidderNostrPubkey, wallet: 'ready' }, raw: String(amount) },
						{
							signer: {
								pubkey: bidderNostrPubkey,
								sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
									finalizeEvent(template, nostrSk) as unknown as Event,
							},
							publisher: publisher(pool),
							relays: [RELAY],
							now: nowSec(),
							funding: lock.funding,
							fundingTerms: lock.fundingTerms,
						},
					)
					expect(bidResult.outcome).toBe('accepted')
					const commit = await pollChainUntil(
						CHAIN_STATE_URL,
						(state) => bidResult.eventId in state.bids,
						BID_COMMIT_DEADLINE_MS,
						`the bid ${label} (${bidResult.eventId})`,
					)
					// The bid's OWN committed height: the chain's live height at poll time can
					// already be one block ahead of the block the bid landed in.
					const committedBid = commit.state.bids[bidResult.eventId] as { height?: number } | undefined
					return {
						...lock,
						bidEventId: bidResult.eventId,
						nostrSk,
						nostrPubkey: bidderNostrPubkey,
						committedHeight: committedBid?.height ?? commit.state.height,
					}
				}

				const fundAndPublishBid = async (amount: number, label: string, nostrSk = generateSecretKey()) =>
					publishFundedBid(amount, label, await lockEscrow(amount), nostrSk)

				mark('create committed')
				// ---- 3. A funds and bids: the escrow is locked at the mint and committed ----
				const A = await fundAndPublishBid(BID_A_SATS, 'A')
				const aCommit = await fetchChainState(CHAIN_STATE_URL)
				const aCommitted = aCommit.bids[A.bidEventId] as { auction: string; wallet: string; amount: number }
				expect(aCommitted.auction).toBe(coordinate)
				expect(aCommitted.wallet).toBe(A.walletPub)
				expect(aCommitted.amount).toBe(BID_A_SATS)
				const aEscrow = await checkProofsSpent(mintUrl, A.preLockProofs)
				expect(aEscrow.allSpent).toBe(true)
				// The escrow proofs themselves are held (locked to the committee), not spent —
				// they are redeemed by the committee at settle/refund.
				const aLocked = await checkProofsSpent(mintUrl, A.funding.proofs)
				report.bidA = {
					eventId: A.bidEventId,
					wallet: A.walletPub,
					amount: BID_A_SATS,
					committedHeight: A.committedHeight,
					mintInputProofsSpent: aEscrow.allSpent,
					mintEscrowProofsState: [...aLocked.states.entries()],
				}

				mark('A committed')
				// ---- 4. B outbids A: A's kind-1443 refund, and A's balance returns while the lot is OPEN ----
				const B = await fundAndPublishBid(BID_B_SATS, 'B')
				report.bidB = { eventId: B.bidEventId, wallet: B.walletPub, amount: BID_B_SATS, committedHeight: B.committedHeight }

				const refundPoll = await pollRelayForBidReceipts(pool, RELAY, 1443, A.bidEventId, BID_COMMIT_DEADLINE_MS)
				const refundRead = readArenaReceipts(refundPoll.events as ArenaReceiptEventLike[], {})
				expect(refundRead.receipts.length).toBeGreaterThan(0)
				const refund = refundRead.receipts.find((receipt) => receipt.outcome === 'refund' && receipt.bidId === A.bidEventId)
				if (refund === undefined) throw new Error(`the read delivered no verified refund receipt for A's bid ${A.bidEventId}`)
				const refundTotal = refund.outputs
					.filter((output) => output.recipient === A.walletPub)
					.reduce((sum, output) => sum + (output.amount ?? 0), 0)
				expect(refundTotal).toBeGreaterThan(0)
				report.refundReceipt = {
					eventId: refund.eventId,
					bidId: refund.bidId,
					outcome: refund.outcome,
					height: refund.height,
					outputs: refund.outputs.map((output) => ({ recipient: output.recipient, amount: output.amount })),
					refundTotal,
				}

				// The lot must still be OPEN: a leader change refunds the old leader at once, not at close.
				const openLot = await fetchChainState(CHAIN_STATE_URL)
				const openState = openLot.auctions[coordinate] as { status: string; highBid?: string }
				expect(openState.status).toBe('open')
				expect(openState.highBid).toBe(B.bidEventId)
				report.lotOpenAtRefund = { status: openState.status, highBid: openState.highBid, height: openLot.height }

				// The claim path: A's wallet takes the refund, once.
				const balanceBefore = A.source.balance()
				expect(balanceBefore).toBe(0)
				const aClaimHost = {
					getWallet: () => A.source,
					isWalletReady: () => true,
					mint: { cashuWalletForMint: async () => ({ cashuWallet, keysetId }) },
					getWalletP2pk: () => A.walletPub,
					getWalletPrivkey: (pubkey: string) => (pubkey === A.walletPub ? A.walletPrivate : null),
					getExpectedMintUrl: () => mintUrl,
					getWalletMints: () => [mintUrl],
					getExpectedKeysetId: () => keysetId,
					getClaimRecord: () => loadArenaReceiptClaimRecord('lifecycle-A'),
					setClaimRecord: (record: ReturnType<typeof loadArenaReceiptClaimRecord>) => saveArenaReceiptClaimRecord(record, 'lifecycle-A'),
					refresh: async () => {},
					now: () => Date.now(),
				}
				const aClaim = createArenaReceiptClaims(aClaimHost)
				const firstRun = await aClaim.claimReceipts([refund])
				const balanceAfter = A.source.balance()
				expect(firstRun.claimed).toHaveLength(1)
				expect(firstRun.claimed[0].bidId).toBe(A.bidEventId)
				expect(balanceAfter - balanceBefore).toBe(refundTotal)
				report.claimA = { claimed: firstRun.claimed, balanceBefore, balanceAfter, delta: balanceAfter - balanceBefore }

				const secondRun = await aClaim.claimReceipts([refund])
				expect(secondRun.claimed).toEqual([])
				expect(secondRun.refusals.map((entry) => entry.refusal)).toEqual(['arena.claim.already_claimed'])
				expect(A.source.balance()).toBe(balanceAfter)
				report.claimASecondRun = { claimed: secondRun.claimed, refusals: secondRun.refusals, balance: A.source.balance() }

				mark('B committed + refund read + claimed')
				// ---- 5. A bid the chain refused at ADMISSION: no 1450, and the three-state diagnosis ----
				// The chain discards an admission-refused bid in CheckTx with no record (owner
				// ruling). Lock a FRESH escrow (unspent, so the only failure can be the escrow
				// crypto) and drop its DLEQ → `missing DLEQ proof`; the amount is above the
				// current leader so no state-dependent refusal can record it first. Assert it is
				// on the relay and NOT in committed state with NO 1450 naming it, then exercise
				// the app's diagnosis — which states no reason the chain did not.
				const admissionLock = await lockEscrow(ADMISSION_SATS)
				const { content: rawBidContent, tags: rawBidTags } = buildArenaBidContent(model, ADMISSION_SATS, {
					wallet: admissionLock.funding.wallet,
					locktime: admissionLock.funding.locktime,
					outcome_templates: admissionLock.funding.outcome_templates,
					proofs: admissionLock.funding.proofs.map((proof) => ({ id: proof.id, amount: proof.amount, secret: proof.secret, C: proof.C })),
				})
				const refusalBidEvent = finalizeEvent(
					{ kind: ARENA_AUCTION_BID_KIND, created_at: nowSec(), tags: rawBidTags, content: JSON.stringify(rawBidContent) },
					generateSecretKey(),
				) as unknown as Event
				await publisher(pool).publish(refusalBidEvent)
				const admissionRefusedId = refusalBidEvent.id

				const servedRefused = await fetchRawById(pool, admissionRefusedId)
				expect(servedRefused).not.toBeNull()
				const afterRefusal = await pollChainUntil(
					CHAIN_STATE_URL,
					(state) => state.height > openLot.height,
					BID_COMMIT_DEADLINE_MS,
					'a fresh block after the admission-refused bid',
				)
				expect(admissionRefusedId in afterRefusal.state.bids).toBe(false)
				const refuseEvents = await pool.querySync([RELAY], { kinds: [ARENA_REFUSED_KIND], limit: 200 }, { maxWait: 8000 })
				const namedByRefusal = refuseEvents.some((event) => event.tags.some((tag) => tag[0] === 'e' && tag[1] === admissionRefusedId))
				expect(namedByRefusal).toBe(false)
				const advancing = await readChainAdvancing(pool, RELAY, { now: nowSec() })
				expect(advancing.advancing).toBe(true)
				report.admissionRefusedBid = {
					eventId: admissionRefusedId,
					onRelay: servedRefused !== null,
					inCommittedState: false,
					namedBy1450: namedByRefusal,
					chainAdvancing: advancing,
					escrowLocktime: admissionLock.funding.locktime,
				}
				// Not committed, no recorded refusal, chain advancing ⇒ not-accepted, and the app
				// states NO reason (it cannot see one).
				const diagnosis = diagnosePublishedBid({
					eventId: admissionRefusedId,
					seenInRead: false,
					namedByReceipt: false,
					chainAdvancing: advancing.advancing,
					escrowLocktime: admissionLock.funding.locktime,
					refusalReason: null,
				})
				expect(diagnosis.state).toBe('not-accepted')
				expect(diagnosis.reason).toBeNull()
				expect(diagnosis.escrowLocktime).toBe(admissionLock.funding.locktime)
				expect(diagnosis.reclaimable).toBe(true)
				report.admissionDiagnosis = diagnosis

				mark('admission probe done')
				// ---- 6. A bid inside the anti-snipe window moves the COMMITTED end ----
				// The chain extends when a bid lands with less than `windowSec` left, and it
				// VOIDS a rebid from the current leader ("you are already the highest bidder",
				// chain/app.go:740). So the sniper is a distinct identity from B, who leads
				// here. The chain's clock advances in coarse blocks, so target a band well
				// inside the window rather than a single instant.
				const extendDeadline = Date.now() + DURATION_SEC * 1000
				const windowTarget = Math.max(15, WINDOW_SEC - 60)
				let remaining = Number.POSITIVE_INFINITY
				while (remaining > windowTarget) {
					if (Date.now() > extendDeadline) throw new Error('the lot closed before the extension bid could land')
					const state = await fetchChainState(CHAIN_STATE_URL)
					const lot = state.auctions[coordinate] as { endAt: number; status: string }
					if (lot.status !== 'open') throw new Error(`the lot is ${lot.status} before the extension bid`)
					remaining = lot.endAt - state.time
					if (remaining > windowTarget) await sleep(1000)
				}
				report.extensionWindow = { remainingSecAtBid: remaining, windowSec: WINDOW_SEC }

				const Sniper = await fundAndPublishBid(BID_EXTEND_SATS, 'sniper')
				report.bidSniper = {
					eventId: Sniper.bidEventId,
					wallet: Sniper.walletPub,
					bidder: Sniper.nostrPubkey,
					amount: BID_EXTEND_SATS,
					committedHeight: Sniper.committedHeight,
				}

				// The kind-1449 the validator published for the moved end, read from the relay.
				// Poll: it is published in the same pass as the commit, but not instantly.
				const movedEndDeadline = Date.now() + BID_COMMIT_DEADLINE_MS
				let movedRawEvent: RawRelayEvent | null = null
				while (movedRawEvent === null && Date.now() < movedEndDeadline) {
					const lotStateEvents = await pool.querySync([RELAY], { kinds: [ARENA_LOT_STATE_KIND], limit: 300 }, { maxWait: 8000 })
					const movedRawCandidate = lotStateEvents.find((event) => event.tags.some((tag) => tag[0] === 'auction' && tag[1] === coordinate))
					if (movedRawCandidate !== undefined) movedRawEvent = asRaw(movedRawCandidate)
					else await sleep(2000)
				}
				if (movedRawEvent === null) throw new Error(`no kind-1449 committed end arrived for ${coordinate}`)
				const stateHalf = decodeArenaEvent(movedRawEvent as unknown as NostrEventLike, RELAY)
				if (!stateHalf.ok || stateHalf.event.type !== 'lot-state') throw new Error('the 1449 did not decode as lot-state')
				const committedEnd = stateHalf.event.lotState
				expect(committedEnd.auctionId).toBe(coordinate)
				expect(committedEnd.endTime).toBeGreaterThan(createDerivedEnd)
				expect(committedEnd.originalEndTime).not.toBeNull()
				expect(committedEnd.originalEndTime as number).toBe(createDerivedEnd)
				// `extensions` is the PER-BID ORDINAL, not the lot's running count: this is the
				// first extension, so it is 1.
				expect(committedEnd.extensionOrdinal).toBe(1)
				// The anchor is the bid's own committed height.
				expect(committedEnd.height).toBe(Sniper.committedHeight)
				report.committedEnd = {
					eventId: committedEnd.eventId,
					endTime: committedEnd.endTime,
					originalEndTime: committedEnd.originalEndTime,
					extensionOrdinal: committedEnd.extensionOrdinal,
					anchorHeight: committedEnd.height,
					bidCommittedHeight: Sniper.committedHeight,
				}

				// The app's lot view must use the COMMITTED end, not the create-derived one.
				const endView = findAuction(projectRaws([createRaw, movedRawEvent]).snapshot, coordinate)
				if (endView === null) throw new Error(`the projection did not deliver ${coordinate} after the extension`)
				expect(endSourceOf(endView)).toBe('committed')
				expect(auctionEndsAt(endView)).toBe(committedEnd.endTime)
				report.lotView = {
					endSource: endSourceOf(endView),
					endsAt: auctionEndsAt(endView),
					createDerivedEnd,
					committedEnd: committedEnd.endTime,
				}

				mark('extension + committed-end read')
				// ---- 7. The lot closes on the committed end ----
				const closedState = await pollChainUntil(
					CHAIN_STATE_URL,
					(state) => (state.auctions[coordinate] as { status?: string } | undefined)?.status !== 'open',
					TEST_TIMEOUT_MS,
					`the close of ${coordinate}`,
				)
				const closedLot = closedState.state.auctions[coordinate] as { status: string; highBid: string; endAt: number }
				expect(closedLot.status).not.toBe('open')
				expect(closedLot.highBid).toBe(Sniper.bidEventId)
				report.lotClosed = {
					status: closedLot.status,
					highBid: closedLot.highBid,
					endAt: closedLot.endAt,
					height: closedState.state.height,
				}

				// ---- 8. A verdict (1445) names B, anchored ----
				const verdictPollDeadline = Date.now() + BID_COMMIT_DEADLINE_MS
				let winnerVerdict: { eventId: string; height: number } | null = null
				while (Date.now() < verdictPollDeadline) {
					const raw = await pool.querySync([RELAY], { kinds: [1445], limit: 200 }, { maxWait: 6000 })
					const match = raw.find(
						(event) =>
							event.tags.some((tag) => tag[0] === 'auction' && tag[1] === coordinate) &&
							event.tags.some((tag) => tag[0] === 'bid' && tag[1] === Sniper.bidEventId),
					)
					if (match !== undefined) {
						const heightTag = match.tags.find((tag) => tag[0] === 'height')?.[1]
						winnerVerdict = { eventId: match.id, height: heightTag === undefined ? 0 : Number(heightTag) }
						expect(match.content).toContain('winner')
						break
					}
					await sleep(1500)
				}
				if (winnerVerdict === null) throw new Error(`no kind-1445 winner verdict for bid ${Sniper.bidEventId} arrived`)
				expect(winnerVerdict.height).toBeGreaterThan(0)
				report.winnerVerdict = winnerVerdict

				// ---- 9. A settle receipt (1444) records the winner's settlement. ----
				// The app-side defect behind the earlier red run is fixed in this tree: the
				// outcome templates are built by `buildArenaOutcomeTemplate`, which now
				// decomposes every payout into the mint keyset's single denominations
				// (handover §4). A Cashu output must be one denomination — the mint looks the
				// amount up in its keyset and answers POST /v1/swap 400 before it examines a
				// signature — so a pre-signed 72- or 80-sat output could never settle and
				// never refund, and the chain's settler retried it forever. The assertion at
				// the end of the walk stays exactly as strong: it must find the winner's
				// kind-1444 settle receipt.
				const settlePoll = await pollRelayForBidReceipts(pool, RELAY, 1444, Sniper.bidEventId, 25_000).catch(() => null)
				const settleRead = settlePoll === null ? null : readArenaReceipts(settlePoll.events as ArenaReceiptEventLike[], {})
				const settle = settleRead?.receipts.find((receipt) => receipt.outcome === 'settle' && receipt.bidId === Sniper.bidEventId)
				const winnerState = (await fetchChainState(CHAIN_STATE_URL)).bids[Sniper.bidEventId] as
					| { status?: string; settled?: string | null }
					| undefined
				report.settleReceipt =
					settle === undefined
						? {
								reached: false,
								bidId: Sniper.bidEventId,
								coordinate,
								committedStatus: winnerState?.status ?? null,
								committedSettled: winnerState?.settled ?? null,
								defect: 'no kind-1444 settle receipt was read for the winning bid',
							}
						: {
								reached: true,
								eventId: settle.eventId,
								bidId: settle.bidId,
								height: settle.height,
								outputs: settle.outputs.map((output) => ({ recipient: output.recipient, amount: output.amount })),
								destinations: settle.outputs.length,
							}

				// The seller's claim path runs only when a settle receipt exists to claim: with no
				// receipt there is no money to move, and a claim that found nothing would assert
				// nothing. Blocked, not skipped — recorded by name.
				if (settle !== undefined) {
					expect(settle.outputs.length).toBeGreaterThanOrEqual(1)
					const sellerOutputs = settle.outputs.filter((output) => output.recipient === sellerWallet)
					expect(sellerOutputs.length).toBeGreaterThanOrEqual(1)
					const sellerPayout = sellerOutputs.reduce((sum, output) => sum + (output.amount ?? 0), 0)
					expect(sellerPayout).toBeGreaterThan(0)
					const sellerSource = trackedWallet(mintUrl, [] as Proof[])
					const sellerBalanceBefore = sellerSource.balance()
					const sellerClaimHost = {
						getWallet: () => sellerSource,
						isWalletReady: () => true,
						mint: { cashuWalletForMint: async () => ({ cashuWallet, keysetId }) },
						getWalletP2pk: () => sellerWallet,
						getWalletPrivkey: (pubkey: string) => (pubkey === sellerWallet ? sellerWalletPrivate : null),
						getExpectedMintUrl: () => mintUrl,
						getWalletMints: () => [mintUrl],
						getExpectedKeysetId: () => keysetId,
						getClaimRecord: () => loadArenaReceiptClaimRecord('lifecycle-seller'),
						setClaimRecord: (record: ReturnType<typeof loadArenaReceiptClaimRecord>) =>
							saveArenaReceiptClaimRecord(record, 'lifecycle-seller'),
						refresh: async () => {},
						now: () => Date.now(),
					}
					const sellerClaim = createArenaReceiptClaims(sellerClaimHost)
					const sellerRun = await sellerClaim.claimReceipts([settle])
					expect(sellerRun.claimed).toHaveLength(1)
					expect(sellerSource.balance() - sellerBalanceBefore).toBe(sellerPayout)
					report.sellerClaim = { claimed: sellerRun.claimed, balanceBefore: sellerBalanceBefore, balanceAfter: sellerSource.balance() }
				} else {
					report.sellerClaim = { reached: false, reason: 'no kind-1444 settle receipt to claim' }
				}

				// ---- 10. The sniper's claim message reaches the seller, and the fulfilment surface shows it ----
				const orderId = `wsl-order-${Date.now().toString(36)}`
				const claimFields = {
					orderId,
					auctionCoordinates: coordinate,
					auctionEventId: createResult.eventId,
					verdictEventId: winnerVerdict.eventId,
					buyerPubkey: Sniper.nostrPubkey,
					sellerPubkey,
					totalAmountSats: BID_EXTEND_SATS,
					shippingAddress: {
						name: SHIPPING_NAME,
						firstLineOfAddress: SHIPPING_FIRST_LINE,
						city: SHIPPING_CITY,
						zipPostcode: SHIPPING_POSTCODE,
						country: SHIPPING_COUNTRY,
					},
					createdAt: nowSec(),
				}
				const privateClaim = createPrivateAuctionClaimMessage({ ...claimFields, senderPrivateKey: Sniper.nostrSk })
				// The public marker the seller's order surfaces key on — money-free, PII-free.
				const markerEvent = finalizeEvent(
					{
						kind: ORDER_PROCESS_KIND,
						created_at: nowSec(),
						tags: buildAuctionClaimPublicMarkerTags(claimFields),
						content: 'auction claim',
					},
					Sniper.nostrSk,
				) as unknown as Event
				await publisher(pool).publish(privateClaim.giftWrap as unknown as Event)
				await publisher(pool).publish(markerEvent)

				// The DM arrives at the seller: poll the relay for the gift wrap addressed to the seller.
				const dmDeadline = Date.now() + BID_COMMIT_DEADLINE_MS
				let giftWrapRaw: RawRelayEvent | null = null
				while (Date.now() < dmDeadline) {
					const raw = await pool.querySync([RELAY], { kinds: [NIP59_GIFT_WRAP_KIND], '#p': [sellerPubkey], limit: 100 }, { maxWait: 6000 })
					const match = raw.find((event) => event.tags.some((tag) => tag[0] === 'p' && tag[1] === sellerPubkey))
					if (match !== undefined) {
						giftWrapRaw = asRaw(match)
						break
					}
					await sleep(1500)
				}
				if (giftWrapRaw === null) throw new Error(`the sniper's claim gift wrap never reached the seller ${sellerPubkey}`)
				const decrypted = decryptPrivateAuctionClaimMessage({
					giftWrap: giftWrapRaw as unknown as Event,
					recipientPrivateKey: sellerSk,
					expectedSellerPubkey: sellerPubkey,
					expectedBuyerPubkey: Sniper.nostrPubkey,
				})
				expect(decrypted.payload.shippingAddress.name).toBe(SHIPPING_NAME)
				expect(decrypted.payload.shippingAddress.firstLineOfAddress).toBe(SHIPPING_FIRST_LINE)
				expect(decrypted.payload.orderId).toBe(orderId)
				// The app's public marker binds the private payload (one mechanism, no PII in the marker).
				const markerFields = getAuctionClaimPublicMarkerFields(markerEvent as unknown as { pubkey?: string; tags: string[][] })
				expect(markerFields).not.toBeNull()
				expect(
					privateAuctionClaimMatchesPublicMarker(decrypted.payload, markerEvent as unknown as { pubkey?: string; tags: string[][] }),
				).toBe(true)
				report.claimMessage = {
					giftWrapId: giftWrapRaw.id,
					markerEventId: markerEvent.id,
					orderId,
					name: decrypted.payload.shippingAddress.name,
					firstLine: decrypted.payload.shippingAddress.firstLineOfAddress,
					markerBound: true,
				}

				// The seller's fulfilment surface: WHO won, and the ADDRESS. The React component is
				// not rendered here; these are its pure helpers over the same wire reading — the
				// create, the committed end, the bids and the winner verdict, all from the relay.
				const fulfilmentRaws: RawRelayEvent[] = [createRaw, movedRawEvent]
				for (const id of [A.bidEventId, B.bidEventId, Sniper.bidEventId, winnerVerdict.eventId]) {
					const raw = await fetchRawById(pool, id)
					if (raw !== null) fulfilmentRaws.push(raw)
				}
				const fulfilmentView = findAuction(projectRaws(fulfilmentRaws).snapshot, coordinate)
				expect(winningBidderOf(fulfilmentView)).toBe(Sniper.nostrPubkey)
				expect(winningVerdictOf(fulfilmentView)?.bidId).toBe(Sniper.bidEventId)
				const renderedAddress = formatClaimAddress(decrypted.payload.shippingAddress)
				expect(renderedAddress).toContain(SHIPPING_NAME)
				expect(renderedAddress).toContain(SHIPPING_FIRST_LINE)
				report.fulfilmentSurface = {
					winner: winningBidderOf(fulfilmentView),
					winningBidId: winningVerdictOf(fulfilmentView)?.bidId,
					addressRendered: renderedAddress,
					note: 'the pure fulfilment helpers over the wire reading; the React AuctionFulfilmentHost is not rendered',
				}

				// ---- 11. A create the published rules refuse: a kind-1450, and the chain records it ----
				const refusedD = `wsl-refused-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
				const refusedCoordinate = `1440:${sellerPubkey}:${refusedD}`
				const longTitle = 'x'.repeat((rules.max_title_chars ?? 120) + 5)
				const refusedForm = { ...createForm, auctionId: refusedD, title: longTitle, imageUrl: 'https://picsum.photos/seed/wsl-refused/200' }
				// The app's own pre-flight refuses this create with the chain's rule…
				const refusedIssues = getArenaCreateIssues(refusedForm, { sellerWallet, rules })
				expect(refusedIssues.map((issue) => issue.refusal)).toContain('create.title-too-long')
				// …and publishing it straight (bypassing the editor gate) reaches the chain, which refuses it.
				const refusedCreate = await publishArenaCreate(refusedForm, {
					sellerPubkey,
					sellerWallet,
					signer: {
						pubkey: sellerPubkey,
						sign: async (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
							finalizeEvent(template, sellerSk) as unknown as Event,
					},
					publisher: publisher(pool),
					relays: [RELAY],
					now: nowSec(),
				})
				expect(refusedCreate.outcome).toBe('accepted')

				// The chain records the refusal at a height, with its own reason.
				const refusalRecorded = await pollChainUntil(
					CHAIN_STATE_URL,
					(state) => (state.rejections ?? []).some((rejection) => rejection.event === refusedCreate.eventId),
					BID_COMMIT_DEADLINE_MS,
					`the create refusal of ${refusedCreate.eventId}`,
				)
				const chainRejection = (refusalRecorded.state.rejections ?? []).find((rejection) => rejection.event === refusedCreate.eventId)
				if (chainRejection === undefined) throw new Error('the chain recorded the create refusal but the poll did not find it')
				expect(chainRejection.kind).toBe(ARENA_AUCTION_CREATE_KIND)
				expect(refusedCoordinate in refusalRecorded.state.auctions).toBe(false)

				// The 1450 on the relay names it, with the chain's reason verbatim.
				const refusalPollDeadline = Date.now() + BID_COMMIT_DEADLINE_MS
				let refusalEvent: RawRelayEvent | null = null
				while (Date.now() < refusalPollDeadline) {
					const raw = await pool.querySync([RELAY], { kinds: [ARENA_REFUSED_KIND], limit: 200 }, { maxWait: 6000 })
					const match = raw.find((event) => event.tags.some((tag) => tag[0] === 'e' && tag[1] === refusedCreate.eventId))
					if (match !== undefined) {
						refusalEvent = asRaw(match)
						break
					}
					await sleep(1500)
				}
				if (refusalEvent === null) throw new Error(`no kind-1450 named the refused create ${refusedCreate.eventId}`)
				const parsedRefusal = parseArenaRefusalEvent(refusalEvent as unknown as Parameters<typeof parseArenaRefusalEvent>[0])
				expect(parsedRefusal.refusedEventId).toBe(refusedCreate.eventId)
				expect(parsedRefusal.refusedKind).toBe(ARENA_AUCTION_CREATE_KIND)
				expect(parsedRefusal.reason).toBe(chainRejection.reason)
				expect(parsedRefusal.height).toBe(chainRejection.height)
				report.refusal = {
					createEventId: refusedCreate.eventId,
					coordinate: refusedCoordinate,
					refusalEventId: parsedRefusal.eventId,
					refusalHeight: parsedRefusal.height,
					chainReason: chainRejection.reason,
					reasonVerbatim: parsedRefusal.reason,
					preflightRefusal: refusedIssues.map((issue) => issue.refusal),
				}

				// The lot view renders the refusal verbatim: the app's detail model carries it.
				const refusedCreateRaw = await fetchRawById(pool, refusedCreate.eventId)
				expect(refusedCreateRaw).not.toBeNull()
				const refusedView = findAuction(projectRaws([refusedCreateRaw as RawRelayEvent, refusalEvent]).snapshot, refusedCoordinate)
				if (refusedView === null) throw new Error(`the projection did not deliver the refused create ${refusedCoordinate}`)
				const refusedModel = toAuctionDetailModel(refusedView, { now: nowSec(), status: 'settled' })
				expect(refusedModel.createRefusal?.reason).toBe(parsedRefusal.reason)
				report.refusalRendered = {
					modelCreateRefusalReason: refusedModel.createRefusal?.reason ?? null,
					refusalEventId: refusedModel.createRefusal?.refusalEventId ?? null,
				}

				// ---- THE SETTLE ASSERTION, last so every other step is exercised first ----
				// It is NOT weakened and NOT skipped: it requires the winner's kind-1444 settle
				// receipt, which the fixed denomination decomposition now lets the mint honour.
				// The escrows this walk binds are throwaway test lots.
				report.throwaway = {
					coordinate,
					seller: sellerPubkey,
					bids: {
						A: { eventId: A.bidEventId, amount: BID_A_SATS, note: 'outbid; refunded and claimed' },
						B: { eventId: B.bidEventId, amount: BID_B_SATS, note: 'outbid leader; loser refund due at close' },
						sniper: {
							eventId: Sniper.bidEventId,
							amount: BID_EXTEND_SATS,
							note: 'WINNING escrow, settled to the seller when the settle step passes',
						},
					},
					admissionProbeEscrow: {
						eventId: admissionRefusedId,
						amount: ADMISSION_SATS,
						note: 'the admission-refused bid\u2019s escrow, locked at the mint and never spent — throwaway',
					},
				}
				console.log(`WS-E live lifecycle — ARTIFACTS\n${JSON.stringify(report, null, 2)}`)

				expect(
					settle !== undefined,
					`the chain settled no kind-1444 receipt for the winning bid ${Sniper.bidEventId} ` +
						`(committed status ${winnerState?.status ?? 'unknown'}, settled ${JSON.stringify(winnerState?.settled ?? null)}). ` +
						`VALIDATED CAUSE (handover §4): the pre-signed outcome templates asked for output amounts that are not mint ` +
						`denominations, so POST /v1/swap answered 400 before any signature was examined and the escrow could never ` +
						`settle or refund. This tree decomposes every payout into the keyset's denominations; if this assertion still ` +
						`fires, read the mint's and the chain's refusal for the winning escrow rather than assuming a regression here.`,
				).toBe(true)
			} finally {
				pool.close([RELAY])
			}
		},
		TEST_TIMEOUT_MS,
	)
})

afterAll(() => {
	if (!LIVE) console.log('AUCTIONS_LIVE is unset — the live lifecycle end-to-end was skipped.')
})
