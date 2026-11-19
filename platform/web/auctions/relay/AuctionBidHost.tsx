/**
 * `platform/web/auctions/relay/AuctionBidHost.tsx` — the platform binding for
 * the arena bid panel.
 *
 * It owns everything the props-only `@ui/auction/arena/bid-panel` may not:
 * the viewer identity, the ticking clock the end check needs, the typed amount,
 * and the publish. The panel receives a `check` and a `submission` state and
 * renders words; it never sees a relay, a signer or a promise
 * (`ui/AGENTS.md:118-120`).
 *
 * ## Where the relays come from
 *
 * The bid is offered to **`webRelayPolicy('query')`** — the same set
 * `useArenaSurfacesRead` subscribes to. That is deliberate: a bid published to
 * relays the read does not watch would be invisible to the very view that
 * placed it, and the "presumed → seen" upgrade would be unobtainable. In a
 * normal deployment the policy answers the same configured relays for reads and
 * writes; when it does not, the panel's "x of y relays" line is the honest
 * record of it, not a smoothed-over one.
 *
 * ## The signing seam
 *
 * Signing goes through the active signer capability
 * (`getActiveSignerCapability`, the same seam `platform/web/app-settings/*`
 * uses) on a signed bare event, and publishing through the SDK seam
 * (`createWebNostrIo().publish`, i.e. `sdk/core/nostr-io` via
 * `platform/web/sdkNostrIo.ts`, per `AGENTS.md:85-89`). Neither is the retired
 * 30408 publish binding.
 *
 * ## The escrow
 *
 * A bid on the consolidated protocol carries its money: proofs locked under a
 * 2-of-2 `[bidder, committee]` condition, plus a pre-signed settle and refund
 * template (`arenaBidFunding.ts`). This host obtains that payload before it
 * publishes anything: `assembleArenaBidFunding` (`arenaBidFund.ts`) reads the
 * committee key and mint from the relay's committed **kind-1448** params event
 * (`arena.params.v1`, through `arenaParamsRead.ts`), takes the wallet spend
 * key from `walletOps.getAuctionBidWalletSigner()`, derives the locktime floor
 * from the lot's own `mode` / `endsAt` / `windowSec` and the relay's committed
 * settlement-safety and latency terms, locks exactly the bid amount through Coco
 * (`lockArenaEscrowWithCoco`), and builds the two templates. The result is
 * passed to `publishArenaBid` as both `funding` and `fundingTerms`, which
 * re-checks it against the same terms before a signature exists.
 *
 * Every way that assembly can fail — no committee key, no mint, no wallet spend
 * key, no Cashu wallet, a lot with no end or no mode or no seller wallet, a mint
 * that refuses the lock — is a **named refusal**, and the panel renders it as an
 * honest failure. Nothing is published, no key is invented, and the lock is
 * never retried: a mint that timed out may already have processed the swap, so a
 * second send would commit the bidder twice.
 *
 * ## Refencing the read after a bid
 *
 * The surfaces read is consumed to caught-up and then closed
 * (`auctionSurfacesRead.ts:256-262`). After a successful publish the host bumps
 * `refreshKey`, which tears the read down and opens it again, so "presumed"
 * becomes "seen" only when a relay really serves the bid — never because the
 * app assumed it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import type { EventStorePort } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { authStore, getActiveSignerCapability } from '@platform/web/auth/authStore'
import { createWebNostrIo, webRelayPolicy } from '@platform/web/sdkNostrIo'
import { createWebArenaParamsRead } from '@platform/web/auctions/relay/arenaParamsRead'
import { resolveEscrowMintUrl } from '@platform/web/chainMint'
import { getAppRelayUrl, getReadContext } from '@platform/web/readContext'
import { arenaParamsRelays } from '@platform/web/auctions/relay/arenaParamsRelays'
import type { ArenaBidFunding, ArenaBidFundingTerms } from '@platform/web/auctions/relay/arenaBidFunding'
import { arenaEscrowSendOverCoco } from '@platform/web/auctions/relay/arenaEscrowCocoSend'
import { ArenaBidFundError, assembleArenaBidFunding, type ArenaBidFundPorts } from '@platform/web/auctions/relay/arenaBidFund'
import { cashuStore } from '@platform/web/wallet/cashuStore'
import { walletOps } from '@platform/web/wallet/walletOps'
import { ArenaBidPanel, type ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'
import {
	ARENA_BID_SETTLE_POLL_MS,
	arenaBidBlock,
	checkArenaBid,
	nextPublishedBidState,
	publishArenaBid,
	submissionFromError,
	type ArenaBidderState,
} from '@platform/web/auctions/relay/arenaBidPublish'
import type { ArenaAuctionDetailModel, ArenaSurfaceStatus } from '@ui/auction/arena/model'

/**
 * A submission that failed **after** the escrow was locked says so.
 *
 * The lock is not reversible and is not published anywhere, so the bidder's
 * funds sit at the mint until the lock's own refund path opens at `locktime`
 * (spec §4b). Presenting that as an ordinary "the bid failed" would hide the one
 * thing they need to know, and re-bidding the same amount would lock a second
 * escrow on top of the first.
 */
