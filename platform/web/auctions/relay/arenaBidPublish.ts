/**
 * `platform/web/auctions/relay/arenaBidPublish.ts` — the 1441 (arena bid)
 * publish path.
 *
 * ## What this is
 *
 * One bid: pre-check it against the auction's published terms, sign a kind-1441
 * event bound to the auction's **root** create, offer it to every relay the
 * read adapter reads, and report honestly what each relay did with it. That is
 * all. There is no settlement, no lock, no escrow, no refund and no verdict
 * publication in this module — those are the other slices on the frozen kind
 * map (`1443` refund, `1444` settle, `1445` verdict, `1446` funding abort).
 *
 * ## Why it is on the platform side
 *
 * `ui/AGENTS.md:18-28` — `ui/` may not import `@platform/…` or `nostr-tools`;
 * `ui/AGENTS.md:120` — no data fetching, no publishing in `ui/`;
 * `ui/AGENTS.md:38-41` — "Data adapters … are invoked by the platform/assembler
 * and passed down as props." The bid panel receives its `check` and its
 * `submission` state as props; this module produces both, and holds the only
 * code in the feature that signs or publishes.
 *
 * ## The wire shape, and where each field comes from
 *
 * A 1441 is a NIP-01 regular event (never ephemeral: a khatru relay drops an
 * ephemeral event with no live subscriber — the measured bug that froze the
 * 1000-range kinds, `notes/DECISION-auction-kinds-and-editable-allowlist.md`).
 *
 * ```
 * kind:     1441
 * tags:     ["e", <auction root event id>]      <- REQUIRED (see below)
 *           ["a", "1440:<seller>:<d>"]          <- the coordinate, for indexers
 * content:  {"auction":"<1440:seller:d>","auction_id":"<d>","amount":<sats>,
 *            "wallet":<bidder wallet key>,"proofs":[...],"outcome_templates":{...}}
 * ```
 *
 * Each field is a **decision**, not a port:
 *
 * - **`e` names the ROOT create, never the canonical version.** Decision §4.2:
 *   "Every 1441 bid MUST carry `e = <auction_root_event_id>`. This is what
 *   makes edits non-destructive, because they never referenced the version that
 *   changed." The read adapter exposes exactly that id as
 *   `ArenaAuctionView.rootEventId`, and the detail model carries it as
 *   `rootEventId`. Binding to `canonicalEventId` would orphan every bid the
 *   moment the seller fixed a typo in a title.
 * - **`auction` is the coordinate `1440:<seller>:<d>`** — the reference chain's
 *   `BidContent.Auction` (`chain/app.go:104`) and its `Auction.ID`
 *   (`chain/app.go:550`). Without it the chain cannot find the lot and refuses
 *   the bid as `unknown auction`.
 * - **`auction_id` is the `d`**, kept because this app's own read adapter
 *   resolves a bid by `content.auction_id` (`arenaAuctionRead.ts:485-501`).
 *   Both are emitted so the protocol and the local view agree.
 * - **`amount` is the DELTA**, an integer, in sats. The arena protocol's bid
 *   model is additive (the reference chain's `BidContent.Amount`, `chain/app.go`)
 *   — the read adapter sums bid amounts per bidder into positions — and the
 *   surface says "bids add to your position" for exactly that reason. It is
 *   written as a JSON **number**, not a string, because that is the type the
 *   read adapter accepts and the type the demo client wrote.
 * - **`wallet`, `proofs` and `outcome_templates` are the funding payload**, and
 *   they are not optional. The money is locked under a 2-of-2 NUT-11 `SIG_ALL`
 *   condition whose destinations the bidder fixed when it bid; the validator
 *   refuses a bid that omits them (`chain/sigall.go`
 *   `verifySigAllBidTemplates`). `arenaBidFunding` builds and checks them; this
 *   module attaches them and refuses to sign an unfunded bid. The old comment
 *   here called these extensions "the retired bidder-held path" — that was the
 *   *opposite* of the truth: the retired thing was the bidder-HOSTED release,
 *   and this payload is the consolidated protocol's core.
 * - **The two keys are not one key.** The event is signed by the Nostr identity
 *   (`ArenaBidSigner`); the templates are signed by the wallet spend key inside
 *   `arenaBidFunding`. This module never derives either from the other.
 *
 * ## Honest reporting: what each relay did
 *
 * One ACK per relay, kept as it came:
 *
 * | condition                    | outcome                                        |
 * | ---------------------------- | ---------------------------------------------- |
 * | ≥1 relay accepted            | `accepted` — the bid is **presumed** on the wire until the read delivers it back |
 * | relays answered, none accepted | `rejected` — nothing stored; the reason names the refusals |
 * | no relay ACKed at all        | **fails closed** — an unpublished bid, exactly as `publishRequired` does for the 30408 path (`auctionPublishIo.ts:34-52`) |
 *
 * The third row is the one that matters: the applesauce publish adapter
 * resolves with the ACK-filtered set, so an unchecked call reports a zero-ACK
 * publish as a success (`auctionPublishIo.ts:39-42`). This module does not use
 * that adapter — it goes through the SDK seam `sdk/core/nostr-io`
 * (`AGENTS.md:85-89`: "All new Nostr relay I/O must route through the SDK seam
 * … via the web host `platform/web/sdkNostrIo.ts`"), whose `publish` returns
 * one `RelayAck` per targeted relay — so the count is read from the seam's own
 * answer and never inferred.
 *
 * `accepted` is **not** "the bid counts". The relays notified; the chain
 * decides. Nothing here claims an outcome, a winner, or that any money moved.
 *
 * ## What it verifies locally
 *
 * The relay gate (`arenaAuctionRead.ts:444-519`) will refuse a bid it cannot
 * bind, so the same binding is checked here **before publishing**, and the id
 * is computed with `getEventHash` from the unsigned template to prove the signed
 * event is the event that was validated (a signing race is a wrong bid, not a
 * publish bug). A wrong kind or an unparseable amount fails before a signature
 * exists.
 */

