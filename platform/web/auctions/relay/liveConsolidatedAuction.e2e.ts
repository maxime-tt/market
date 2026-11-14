/**
 * `platform/web/auctions/relay/liveConsolidatedAuction.e2e.ts` — the LIVE end-to-end
 * proof of the consolidated auction protocol against the demo stack on this box.
 *
 * Gated: it does nothing unless `AUCTIONS_LIVE=1`, so the normal unit suite
 * (`find … -name '*.test.ts'`) never picks it up. Run it explicitly:
 *
 *   AUCTIONS_LIVE=1 /home/admin_maxime/.bun/bin/bun test \
 *     platform/web/auctions/relay/liveConsolidatedAuction.e2e.ts
 *
 * What it drives, with REAL primitives (no re-implementations):
 *
 *   (a) a kind-1440 create, signed with `nostr-tools`, published to the demo relay and
 *       read back through `createArenaAuctionRead` — the app's own gate;
 *   (b) a kind-1441 bid carrying the escrow funding payload: Cashu proofs actually
 *       swapped at the demo mint (127.0.0.1:3338) into a 2-of-2 NUT-11 SIG_ALL lock
 *       under the chain's committee key, plus the two outcome templates built and
 *       signed by `arenaBidFunding` — published and read back;
 *   (c) the kind-1445 verdict path: what exists on the relay, and whether the app's
 *       read adapter folds an anchored, per-validator verdict.
 *
 * It is honest by construction: every relay answer, every event id, every mint
 * proof and every refusal is printed as measured. Where a link of the chain cannot
 * work, the step records the exact refusal (HTTP status + body / relay frame /
 * adapter refusal name) and the run ends red, naming the break. It never fabricates
 * a "pass" for a step it did not observe.
 */
import { describe, expect, test } from 'bun:test'
import { Mint, Wallet, hashToCurve, schnorrSignDigest, type Proof } from '@cashu/cashu-ts'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
	arenaBidLocktimeFloor,
	arenaWalletPubkey,
	buildArenaBidFunding,
	buildArenaEscrowLockOptions,
	parseArenaEscrowLock,
	verifyArenaBidFunding,
	type ArenaBidFunding,
	type ArenaEscrowProof,
} from './arenaBidFunding'
import { buildArenaBidContent } from './arenaBidPublish'
import type { EventFilter, EventStreamItem, NostrEventLike } from '@sdk/core'
import {
	arenaAuctionCoordinate,
	createArenaAuctionRead,
	decodeArenaEvent,
	type ArenaAuctionSnapshot,
	type ArenaRelayOpen,
} from './arenaAuctionRead'

/** What `openRelay` yields: the SDK's own stream item shape, per relay. */
type ArenaRelayStreamItem = EventStreamItem<NostrEventLike>

const LIVE = process.env.AUCTIONS_LIVE === '1'