function withEscrowLockedNote(state: ArenaBidSubmissionState): ArenaBidSubmissionState {
	if (state.phase !== 'failed' && state.phase !== 'unpublished') return state
	return {
		...state,
		// The escrow lock had completed before this failure: the one fact the
		// stepper's lock step states. Without it the panel would claim no lock.
		escrowLocked: true,
		reason: `${state.reason} This bid's escrow is locked at the mint but the bid was not published, so those funds come back only through the lock's refund path after its locktime — do not bid the same amount again from this wallet.`,
	}
}

/**
 * The escrow ports, built from the app's own seams.
 *
 * The terms read is per call, not cached: the committee's FROST group key is
 * regenerated by every `arena init` and the mint is published by the chain, so a
 * stale key would lock the bidder's money to a key no validator holds. It comes
 * from the relay's committed kind-1448 params event; there is deliberately **no
 * HTTP fallback** — a relay that serves no anchored reading is refused, not
 * papered over. `readWalletSigner` answers `null` until the one-time wallet-key
 * migration has produced the spend key, and `readEscrowManager` answers `null`
 * until Coco is ready — both are refusals, never substitutes.
 */
const arenaBidFundPorts: ArenaBidFundPorts = {
	readConfig: async () => {
		const read = createWebArenaParamsRead({
			relays: arenaParamsRelays(getAppRelayUrl(), webRelayPolicy('query')),
			store: getReadContext().store as unknown as EventStorePort<Event>,
		})
		const { params } = await read()
		if (params === null) throw new Error('no anchored arena.params.v1 reading is available on the configured relays')
		// The escrow locks at a mint, not at a URL: the chain's committed `mint_url` can be a
		// loopback URL a browser may not reach, and coco refuses a mint it cannot read as
		// untrusted. `resolveEscrowMintUrl` substitutes the configured browser-reachable origin
		// of the chain's keyset (never a mint whose keyset disagrees) — the same resolution the
		// wallet's own first mint goes through. A refusal is returned to the caller rather than
		// locked at the unreachable URL.
		const escrowMint = await resolveEscrowMintUrl({ mintUrl: params.terms.mint_url, keysetId: params.terms.keyset_id })
		if (!escrowMint.ok) throw new Error(`${escrowMint.refusal}: ${escrowMint.message}`)
		return {
			committee_public_key: params.terms.group_key,
			mint_url: escrowMint.mintUrl,
			keyset_id: params.terms.keyset_id,
			keys: params.terms.keys,
			settlement_safety_sec: params.terms.settlement_safety_sec,
			bid_to_consensus_latency_sec: params.terms.bid_to_consensus_latency_sec,
			min_window_sec: params.terms.min_window_sec,
			max_window_sec: params.terms.max_window_sec,
			min_duration_sec: params.terms.min_duration_sec,
			max_duration_sec: params.terms.max_duration_sec,
			max_proofs: params.terms.max_proofs,
			threshold: params.terms.threshold,
		}
	},
	readWalletSigner: () => walletOps.getAuctionBidWalletSigner(),
	// The money moves through the one wallet the app already holds: Coco's own
	// `Manager`, bound to the escrow send port by `arenaEscrowSendOverCoco` (Coco
	// has no `init`, and its `prepare` takes the P2PK target — the adapter is that
	// mapping and nothing else).
	readEscrowManager: () => {
		const manager = cashuStore.state.manager
		return manager === null ? null : arenaEscrowSendOverCoco(manager)
	},
}