import { getEventHash } from 'nostr-tools/pure'
import type { Event, NostrIo } from '@sdk/core/nostr-io'
import { ARENA_AUCTION_BID_KIND } from '@sdk/commerce/auctions/constants'
import type { ArenaAuctionDetailModel, ArenaSurfaceStatus } from '@ui/auction/arena/model'
import {
	arenaBidBlock,
	checkArenaBid,
	bidBlockedCopy,
	type ArenaBidCheck,
	type ArenaBidBlockedReason,
	type ArenaBidderState,
} from '@ui/auction/arena/bid-rules'
import type { ArenaBidSubmissionState } from '@ui/auction/arena/bid-panel'
import { arenaAuctionCoordinate } from '@platform/web/auctions/relay/arenaAuctionRead'
import { verifyArenaBidFunding, type ArenaBidFunding, type ArenaBidFundingTerms } from '@platform/web/auctions/relay/arenaBidFunding'

const HEX64 = /^[0-9a-f]{64}$/

// =========================================================================
// Refusals
// =========================================================================

/**
 * Names, not sentences, in the discipline of `arenaAnchor.ts` and the read
 * adapter's refusal list: a caller and a test can tell one failure from
 * another, and the UI owns the copy.
 */
export type ArenaBidRefusal =
	/** The pre-check refused it — `reason` is the check's own reason. */
	| 'bid.not-allowed'
	/** The auction's root event id is not a 64-hex event id, so no bid can bind to it. */
	| 'bid.bad-root'
	/** The auction's `d` is empty. */
	| 'bid.no-auction-id'
	/** The amount is not a positive safe integer. The publish path must never round. */
	| 'bid.bad-amount'
	/** The signed event's id does not match the template that was validated. */
	| 'bid.signature-mismatch'
	/** A relay ACKed an event with a different id. */
	| 'bid.ack-for-other-event'
	/** The bid carries no funding payload. The consolidated protocol refuses it. */
	| 'bid.unfunded'
	/** The funding payload does not satisfy the lock, nonce, locktime or template rules. */
	| 'bid.funding-invalid'

export class ArenaBidPublishError extends Error {
	readonly refusal: ArenaBidRefusal
	/** The publication state at the moment of failure — what the bidder is told. */
	readonly state: ArenaBidSubmissionState
	constructor(refusal: ArenaBidRefusal, message: string, state: ArenaBidSubmissionState) {
		super(message)
		this.name = 'ArenaBidPublishError'
		this.refusal = refusal
		this.state = state
	}
}

// =========================================================================
// The event
// =========================================================================

/** The bid content, as the frozen protocol reads it (`chain/app.go` `BidContent`). */
export interface ArenaBidContent {
	/** The auction coordinate `1440:<seller>:<d>` — what the chain keys the lot by. */
	auction: string
	/** The `d` tag, kept for this app's own read adapter. */
	auction_id: string
	amount: number
	/** The bidder's wallet spend key that owns the escrow lock. */
	wallet: string
	/** The locked proofs the templates spend. */
	proofs: ArenaBidFunding['proofs']
	/** The bidder's two pre-signed spends. The validator refuses a bid without them. */
	outcome_templates: ArenaBidFunding['outcome_templates']
}

/**
 * Pure: what a 1441 for this auction and amount must carry. Throws a refusal,
 * never guesses.
 *
 * `funding` is required. A bid without a lock and its two pre-signed templates
 * is refused by the consolidated protocol, so publishing one would be a lie the
 * relays would faithfully store.
 */