const BASE = (process.env.AUCTIONS_POC_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const RELAY = (process.env.AUCTIONS_RELAY_URL ?? 'ws://127.0.0.1:7777').replace(/\/$/, '')
const MINT = (process.env.AUCTIONS_MINT_URL ?? 'http://127.0.0.1:3338').replace(/\/$/, '')
const BID_AMOUNT = 128

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// =========================================================================
// Measured steps: recorded, printed, and never silently "passed"
// =========================================================================

interface StepResult {
	name: string
	ok: boolean
	/** What was observed, in the units of the thing observed (ids, codes, sums). */
	measured: string
}

const results: StepResult[] = []

function record(name: string, ok: boolean, measured: string): void {
	results.push({ name, ok, measured })
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${measured}`)
}

// =========================================================================
// HTTP + relay primitives
// =========================================================================

async function http(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; text: string }> {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	return { status: response.status, text: await response.text() }
}

interface RelayOk {
	/** The literal frame the relay sent back, e.g. ["OK","<id>",true,""]. */
	frame: string
	id: string
	accepted: boolean
	message: string
}

/**
 * Publish one signed event to one relay over a real WebSocket and return the
 * literal OK frame. This is the wire, not a client library's summary of it.
 */
async function publishToRelay(event: { id: string }, url = RELAY): Promise<RelayOk> {
	return new Promise<RelayOk>((resolve, reject) => {
		const socket = new WebSocket(url)
		const timer = setTimeout(() => {
			socket.close()
			reject(new Error(`relay ${url} did not answer EVENT within 10s`))
		}, 10_000)
		socket.onopen = () => socket.send(JSON.stringify(['EVENT', event]))
		socket.onmessage = (message) => {
			const frame = String(message.data)
			let parsed: unknown
			try {
				parsed = JSON.parse(frame)
			} catch {
				return
			}
			if (!Array.isArray(parsed) || parsed[0] !== 'OK') return
			clearTimeout(timer)
			socket.close()
			resolve({
				frame,
				id: String(parsed[1]),
				accepted: parsed[2] === true,
				message: typeof parsed[3] === 'string' ? parsed[3] : '',
			})
		}
		socket.onerror = () => {
			clearTimeout(timer)
			reject(new Error(`relay ${url} socket error`))
		}
	})
}

/** Query one relay for a set of filters and collect raw events until EOSE. */
async function queryRelay(filters: object[], url = RELAY, timeoutMs = 8000): Promise<Record<string, unknown>[]> {
	return new Promise<Record<string, unknown>[]>((resolve) => {
		const socket = new WebSocket(url)
		const events: Record<string, unknown>[] = []
		const finish = () => {
			try {
				socket.close()
			} catch {
				/* already closed */
			}
			resolve(events)
		}
		const timer = setTimeout(finish, timeoutMs)
		socket.onopen = () => socket.send(JSON.stringify(['REQ', `e2e-${Date.now()}`, ...filters]))
		socket.onmessage = (message) => {
			let parsed: unknown
			try {
				parsed = JSON.parse(String(message.data))
			} catch {
				return
			}
			if (!Array.isArray(parsed)) return
			if (parsed[0] === 'EVENT' && typeof parsed[2] === 'object' && parsed[2] !== null) {
				events.push(parsed[2] as Record<string, unknown>)
			}
			if (parsed[0] === 'EOSE' || parsed[0] === 'CLOSED' || parsed[0] === 'NOTICE') {
				clearTimeout(timer)
				finish()
			}
		}
		socket.onerror = () => {
			clearTimeout(timer)
			finish()
		}
	})
}

/**
 * The `openRelay` seam `createArenaAuctionRead` asks a host for: one relay, a
 * real REQ, events as they arrive, and the caught-up marker at EOSE.
 */
function openRelay(url: string): ArenaRelayOpen {
	const open: ArenaRelayOpen = (filters, options) => ({
		async *[Symbol.asyncIterator](): AsyncIterator<ArenaRelayStreamItem> {
			const queue: ArenaRelayStreamItem[] = []
			let wake: (() => void) | null = null
			let closed = false
			const push = (item: ArenaRelayStreamItem) => {
				queue.push(item)
				wake?.()
				wake = null
			}
			const socket = new WebSocket(url)
			const onAbort = () => {
				closed = true
				try {
					socket.close()
				} catch {
					/* already closed */
				}
				push({ type: 'caught-up', info: { eose: [], pending: [url], complete: false } })
			}
			options.signal?.addEventListener('abort', onAbort)
			socket.onopen = () => socket.send(JSON.stringify(['REQ', `read-${Date.now()}`, ...filters]))
			socket.onmessage = (message) => {
				let parsed: unknown
				try {
					parsed = JSON.parse(String(message.data))
				} catch {
					return
				}
				if (!Array.isArray(parsed)) return
				if (parsed[0] === 'EVENT') push({ type: 'event', event: parsed[2] as NostrEventLike })
				else if (parsed[0] === 'EOSE') push({ type: 'caught-up', info: { eose: [url], pending: [], complete: options.bounded === true } })
			}
			socket.onclose = () => {
				closed = true
				push({ type: 'caught-up', info: { eose: [], pending: [url], complete: false } })
			}
			try {
				while (true) {
					if (queue.length === 0) {
						if (closed) break
						await new Promise<void>((resolve) => {
							wake = resolve
						})
						continue
					}
					const item = queue.shift() as ArenaRelayStreamItem
					yield item
					if (item.type === 'caught-up' && options.bounded === true) break
				}
			} finally {
				options.signal?.removeEventListener('abort', onAbort)
				try {
					socket.close()
				} catch {
					/* already closed */
				}
			}
		},
	})
	return open
}

async function snapshot(): Promise<ArenaAuctionSnapshot> {
	const read = createArenaAuctionRead({ relays: [RELAY], openRelay, deadlineMs: 6000 })
	const value = await read.snapshot()
	read.close()
	return value
}

/** NUT-07 for a set of proofs, straight from the mint, keyed by Y. */
async function mintStates(proofs: readonly { secret: string }[]): Promise<Record<string, string>> {
	const Ys = proofs.map((proof) => hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true))
	const response = await fetch(`${MINT}/v1/checkstate`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ Ys }),
	})
	const body = (await response.json()) as { states?: { Y: string; state: string }[] }
	return Object.fromEntries((body.states ?? []).map((state) => [state.Y, state.state]))
}

const asEscrowProof = (proof: Proof): ArenaEscrowProof => ({
	id: proof.id,
	amount: Number(proof.amount),
	secret: proof.secret,
	C: proof.C,
})

// =========================================================================
// The live run
// =========================================================================

describe.skipIf(!LIVE)('live consolidated auction e2e', () => {
	test('1440 create, SIG_ALL-funded 1441, and the 1445 verdict path against the demo stack', async () => {
		console.log(`\n=== live target: poc=${BASE} relay=${RELAY} mint=${MINT} ===\n`)

		// ---- preflight ----------------------------------------------------
		const configResponse = await http('GET', '/api/config')
		const config = JSON.parse(configResponse.text) as Record<string, string | number | boolean>
		const stateResponse = await http('GET', '/api/state')
		const stateBody = JSON.parse(stateResponse.text) as { state: Record<string, unknown> }
		const committeeKey = String(config.committee_public_key)
		const chainHeight = Number((stateBody.state as { height?: number }).height)
		const mintInfo = (await (await fetch(`${MINT}/v1/info`)).json()) as { version?: string }
		const keysets = (await (await fetch(`${MINT}/v1/keysets`)).json()) as { keysets: { id: string; active: boolean }[] }
		const activeKeyset = keysets.keysets.find((keyset) => keyset.active)?.id ?? ''
		console.log(
			`preflight: HTTP /api/config ${configResponse.status} chain=${config.chain_id} height=${chainHeight}\n` +
				`           committee=${committeeKey}\n` +
				`           mint version=${mintInfo.version} active keyset=${activeKeyset}\n` +
				`           config.funding_mode=${config.funding_mode} mint_backed_funding=${config.mint_backed_funding}`,
		)
		record(
			'preflight: committee key + active keyset present',
			/^0[23][0-9a-f]{64}$/.test(committeeKey) && /^[0-9a-f]{66}$/.test(activeKeyset),
			`committee=${committeeKey} keyset=${activeKeyset}`,
		)

		// ---- keys ---------------------------------------------------------
		const sellerSecret = generateSecretKey()
		const seller = getPublicKey(sellerSecret)
		const bidderSecret = generateSecretKey()
		const bidder = getPublicKey(bidderSecret)
		const sellerWalletSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
		const sellerWallet = arenaWalletPubkey(sellerWalletSecret)
		const bidderWalletSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
		const bidderWallet = arenaWalletPubkey(bidderWalletSecret)
		const d = `live-e2e-${Date.now()}`
		const coordinate = arenaAuctionCoordinate(seller, d)
		console.log(`identities: seller=${seller} sellerWallet=${sellerWallet}\n            bidder=${bidder} bidderWallet=${bidderWallet}\n            d=${d}`)

		// =================================================================
		// (a) the 1440 create
		// =================================================================
		const durationSeconds = 600
		const createContent = {
			auction_id: d,
			title: 'Live consolidated e2e lot',
			description: 'throwaway live e2e',
			image_url: '',
			duration_seconds: durationSeconds,
			starting_bid: 100,
			min_increment: 10,
			reserve: 0,
			funding_mode: 'cashu_sigall_v1',
			seller_coco_payment_public_key: sellerWallet,
			late_bid_window_seconds: 0,
			late_bid_extension_seconds: 0,
			max_total_extension_seconds: 0,
		}
		const create = finalizeEvent(
			{ kind: 1440, created_at: Math.floor(Date.now() / 1000), tags: [['d', d]], content: JSON.stringify(createContent) },
			sellerSecret,
		)
		console.log(`\n--- (a) 1440 create ---\nevent id=${create.id}`)
		const createAck = await publishToRelay(create)
		record('(a) relay accepted the 1440 create', createAck.accepted && createAck.id === create.id, `frame=${createAck.frame}`)

		const afterCreate = await snapshot()
		const createdView = afterCreate.auctions.find((auction) => auction.d === d)
		record(
			'(a) app read adapter read the 1440 back as a canonical auction',
			createdView !== undefined &&
				createdView.rootEventId === create.id &&
				createdView.seller === seller &&
				createdView.content.startingBid === 100 &&
				createdView.content.fundingMode === 'cashu_sigall_v1',
			createdView === undefined
				? `auction ${d} is absent from the snapshot (auctions=${afterCreate.auctions.length}, refusals=${JSON.stringify(afterCreate.refusals)})`
				: `coordinate=${createdView.coordinate} rootEventId=${createdView.rootEventId} title=${JSON.stringify(createdView.content.title)} startingBid=${createdView.content.startingBid} fundingMode=${createdView.content.fundingMode}`,
		)

		// The chain is a second, independent consumer of the same bytes.
		let auctionCommitted: Record<string, unknown> | undefined
		for (let attempt = 0; attempt < 25 && auctionCommitted === undefined; attempt += 1) {
			const state = JSON.parse((await http('GET', '/api/state')).text).state as { auctions?: Record<string, Record<string, unknown>> }
			auctionCommitted = state.auctions?.[d]
			if (auctionCommitted === undefined) await sleep(1000)
		}
		let createSubmit: { status: number; text: string } | undefined
		if (auctionCommitted === undefined) createSubmit = await http('POST', '/api/event', create)
		record(
			'(a) the chain committed the 1440 create',
			auctionCommitted !== undefined,
			auctionCommitted !== undefined
				? `state.auctions[${d}] funding_mode=${auctionCommitted.funding_mode} end_time=${auctionCommitted.end_time} required_locktime=${auctionCommitted.required_locktime}`
				: `no observer commit within 25s; POST /api/event -> HTTP ${createSubmit?.status} ${createSubmit?.text.trim()}`,
		)

		// Diagnostic, not a substitute: the identical event on the kind this binary's
		// protocol map does know tells "stale chain build" apart from "bad event".
		let legacyProbeRootId: string | undefined
		if (auctionCommitted === undefined) {
			const legacyProbe = finalizeEvent(
				{
					kind: 28640,
					created_at: Math.floor(Date.now() / 1000),
					tags: [
						['t', 'plebeian-auctions-poc'],
						['auction', `${d}-probe`],
					],
					content: JSON.stringify({ ...createContent, auction_id: `${d}-probe` }),
				},
				sellerSecret,
			)
			const legacy = await http('POST', '/api/event', legacyProbe)
			if (legacy.status === 200) legacyProbeRootId = legacyProbe.id
			console.log(
				`diagnostic: the SAME create content on kind 28640 -> HTTP ${legacy.status} ${legacy.text.trim()}\n` +
					`            (28640 is the pre-1440 kind map; this isolates the kind map from the event)`,
			)
		}

		// =================================================================
		// (b) the SIG_ALL-funded 1441
		// =================================================================
		const endAt = Number(create.created_at) + durationSeconds
		const locktime = arenaBidLocktimeFloor({ mode: 'fixed', endAt, now: Number(create.created_at) })
		console.log(`\n--- (b) SIG_ALL escrow ---\nlocktime floor = ${locktime} (end ${endAt} + 900s safety + 15s latency)`)

		// Real money: mint fake sats at the demo mint, then swap them into the lock.
		const mint = new Mint(MINT)
		const wallet = new Wallet(mint, { unit: 'sat' })
		await wallet.loadMint()
		const quote = await wallet.createMintQuoteBolt11(BID_AMOUNT)
		const minted = await wallet.mintProofsBolt11(BID_AMOUNT, quote)
		const mintedSum = minted.reduce((total, proof) => total + Number(proof.amount), 0)
		record(
			'(b) mint issued real proofs at the demo mint',
			mintedSum === BID_AMOUNT,
			`quote=${quote.quote} (state at creation=${quote.state}; FakeWallet settles on mintProofs) proofs=${minted.length} sum=${mintedSum} amounts=[${minted.map((proof) => Number(proof.amount)).join(',')}] ids=[${minted.map((proof) => proof.id).join(',')}]`,
		)

		const lockOptions = buildArenaEscrowLockOptions({ bidderWallet, committeeKey, locktime })
		const locked = await wallet.send(BID_AMOUNT, minted, undefined, { send: { type: 'p2pk', options: lockOptions } })
		const escrowProofs = locked.send.map(asEscrowProof)
		const escrowSum = escrowProofs.reduce((total, proof) => total + proof.amount, 0)
		console.log(`            locked secret: ${escrowProofs[0]?.secret}`)
		const parsedLock = escrowProofs[0] === undefined ? null : parseArenaEscrowLock(escrowProofs[0].secret, { bidderWallet, committeeKey, minLocktime: locktime })
		record(
			'(b) the mint swapped the proofs into a 2-of-2 NUT-11 SIG_ALL lock',
			locked.send.length > 0 && escrowSum === BID_AMOUNT && parsedLock !== null && parsedLock.locktime === locktime && locked.keep.length === 0,
			`send=${locked.send.length} sum=${escrowSum} keep=${locked.keep.length} tags=${parsedLock === null ? 'unparsed' : JSON.stringify(parsedLock.tags)}`,
		)

		const preStates = await mintStates(escrowProofs)
		record(
			'(b) NUT-07 reports the locked inputs UNSPENT before the bid',
			escrowProofs.every((proof) => preStates[hashToCurve(new TextEncoder().encode(proof.secret)).toHex(true)] === 'UNSPENT'),
			`${JSON.stringify(preStates)}`,
		)

		const funding: ArenaBidFunding = await buildArenaBidFunding({
			proofs: escrowProofs,
			sellerWallet,
			bidderWallet,
			committeeKey,
			keysetId: activeKeyset,
			minLocktime: locktime,
			signer: {
				pubkey: bidderWallet,
				signDigest: (digestHex) => schnorrSignDigest(digestHex, bidderWalletSecret),
			},
		})
		const terms = { bidderWallet, sellerWallet, committeeKey, keysetId: activeKeyset, minLocktime: locktime }
		let fundingVerifies = false
		let fundingRefusal = ''
		try {
			verifyArenaBidFunding(funding, terms)
			fundingVerifies = true
		} catch (error) {
			fundingRefusal = error instanceof Error ? `${(error as { refusal?: string }).refusal ?? 'unknown'}: ${error.message}` : String(error)
		}
		record(
			'(b) both pre-signed outcome templates verify against the wallet spend key',
			fundingVerifies,
			fundingVerifies
				? `settle: ${funding.outcome_templates.settle.outputs.length} output(s) ${JSON.stringify(funding.outcome_templates.settle.outputs.map((output) => output.amount))} digest=${funding.outcome_templates.settle.digest}\n` +
						`        refund: ${funding.outcome_templates.refund.outputs.length} output(s) ${JSON.stringify(funding.outcome_templates.refund.outputs.map((output) => output.amount))} digest=${funding.outcome_templates.refund.digest}\n` +
						`        settlement digest (golden-pinned layout B) = ${funding.outcome_templates.settle.digest}`
				: fundingRefusal,
		)

		const built = buildArenaBidContent({ d, seller, rootEventId: create.id, coordinate }, BID_AMOUNT, funding)
		const bid = finalizeEvent(
			{ kind: 1441, created_at: Math.floor(Date.now() / 1000), tags: built.tags, content: JSON.stringify(built.content) },
			bidderSecret,
		)
		console.log(`\n--- (b) 1441 bid ---\nevent id=${bid.id}\ntags=${JSON.stringify(bid.tags)}\ncontent keys=${Object.keys(JSON.parse(bid.content)).join(',')}`)
		const bidAck = await publishToRelay(bid)
		record('(b) relay accepted the 1441 bid', bidAck.accepted && bidAck.id === bid.id, `frame=${bidAck.frame}`)

		const afterBid = await snapshot()
		const bidView = afterBid.auctions.find((auction) => auction.d === d)?.bids.find((entry) => entry.eventId === bid.id)
		// The projection keeps only what a view needs; the `e`/`a` binding is on the
		// decoded event, so read the wire copy back and run it through the same gate.
		const storedBidEvents = await queryRelay([{ kinds: [1441], ids: [bid.id] }])
		const storedBid = storedBidEvents[0] as unknown as Parameters<typeof decodeArenaEvent>[0] | undefined
		const storedBidDecoded = storedBid === undefined ? null : decodeArenaEvent(storedBid, RELAY)
		const bidBinding =
			storedBidDecoded !== null && storedBidDecoded.ok && storedBidDecoded.event.type === 'bid' ? storedBidDecoded.event : null
		const storedContent =
			storedBid === undefined ? null : (JSON.parse(String(storedBid.content)) as Record<string, unknown>)
		const storedProofs = (storedContent?.proofs ?? []) as { amount: number }[]
		const storedSum = storedProofs.reduce((total, proof) => total + Number(proof.amount), 0)
		record(
			'(b) app read adapter read the 1441 back and bound it to the root',
			bidView !== undefined &&
				bidView.amount === BID_AMOUNT &&
				bidView.bidder === bidder &&
				bidBinding !== null &&
				bidBinding.rootEventId === create.id &&
				bidBinding.coordinate === coordinate &&
				storedSum === BID_AMOUNT,
			bidView === undefined
				? `bid ${bid.id} is absent from the snapshot (refusals=${JSON.stringify(afterBid.refusals)})`
				: `bid=${bidView.eventId} amount=${bidView.amount} bidder=${bidView.bidder.slice(0, 12)}… e=${bidBinding?.rootEventId ?? 'unparsed'} a=${bidBinding?.coordinate ?? 'unparsed'} stored proofs sum=${storedSum} templates=${storedContent?.outcome_templates === undefined ? 'MISSING' : 'present'}`,
		)

		let bidCommitted: Record<string, unknown> | undefined
		for (let attempt = 0; attempt < 20 && bidCommitted === undefined; attempt += 1) {
			const state = JSON.parse((await http('GET', '/api/state')).text).state as { bids?: Record<string, Record<string, unknown>> }
			bidCommitted = state.bids?.[bid.id]
			if (bidCommitted === undefined) await sleep(1000)
		}
		const bidSubmit = bidCommitted === undefined ? await http('POST', '/api/event', bid) : undefined
		record(
			'(b) the chain committed the 1441 bid (funding verified in consensus)',
			bidCommitted !== undefined,
			bidCommitted !== undefined
				? `state.bids[${bid.id}] amount=${bidCommitted.amount} token=${String(bidCommitted.cashu_token_sha256).slice(0, 12)}…`
				: `no observer commit within 20s; POST /api/event -> HTTP ${bidSubmit?.status} ${bidSubmit?.text.trim()}`,
		)

		// The same content on the kind this binary knows isolates the content-shape
		// refusal from the kind-map refusal. Purely diagnostic.
		if (bidCommitted === undefined && legacyProbeRootId !== undefined) {
			const shapeProbe = finalizeEvent(
				{ kind: 28641, created_at: Math.floor(Date.now() / 1000), tags: built.tags, content: JSON.stringify(built.content) },
				bidderSecret,
			)
			const shape = await http('POST', '/api/event', shapeProbe)
			console.log(`diagnostic: the consolidated 1441 content on kind 28641 -> HTTP ${shape.status} ${shape.text.trim()}`)

			// Second diagnostic: drop exactly the two fields the decoder rejects
			// (`auction`, `wallet`) and keep the escrow fields. Whatever it refuses
			// with now is the next rule the app's 1441 shape meets, not JSON shape.
			const fundingOnlyShape = finalizeEvent(
				{
					kind: 28641,
					created_at: Math.floor(Date.now() / 1000),
					tags: [['e', legacyProbeRootId]],
					content: JSON.stringify({ auction_id: `${d}-probe`, amount: BID_AMOUNT, proofs: escrowProofs }),
				},
				bidderSecret,
			)
			const fundingOnly = await http('POST', '/api/event', fundingOnlyShape)
			console.log(
				`diagnostic: the same bid with only auction_id/amount/proofs on kind 28641 -> HTTP ${fundingOnly.status} ${fundingOnly.text.trim()}`,
			)
		}

		// =================================================================
		// (c) the 1445 verdict path
		// =================================================================
		console.log('\n--- (c) kind-1445 verdicts ---')
		console.log(
			`chain state exposes height=${chainHeight} but no block hash: /api/state keys = [${Object.keys(stateBody.state).join(', ')}]`,
		)
		const verdictsOnRelay = await queryRelay([{ kinds: [1445] }])
		console.log(
			`relay kind-1445 inventory: ${verdictsOnRelay.length} event(s)` +
				verdictsOnRelay
					.map((event) => `\n   id=${String(event.id)} pubkey=${String(event.pubkey)} created_at=${String(event.created_at)} tags=${JSON.stringify(event.tags)}`)
					.join(''),
		)
		const forThisAuction = verdictsOnRelay.filter((event) => JSON.stringify(event.tags ?? []).includes(d) || String(event.content ?? '').includes(d))
		record(
			'(c) the validators published a 1445 verdict for this auction',
			forThisAuction.length > 0,
			`${forThisAuction.length} verdict(s) name ${d}; relay total kind-1445 = ${verdictsOnRelay.length}`,
		)

		// What the chain itself emits as its kind-1445 record (READ-FROM-SOURCE:
		// internal/poc/demo_outcome_sweeper.go postOutcome — no tags, schema
		// PlebeianAuctionsPOCOutcomeV1, signed by the single committee key).
		const chainOutcomeShape = {
			kind: 1445,
			pubkey: committeeKey.slice(2),
			created_at: Math.floor(Date.now() / 1000),
			tags: [] as string[][],
			content: JSON.stringify({
				schema: 'PlebeianAuctionsPOCOutcomeV1',
				auction_id: d,
				bid_id: bid.id,
				outcome: 'settle',
				payout_token_sha256: '0'.repeat(64),
			}),
			id: 'f'.repeat(64),
			sig: '0'.repeat(128),
		}
		const chainOutcomeDecoded = decodeArenaEvent(chainOutcomeShape, RELAY)
		// A 1445 with the app's schema but no anchor, to show the two independent
		// reasons the chain's own record cannot be read as a verdict.
		const unanchoredShape = {
			...chainOutcomeShape,
			tags: [] as string[][],
			content: JSON.stringify({ schema: 'arena.verdict.v1', auction_id: d, outcome: 'winner' }),
			id: 'e'.repeat(64),
		}
		const unanchoredDecoded = decodeArenaEvent(unanchoredShape, RELAY)
		record(
			"(c) the app's gate refuses the chain's own 1445 record (schema and/or anchor)",
			!chainOutcomeDecoded.ok &&
				!unanchoredDecoded.ok &&
				unanchoredDecoded.refusal.reason === 'arena.unanchored',
			`chain record (postOutcome shape): ${chainOutcomeDecoded.ok ? 'ACCEPTED (unexpected)' : `${chainOutcomeDecoded.refusal.reason} — ${chainOutcomeDecoded.refusal.detail}`}\n` +
				`        right schema, no anchor: ${unanchoredDecoded.ok ? 'ACCEPTED (unexpected)' : `${unanchoredDecoded.refusal.reason} — ${unanchoredDecoded.refusal.detail}`}`,
		)

		// Read-path positive control: two anchored verdicts, one per (test-authored)
		// validator key. This proves the ADAPTER folds per-validator verdicts; it is
		// NOT evidence that the validators publish them.
		const controlValidators = [generateSecretKey(), generateSecretKey()]
		const controlEvents = controlValidators.map((secret, index) =>
			finalizeEvent(
				{
					kind: 1445,
					created_at: Math.floor(Date.now() / 1000),
					tags: [
						['auction', d],
						['bid', bid.id],
						['height', String(chainHeight)],
						['hash', (index === 0 ? 'ab' : 'cd').repeat(32)],
						['p', getPublicKey(secret)],
					],
					content: JSON.stringify({
						schema: 'arena.verdict.v1',
						auction_id: d,
						bid_id: bid.id,
						outcome: 'winner',
						height: chainHeight,
						block_hash: (index === 0 ? 'ab' : 'cd').repeat(32),
					}),
				},
				secret,
			),
		)
		const controlAcks = []
		for (const controlEvent of controlEvents) controlAcks.push(await publishToRelay(controlEvent))
		console.log(`read-path control: ${controlAcks.map((ack) => ack.frame).join(' ')}`)
		const afterVerdicts = await snapshot()
		const verdictView = afterVerdicts.auctions.find((auction) => auction.d === d)
		const folded = verdictView?.verdicts ?? []
		record(
			'(c) app read adapter folds anchored verdicts per validator (read-path control)',
			folded.length >= 2 && new Set(folded.map((verdict) => verdict.validatorPubkey)).size >= 2,
			folded.length === 0
				? `0 verdicts folded; snapshot refusals=${JSON.stringify(afterVerdicts.refusals)}`
				: folded
						.map((verdict) => `${verdict.validatorPubkey ?? '<no p tag>'} outcome=${verdict.outcome} height=${verdict.height} hash=${verdict.blockHash.slice(0, 8)}…`)
						.join(' | '),
		)

		// ---- the ledger ----------------------------------------------------
		const failures = results.filter((result) => !result.ok)
		console.log(
			`\n=== ${results.length - failures.length}/${results.length} steps passed ===` +
				(failures.length === 0 ? '\nall links observed working' : `\nBROKEN: ${failures.map((failure) => failure.name).join('; ')}`),
		)
		expect(failures.map((failure) => `${failure.name} :: ${failure.measured}`)).toEqual([])
	}, 180_000)
})