export interface AuctionBidHostProps {
	/** The auction as the read delivered it, or `null` when it has not been read. */
	model: ArenaAuctionDetailModel | null
	/** The read state that produced `model`. A partial read disables bidding. */
	readStatus: ArenaSurfaceStatus
	/** Unix seconds. The route already ticks a clock for the surfaces; pass the same one. */
	now: number
	/**
	 * Whether the chain is advancing — fresh kind-1447 commitments across several
	 * blocks — as the lot host derived it from the read. `null` when no read has
	 * settled. This is the signal the diagnosis needs: a published bid that is
	 * not in committed state is "the chain did not accept it" when this is
	 * `true`, and otherwise "the chain has not settled it yet" — which only
	 * becomes "the chain is not advancing" once the app has watched a window long
	 * enough to demonstrate it (`arenaBidPublish.ts`
	 * `ARENA_CHAIN_STALLED_AFTER_SEC`). The host never invents the value
	 * (`arenaBidPublish.ts` `arenaChainAdvancing`).
	 */
	chainAdvancing?: boolean | null
	/** Bumped by the route when it wants the panel to forget its last submission. */
	resetKey?: string | number
	className?: string
	/** Called after a bid reached at least one relay, so the route can re-read. */
	onPublished?: (eventId: string) => void
	/**
	 * Reopen the read. **Required, and polled**: while the chain has not settled a
	 * published bid the panel asks for a fresh read every
	 * `ARENA_BID_SETTLE_POLL_MS`, and the stall claim it may eventually make is
	 * measured over the reads those requests produced. A host that could not
	 * reopen the read could not honestly say the chain was watched at all, so this
	 * is not optional (see the timer below for the reasoning).
	 */
	onRefresh: () => void
}

/** The viewer, from the auth session: identity and wallet readiness are separate facts. */
function useArenaBidder(): ArenaBidderState {
	const { isAuthenticated, user } = useStore(authStore)
	const pubkey = isAuthenticated ? (user?.pubkey ?? null) : null
	// `ready` means "a signer is available", not "funds are locked": the escrow
	// payload is assembled at submit time (`arenaBidFund.ts`) from this signer's
	// wallet, the wallet store's spend key and the committee's terms. A bidder
	// whose wallet has no spendable balance gets past this gate and is then
	// refused honestly by the lock (`fund.lock-failed`), because only the mint
	// knows what the wallet can actually cover.
	const wallet: ArenaBidderState['wallet'] = pubkey === null ? 'missing' : getActiveSignerCapability() !== null ? 'ready' : 'unavailable'
	return useMemo(() => ({ pubkey, wallet }), [pubkey, wallet])
}

/** Everything a bid surface needs from the host: the check, the input and the publish. */
export interface AuctionBidController {
	viewer: string | null
	check: ReturnType<typeof checkArenaBid> | null
	blockedReason: ReturnType<typeof arenaBidBlock>
	amountInput: string
	onAmountChange: (value: string) => void
	pending: boolean
	submission: ArenaBidSubmissionState
	onSubmit: () => void
	/** Submit a specific delta at once (the Arena swipe), through the same publish path. */
	onSubmitAmount: (raw: string) => void
}

/**
 * The bid state and the publish, without a view. `AuctionBidHost` renders it
 * through the catalogue `ArenaBidPanel`; the Arena lot page renders it through
 * its own ladder, input and swipe. Both share every check and every refusal.
 */