export function buildArenaBidContent(
	auction: Pick<ArenaAuctionDetailModel, 'd' | 'seller' | 'rootEventId' | 'coordinate'>,
	amount: number,
	funding: ArenaBidFunding | null | undefined,
): { content: ArenaBidContent; tags: string[][] } {
	if (typeof auction.d !== 'string' || auction.d.trim() === '') {
		throw new ArenaBidPublishError('bid.no-auction-id', 'The auction has no id, so a bid cannot name it.', {
			phase: 'failed',
			amount,
			reason: 'The auction has no id.',
		})
	}
	if (typeof auction.rootEventId !== 'string' || !HEX64.test(auction.rootEventId)) {
		throw new ArenaBidPublishError(
			'bid.bad-root',
			`\`e\` must be the auction's root event id (64 hex), got ${JSON.stringify(auction.rootEventId)}`,
			{ phase: 'failed', amount, reason: 'The auction’s root event id was not published in a form a bid can bind to.' },
		)
	}
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new ArenaBidPublishError('bid.bad-amount', `amount must be a positive integer number of sats, got ${amount}`, {
			phase: 'failed',
			amount,
			reason: 'The bid amount is not a whole number of sats.',
		})
	}
	if (funding === null || funding === undefined || funding.proofs.length === 0) {
		throw new ArenaBidPublishError('bid.unfunded', 'the bid carries no escrow lock or pre-signed outcome templates', {
			phase: 'failed',
			amount,
			reason: 'The bid has no funding: its money is not locked and its outcome templates are not signed.',
		})
	}
	// The read adapter's own coordinate convention (`arenaAuctionRead.ts:401-404`).
	const coordinate = auction.coordinate.includes(':') ? auction.coordinate : arenaAuctionCoordinate(auction.seller, auction.d)
	return {
		content: {
			auction: coordinate,
			auction_id: auction.d,
			amount,
			wallet: funding.wallet,
			proofs: funding.proofs,
			outcome_templates: funding.outcome_templates,
		},
		tags: [
			['e', auction.rootEventId],
			['a', coordinate],
		],
	}
}

