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
 * content:  {"auction_id":"<d>","amount":<integer sats>}
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
 * - **`auction_id` is the `d`**, which is what the read adapter resolves a bid
 *   by (`arenaAuctionRead.ts:485-501` reads `content.auction_id`), and what the
 *   create's own `d` equals (a mismatch is refused by the read gate).
 * - **`amount` is the DELTA**, an integer, in sats. The arena protocol's bid
 *   model is additive (`platform/web/auctions/protocol/client.ts:62-63`) — the
 *   read adapter sums bid amounts per bidder into positions — and the surface
 *   says "bids add to your position" for exactly that reason. It is written as
 *   a JSON **number**, not a string, because that is the type the read adapter
 *   accepts and the type the demo client wrote.
 * - **No funding payload.** The custodial `reservation` / `cashu_lock` /
 *   `outcome_templates` / `sigall_deposit` extensions that
 *   `client.ts:244-254` could attach belong to the retired bidder-held path and
 *   to funding modes this slice does not implement. A bid published here says
 *   nothing about funding, and the UI says so (`ARENA_BID_ADVISORY`).
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
import type { ArenaAuctionDetailModel } from '@ui/auction/arena/model'
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

/** The bid content, as the frozen protocol reads it (`arenaAuctionRead.ts:485-501`). */
export interface ArenaBidContent {
	auction_id: string
	amount: number
}

/** Pure: what a 1441 for this auction and amount must carry. Throws a refusal, never guesses. */
export function buildArenaBidContent(
	auction: Pick<ArenaAuctionDetailModel, 'd' | 'seller' | 'rootEventId' | 'coordinate'>,
	amount: number,
): { content: ArenaBidContent; tags: string[][] } {
	if (typeof auction.d !== 'string' || auction.d.trim() === '') {
		throw new ArenaBidPublishError('bid.no-auction-id', 'The auction has no id, so a bid cannot name it.', { phase: 'failed', amount, reason: 'The auction has no id.' })
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
	// The read adapter's own coordinate convention (`arenaAuctionRead.ts:401-404`).
	const coordinate = auction.coordinate.includes(':') ? auction.coordinate : arenaAuctionCoordinate(auction.seller, auction.d)
	return {
		content: { auction_id: auction.d, amount },
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
	input: { model: ArenaAuctionDetailModel | null; status: 'loading' | 'settled' | 'incomplete' | 'no-relays' | 'error'; bidder: ArenaBidderState; raw: string },
	options: ArenaBidPublishOptions,
): Promise<ArenaBidPublishResult> {
	const check = checkArenaBid({ model: input.model, status: input.status, now: options.now, bidder: input.bidder, raw: input.raw })
	const typed = check.amount
	const failedState = (reason: string): ArenaBidSubmissionState => ({ phase: 'failed', amount: typed ?? 0, reason })
	if (!check.allowed || input.model === null || typed === null) {
		throw new ArenaBidPublishError('bid.not-allowed', bidBlockedCopy(check.reason, check), failedState(bidBlockedCopy(check.reason, check)))
	}

	const { content, tags } = buildArenaBidContent(input.model, typed)
	const template = { kind: ARENA_AUCTION_BID_KIND, created_at: options.now, tags, content: JSON.stringify(content) }

	// The id of the event that WILL be signed, from the template — so a signer
	// that returns a different event (wrong key, mutated tags) is caught here
	// rather than published.
	let expectedId: string
	try {
		expectedId = getEventHash({ ...template, pubkey: options.signer.pubkey })
	} catch (error) {
		throw new ArenaBidPublishError('bid.bad-root', error instanceof Error ? error.message : String(error), failedState('The event could not be built.'))
	}

	let event: Event
	try {
		event = await options.signer.sign(template)
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		throw new ArenaBidPublishError('bid.not-allowed', `signing failed: ${detail}`, failedState(`Your wallet did not sign the bid: ${detail}`))
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
		const named = rejected.length > 0 ? rejected.map((r) => `${r.url}${r.message ? ` (${r.message})` : ''}`).join('; ') : 'no relay answered'
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
// The read-back: presumed → seen
// =========================================================================

/**
 * Upgrade a `presumed` submission to `seen` once the read delivered the bid.
 *
 * The read's own bid list is the only proof that a relay is *serving* the bid;
 * an ACK is a promise a relay made. Both are recorded, and the panel shows the
 * second only when it is true.
 */
export function settleSubmissionFromRead(
	state: ArenaBidSubmissionState,
	model: ArenaAuctionDetailModel | null,
): ArenaBidSubmissionState {
	if (state.phase !== 'presumed' || model === null) return state
	const seen = model.bids.some((bid) => bid.eventId === state.eventId)
	if (!seen) return state
	return { phase: 'seen', amount: state.amount, eventId: state.eventId, acceptedBy: state.acceptedBy, totalRelays: state.totalRelays }
}

/** What an error thrown by {@link publishArenaBid} means for the panel. */
export function submissionFromError(error: unknown, fallbackAmount: number): ArenaBidSubmissionState {
	if (error instanceof ArenaBidPublishError) return error.state
	return { phase: 'failed', amount: fallbackAmount, reason: error instanceof Error ? error.message : String(error) }
}

/** Re-exported so a host imports its check types from the same place it imports the publisher. */
export { checkArenaBid, arenaBidBlock }
export type { ArenaBidCheck, ArenaBidBlockedReason, ArenaBidderState }