export function useAuctionBidController({
	model,
	readStatus,
	now,
	chainAdvancing = null,
	resetKey,
	onPublished,
	onRefresh,
}: Omit<AuctionBidHostProps, 'className'>): AuctionBidController {
	const bidder = useArenaBidder()
	const [amountInput, setAmountInput] = useState('')
	const [pending, setPending] = useState(false)
	const [submission, setSubmission] = useState<ArenaBidSubmissionState>({ phase: 'idle' })
	// The escrow locktime this host funded the last bid against, held so the
	// diagnosis can state it when the chain does not accept the bid.
	// `null` until a bid is funded; never invented.
	const [escrowLocktime, setEscrowLocktime] = useState<number | null>(null)

	useEffect(() => {
		setSubmission({ phase: 'idle' })
		setAmountInput('')
		setEscrowLocktime(null)
	}, [resetKey, model?.coordinate])

	// Pre-fill with the floor, the retired panel's behaviour: a bidder who types
	// is editing the minimum, not starting from a blank box.
	const blockedReason = arenaBidBlock(model, readStatus, now, bidder)
	const prefill = useMemo(() => {
		if (model === null) return ''
		const check = checkArenaBid({ model, status: readStatus, now, bidder, raw: '1' })
		return check.minimum !== null ? String(check.minimum) : ''
	}, [model, readStatus, now, bidder])

	const check =
		model !== null ? checkArenaBid({ model, status: readStatus, now, bidder, raw: amountInput === '' ? prefill : amountInput }) : null

	// A bid acknowledged by a relay becomes "seen" only when the read serves it.
	// Until a read has settled the question — the read serves the bid (seen), the
	// chain refused it in its own words (refused), the chain advanced without
	// taking it (not-accepted), or the chain's committed state has demonstrably
	// stood still (infrastructure) — the panel stays in `unconfirmed` and says so.
	// A partial read may simply not have arrived yet: it is never diagnosed from.
	useEffect(() => {
		setSubmission((previous) =>
			nextPublishedBidState({ previous, model, readStatus, chainAdvancing, escrowLocktime, now }),
		)
	}, [model, readStatus, chainAdvancing, escrowLocktime, now])

	// Once the chain has admitted the bid, the escrow locktime has done its job:
	// it exists only to state a lock the chain did NOT take. Keeping it past
	// admission would let a later `not-accepted` (or a refusal) state a lock the
	// chain's own fact has already discharged.
	useEffect(() => {
		if (submission.phase === 'admitted') setEscrowLocktime(null)
	}, [submission.phase])

	// **Polling is what makes the chain's admission fact land.** The read is
	// one-shot (`auctionSurfacesRead.ts`: "Consume one live read to its caught-up
	// marker"), so a snapshot's freshness decays with the wall clock while the
	// page stays open: without a reopen, a missed freshness window would become a
	// permanent claim about the chain, and an admission fact published after the
	// first read would never be seen. While the chain has not settled the bid —
	// not admitted, not refused — the panel therefore asks its host for a fresh
	// read on a timer, and every read re-runs the state machine above. `seen` is
	// included (the relays holding the bid is not the end of the story, the
	// chain's admission fact is), and so are `not-accepted` and `infrastructure`:
	// the chain's admission fact may land after the read that first made the app
	// conclude otherwise, and `nextPublishedBidState` lets that fact correct the
	// conclusion. It stops only on the chain's own word: `admitted` or `refused`.
	//
	// The callback is held in a ref: a caller that passes a fresh closure each
	// render (the route does) must not restart the timer every render, or the
	// interval would never elapse.
	const unsettled =
		submission.phase === 'presumed' ||
		submission.phase === 'seen' ||
		submission.phase === 'unconfirmed' ||
		submission.phase === 'not-accepted' ||
		submission.phase === 'infrastructure'
	const onRefreshRef = useRef(onRefresh)
	useEffect(() => {
		onRefreshRef.current = onRefresh
	}, [onRefresh])
	useEffect(() => {
		if (!unsettled) return
		const id = setInterval(() => onRefreshRef.current(), ARENA_BID_SETTLE_POLL_MS)
		return () => clearInterval(id)
	}, [unsettled])

	const submitRaw = useCallback(
		async (raw: string) => {
			if (pending) return
			// The check is re-run on the exact raw being published, so an amount
			// handed in by the swipe is held to the same rules as a typed one.
			const check = model !== null ? checkArenaBid({ model, status: readStatus, now, bidder, raw }) : null
			setPending(true)
			const submissionAmount = check?.amount ?? 0
			// The app's own funding step is step 1 of the stepper. State it while it
			// runs; move to `publishing` only once the escrow is actually locked. A
			// bid the check did not allow locks nothing, so it starts at publish.
			const willLock = model !== null && check !== null && check.allowed && check.amount !== null
			setSubmission(willLock ? { phase: 'locking', amount: submissionAmount } : { phase: 'publishing', amount: submissionAmount })
			// Non-null once the escrow was actually locked: a failure after that point
			// means the bidder's money is committed at the mint, and the panel has to
			// say so (see `withEscrowLockedNote`).
			let funding: ArenaBidFunding | null = null
			let fundingTerms: ArenaBidFundingTerms | null = null
			try {
				const capability = getActiveSignerCapability()
				const pubkey = bidder.pubkey
				if (capability === null || pubkey === null) {
					setSubmission({ phase: 'failed', amount: check?.amount ?? 0, reason: 'No signer is available.' })
					return
				}
				const relays = [...webRelayPolicy('query')]
				const io = createWebNostrIo()
				// ONE clock reading for the locktime floor and for the event's
				// `created_at`, so the escrow is written against the same instant the
				// bid is published at. A second reading would let the two disagree.
				const nowSec = Math.floor(Date.now() / 1000)
				// The escrow first, and only for a bid the check has already allowed:
				// money is never locked for a bid that is about to be refused, and a
				// bid is never published without its escrow. `check.amount` is the same
				// parse `publishArenaBid` performs on `raw`, so the amount locked is
				// the amount the event names. When the check is not allowed — or names
				// no amount — the publish path's own refusal is the honest answer and
				// no lock is attempted.
				if (model !== null && check !== null && check.allowed && check.amount !== null) {
					// Resolve (and, on a fresh wallet, create) the spend key before the escrow reads
					// the synchronous signer. The ensure retries, so a wallet that was not ready at
					// login is not stranded; if it still fails, `readWalletSigner` answers null and
					// the assembly refuses with `fund.wallet-signer-missing`.
					try {
						await walletOps.ensureAuctionWalletKey()
					} catch (keyErr) {
						console.warn('[wallet] Auction spend key is not available:', keyErr)
					}
					const assembled = await assembleArenaBidFunding({ model, amount: check.amount, now: nowSec }, arenaBidFundPorts)
					funding = assembled.funding
					fundingTerms = assembled.fundingTerms
					// The escrow's own locktime, from the funds that were actually
					// locked — held so the diagnosis can state it if the chain does not
					// accept the bid.
					setEscrowLocktime(assembled.funding.locktime)
					// The lock is written: step 1 of the stepper is done, and the signed
					// event is now being offered (step 2).
					setSubmission({ phase: 'publishing', amount: submissionAmount })
				}
				const result = await publishArenaBid(
					{ model, status: readStatus, bidder, raw },
					{
						signer: {
							pubkey,
							sign: async (template) => {
								const signature = await capability.signEvent({ ...template, pubkey })
								return signature as unknown as Event
							},
						},
						// `NostrIo` is never closed: it shares the app's pool (`sdkNostrIo.ts:18`).
						publisher: { publish: (event) => io.publish(event) },
						relays,
						now: nowSec,
						// The locked escrow and its two pre-signed templates, plus the
						// terms they were built against. `publishArenaBid` re-verifies
						// the payload against those terms before a signature exists.
						funding,
						fundingTerms,
					},
				)
				// A zero-ACK publish (`unpublished`) still carries the lock fact when
				// the escrow was locked first, so the stepper can state step 1.
				setSubmission(funding !== null ? withEscrowLockedNote(result.state) : result.state)
				onPublished?.(result.eventId)
			} catch (error) {
				const failed = submissionFromError(error, check?.amount ?? 0)
				// An assembly refusal is thrown before any money moves; anything after
				// the lock is a different fact for the bidder, and it is said plainly.
				setSubmission(funding !== null && !(error instanceof ArenaBidFundError) ? withEscrowLockedNote(failed) : failed)
			} finally {
				setPending(false)
			}
		},
		[pending, model, readStatus, now, bidder, onPublished],
	)

	const effectiveInput = amountInput === '' ? prefill : amountInput
	return {
		viewer: bidder.pubkey,
		check,
		blockedReason,
		amountInput: effectiveInput,
		onAmountChange: setAmountInput,
		pending,
		submission,
		onSubmit: () => void submitRaw(effectiveInput),
		onSubmitAmount: (raw: string) => {
			setAmountInput(raw)
			void submitRaw(raw)
		},
	}
}

export function AuctionBidHost({ className, ...props }: AuctionBidHostProps) {
	const bid = useAuctionBidController(props)
	return (
		<ArenaBidPanel
			model={props.model}
			readStatus={props.readStatus}
			check={bid.check}
			blockedReason={bid.blockedReason}
			amountInput={bid.amountInput}
			onAmountChange={bid.onAmountChange}
			pending={bid.pending}
			submission={bid.submission}
			onSubmit={bid.onSubmit}
			className={className}
		/>
	)
}