/** The signer, as the host supplies it (`@platform/web/auth/authStore` capability, or a test's). */
export interface ArenaBidSigner {
	/** The signed-in pubkey, hex. */
	pubkey: string
	/** Sign an event template. Returns the signed event carrying `id`, `pubkey`, `sig`. */
	sign(template: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Event>
}

/** The publish seam: one ACK per relay targeted, as `NostrIo.publish` returns. */
export interface ArenaBidPublisher {
	publish(event: Event): Promise<{ id: string; acks: { url: string; accepted: boolean; message?: string }[] }>
}

/** The relayout a host passes down: where the read reads, so the write goes where the read looks. */
export interface ArenaBidPublishOptions {
	signer: ArenaBidSigner
	publisher: ArenaBidPublisher
	/** Relays the bid is offered to — the same set the read subscribes to. */
	relays: readonly string[]
	/** Unix seconds. Injected so a test can pin it. */
	now: number
	/**
	 * The locked escrow and its two pre-signed templates. Required: the
	 * consolidated protocol refuses a bid without them.
	 */
	funding: ArenaBidFunding | null | undefined
	/** The auction terms the funding is re-checked against before signing. */
	fundingTerms: ArenaBidFundingTerms | null | undefined
	/** Called once, when the event is signed and before the relays answer. */
	onSigned?: (eventId: string) => void
}

// =========================================================================
// Publishing
// =========================================================================

export interface ArenaBidPublishResult {
	eventId: string
	/**
	 * - `accepted` — ≥1 relay ACKed. **Presumed** on the network until the read delivers it.
	 * - `rejected` — relays answered and every one refused.
	 * `unpublished` never returns: it throws.
	 */
	outcome: 'accepted' | 'rejected'
	acceptedBy: string[]
	rejected: { url: string; message: string | null }[]
	totalRelays: number
	/** The submission state the panel should render. */
	state: ArenaBidSubmissionState
}

/**
 * Publish one bid. Resolves with what the relays said; **throws
 * {@link ArenaBidPublishError}** when the bid did not reach the wire — a
 * pre-check refusal, a signing failure, or no relay ACK at all.
 *
 * The check is re-run here even when the host already ran it: a disabled
 * button is presentation, and the publish path is where money rules have to
 * hold. It is the *same* {@link checkArenaBid}, so the two cannot disagree.
 */
export async function publishArenaBid(
	input: {
		model: ArenaAuctionDetailModel | null
		status: 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'
		bidder: ArenaBidderState
		raw: string
	},
	options: ArenaBidPublishOptions,
): Promise<ArenaBidPublishResult> {
	const check = checkArenaBid({ model: input.model, status: input.status, now: options.now, bidder: input.bidder, raw: input.raw })
	const typed = check.amount
	const failedState = (reason: string): ArenaBidSubmissionState => ({ phase: 'failed', amount: typed ?? 0, reason })
	if (!check.allowed || input.model === null || typed === null) {
		throw new ArenaBidPublishError('bid.not-allowed', bidBlockedCopy(check.reason, check), failedState(bidBlockedCopy(check.reason, check)))
	}

	const { content, tags } = buildArenaBidContent(input.model, typed, options.funding)
	// Re-check the funding payload against the auction's own terms before a
	// signature exists. The producer already checked it; this is the same rule
	// applied at the point where money rules have to hold, so a caller that
	// assembles a payload by hand cannot publish a lock the chain will refuse.
	if (options.funding === null || options.funding === undefined || options.fundingTerms === null || options.fundingTerms === undefined) {
		throw new ArenaBidPublishError(
			'bid.unfunded',
			'no escrow funding or funding terms were supplied for this bid',
			failedState('The bid has no funding terms to check its escrow against.'),
		)
	}
	try {
		verifyArenaBidFunding(options.funding, options.fundingTerms)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new ArenaBidPublishError(
			'bid.funding-invalid',
			`escrow funding refused: ${detail}`,
			failedState(`The escrow funding is not valid: ${detail}`),
		)
	}
	const escrowTotal = options.funding.proofs.reduce((sum, proof) => sum + proof.amount, 0)
	if (escrowTotal !== typed) {
		throw new ArenaBidPublishError(
			'bid.funding-invalid',
			`escrow proofs total ${escrowTotal} but the bid is ${typed}`,
			failedState('The escrow does not match the amount this bid names.'),
		)
	}
	const template = { kind: ARENA_AUCTION_BID_KIND, created_at: options.now, tags, content: JSON.stringify(content) }

	// The id of the event that WILL be signed, from the template — so a signer
	// that returns a different event (wrong key, mutated tags) is caught here
	// rather than published.
	let expectedId: string
	try {
		expectedId = getEventHash({ ...template, pubkey: options.signer.pubkey })
	} catch (error) {
		throw new ArenaBidPublishError(
			'bid.bad-root',
			error instanceof Error ? error.message : String(error),
			failedState('The event could not be built.'),
		)
	}

	let event: Event
	try {
		event = await options.signer.sign(template)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new ArenaBidPublishError(
			'bid.not-allowed',
			`signing failed: ${detail}`,
			failedState(`Your wallet did not sign the bid: ${detail}`),
		)
	}
	if (event.id !== expectedId || event.kind !== ARENA_AUCTION_BID_KIND) {
		throw new ArenaBidPublishError(
			'bid.signature-mismatch',
			`signed event id ${event.id} != validated template id ${expectedId}`,
			failedState('The signed bid did not match the bid that was checked. Nothing was published.'),
		)
	}

	options.onSigned?.(event.id)

	let acks: { url: string; accepted: boolean; message?: string }[]
	try {
		const outcome = await options.publisher.publish(event)
		if (outcome.id !== event.id) {
			throw new ArenaBidPublishError('bid.ack-for-other-event', `publish outcome id ${outcome.id} != event id ${event.id}`, {
				phase: 'unpublished',
				amount: typed,
				eventId: event.id,
				reason: 'The relay answers did not match the bid that was sent.',
			})
		}
		acks = outcome.acks
	} catch (error) {
		if (error instanceof ArenaBidPublishError) throw error
		const detail = error instanceof Error ? error.message : String(error)
		throw new ArenaBidPublishError('bid.not-allowed', `publish failed: ${detail}`, {
			phase: 'unpublished',
			amount: typed,
			eventId: event.id,
			reason: `The publish failed before any relay answered: ${detail}.`,
		})
	}

	const acceptedBy = acks.filter((ack) => ack.accepted).map((ack) => ack.url)
	const rejected = acks.filter((ack) => !ack.accepted).map((ack) => ({ url: ack.url, message: ack.message ?? null }))

	if (acceptedBy.length === 0) {
		// Fail closed, the same contract `publishRequired` enforces on the 30408
		// path: a zero-ACK publish is a publish failure, whatever the transport
		// resolved with.
		const named =
			rejected.length > 0 ? rejected.map((r) => `${r.url}${r.message ? ` (${r.message})` : ''}`).join('; ') : 'no relay answered'
		throw new ArenaBidPublishError('bid.not-allowed', `No relay accepted the bid (kind ${ARENA_AUCTION_BID_KIND}, id ${event.id})`, {
			phase: 'unpublished',
			amount: typed,
			eventId: event.id,
			reason: `No relay accepted it — ${named}.`,
		})
	}

	return {
		eventId: event.id,
		outcome: 'accepted',
		acceptedBy,
		rejected,
		totalRelays: options.relays.length,
		state: { phase: 'presumed', amount: typed, eventId: event.id, acceptedBy, totalRelays: options.relays.length },
	}
}

// =========================================================================
// The read-back: what one read says about a published bid
// =========================================================================

/**
 * How long, in **seconds**, the app must read the chain's committed state stand
 * still before it may call the chain stalled and say so.
 *
 * ## Why the claim needs a window at all
 *
 * The app's only window into the chain is the kind-1447 state commitments its
 * read delivers, and that read is **one-shot**: it is consumed to its caught-up
 * marker and closed (`auctionSurfacesRead.ts`, "Consume one live read to its
 * caught-up marker"), so its freshness decays with the wall clock while the
 * reader stays open. "This snapshot holds no fresh commitment" is therefore a
 * fact about the app's *read*, never a fact about the chain — measured live
 * 2026-11-19: the arena nodes committed every 10 s and the chain advanced a
 * block a minute, while `relay.playday.it` served no kind-1447 at all for 36
 * minutes, and a bid the chain **admitted** was diagnosed "the chain is not
 * advancing".
 *
 * What the app can demonstrate is its own reading: it reopens the read on a
 * timer ({@link ARENA_BID_SETTLE_POLL_MS}) and can see whether committed state
 * moves across those reads. Only after it has watched for the protocol's own
 * longest rule horizon and seen nothing move may it say the chain has not
 * advanced — and then it says exactly that, with the window it watched.
 *
 * ## Why 900 s
 *
 * 900 s is that horizon. `ARENA_CHAIN_CLOCK_STALE_AFTER_SEC`
 * (`arenaClock.ts:44-49`) is 900 s because `SettlementSafetySec = 900 s` and the
 * anti-snipe window tops out at 900 s
 * (`sdk/commerce/auctions/auctionPublishValidation.ts:38`). Below it, a
 * commitment arriving late is still consistent with every rule this app has, so
 * a stall claim below it would not be demonstrable; at or past it, no rule the
 * app holds can be underwritten against the chain's committed state at all.
 */
export const ARENA_CHAIN_STALLED_AFTER_SEC = 900

/**
 * How often, in **milliseconds**, the bid panel asks its host to reopen the lot
 * read while a published bid is not settled. Measured on the arena nodes
 * 2026-11-19: they commit every 10 s (`-commit-max-interval=10s`), and one lot
 * read can take up to its 8 s deadline (`createWebRelayReadContext`, default
 * `deadlineMs: 8000`) — so one reopen per 15 s keeps every decision within about
 * 25 s of the chain's own, without holding a read open continuously.
 */
export const ARENA_BID_SETTLE_POLL_MS = 15_000

/**
 * The state a published bid moves to, from the read the host has just consumed.
 *
 * Pure: the host owns the read, the timer and the render; this owns which state
 * follows from which facts, so the whole machine is decidable in a test.
 *
 * The order of the checks **is** the honesty order:
 *
 * 1. **Possession first.** If the read serves the bid (`model.bids`), it is
 *    `seen`: a relay is holding it, whatever the chain has not yet said. Event-id
 *    equality, never a fuzzy match.
 * 2. **Nothing else is a fact until a read settles.** With no model, a
 *    non-settled read, or no `chainAdvancing` yet, the state stands as it is:
 *    the app has not read enough to say anything, and a read in progress is
 *    never dressed up as an answer.
 * 3. **Then the diagnosis** (`diagnosePublishedBid`) — the chain's *recorded*
 *    refusal in its own words; else the chain advancing while the bid is absent
 *    (it saw the bid and did not take it); else the app has **not** seen the
 *    chain advance, which is *not* the same as the chain having stalled. That
 *    last case stays `unconfirmed` and keeps reading until it has watched
 *    committed state stand still for {@link ARENA_CHAIN_STALLED_AFTER_SEC};
 *    only then is the chain stalled enough to say so.
 *
 * `unconfirmed` carries the instant the app began waiting (`watchingSince`) so
 * the window is a fact in the state rather than a ref beside it, and a state
 * that does not change is returned as the **same object** — a host calling this
 * on every tick does not re-render for it.
 */
export function nextPublishedBidState(input: {
	/** The state the panel holds. Anything that is not a published bid is returned unchanged. */
	previous: ArenaBidSubmissionState
	/** The read the host has just consumed, or `null` when none has. */
	model: ArenaAuctionDetailModel | null
	/** The read's own status. Only a settled read may be diagnosed from. */
	readStatus: ArenaSurfaceStatus
	/** `arenaChainAdvancing` on this read; `null` before any read has settled. */
	chainAdvancing: boolean | null
	/** The escrow locktime the bid was funded against, or `null`. */
	escrowLocktime: number | null
	/** Unix seconds — the route's own ticking clock. */
	now: number
}): ArenaBidSubmissionState {
	const previous = input.previous
	// `seen` is included: the read holding the bid is not the end of the story —
	// the panel keeps watching for the chain's admission fact, which may arrive
	// after the relay read first served the bid (a late admission fact must still
	// advance the panel). `not-accepted` and `infrastructure` are included for the
	// same reason: the chain's admission fact may land later than the read that
	// first made the app conclude otherwise.
	const inFlight = previous.phase === 'presumed' || previous.phase === 'seen' || previous.phase === 'unconfirmed'
	const concluded = previous.phase === 'not-accepted' || previous.phase === 'infrastructure'
	if (!inFlight && !concluded) return previous

	// 0. The chain's admission fact. This is checked FIRST and from any state:
	//    an `arena.bidadmit.v1` fact that names this bid id is the chain saying
	//    it took the bid, and it outranks every weaker signal below (a relay ACK,
	//    the read holding the bid, an elapsed window). It carries the chain's own
	//    position/highBid, which is what the panel then states.
	const admission = input.model?.admissions[previous.eventId]
	if (admission !== undefined) {
		return {
			phase: 'admitted',
			amount: previous.amount,
			eventId: previous.eventId,
			acceptedBy: previous.acceptedBy,
			totalRelays: previous.totalRelays,
			admission: {
				position: admission.position,
				highBid: admission.highBid,
				height: admission.height,
				blockHash: admission.blockHash,
			},
		}
	}

	// A conclusion is not re-litigated tick over tick: only the chain's own
	// admission fact above, or a refusal a later read delivers, moves it. Without
	// this the panel would flap between not-accepted, unconfirmed and
	// infrastructure as reads came and went, and a later read that merely serves
	// the bid again would drag it back to `seen`.
	if (concluded) {
		const refusalReason = input.model?.bidRefusals[previous.eventId]?.reason ?? null
		if (input.readStatus === 'settled' && typeof refusalReason === 'string' && refusalReason.trim() !== '') {
			return {
				phase: 'refused',
				amount: previous.amount,
				eventId: previous.eventId,
				reason: refusalReason,
				locktime: input.escrowLocktime,
				reclaimable: input.escrowLocktime !== null,
			}
		}
		return previous
	}

	// 1. Possession: the read serves the bid, so a relay is holding it. This is
	//    true from either unsettled state, and it does not wait for a settled
	//    read — the read would not carry the bid at all if it had not arrived.
	if (input.model !== null && input.model.bids.some((bid) => bid.eventId === previous.eventId)) {
		return { phase: 'seen', amount: previous.amount, eventId: previous.eventId, acceptedBy: previous.acceptedBy, totalRelays: previous.totalRelays }
	}

	// 2. The app has read nothing it may diagnose from. Say nothing new.
	if (input.model === null || input.readStatus !== 'settled' || input.chainAdvancing === null) return previous

	// 3. The window the app has itself watched: from the first settled read that
	//    told it the chain was not advancing, to now. Never negative (a clock
	//    that steps back must not shorten a window that was watched).
	const observedStallSec = previous.phase === 'unconfirmed' ? Math.max(0, input.now - previous.watchingSince) : 0
	const diagnosis = diagnosePublishedBid({
		eventId: previous.eventId,
		seenInRead: false,
		namedByReceipt: input.model.receipts.some((receipt) => receipt.bidId === previous.eventId),
		admission: null,
		chainAdvancing: input.chainAdvancing,
		escrowLocktime: input.escrowLocktime,
		refusalReason: input.model.bidRefusals[previous.eventId]?.reason ?? null,
		observedStallSec,
	})

	switch (diagnosis.state) {
		// Nothing new to say: the read knows the bid but the panel already shows
		// the stronger fact (admitted / seen), both of which returned earlier.
		case 'committed':
			return previous
		case 'admitted':
			// Unreachable here: `nextPublishedBidState` returns `admitted` from the
			// admission fact before it ever diagnoses. Kept so the switch stays total.
			return previous
		case 'refused':
			return {
				phase: 'refused',
				amount: previous.amount,
				eventId: previous.eventId,
				reason: diagnosis.reason ?? '',
				locktime: diagnosis.escrowLocktime,
				reclaimable: diagnosis.reclaimable,
			}
		case 'not-accepted':
			return {
				phase: 'not-accepted',
				amount: previous.amount,
				eventId: previous.eventId,
				locktime: diagnosis.escrowLocktime,
				reclaimable: diagnosis.reclaimable,
			}
		case 'infrastructure':
			return { phase: 'infrastructure', amount: previous.amount, eventId: previous.eventId, stalledForSec: observedStallSec }
		case 'unconfirmed':
			// Already waiting: the same state object, so the window keeps running
			// from its own start and the host is not asked to re-render for it.
			return previous.phase === 'unconfirmed'
				? previous
				: {
						phase: 'unconfirmed',
						amount: previous.amount,
						eventId: previous.eventId,
						acceptedBy: previous.acceptedBy,
						totalRelays: previous.totalRelays,
						watchingSince: input.now,
					}
	}
}

// =========================================================================
// The diagnosis — a published bid the chain has not taken
//
// Owner ruling (`notes/DECISION-2026-11-18-refused-bids-are-not-committed.md`):
// a refused bid is never committed, and the chain publishes **no** 1450 for one.
// So the app never invents a reason. It diagnoses from what it already reads:
// whether the bid is in committed state, and whether the chain is advancing.
//
// "Not advancing in this snapshot" is not "the chain is stalled": the read is
// one-shot and its freshness decays by itself (`nextPublishedBidState`), so the
// stall claim needs a window the app has itself watched
// (`ARENA_CHAIN_STALLED_AFTER_SEC`) and everything short of it is `unconfirmed`.
// =========================================================================

/**
 * The states a bid the app published can be in, and nothing else.
 *
 * - `admitted` — the chain **admitted** this bid: an `arena.bidadmit.v1` fact
 *   (kind 1449) names this bid id, anchored at the bid's own committed height,
 *   and carries the chain's own `position`/`highBid`. This is the **only** state
 *   in which the bid is in — a relay ACK, a timeout and a `highAmount` never
 *   produce it.
 * - `refused` — the chain **recorded** a refusal of this bid (a kind-1450 naming
 *   the bid's event id, with the chain's own reason). Only a bid refused **at
 *   delivery** is recorded; one refused at admission leaves no record. The
 *   reason is the chain's, verbatim — never re-worded.
 * - `committed` — the bid is in committed state (the read serves it, or a
 *   receipt names it): the bid is live. Say nothing.
 * - `not-accepted` — it was published, no admission fact names it, and the chain
 *   is advancing: the chain has **not admitted** it. **This is not a network
 *   problem** and must not read like one. The escrow is still locked until its
 *   locktime, so the surface states the locktime and the reclaim. The reason is
 *   deliberately absent — see the SEAM note in `bid-panel.tsx` (`submissionLine`,
 *   `not-accepted`): the owner has not ruled on publishing a refusal fact.
 * - `unconfirmed` — it is published, no admission fact names it, and the app has
 *   **not** seen the chain advance: nothing from the chain yet, and no admission
 *   fact is not a refusal. The honest statement is that the app is still
 *   reading; a bid may still be admitted, so nothing is said about it and
 *   nothing is given up.
 * - `infrastructure` — it is published and not committed, and the app has read
 *   the chain's committed state stand still for
 *   {@link ARENA_CHAIN_STALLED_AFTER_SEC}: no rule the app holds can be
 *   underwritten against the chain's state, which is an infrastructure problem
 *   and not a fact about the bid.
 */
export type ArenaBidDiagnosisState = 'admitted' | 'committed' | 'refused' | 'not-accepted' | 'unconfirmed' | 'infrastructure'

/** One diagnosis, with the facts it rests on and no invented reason. */
export interface ArenaBidDiagnosis {
	state: ArenaBidDiagnosisState
	/** The bid event id the diagnosis is about. */
	eventId: string
	/**
	 * The chain's admission fact, verbatim — set only for `admitted` (an
	 * `arena.bidadmit.v1` fact naming the bid). `null` in every other state.
	 */
	admission: { position: number; highBid: string; height: number; blockHash: string } | null
	/**
	 * The escrow locktime (unix seconds) the bid was funded against, when the
	 * app held it — the instant the funds become reclaimable through the lock's
	 * own refund path. `null` when the app did not hold it (never a guess).
	 */
	escrowLocktime: number | null
	/**
	 * The chain's own reason for refusing this bid, verbatim — set only for
	 * `refused` (a kind-1450 naming the bid). `null` in every state the app
	 * diagnoses itself: the app never supplies a reason the chain did not state.
	 */
	reason: string | null
	/**
	 * `true` only in `not-accepted` **and** when the locktime is known: the bid
	 * was not taken by the chain and its funds are locked by real sats until
	 * then, so the bidder can reclaim them. `false` for `committed` (nothing to
	 * reclaim — the bid is live) and for `infrastructure` (the bid may still
	 * land; reclaiming now would strand it).
	 */
	reclaimable: boolean
}

/**
 * Whether the chain is advancing — fresh kind-1447 commitments across several
 * distinct blocks, recent against the wall clock. This is the only chain signal
 * the app needs to tell "the chain refused the bid" from "the chain is stuck".
 *
 * `heights` are the distinct anchored heights of the commitments the read saw;
 * `newestTime` the newest commitment's `time`; `now` the wall clock. It answers
 * `true` only when there are at least `minDistinctHeights` (default 2 — "across
 * several blocks") distinct heights and the newest is within `freshWithinSec`
 * (default 120 s) of now. Anything else is "not advancing", which is the honest
 * answer when there is nothing to prove the chain is moving.
 */
export function arenaChainAdvancing(input: {
	heights: readonly number[]
	newestTime: number | null
	now: number
	minDistinctHeights?: number
	freshWithinSec?: number
}): boolean {
	const distinct = new Set(input.heights.filter((height) => Number.isInteger(height) && height > 0))
	if (distinct.size < (input.minDistinctHeights ?? 2)) return false
	if (input.newestTime === null) return false
	const age = input.now - input.newestTime
	return age >= 0 && age <= (input.freshWithinSec ?? 120)
}

/**
 * Diagnose a bid the app published. **Never invents a reason** — it decides one
 * state from the facts the read already holds.
 *
 * - an `arena.bidadmit.v1` fact names it → `admitted`, with the chain's own
 *   position/highBid. This is checked FIRST: the chain's word outranks every
 *   weaker signal, and is the only one that may say the bid is in;
 * - committed (in the read's bids, or a receipt names it) → `committed`, say nothing;
 * - published, not committed, a refusal names it → `refused`, in the chain's own words;
 * - published, not committed, no admission fact, chain advancing → `not-accepted`
 *   (the chain has not admitted it), with the locktime and the reclaim affordance;
 * - published, not committed, not advancing, and the app has watched committed
 *   state stand still for less than {@link ARENA_CHAIN_STALLED_AFTER_SEC} →
 *   `unconfirmed`: nothing from the chain yet, and not a refusal;
 * - …and for at least that window → `infrastructure`. **"Not advancing in this
 *   snapshot" is not that window**: the app's read is one-shot and its own
 *   freshness decays, so only the window it has itself watched makes the claim
 *   true (`nextPublishedBidState` is what runs the clock).
 *
 * A bid that was never published (no event id, or a failed submission) is not
 * diagnosed here: this function is only about a bid that reached a relay.
 */
export function diagnosePublishedBid(input: {
	eventId: string
	/** `true` when the read served the bid — the app's committed-state signal. */
	seenInRead: boolean
	/** `true` when a receipt (1443/1444) names the bid event id. */
	namedByReceipt: boolean
	/**
	 * The chain's admission fact for this bid (an `arena.bidadmit.v1` fact naming
	 * its event id), or `null`/absent when no fact names it. This is the one
	 * input that yields `admitted`; nothing else does.
	 */
	admission?: { position: number; highBid: string; height: number; blockHash: string } | null
	/** `true` when the chain is advancing (`arenaChainAdvancing`). */
	chainAdvancing: boolean
	/** The escrow locktime the bid was funded against, or `null`. */
	escrowLocktime: number | null
	/**
	 * The chain's recorded refusal of this bid (kind-1450 naming its event id),
	 * verbatim, or `null` when no refusal was read. A bid refused at admission
	 * has no record and therefore no reason — which is not the same as accepted.
	 */
	refusalReason?: string | null
	/**
	 * Seconds the app has itself read the chain's committed state without seeing
	 * it advance, or `null`/absent when it has not begun observing. A caller
	 * that has no window (one probe, no clock) gets `unconfirmed`, never the
	 * stall claim: the absence of a window is not evidence of a stall.
	 */
	observedStallSec?: number | null
}): ArenaBidDiagnosis {
	// The chain admitted the bid. This is the affirmative fact, and it is checked
	// before every weaker one: an ACK, a receipt, a held bid or an elapsed window
	// can never say this, and none of them outranks it.
	if (input.admission !== undefined && input.admission !== null) {
		return {
			state: 'admitted',
			eventId: input.eventId,
			admission: input.admission,
			escrowLocktime: input.escrowLocktime,
			reason: null,
			reclaimable: false,
		}
	}
	if (input.seenInRead || input.namedByReceipt) {
		return {
			state: 'committed',
			eventId: input.eventId,
			admission: null,
			escrowLocktime: input.escrowLocktime,
			reason: null,
			reclaimable: false,
		}
	}
	// The chain put it in committed state and refused it. That is a fact, and the
	// reason is the chain's own words — the app adds none.
	const refusalReason = input.refusalReason
	if (typeof refusalReason === 'string' && refusalReason.trim() !== '') {
		return {
			state: 'refused',
			eventId: input.eventId,
			admission: null,
			escrowLocktime: input.escrowLocktime,
			reason: refusalReason,
			reclaimable: input.escrowLocktime !== null,
		}
	}
	if (input.chainAdvancing) {
		return {
			state: 'not-accepted',
			eventId: input.eventId,
			admission: null,
			escrowLocktime: input.escrowLocktime,
			reason: null,
			// Reclaimable only once the lock's own refund path is reachable, and
			// only when the locktime is known: a reclaim affordance with an
			// unknown deadline would be a button that cannot be honoured.
			reclaimable: input.escrowLocktime !== null,
		}
	}
	const observedStallSec = typeof input.observedStallSec === 'number' ? Math.max(0, input.observedStallSec) : null
	if (observedStallSec === null || observedStallSec < ARENA_CHAIN_STALLED_AFTER_SEC) {
		// No window, or a window too short to demonstrate a stall: the app has
		// nothing from the chain and says so. Nothing about the bid is claimed.
		return {
			state: 'unconfirmed',
			eventId: input.eventId,
			admission: null,
			escrowLocktime: input.escrowLocktime,
			reason: null,
			reclaimable: false,
		}
	}
	return {
		state: 'infrastructure',
		eventId: input.eventId,
		admission: null,
		escrowLocktime: input.escrowLocktime,
		reason: null,
		reclaimable: false,
	}
}

/** What an error thrown by {@link publishArenaBid} means for the panel. */
export function submissionFromError(error: unknown, fallbackAmount: number): ArenaBidSubmissionState {
	if (error instanceof ArenaBidPublishError) return error.state
	return { phase: 'failed', amount: fallbackAmount, reason: error instanceof Error ? error.message : String(error) }
}

/** Re-exported so a host imports its check types from the same place it imports the publisher. */
export { checkArenaBid, arenaBidBlock }
export type { ArenaBidCheck, ArenaBidBlockedReason, ArenaBidderState }
