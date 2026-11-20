/**
 * The arena 1440-series **read adapter** — one read seam over the four auction
 * kinds, multi-relay from the start.
 *
 * Subscribes to `1440` (create), `1441` (bid), `1445` (verdict), `1447` (state
 * commitment) on **every configured relay independently**, and turns that
 * firehose into a deduplicated, ordered, allow-list-checked projection: one
 * canonical auction per `(seller, d)`, its bids, its verdicts, and the chain
 * anchor the verdicts claim.
 *
 * Read-only. No React, no UI, no route, no publish, and — by ruling — **no
 * validator ever**: the read path is 100% Nostr (`order.md` §"The rulings";
 * `notes/REPLY-nostr-verdict-contract.md` §2, "the relay notifies, the chain
 * decides, the anchor proves"). `relay notifies` is all this module does.
 *
 * ## Where this lives, and why
 *
 * It is on the **data side of the read seam**, in `platform/web/`, beside the
 * stage-1 parsers it builds on. The rules that put it there:
 *
 * - `ui/AGENTS.md:18-28` — `ui/` is the component library and its hard
 *   boundary forbids `ui/` importing `@platform/…`, `nostr-tools` or
 *   `applesauce-*`; `ui/AGENTS.md:120` ("No data fetching. No `fetch`, no
 *   `useQuery`, no `useStore`"). A relay read cannot be a `ui/` module.
 * - `ui/AGENTS.md:38-41` — "Data adapters … are invoked by the platform/assembler
 *   and passed down as props." This is that adapter.
 * - `sdk/AGENTS.md:38-53` — the read API is **stream-first**:
 *   `EventReadContext.stream(filters)` "is the default read path", and "Use
 *   `stream` for anything list-based or live — … bids and auction activity".
 *   This module is written against `EventReadContext.stream`, not against a
 *   transport.
 * - `sdk/AGENTS.md:59-61` — `sdk/` stays rxjs-free; the platform adapter maps
 *   applesauce's RxJS to `AsyncIterable`. So the transport-touching half of the
 *   seam is here, never in `sdk/`.
 * - `AGENTS.md:85-87` — "All new Nostr relay I/O must route through the SDK seam
 *   `sdk/core/nostr-io` … via the web host `platform/web/sdkNostrIo.ts`".
 *   `createWebArenaAuctionRead` below is the only part that touches I/O, and it
 *   does so through exactly that host.
 *
 * (Measured note: `AGENTS.md` does **not** itself state a "read seam" or a
 * `ui/` ↔ `platform/` split rule; the rules quoted above are the ones that
 * actually exist and that decide this placement. See the run report.)
 *
 * ## Multi-relay, and the failure it is for
 *
 * Each relay gets its **own** subscription, not one pooled subscription. That is
 * deliberate: `notes/REPLY-nostr-verdict-contract.md` §2 names equivocation —
 * one relay showing different verdicts to different clients — as the real
 * weakness of a relay-fed read, and says the mitigation is "publish to ≥2 and
 * have the client diff them". One pooled subscription cannot diff; per-relay
 * subscriptions can, and they also isolate latency.
 *
 * What the caller sees in each degraded case:
 *
 * | condition                       | what happens                                                        | what the caller sees |
 * | ------------------------------- | ------------------------------------------------------------------- | -------------------- |
 * | no relay configured             | nothing is opened                                                   | `caught-up` at once; `health.noRelaysReachable === true`; `auctions: []` |
* | every relay unreachable/errors  | each pump fails independently, nothing throws out of the read        | empty snapshot, `health.relays[*].status === 'unreachable'`/`'error'` |
 * | one relay down, others healthy  | the dead pump ends, the others keep delivering; no stall             | full data; `health.relays[dead].status === 'unreachable'`, `health.unreachable` names it |
 * | one relay slow / never EOSE     | it is dropped at `deadlineMs`, the others already delivered          | partial data at the deadline; that relay is `'timeout'`, in `health.pending` |
 * | one relay refuses the filter    | it CLOSEs with a reason (or NOTICEs a refusal); no follow-up REQ is opened on it | `health.relays[refuser].status === 'refused'`; `health.refused` names it; **not** pending |
 * | one relay lying                 | its events go through the same gate as everyone's: wrong kind, bad JSON, missing anchor, a 1440 update that changes an immutable field | dropped and counted in `health.relays[relay].refusals` + `snapshot.refusals`; never in `auctions` |
 *
 * `health.answered` is the field that answers "did this relay deliver data?".
 * `health.pending` is the field that answers "is a relay still to be heard
 * from?" — and it names **only** the silent ones. A relay that refused the
 * subscription, or that could not be reached, is a settled fact about that relay
 * (`health.refused` / `health.unreachable`) and never holds the read open. Three
 * measured caveats, all pinned by tests rather than papered over:
 *
 * - the web transport does not always surface EOSE, so `health.eose` may be
 *   empty on a healthy read; a relay that delivered events is `answered`
 *   regardless;
 * - on a **bounded** read (`snapshot`) the transport's `fetchEvents` turns a
 *   connection failure into an empty array, so a silent relay is
 *   indistinguishable from an empty one. `events()` is the live read and keeps
 *   the distinction; reach for it when it matters;
 * - the refusal/unreachable classification is the **transport's**, and it arrives
 *   when the relay itself says so (a `CLOSED` naming a filter error, a refusal
 *   `NOTICE`, a connection that fails). The read waits for that verdict for its
 *   whole deadline: there is no per-relay margin that ends the read first (see
 *   the note at the web host, `createWebArenaAuctionRead`).
 *
 * `snapshot()` therefore **never rejects** because of the network; it resolves
 * with what arrived and a `health` that says what did not. It rejects only when
 * the caller's own `signal` aborts it… and in fact it does not even do that: an
 * aborted read resolves with the partial result and `health.aborted === true`.
 *
 * ## Ordering and dedupe
 *
 * - Dedupe: by event id. `id` is the event hash, so two relays can only agree
 *   on an id or deliver different ids; there is no merge to do, only a union.
 *   The `relays` array on each event records who delivered it.
 * - Order: `created_at` **descending**, ties broken by the **lexically lowest
 *   id**. Derived, not guessed, from the protocol code:
 *   `sdk/core/event-store/mergeRules.ts:24-28` ("NIP-01: newer `created_at`
 *   wins; ties go to the lexically lowest id") and
 *   `sdk/core/event-store/filter.ts:32-34` (`selectMatching` sorts
 *   `b.created_at - a.created_at || a.id.localeCompare(b.id)`). Bids inside an
 *   auction are ordered **ascending** — a bid chain reads forwards.
 *
 * ## 1440 is regular, so "latest version wins" is built here
 *
 * `1440` is a NIP-01 *regular* kind: the relay stores every version side by
 * side and replaces nothing (`notes/DECISION-auction-kinds-and-editable-allowlist.md`
 * §4, "What is NOT free in this range"). So:
 *
 * - the **root** is the earliest `1440` by `created_at` for `(seller, d)`
 *   (decision §4.1);
 * - a later version is an **update** only if its `e` tag names that root
 *   (decision §4.3) — an event that does not supersede the root is not an
 *   update and is ignored, never guessed at;
 * - an update is **accepted** only if every field in
 *   {@link ARENA_CREATE_IMMUTABLE_FIELDS} is unchanged from the root
 *   (decision §3, §4.3);
 * - the **canonical** version is the latest accepted one by `created_at`
 *   (decision §4, last bullet).
 *
 * A rejected update is not silently swallowed: it lands in
 * `snapshot.rejectedCreates` with the field that changed, per
 * `AGENTS.md:111-115` (a visitor "cannot tell a curated item from a broken one"
 * if a constraint failure is invisible).
 */

import { parseLotMedia, type LotMediaItem } from '@sdk/commerce/auctions/lotMedia'
import type { EventFilter, EventStorePort, EventStreamItem, NostrEventLike } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { createWebRelayReadContext } from '@platform/web/sdkNostrIo'
import {
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_CREATE_KIND,
	ARENA_AUCTION_REFUND_KIND,
	ARENA_AUCTION_SETTLE_KIND,
	ARENA_LOT_STATE_KIND,
	ARENA_REFUSED_KIND,
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_VERDICT_KIND,
} from '@sdk/commerce/auctions/constants'
import {
	ARENA_REFUSAL_BAD_CONTENT,
	ArenaContractError,
	parseArenaStateCommitment,
	parseArenaVerdict,
	type ParsedArenaStateCommitment,
	type ParsedArenaVerdict,
} from './arenaAnchor'
import { ArenaReceiptError, dedupeArenaReceipts, parseArenaReceiptEvent, type ParsedArenaReceipt } from './arenaReceiptsRead'
import {
	ArenaLotStateError,
	dedupeArenaRefusals,
	dedupeArenaLotStates,
	parseArenaRefusalEvent,
	parseArenaLotStateEvent,
	type ArenaLotStateEventLike,
	type ParsedArenaRefusal,
	type ParsedArenaLotState,
} from './arenaLotStateRead'
import {
	ArenaBidAdmitError,
	dedupeArenaBidAdmits,
	isArenaBidAdmitSchema,
	parseArenaBidAdmitEvent,
	type ArenaBidAdmitEventLike,
	type ParsedArenaBidAdmit,
} from './arenaBidAdmitRead'
// Type-only: erased at runtime, so this adapter stays free of any `ui/` code.
import type { ArenaV4vSplitRow } from '@ui/auction/arena/model'

// =========================================================================
// Refusals
//
// Names, never message strings, so a caller (and a test) can tell one failure
// mode from another on the wire — the discipline stage 1 set at
// `arenaAnchor.ts:39-58`. The `arena.bad_*` / `arena.unanchored` names are
// re-used from that module; the four below are the read adapter's own.
// =========================================================================

/** A 1440 whose `d` tag and content `auction_id` disagree — it addresses two auctions at once. */
export const ARENA_REFUSAL_BAD_IDENTITY = 'arena.bad_identity' as const
/** A deeper 1440 that does not carry `e = <root event id>`: not a supersession of the root (decision §4.3). */
export const ARENA_REFUSAL_NOT_SUPERSEDING_ROOT = 'arena.not_superseding_root' as const
/** A deeper 1440 that changes a field frozen at first publish (decision §3). */
export const ARENA_REFUSAL_IMMUTABLE_CHANGED = 'arena.immutable_field_changed' as const
/** A 1441 that names no auction this read knows: no `a`, no root `e`, no unambiguous `auction_id`. */
export const ARENA_REFUSAL_UNBOUND_BID = 'arena.unbound_bid' as const
/** A kind the read never subscribes to, delivered anyway (a relay answering a filter it was not given). */
export const ARENA_REFUSAL_UNEXPECTED_KIND = 'arena.unexpected_kind' as const

export type ArenaReadRefusalName =
	| typeof ARENA_REFUSAL_BAD_IDENTITY
	| typeof ARENA_REFUSAL_NOT_SUPERSEDING_ROOT
	| typeof ARENA_REFUSAL_IMMUTABLE_CHANGED
	| typeof ARENA_REFUSAL_UNBOUND_BID
	| typeof ARENA_REFUSAL_UNEXPECTED_KIND
	| typeof ARENA_REFUSAL_BAD_CONTENT
	| 'arena.unanchored'
	| 'arena.bad_schema'
	| 'arena.bad_height'
	| 'arena.bad_hash'
	| 'arena.bad_kind'
	| 'arena.bad_outcome'
	| 'arena.receipt.bad_kind'
	| 'arena.receipt.bad_signature'
	| 'arena.receipt.bad_schema'
	| 'arena.receipt.bad_content'
	| 'arena.receipt.unanchored'
	| 'arena.receipt.bad_anchor'
	| 'arena.receipt.anchor_mismatch'
	| 'arena.receipt.signer_not_in_roster'
	| 'arena.lot_state.bad_kind'
	| 'arena.lot_state.bad_signature'
	| 'arena.lot_state.bad_schema'
	| 'arena.lot_state.bad_content'
	| 'arena.lot_state.unanchored'
	| 'arena.lot_state.bad_anchor'
	| 'arena.lot_state.anchor_mismatch'
	| 'arena.lot_state.signer_not_in_roster'
	| 'arena.bid_admit.bad_kind'
	| 'arena.bid_admit.bad_signature'
	| 'arena.bid_admit.bad_schema'
	| 'arena.bid_admit.bad_content'
	| 'arena.bid_admit.unanchored'
	| 'arena.bid_admit.bad_anchor'
	| 'arena.bid_admit.anchor_mismatch'
	| 'arena.bid_admit.p_tag_mismatch'
	| 'arena.bid_admit.signer_not_in_roster'

// =========================================================================
// The immutable allow-list for a 1440 (MERGED-PROTOCOL-SPEC.md §8)
//
// "display is mutable; money, time and cryptography are not." The seven
// fields below are frozen at first publish; `title` / `description` /
// `image` are deliberately absent, because those are the three that may be
// edited, including after the first bid. `auction_id` (the `d` value) is the
// auction's own identity and is enforced separately by the `d`/`auction_id`
// identity check below.
// =========================================================================

export const ARENA_CREATE_IMMUTABLE_FIELDS = [
	'mode',
	'startPrice',
	'minIncrement',
	'windowSec',
	'durationSec',
	'sellerWallet',
	'v4vSplit',
] as const

export type ArenaCreateImmutableField = (typeof ARENA_CREATE_IMMUTABLE_FIELDS)[number]

/**
 * Which of the frozen fields are numbers on the wire. Compared numerically, so
 * `1000` and `"1000"` are the same value (a producer's type wobble is not a
 * field change); everything else is compared as a trimmed string, and
 * absent/empty collapses to `null`. `v4vSplit` is an array of objects and is
 * compared by its canonical JSON serialisation.
 */
const NUMERIC_IMMUTABLE_FIELDS: ReadonlySet<string> = new Set(['startPrice', 'minIncrement', 'windowSec', 'durationSec'])

// =========================================================================
// Raw event → decoded event
// =========================================================================

/** The kinds this read subscribes to, in the one place it writes them. */
export const ARENA_READ_KINDS = [
	ARENA_AUCTION_CREATE_KIND,
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_REFUND_KIND,
	ARENA_AUCTION_SETTLE_KIND,
	ARENA_VERDICT_KIND,
	ARENA_STATE_COMMITMENT_KIND,
	ARENA_LOT_STATE_KIND,
	ARENA_REFUSED_KIND,
] as readonly number[]

/** The subscription filters: eight kinds, one budget each. Nothing else is ever requested. */
export function arenaAuctionFilters(): EventFilter[] {
	// One filter per kind group, each with an explicit limit. A relay caps a
	// filter's response (khatru answers at most 500 events), so a SINGLE combined
	// filter over all the kinds is answered with the newest 500 events ACROSS
	// them — and once the chain publishes a commitment every 10 s, those 500 are
	// all commitments and no lot ever arrives. Measured on the live relay
	// 2026-11-18: 36 creates alongside ~500 commitments, while the app's list
	// rendered a single lot. Splitting the filter gives each kind its own budget.
	return [
		{ kinds: [ARENA_AUCTION_CREATE_KIND], limit: 500 },
		{ kinds: [ARENA_AUCTION_BID_KIND], limit: 500 },
		{ kinds: [ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND], limit: 200 },
		{ kinds: [ARENA_VERDICT_KIND], limit: 200 },
		// The clock needs the newest few readings, not the history: this kind is
		// published every ~10 s by every validator.
		{ kinds: [ARENA_STATE_COMMITMENT_KIND], limit: 60 },
		// The state half: a lot's committed end and a create's refusal, one per
		// validator. A 1449 is published only while a lot is open, so a modest
		// budget carries the open lots' ends; a 1450 is rare.
		{ kinds: [ARENA_LOT_STATE_KIND], limit: 200 },
		{ kinds: [ARENA_REFUSED_KIND], limit: 200 },
	]
}

/**
 * The bid filters for **one lot**: the `#a` coordinate, and — when the lot's
 * create event id is known — the `#e` variant as well.
 *
 * `#e` is not an optimisation. A bid's `a` value is
 * `1440:<64 hex>:<36-char uuid>` = 106 characters, and the relay's event store
 * refuses to index a tag value longer than 100
 * (`fiatjaf.com/nostr@…/eventstore/boltdb/helpers.go:243`), so a `#a` query is
 * answered from the index with a confident zero. A bid's `e` is the create's
 * 64-hex event id, which the same store does index (`indexTag32`). Two filters
 * in one REQ are ORed, so a relay that indexes either tag answers — and `#a`
 * stays for the relays that do index it.
 */
export function arenaLotBidFilters(seller: string | null, d: string, eventId: string | null = null): EventFilter[] {
	const filters: EventFilter[] = []
	if (seller !== null && seller !== '') {
		filters.push({ kinds: [ARENA_AUCTION_BID_KIND], '#a': [arenaAuctionCoordinate(seller, d)] })
	}
	if (eventId !== null && eventId !== '') {
		filters.push({ kinds: [ARENA_AUCTION_BID_KIND], '#e': [eventId] })
	}
	return filters
}

/** The `#e` bid filter for a lot whose create event id is known; empty when no id is. */
export function arenaLotBidByEventFilters(eventIds: readonly string[]): EventFilter[] {
	const ids = eventIds.filter((id) => id !== '')
	if (ids.length === 0) return []
	return [{ kinds: [ARENA_AUCTION_BID_KIND], '#e': [...ids] }]
}

/**
 * The subscription filters for **one lot**, so a detail page resolves the lot
 * instead of the whole-arena firehose. The identity is `(seller, d)`: a 1440 is
 * matched by its `d` tag, and the coordinate-tagged kinds (a bid's `a`, a
 * receipt's / verdict's / committed end's `auction`) by
 * `1440:<seller>:<d>`. With no seller the coordinate is not knowable yet, so
 * this first REQ asks for the create alone: the create carries its seller, and
 * the coordinate REQ is the follow-up ({@link arenaLotFollowUpFilters}). A bare
 * `d` therefore reads its verdicts, receipts and committed end too — the
 * `?seller=` disambiguator only spares the read that second REQ.
 *
 * `eventId` is the lot's create event id when the caller already knows it; it
 * adds the `#e` bid filter ({@link arenaLotBidFilters}). A read that starts
 * before the create is known leaves it out and subscribes the `#e` variant as a
 * follow-up ({@link arenaLotFollowUpFilters}).
 */
export function arenaLotFilters(seller: string | null, d: string, eventId: string | null = null): EventFilter[] {
	const bids = arenaLotBidFilters(seller, d, eventId)
	if (seller === null || seller === '') return [{ kinds: [ARENA_AUCTION_CREATE_KIND], '#d': [d] }, ...bids]
	const coordinate = arenaAuctionCoordinate(seller, d)
	return [
		{ kinds: [ARENA_AUCTION_CREATE_KIND], '#d': [d] },
		...bids,
		{
			kinds: [ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND, ARENA_VERDICT_KIND, ARENA_LOT_STATE_KIND],
			'#auction': [coordinate],
		},
		// The chain clock is not lot-scoped (a 1447 names only its height and
		// hash), and the detail shows it: keep the same small window the
		// whole-arena read uses rather than dropping the clock from the page.
		{ kinds: [ARENA_STATE_COMMITMENT_KIND], limit: 60 },
	]
}

/**
 * The second subscription a lot read needs: both identities a create carries are
 * only knowable **after** the create has been read.
 *
 * - A bid's `#e` tag names the create's **event id** (its `a` coordinate is 106
 *   chars, which the relay's index refuses — see {@link arenaLotBidFilters}).
 * - Every coordinate-tagged kind (a receipt's / verdict's / committed end's
 *   `auction`) names the create's **`(seller, d)` coordinate**, and a bare-`d`
 *   address does not carry the seller. With a seller known that coordinate is in
 *   the base REQ already; without one, `#d` matches the create and nothing else,
 *   so the verdicts and receipts of a seller-less lot URL would never be asked
 *   for at all. The create's own signer IS the seller, so the coordinate becomes
 *   addressable the moment the create arrives.
 *
 * The read opens the base subscription first ({@link arenaLotFilters}); once a
 * create for this `d` arrives, the returned set is subscribed as a second REQ.
 * With a known seller it is the `#e` bid filter alone (the coordinate filter is
 * never sent twice); with no seller it carries the `#e` bid filter **and** the
 * coordinate filter, so receipts (1443/1444), verdicts (1445) and the committed
 * end (1449) are read together as they are on a seller-known lot. No create yet
 * → no extra filter, never an empty one.
 */
export function arenaLotFollowUpFilters(
	seller: string | null,
	d: string,
): (events: readonly ArenaAuctionEvent[]) => readonly EventFilter[] {
	const sellerKnown = seller !== null && seller !== ''
	return (events) => {
		const ids: string[] = []
		const coordinates: string[] = []
		for (const event of events) {
			if (event.type !== 'create' || event.d !== d) continue
			if (sellerKnown && event.pubkey !== seller) continue
			if (!ids.includes(event.id)) ids.push(event.id)
			if (!sellerKnown) {
				// `event.pubkey` is the seller the create was signed by: the same value
				// `projectArenaEvents` groups the lot under (`entry.root.pubkey`).
				const coordinate = arenaAuctionCoordinate(event.pubkey, event.d)
				if (!coordinates.includes(coordinate)) coordinates.push(coordinate)
			}
		}
		const filters = arenaLotBidByEventFilters(ids)
		if (coordinates.length === 0) return filters
		return [
			...filters,
			{
				kinds: [ARENA_AUCTION_REFUND_KIND, ARENA_AUCTION_SETTLE_KIND, ARENA_VERDICT_KIND, ARENA_LOT_STATE_KIND],
				'#auction': coordinates,
			},
		]
	}
}

/** The fields a decoded event always has, whatever its kind. */
export interface ArenaAuctionEventBase {
	id: string
	/** The signer: seller on a 1440, bidder on a 1441, validator on a 1445/1447. */
	pubkey: string
	kind: number
	createdAt: number
	tags: string[][]
	content: string
	/**
	 * Every relay that delivered this event id. Filled as the read runs; the
	 * snapshot's copy is complete for the relays that answered. This is the
	 * provenance that makes the equivocation diff possible.
	 */
	relays: string[]
}

/** The create content (`KindCreate`), as read — the consolidated protocol's camelCase fields only. */
export interface ArenaCreateContent {
	auctionId: string
	title: string | null
	description: string | null
	/** The lot's image URL (`image` on the wire). */
	image: string | null
	/** Gallery items after `image` (`media` on the wire); unsafe entries are dropped. */
	media: LotMediaItem[]
	/** The opening price (`startPrice` on the wire); `null` when unstated. */
	startPrice: number | null
	minIncrement: number | null
	/** `fixed` | `antisnipe`; `null` when unstated. */
	mode: string | null
	windowSec: number | null
	durationSec: number | null
	sellerWallet: string | null
	v4vSplit: ArenaV4vSplitRow[] | null
}

export interface ArenaCreateEvent extends ArenaAuctionEventBase {
	type: 'create'
	/** The `d` value — the auction's identity within its seller (decision §3). */
	d: string
	/** `content.auction_id`, which must equal `d`; a mismatch is refused, never reconciled. */
	auctionId: string
	/** The `e` tag, when present: the root this version claims to supersede. */
	supersedes: string | null
	content_: ArenaCreateContent
	/** The frozen fields as canonical strings — what the immutable check compares. */
	immutable: Record<string, string | null>
}

export interface ArenaBidEvent extends ArenaAuctionEventBase {
	type: 'bid'
	/** `content.auction_id`, unwrapped to a string when it is one. */
	auctionId: string | null
	/** The **delta** added to the bidder's position, not their new total (`client.ts:63`). */
	amount: number | null
	/** The `a` tag, `1440:<seller>:<d>`, when present. */
	coordinate: string | null
	/** The `e` tag — for a bid, the auction **root** event id (decision §4.2). */
	rootEventId: string | null
}

export interface ArenaVerdictEvent extends ArenaAuctionEventBase {
	type: 'verdict'
	verdict: ParsedArenaVerdict
}

export interface ArenaStateCommitmentEvent extends ArenaAuctionEventBase {
	type: 'commitment'
	commitment: ParsedArenaStateCommitment
}

/**
 * A kind-1443/1444 money receipt, parsed and anchored. Distinct from a verdict
 * on purpose: a verdict is a claim, a receipt is money that moved.
 */
export interface ArenaReceiptEvent extends ArenaAuctionEventBase {
	type: 'receipt'
	receipt: ParsedArenaReceipt
}

/**
 * A kind-1449 **committed end** for a lot: the end the chain committed when a
 * bid moved it, published while the lot is still open. Distinct from the
 * create-derived end the lot page computes from the create.
 */
export interface ArenaLotStateEvent extends ArenaAuctionEventBase {
	type: 'lot-state'
	lotState: ParsedArenaLotState
}

/**
 * A kind-1449 **bid admission**: the chain's own record that it admitted one
 * bid, carrying the position the bid belongs to. The other schema of the same
 * kind as {@link ArenaLotStateEvent}; dispatched on `content.schema`.
 */
export interface ArenaBidAdmitEvent extends ArenaAuctionEventBase {
	type: 'bid-admit'
	admit: ParsedArenaBidAdmit
}

/** A kind-1450 **refusal**: a create the chain refused, with the chain's own reason. */
export interface ArenaRefusedFactEvent extends ArenaAuctionEventBase {
	type: 'refused-fact'
	refusal: ParsedArenaRefusal
}

export type ArenaAuctionEvent =
	| ArenaCreateEvent
	| ArenaBidEvent
	| ArenaVerdictEvent
	| ArenaStateCommitmentEvent
	| ArenaReceiptEvent
	| ArenaLotStateEvent
	| ArenaBidAdmitEvent
	| ArenaRefusedFactEvent

/** One event the gate refused, with the relay that offered it. */
export interface ArenaRefusedEvent {
	relay: string
	eventId: string | null
	kind: number | null
	reason: string
	/** The refusal's own message, or the thrown error's, for an operator log. */
	detail: string
}

type DecodeResult = { ok: true; event: ArenaAuctionEvent } | { ok: false; refusal: ArenaRefusedEvent }

// =========================================================================
// Helpers
// =========================================================================

const HEX = /^[0-9a-fA-F]+$/

function tagValue(tags: readonly string[][], name: string): string | null {
	for (const tag of tags) {
		if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) return tag[1]
	}
	return null
}

/** A number from a JSON value, or null. Strings that are not finite numbers are null, not 0. */
function asFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value)
		return Number.isFinite(n) ? n : null
	}
	return null
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The committed V4V split, or `null`. A row is kept only when its role is a
 * non-empty string, its recipient is a non-empty string, and its allocation is
 * a finite number; anything else is dropped, never coerced. An absent, empty or
 * unparseable split is `null` — "no split stated", not an empty split.
 */
function asV4vSplit(value: unknown): ArenaV4vSplitRow[] | null {
	if (!Array.isArray(value)) return null
	const rows: ArenaV4vSplitRow[] = []
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
		const row = entry as Record<string, unknown>
		const role = asTrimmedString(row.role)
		const recipientPubkey = asTrimmedString(row.recipientPubkey)
		const allocationBps = asFiniteNumber(row.allocationBps)
		if (role === null || recipientPubkey === null || allocationBps === null) continue
		rows.push({ role, recipientPubkey, allocationBps })
	}
	return rows.length > 0 ? rows : null
}

function parseJsonObject(content: string): Record<string, unknown> | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
	return parsed as Record<string, unknown>
}

/** Canonical form of one frozen field, for the immutable comparison. */
function canonicalImmutableValue(value: unknown, numeric: boolean): string | null {
	if (value === undefined || value === null) return null
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
	if (typeof value === 'boolean') return String(value)
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (trimmed === '') return null
		if (numeric) {
			const n = Number(trimmed)
			return Number.isFinite(n) ? String(n) : trimmed
		}
		return trimmed
	}
	return JSON.stringify(value)
}

function canonicalImmutableFields(content: Record<string, unknown>): Record<string, string | null> {
	const out: Record<string, string | null> = {}
	for (const field of ARENA_CREATE_IMMUTABLE_FIELDS) {
		out[field] = canonicalImmutableValue(content[field], NUMERIC_IMMUTABLE_FIELDS.has(field))
	}
	return out
}

function createContentOf(content: Record<string, unknown>): ArenaCreateContent {
	return {
		// The identity key stays snake_case on the wire: `MERGED-PROTOCOL-SPEC.md` §8
		// names `auction_id` (the `d` value), the bid and verdict content carry the
		// same key, and the live e2e create does too. Only the money and time fields
		// below are the consolidated protocol's camelCase.
		auctionId: asTrimmedString(content.auction_id) ?? '',
		title: asTrimmedString(content.title),
		description: asTrimmedString(content.description),
		image: asTrimmedString(content.image),
		media: parseLotMedia(content.media),
		startPrice: asFiniteNumber(content.startPrice),
		minIncrement: asFiniteNumber(content.minIncrement),
		mode: asTrimmedString(content.mode),
		windowSec: asFiniteNumber(content.windowSec),
		durationSec: asFiniteNumber(content.durationSec),
		sellerWallet: asTrimmedString(content.sellerWallet),
		v4vSplit: asV4vSplit(content.v4vSplit),
	}
}

/** The `(seller, d)` group key. `\0` cannot appear in a pubkey or a `d`, so it cannot collide. */
function auctionGroupKey(seller: string, d: string): string {
	return `${seller}\u0000${d}`
}

/** `a = 1440:<seller_pubkey>:<d>` — our own convention, since 1440 is not addressable (decision §4). */
export function arenaAuctionCoordinate(seller: string, d: string): string {
	return `${ARENA_AUCTION_CREATE_KIND}:${seller}:${d}`
}

function baseOf(event: NostrEventLike, relay: string): ArenaAuctionEventBase {
	return {
		id: event.id,
		pubkey: event.pubkey,
		kind: event.kind,
		createdAt: event.created_at ?? 0,
		tags: event.tags,
		content: event.content,
		relays: [relay],
	}
}

function refuse(relay: string, event: NostrEventLike | null, reason: string, detail: string): { ok: false; refusal: ArenaRefusedEvent } {
	return {
		ok: false,
		refusal: {
			relay,
			eventId: event?.id ?? null,
			kind: event?.kind ?? null,
			reason,
			detail,
		},
	}
}

// =========================================================================
// The gate: one event in, one decoded event or one named refusal out
// =========================================================================

/**
 * Decode one relay event. This is the **only** way an event enters the read, so
 * a lying relay is not a special case: it is an event that fails here.
 */
export function decodeArenaEvent(event: NostrEventLike, relay: string): DecodeResult {
	if (typeof event.id !== 'string' || event.id.length === 0) {
		return refuse(relay, null, ARENA_REFUSAL_UNEXPECTED_KIND, 'event has no id')
	}
	if (!ARENA_READ_KINDS.includes(event.kind)) {
		return refuse(relay, event, ARENA_REFUSAL_UNEXPECTED_KIND, `kind ${event.kind} is not one of ${ARENA_READ_KINDS.join(', ')}`)
	}

	if (event.kind === ARENA_AUCTION_CREATE_KIND) {
		const content = parseJsonObject(event.content)
		if (content === null) return refuse(relay, event, ARENA_REFUSAL_BAD_CONTENT, 'create content is not a JSON object')

		const contentAuctionId = asTrimmedString(content.auction_id)
		const tagD = tagValue(event.tags, 'd')
		// The identity IS the `d` value (`MERGED-PROTOCOL-SPEC.md` §8: `auction_id`
		// is the `d` value). A client may write it twice — the `d` tag and the
		// content key — and must then agree, because a disagreement makes the event
		// address two auctions and neither reading is safe. But a client may also
		// write only the tag: the chain's own client does exactly that, and
		// refusing it made every lot created by a conformant client invisible in
		// this app. A create that names no `d` at all is refused: 1440 is a regular
		// kind, so the `d` is the only stable address for later versions.
		if (tagD === null && contentAuctionId === null) {
			return refuse(relay, event, ARENA_REFUSAL_BAD_CONTENT, 'create states no identity (no d tag and no content.auction_id)')
		}
		if (tagD !== null && contentAuctionId !== null && tagD !== contentAuctionId) {
			return refuse(
				relay,
				event,
				ARENA_REFUSAL_BAD_IDENTITY,
				`d tag ${JSON.stringify(tagD)} != content.auction_id ${JSON.stringify(contentAuctionId)}`,
			)
		}
		const auctionId = tagD ?? (contentAuctionId as string)

		return {
			ok: true,
			event: {
				...baseOf(event, relay),
				type: 'create',
				d: tagD ?? auctionId,
				auctionId,
				supersedes: tagValue(event.tags, 'e'),
				content_: { ...createContentOf(content), auctionId },
				immutable: canonicalImmutableFields(content),
			},
		}
	}

	if (event.kind === ARENA_AUCTION_BID_KIND) {
		const content = parseJsonObject(event.content)
		if (content === null) return refuse(relay, event, ARENA_REFUSAL_BAD_CONTENT, 'bid content is not a JSON object')

		return {
			ok: true,
			event: {
				...baseOf(event, relay),
				type: 'bid',
				auctionId: asTrimmedString(content.auction_id),
				// A read adapter resolves *addressing*; it does not judge validity.
				// A zero or negative delta is the validator's business, not this gate's.
				amount: asFiniteNumber(content.amount),
				coordinate: tagValue(event.tags, 'a'),
				rootEventId: tagValue(event.tags, 'e'),
			},
		}
	}

	// 1443 / 1444: the money receipts, the same discipline the params path
	// applies to a 1448 — signature, schema, mandatory agreeing anchor. No roster
	// is held at this seam, so membership is enforced only where a params read
	// supplies one (`arenaReceiptsRead.ts`).
	if (event.kind === ARENA_AUCTION_REFUND_KIND || event.kind === ARENA_AUCTION_SETTLE_KIND) {
		try {
			const receipt = parseArenaReceiptEvent({
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at ?? 0,
				tags: event.tags,
				content: event.content,
				sig: event.sig ?? '',
			})
			return { ok: true, event: { ...baseOf(event, relay), type: 'receipt', receipt } }
		} catch (error) {
			const reason = error instanceof ArenaReceiptError ? error.refusal : 'arena.receipt.bad_content'
			const detail = error instanceof Error ? error.message : String(error)
			return refuse(relay, event, reason, detail)
		}
	}

	// 1449 / 1450: the chain's state half — a lot's committed end, a bid's
	// admission, and a create's refusal, the same discipline the receipts and
	// params paths apply to a 1443 and a 1448: signature, kind, schema, mandatory
	// agreeing anchor, and a tag-vs-content cross-check. No roster is held at this
	// seam.
	if (event.kind === ARENA_LOT_STATE_KIND || event.kind === ARENA_REFUSED_KIND) {
		try {
			const like: ArenaLotStateEventLike = {
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at ?? 0,
				tags: event.tags,
				content: event.content,
				sig: event.sig ?? '',
			}
			if (event.kind === ARENA_LOT_STATE_KIND) {
				// Kind 1449 carries two schemas. The schema, not the kind, says
				// which fact an event is — so a bid admission is read as one and a
				// committed end as the other, and each parser refuses the other's
				// shape by name (`arenaBidAdmitRead.ts` / `arenaLotStateRead.ts`).
				if (isArenaBidAdmitSchema(event.content)) {
					const admit = parseArenaBidAdmitEvent(like as ArenaBidAdmitEventLike)
					return { ok: true, event: { ...baseOf(event, relay), type: 'bid-admit', admit } }
				}
				const lotState = parseArenaLotStateEvent(like)
				return { ok: true, event: { ...baseOf(event, relay), type: 'lot-state', lotState } }
			}
			const refusal = parseArenaRefusalEvent(like)
			return { ok: true, event: { ...baseOf(event, relay), type: 'refused-fact', refusal } }
		} catch (error) {
			const reason =
				error instanceof ArenaLotStateError || error instanceof ArenaBidAdmitError
					? error.refusal
					: 'arena.lot_state.bad_content'
			const detail = error instanceof Error ? error.message : String(error)
			return refuse(relay, event, reason, detail)
		}
	}

	// 1445 / 1447: stage 1 owns the shape and the mandatory anchor. A thrown
	// refusal here is the event's verdict, and it is the answer a client MUST
	// ignore an unanchored event with (`arenaAnchor.ts:8-13`).
	try {
		if (event.kind === ARENA_VERDICT_KIND) {
			const verdict = parseArenaVerdict({ id: event.id, kind: event.kind, tags: event.tags, content: event.content })
			return { ok: true, event: { ...baseOf(event, relay), type: 'verdict', verdict } }
		}
		const commitment = parseArenaStateCommitment({ kind: event.kind, tags: event.tags, content: event.content })
		return { ok: true, event: { ...baseOf(event, relay), type: 'commitment', commitment } }
	} catch (error) {
		const reason = error instanceof ArenaContractError ? error.refusal : 'arena.bad_content'
		const detail = error instanceof Error ? error.message : String(error)
		return refuse(relay, event, reason, detail)
	}
}

// =========================================================================
// The projection: decoded events → canonical auction state
// =========================================================================

/**
 * What the read learned about one relay.
 *
 * Two of these are **settled facts about the relay** and not silence, which is
 * the distinction this enum exists for:
 *
 * - `ok` — it answered (an event, or an EOSE);
 * - `refused` — it answered with a refusal (`CLOSED` naming a filter error, or a
 *   refusal `NOTICE`/relay-closed `ERROR`): it cannot serve this subscription;
 * - `unreachable` — the connection failed or never established, after the
 *   transport's own retries;
 * - `timeout` — the read stopped waiting on it (the deadline) and it had said
 *   nothing. **Only this one is silence**;
 * - `error` — the pump threw (a connection failure the transport did not name);
 * - `closed` — the stream ended without answering and without either of the
 *   above (the pre-read default too).
 *
 * A later fact upgrades a settling guess: an answer upgrades `timeout`/`closed`
 * to `ok`, and a transport verdict upgrades `timeout`/`closed` to `refused`/
 * `unreachable` — the give-up was a guess, the answer is a fact.
 */
export type ArenaRelayStatus = 'ok' | 'refused' | 'unreachable' | 'timeout' | 'error' | 'closed'

export interface ArenaRelayHealth {
	url: string
	/**
	 * `ok`: answered. `refused`/`unreachable`: the transport classified it — a
	 * settled "no". `timeout`: the deadline stopped the wait. `error`: the pump
	 * threw. `closed`: ended without EOSE.
	 */
	status: ArenaRelayStatus
	events: number
	refusals: number
	/** True when this relay reported EOSE (or, on a bounded read, completed). */
	eose: boolean
	error: string | null
}

export interface ArenaReadHealth {
	relays: ArenaRelayHealth[]
	/**
	 * Relays that explicitly reported EOSE. **Transport-dependent**: measured
	 * 2026-11-13, the web applesauce adapter never fills its `CaughtUpInfo.eose`
	 * for a `ws://` relay and settles by timeout instead, so this can be empty on
	 * a perfectly healthy read. `answered` is the field to rely on.
	 */
	eose: string[]
	/** Relays that answered in the only sense that matters: an event, or an EOSE. */
	answered: string[]
/** Relays that answered with a refusal: they cannot serve this subscription. */
	refused: string[]
	/** Relays whose connection failed or never established — unreachable, not silent. */
	unreachable: string[]
	/**
	 * Relays that have not answered — the ones that stalled. A relay that refused,
	 * or that could not be reached, is accounted for and is *not* here (see
	 * {@link refused} / {@link unreachable}).
	 */
	pending: string[]
	/** Relays whose subscription threw. */
	failed: string[]
	/** No relay is configured at all, or not one of them answered. */
	noRelaysReachable: boolean
	/** No event arrived — an honest empty answer, which may be correct. */
	empty: boolean
	/** The caller's signal fired; the result is partial by construction. */
	aborted: boolean
}

export interface ArenaBidView {
	eventId: string
	bidder: string
	createdAt: number
	/** The delta this bid added (`client.ts:63`). */
	amount: number | null
	relays: string[]
}

export interface ArenaAuctionView {
	/** `1440:<seller>:<d>`. */
	coordinate: string
	seller: string
	d: string
	/** The first 1440 for `(seller, d)`; bids bind to this id, not to a version (decision §4.1-4.2). */
	rootEventId: string
	/** The latest version that passed the immutable check. */
	canonicalEventId: string
	createdAt: number
	/**
	 * The **root** 1440's `created_at` — when the auction actually started.
	 * `createdAt` above is the canonical version's, which moves forward when the
	 * seller edits display fields, so an end time derived from it would drift.
	 * Additive: consumers that predate it are unaffected.
	 */
	rootCreatedAt: number
	content: ArenaCreateContent
	/** How many 1440 versions exist, accepted or not — a display aid, not a count of anything authoritative. */
	versions: number
	bids: ArenaBidView[]
	/**
	 * Per-bidder position: the sum of the bidder's **live** legs. A bid is a
	 * **delta** added to a position (R1-A); a leg a kind-1443 refund receipt names
	 * is dead and is not summed (see the assembly below for the rule and the
	 * invariant it assumes). `null` means the position is **not known** — a leg's
	 * liveness could not be determined because the read could not vouch for the
	 * refund receipts it read — and is never a partial sum. A *derived view*, not
	 * an outcome: the authority on who won is the 1445 verdict, and the
	 * authority on whether money moved is the mint (`REPLY` §4.2).
	 */
	positions: Record<string, number | null>
	/**
	 * The best derived position, or `null` when no top position can be named —
	 * no bids, or at least one bidder whose position is unknown (`null` above),
	 * who could be above the best known one.
	 */
	topBid: { bidder: string; total: number } | null
	/** Bids whose `amount` was not a finite number; the positions above are then incomplete. */
	bidsWithoutAmount: number
	verdicts: ParsedArenaVerdict[]
	/**
	 * The money receipts the read verified for this auction (kinds 1443/1444),
	 * deduped by `(bidId, outcome)` at the earliest anchored height, ordered by
	 * height ascending. A verdict is a claim; a receipt is money that moved —
	 * these are the latter.
	 */
	receipts: ParsedArenaReceipt[]
	/** The earliest-anchored refund receipt per `bidId`, for a per-bid lookup. */
	refundForBid: Record<string, ParsedArenaReceipt>
	/** The earliest-anchored settle receipt per `bidId`, for a per-bid lookup. */
	settleForBid: Record<string, ParsedArenaReceipt>
	/** The lot-level settle: the earliest-anchored 1444 this auction carries, or `null`. */
	settleReceipt: ParsedArenaReceipt | null
	/**
	 * The lot's **committed end** as the chain published it (kind 1449), at the
	 * highest anchored height, or `null` when no 1449 named this lot. `null` is
	 * *no committed end read* — never the create-derived end, which the card
	 * model computes separately and labels as such.
	 */
	committedEnd: ParsedArenaLotState | null
	/**
	 * Every committed end read for this lot, ordered by anchored height
	 * ascending. Empty when none was read; a surface can see the per-bid ordinal
	 * history here.
	 */
	committedEnds: ParsedArenaLotState[]
	/**
	 * The chain's refusal of this lot's **create** (a 1450 naming the root
	 * create's event id), or `null` when none was read.
	 */
	createRefusal: ArenaRefusedCreateFact | null
	/**
	 * The chain's refusals of this lot's **bids** (1450 events naming a kind-1441),
	 * one per refused bid event id, at the earliest anchored height.
	 *
	 * Only a bid the chain refused **at delivery** appears here. A bid refused at
	 * admission is discarded in `CheckTx` and leaves no record — so an absent
	 * entry is *no refusal read*, never "accepted".
	 */
	bidRefusals: ArenaRefusedCreateFact[]
	/**
	 * The chain's **admission facts** for this lot's bids (kind 1449,
	 * `arena.bidadmit.v1`), deduped by bid id at the earliest anchored height,
	 * ordered by anchored height ascending. This is the one fact that says the
	 * chain took a bid — an ACK, a timeout or a `highAmount` is not it.
	 */
	admissions: ParsedArenaBidAdmit[]
	/** The admission that names a bid id, for a per-bid lookup — the one thing a bid panel needs. */
	admissionForBid: Record<string, ParsedArenaBidAdmit>
	relays: string[]
}

export interface ArenaRejectedCreate {
	eventId: string
	seller: string
	d: string
	reason: string
	/** For `arena.immutable_field_changed`: the field that moved. */
	field: string | null
	detail: string
}

/** Two relays returned different outcome sets for one auction. A signal, not proof. */
export interface ArenaVerdictDivergence {
	auctionId: string
	/** Relay url → the distinct outcomes it reports, sorted. */
	byRelay: Record<string, string[]>
}

/** Two relays report different `app_hash` at the same height. A signal, not proof. */
export interface ArenaCommitmentFork {
	height: number
	byRelay: Record<string, string[]>
}

/** A kind-1447 state commitment with its provenance: the parsed anchor plus the relays that delivered it. */
export interface ArenaStateCommitmentView extends ParsedArenaStateCommitment {
	/** Every relay that delivered this commitment. */
	relays: string[]
}

/**
 * A create the chain **refused** (a kind-1450 naming a create's event id), with
 * the chain's own reason verbatim. Distinct from {@link ArenaRejectedCreate},
 * which is a create this read refused locally: this one the **chain** refused.
 */
export interface ArenaRefusedCreateFact {
	/** The refusal event id. */
	refusalEventId: string
	/** The create event id the chain refused. */
	createEventId: string
	/** The refused event's kind (1440 for a create), or `null` when unreadable. */
	refusedKind: number | null
	/** The chain's own reason, verbatim — never invented, never re-worded. */
	reason: string
	/** The anchored height the refusal names. */
	height: number
	/** The anchored block hash the refusal names. */
	blockHash: string
	/** The signing validator. */
	validatorPubkey: string
}

export interface ArenaAuctionSnapshot {
	/** Canonical auctions, `created_at` descending (tie: lowest event id first). */
	auctions: ArenaAuctionView[]
	/** Verdicts whose `auction` id matches no create this read saw. */
	orphanVerdicts: ParsedArenaVerdict[]
	/** Receipts whose `auction` id matches no create this read saw. */
	orphanReceipts: ParsedArenaReceipt[]
	/** Committed ends (kind 1449) whose coordinate matches no create this read saw. */
	orphanLotStates: ParsedArenaLotState[]
	/** Bid admissions (kind 1449, `arena.bidadmit.v1`) whose coordinate matches no create this read saw. */
	orphanAdmissions: ParsedArenaBidAdmit[]
	/** Every create the chain refused (kind 1450), deduped at the earliest anchored height. */
	refusedCreates: ArenaRefusedCreateFact[]
	/** State commitments, height descending then time descending, then validator pubkey. */
	stateCommitments: ArenaStateCommitmentView[]
	highestCommitment: ParsedArenaStateCommitment | null
	commitmentForks: ArenaCommitmentFork[]
	verdictDivergence: ArenaVerdictDivergence[]
	/** 1440 versions refused by the immutable check or by the supersession rule. */
	rejectedCreates: ArenaRejectedCreate[]
	/** Everything else the gate refused (wrong kind, bad JSON, no anchor). */
	refusals: ArenaRefusedEvent[]
	health: ArenaReadHealth
}

/** Order: `created_at` descending, ties to the lexically lowest id (`mergeRules.ts:24-28`). */
function byNewestThenId(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
	if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
	return a.id.localeCompare(b.id)
}

/** Order: `created_at` ascending, ties to the lexically lowest id (a bid chain reads forwards). */
function byOldestThenId(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
	if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
	return a.id.localeCompare(b.id)
}

/**
 * The immutable check (decision §3): returns the first frozen field whose value
 * differs from the root's, or null when every one is unchanged.
 */
export function findImmutableChange(
	root: ArenaCreateEvent,
	update: ArenaCreateEvent,
): { field: ArenaCreateImmutableField; from: string | null; to: string | null } | null {
	for (const field of ARENA_CREATE_IMMUTABLE_FIELDS) {
		const before = root.immutable[field] ?? null
		const after = update.immutable[field] ?? null
		if (before !== after) return { field, from: before, to: after }
	}
	return null
}

interface AcceptedVersion {
	event: ArenaCreateEvent
	reason: string
	field: string | null
	detail: string
}

/** Resolve one `(seller, d)` group to root + accepted versions + rejects. */
function resolveVersions(versions: readonly ArenaCreateEvent[]): {
	root: ArenaCreateEvent
	accepted: ArenaCreateEvent[]
	rejected: AcceptedVersion[]
} {
	const ordered = [...versions].sort(byOldestThenId)
	const root = ordered[0]
	const accepted: ArenaCreateEvent[] = [root]
	const rejected: AcceptedVersion[] = []

	for (const candidate of ordered.slice(1)) {
		if (candidate.supersedes !== root.id) {
			rejected.push({
				event: candidate,
				reason: ARENA_REFUSAL_NOT_SUPERSEDING_ROOT,
				field: null,
				detail: `e tag ${JSON.stringify(candidate.supersedes)} does not name the root ${root.id}`,
			})
			continue
		}
		const change = findImmutableChange(root, candidate)
		if (change !== null) {
			rejected.push({
				event: candidate,
				reason: ARENA_REFUSAL_IMMUTABLE_CHANGED,
				field: change.field,
				detail: `${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`,
			})
			continue
		}
		accepted.push(candidate)
	}

	return { root, accepted, rejected }
}

function emptyHealth(relays: readonly string[], aborted = false): ArenaReadHealth {
	const health = relays.map<ArenaRelayHealth>((url) => ({
		url,
		status: 'closed',
		events: 0,
		refusals: 0,
		eose: false,
		error: null,
	}))
	return summarizeHealth(health, aborted)
}

function summarizeHealth(relays: ArenaRelayHealth[], aborted: boolean): ArenaReadHealth {
	const eose = relays.filter((r) => r.eose).map((r) => r.url)
	const failed = relays.filter((r) => r.status === 'error').map((r) => r.url)
	// `answered` is the field a caller trusts, so it means what it says: a relay
	// that delivered an event answered, whatever its transport did afterwards (a
	// relay that streams events and then drops is `answered` and `failed`). A
	// read that received events must never report `no-relays`.
	const answered = relays.filter((r) => r.status === 'ok' || r.events > 0).map((r) => r.url)
	// A relay that answered with a refusal, or that could not be reached, has
	// **answered the question "will you serve this subscription?"**. It is a
	// settled fact about that relay — not silence — so it must not hold the read
	// open and it is not `pending`. `timeout` (and the pre-read `closed`) are the
	// silence.
	const refused = relays.filter((r) => r.status === 'refused').map((r) => r.url)
	const unreachable = relays.filter((r) => r.status === 'unreachable' || r.status === 'error').map((r) => r.url)
	const accountedFor = new Set([...answered, ...refused, ...unreachable])
	const pending = relays.filter((r) => !accountedFor.has(r.url)).map((r) => r.url)
	return {
		relays,
		eose,
		answered,
		refused,
		unreachable,
		pending,
		failed,
		noRelaysReachable: relays.length === 0 || answered.length === 0,
		empty: relays.every((r) => r.events === 0),
		aborted,
	}
}

/**
 * Pure projection: decoded events → the canonical snapshot. Exported because a
 * consumer that is already holding events (a live stream accumulating them)
 * must be able to re-project without reopening subscriptions.
 *
 * `events` may contain duplicates; they are unioned by id here too, so the
 * function is safe on a raw concatenation of several relays' streams.
 */
export function projectArenaEvents(
	events: readonly ArenaAuctionEvent[],
	health: ArenaReadHealth = emptyHealth([]),
	refusals: readonly ArenaRefusedEvent[] = [],
): ArenaAuctionSnapshot {
	// ---- dedupe by id, unioning relay provenance --------------------------
	const byId = new Map<string, ArenaAuctionEvent>()
	for (const event of events) {
		const prior = byId.get(event.id)
		if (prior === undefined) {
			byId.set(event.id, event)
			continue
		}
		for (const relay of event.relays) if (!prior.relays.includes(relay)) prior.relays.push(relay)
	}

	const all = [...byId.values()]
	const creates = all.filter((e): e is ArenaCreateEvent => e.type === 'create')
	const bids = all.filter((e): e is ArenaBidEvent => e.type === 'bid')
	const verdictEvents = all.filter((e): e is ArenaVerdictEvent => e.type === 'verdict')
	const commitmentEvents = all.filter((e): e is ArenaStateCommitmentEvent => e.type === 'commitment')
	const receiptEvents = all.filter((e): e is ArenaReceiptEvent => e.type === 'receipt')
	const lotStateEvents = all.filter((e): e is ArenaLotStateEvent => e.type === 'lot-state')
	const bidAdmitEvents = all.filter((e): e is ArenaBidAdmitEvent => e.type === 'bid-admit')
	const refusedFactEvents = all.filter((e): e is ArenaRefusedFactEvent => e.type === 'refused-fact')

	// ---- resolve 1440 versions ------------------------------------------
	const groups = new Map<string, ArenaCreateEvent[]>()
	for (const create of creates) {
		const key = auctionGroupKey(create.pubkey, create.d)
		const list = groups.get(key)
		if (list === undefined) groups.set(key, [create])
		else list.push(create)
	}

	const rejectedCreates: ArenaRejectedCreate[] = []
	const resolved = new Map<string, { root: ArenaCreateEvent; canonical: ArenaCreateEvent; versions: number; coordinate: string }>()

	for (const [key, versions] of groups) {
		const { root, accepted, rejected } = resolveVersions(versions)
		const canonical = [...accepted].sort(byNewestThenId)[0]
		const coordinate = arenaAuctionCoordinate(root.pubkey, root.d)
		resolved.set(key, { root, canonical, versions: versions.length, coordinate })
		for (const reject of rejected) {
			rejectedCreates.push({
				eventId: reject.event.id,
				seller: reject.event.pubkey,
				d: reject.event.d,
				reason: reject.reason,
				field: reject.field,
				detail: reject.detail,
			})
		}
	}

	// ---- bind bids to auctions ------------------------------------------
	// `a` first (an explicit coordinate), then `e` = a known root (decision
	// §4.2), then `content.auction_id` when exactly one auction carries that
	// `d`. Anything else is unbound and is counted, not guessed.
	const refusalList: ArenaRefusedEvent[] = [...refusals]
	const rootToKey = new Map<string, string>()
	for (const [key, entry] of resolved) rootToKey.set(entry.root.id, key)
	const keyByD = new Map<string, string[]>()
	for (const [key, entry] of resolved) {
		const list = keyByD.get(entry.root.d)
		if (list === undefined) keyByD.set(entry.root.d, [key])
		else list.push(key)
	}

	const bidsByKey = new Map<string, ArenaBidView[]>()
	let unboundBids = 0
	for (const bid of bids) {
		let key: string | null = null
		if (bid.coordinate !== null) {
			for (const [candidate, entry] of resolved) {
				if (entry.coordinate === bid.coordinate) {
					key = candidate
					break
				}
			}
		}
		if (key === null && bid.rootEventId !== null) key = rootToKey.get(bid.rootEventId) ?? null
		if (key === null && bid.auctionId !== null) {
			const candidates = keyByD.get(bid.auctionId) ?? []
			if (candidates.length === 1) key = candidates[0]
		}
		if (key === null) {
			unboundBids += 1
			refusalList.push({
				relay: bid.relays.join(','),
				eventId: bid.id,
				kind: ARENA_AUCTION_BID_KIND,
				reason: ARENA_REFUSAL_UNBOUND_BID,
				detail: `no auction for a=${JSON.stringify(bid.coordinate)} e=${JSON.stringify(bid.rootEventId)} auction_id=${JSON.stringify(bid.auctionId)}`,
			})
			continue
		}
		const list = bidsByKey.get(key)
		const view: ArenaBidView = {
			eventId: bid.id,
			bidder: bid.pubkey,
			createdAt: bid.createdAt,
			amount: bid.amount,
			relays: bid.relays,
		}
		if (list === undefined) bidsByKey.set(key, [view])
		else list.push(view)
	}

	// ---- verdicts, grouped by auction id --------------------------------
	const verdictsByAuction = new Map<string, ParsedArenaVerdict[]>()
	const orphanVerdicts: ParsedArenaVerdict[] = []
	const dToCoordinate = new Map<string, string[]>()
	for (const entry of resolved.values()) {
		const list = dToCoordinate.get(entry.root.d)
		if (list === undefined) dToCoordinate.set(entry.root.d, [entry.coordinate])
		else list.push(entry.coordinate)
	}
	for (const event of verdictEvents) {
		const auctionId = event.verdict.auctionId
		const coordinate = auctionId.includes(':')
			? auctionId
			: (dToCoordinate.get(auctionId) ?? []).length === 1
				? dToCoordinate.get(auctionId)![0]
				: null
		if (coordinate === null) {
			orphanVerdicts.push(event.verdict)
			continue
		}
		const list = verdictsByAuction.get(coordinate)
		if (list === undefined) verdictsByAuction.set(coordinate, [event.verdict])
		else list.push(event.verdict)
	}

	// ---- receipts, grouped by auction id --------------------------------
	// Same resolution as verdicts: a receipt's `auction_id` is a coordinate, but
	// a bare `d` is accepted when exactly one auction carries it.
	const receiptsByAuction = new Map<string, ParsedArenaReceipt[]>()
	const receiptRelaysByAuction = new Map<string, Set<string>>()
	const orphanReceipts: ParsedArenaReceipt[] = []
	for (const event of receiptEvents) {
		const auctionId = event.receipt.auctionId
		const coordinate = auctionId.includes(':')
			? auctionId
			: (dToCoordinate.get(auctionId) ?? []).length === 1
				? dToCoordinate.get(auctionId)![0]
				: null
		if (coordinate === null) {
			orphanReceipts.push(event.receipt)
			continue
		}
		const list = receiptsByAuction.get(coordinate)
		if (list === undefined) receiptsByAuction.set(coordinate, [event.receipt])
		else list.push(event.receipt)
		const relays = receiptRelaysByAuction.get(coordinate) ?? new Set<string>()
		for (const relay of event.relays) relays.add(relay)
		receiptRelaysByAuction.set(coordinate, relays)
	}

	// ---- committed ends (1449) and refusals (1450), grouped by coordinate ---
	// Same resolution as verdicts and receipts: a 1449's `auction_id` is a
	// coordinate, but a bare `d` is accepted when exactly one auction carries it.
	// Dedupe is by `(auction_id, end_time)` at the earliest anchored height.
	const lotStatesByAuction = new Map<string, ParsedArenaLotState[]>()
	const lotStateRelaysByAuction = new Map<string, Set<string>>()
	const orphanLotStates: ParsedArenaLotState[] = []
	for (const event of lotStateEvents) {
		const auctionId = event.lotState.auctionId
		const coordinate = auctionId.includes(':')
			? auctionId
			: (dToCoordinate.get(auctionId) ?? []).length === 1
				? dToCoordinate.get(auctionId)![0]
				: null
		if (coordinate === null) {
			orphanLotStates.push(event.lotState)
			continue
		}
		const list = lotStatesByAuction.get(coordinate)
		if (list === undefined) lotStatesByAuction.set(coordinate, [event.lotState])
		else list.push(event.lotState)
		const relays = lotStateRelaysByAuction.get(coordinate) ?? new Set<string>()
		for (const relay of event.relays) relays.add(relay)
		lotStateRelaysByAuction.set(coordinate, relays)
	}

	// ---- bid admissions (1449, `arena.bidadmit.v1`), grouped by coordinate ---
	// Same resolution as verdicts, receipts and committed ends: an admission's
	// `auction_id` is a coordinate, but a bare `d` is accepted when exactly one
	// auction carries it. Dedupe is by bid id at the earliest anchored height — a
	// bid is announced once.
	const admitsByAuction = new Map<string, ParsedArenaBidAdmit[]>()
	const admitRelaysByAuction = new Map<string, Set<string>>()
	const orphanAdmissions: ParsedArenaBidAdmit[] = []
	for (const event of bidAdmitEvents) {
		const auctionId = event.admit.auctionId
		const coordinate = auctionId.includes(':')
			? auctionId
			: (dToCoordinate.get(auctionId) ?? []).length === 1
				? dToCoordinate.get(auctionId)![0]
				: null
		if (coordinate === null) {
			orphanAdmissions.push(event.admit)
			continue
		}
		const list = admitsByAuction.get(coordinate)
		if (list === undefined) admitsByAuction.set(coordinate, [event.admit])
		else list.push(event.admit)
		const relays = admitRelaysByAuction.get(coordinate) ?? new Set<string>()
		for (const relay of event.relays) relays.add(relay)
		admitRelaysByAuction.set(coordinate, relays)
	}

	// A refusal (a 1450) names a **create event id**, not a coordinate, so it is
	// deduped by `(event_id, reason)` at the earliest anchored height and kept at
	// the snapshot, where a surface that has the create's event id can find it.
	const refusedCreates: ArenaRefusedCreateFact[] = dedupeArenaRefusals(refusedFactEvents.map((event) => event.refusal)).map((refusal) => ({
		refusalEventId: refusal.eventId,
		createEventId: refusal.refusedEventId,
		refusedKind: refusal.refusedKind,
		reason: refusal.reason,
		height: refusal.height,
		blockHash: refusal.blockHash,
		validatorPubkey: refusal.signerPubkey,
	}))
	const refusedCreateByEventId = new Map<string, ArenaRefusedCreateFact>()
	for (const fact of refusedCreates) {
		const prior = refusedCreateByEventId.get(fact.createEventId)
		if (prior === undefined || fact.height < prior.height) refusedCreateByEventId.set(fact.createEventId, fact)
	}

	// ---- assemble views --------------------------------------------------
	const auctions: ArenaAuctionView[] = []
	for (const [key, entry] of resolved) {
		const auctionBids = [...(bidsByKey.get(key) ?? [])].sort((a, b) => a.createdAt - b.createdAt || a.eventId.localeCompare(b.eventId))

		const verdicts = [...(verdictsByAuction.get(entry.coordinate) ?? [])].sort(
			(a, b) => b.height - a.height || (a.validatorPubkey ?? '').localeCompare(b.validatorPubkey ?? ''),
		)

		// Dedupe the receipts by `(bidId, outcome)` at the earliest anchored
		// height — the same move re-published later is one move.
		const receipts = dedupeArenaReceipts(receiptsByAuction.get(entry.coordinate) ?? [])
		const refundForBid: Record<string, ParsedArenaReceipt> = {}
		const settleForBid: Record<string, ParsedArenaReceipt> = {}
		let settleReceipt: ParsedArenaReceipt | null = null
		for (const receipt of receipts) {
			if (receipt.outcome === 'refund') {
				if (refundForBid[receipt.bidId] === undefined) refundForBid[receipt.bidId] = receipt
			} else if (settleForBid[receipt.bidId] === undefined) {
				settleForBid[receipt.bidId] = receipt
			}
			// `receipts` is height-ascending, so the first settle is the lot-level one.
			if (receipt.outcome === 'settle' && settleReceipt === null) settleReceipt = receipt
		}

		// ---- positions, from the bidder's LIVE legs -------------------------
		// A bid is a **delta** added to its bidder's position (R1-A), so a position
		// is the sum of that bidder's legs. Not every leg is live:
		//
		// - a leg whose bid id a kind-1443 **refund receipt** names is dead — the
		//   chain voided it and returned the escrow — and is excluded
		//   (`refundForBid`, built from `arenaReceiptsRead.ts` above). Summing it
		//   is what made this read report a 645/646 floor over a chain floor of 532.
		// - a leg with no refund receipt is live **only when the read can vouch for
		//   the receipt set it read**. A relay still pending, one whose subscription
		//   threw, or a read the caller aborted leaves a refund unread, so the
		//   absence of a receipt is not evidence of liveness. The position is then
		//   `null` — *not known* — never a partial sum, and the lot's top position
		//   is not known either (which the surfaces already have vocabulary for:
		//   `topBid === null` → `ArenaBidFloor.kind === 'unknown'` → `read-incomplete`).
		//
		// Invariant this relies on: the chain publishes a **1443 refund naming the
		// bid id** for every leg it voids (read here through `arenaReceiptsRead.ts`),
		// and its coming **admission publication** names every bid it admits and the
		// bidder's resulting position. Until that publication is on the wire the
		// receipt is the only evidence of a dead leg, and a complete read is the
		// only warrant that no refund was missed. Chain side:
		// `~/work/wt-validator` `docs/PLAN-2026-11-19-additive-rebid-chain.md` §6-1.
		const receiptsComplete = health.pending.length === 0 && health.failed.length === 0 && !health.aborted
		const positions: Record<string, number | null> = {}
		let bidsWithoutAmount = 0
		for (const bid of auctionBids) {
			if (bid.amount === null) {
				bidsWithoutAmount += 1
				continue
			}
			if (refundForBid[bid.eventId] !== undefined) continue
			if (!receiptsComplete) {
				positions[bid.bidder] = null
				continue
			}
			positions[bid.bidder] = (positions[bid.bidder] ?? 0) + bid.amount
		}
		// The top position is only nameable when **every** position is known: a
		// rival whose position is unknown could be above the best known one, so
		// naming a top would be a claim the read cannot support.
		let topBid: { bidder: string; total: number } | null = null
		let positionsUnknown = false
		for (const [bidder, total] of Object.entries(positions)) {
			if (total === null) {
				positionsUnknown = true
				continue
			}
			if (topBid === null || total > topBid.total || (total === topBid.total && bidder < topBid.bidder)) {
				topBid = { bidder, total }
			}
		}
		if (positionsUnknown) topBid = null

		const relays = new Set<string>()
		for (const relay of entry.canonical.relays) relays.add(relay)
		for (const bid of auctionBids) for (const relay of bid.relays) relays.add(relay)
		for (const relay of receiptRelaysByAuction.get(entry.coordinate) ?? []) relays.add(relay)
		for (const relay of lotStateRelaysByAuction.get(entry.coordinate) ?? []) relays.add(relay)
		for (const relay of admitRelaysByAuction.get(entry.coordinate) ?? []) relays.add(relay)

		// The committed ends, deduped by `(auction_id, end_time)` at the earliest
		// anchored height, ordered by height ascending; the highest-anchored one
		// is the chain's latest word on where the end is.
		const committedEnds = dedupeArenaLotStates(lotStatesByAuction.get(entry.coordinate) ?? [])
		const committedEnd = committedEnds.length === 0 ? null : committedEnds[committedEnds.length - 1]
		// The chain's refusal of this create, keyed on the root create's event id
		// (a 1450 names the create, never a version).
		const createRefusal = refusedCreateByEventId.get(entry.root.id) ?? null
		// **Bid** refusals: the chain records a bid it refused *at delivery* (the
		// late family, the block-time locktime floor, a duplicate bid) as a 1450
		// naming the kind-1441. A bid refused at admission (no proof of funds, a
		// bad escrow signature) is discarded in `CheckTx` and never recorded —
		// that absence is not a refusal, and this list never claims one.
		// Owner ruling: `notes/DECISION-2026-11-18-refused-bids-are-not-committed.md`.
		const bidRefusals: ArenaRefusedCreateFact[] = []
		for (const bid of auctionBids) {
			const refusal = refusedCreateByEventId.get(bid.eventId)
			if (refusal === undefined || refusal.refusedKind !== ARENA_AUCTION_BID_KIND) continue
			bidRefusals.push(refusal)
		}

		// **Bid admissions**: the chain's record that it took a bid (kind 1449,
		// `arena.bidadmit.v1`), deduped by bid id at the earliest anchored height.
		// The chain publishes nothing about a leg it never admitted or one it
		// immediately outbid (`~/work/wt-validator`
		// `docs/ADDITIVE-REBID-2026-11-19-RESULT.md` §2), so an absence here is *no
		// admission read* — never a refusal, and never "the chain rejected it".
		const admissions = dedupeArenaBidAdmits(admitsByAuction.get(entry.coordinate) ?? [])
		const admissionForBid: Record<string, ParsedArenaBidAdmit> = {}
		for (const admit of admissions) {
			if (admissionForBid[admit.bidId] === undefined) admissionForBid[admit.bidId] = admit
		}

		auctions.push({
			coordinate: entry.coordinate,
			seller: entry.root.pubkey,
			d: entry.root.d,
			rootEventId: entry.root.id,
			canonicalEventId: entry.canonical.id,
			createdAt: entry.canonical.createdAt,
			rootCreatedAt: entry.root.createdAt,
			content: entry.canonical.content_,
			versions: entry.versions,
			bids: auctionBids,
			positions,
			topBid,
			bidsWithoutAmount,
			verdicts,
			receipts,
			refundForBid,
			settleForBid,
			settleReceipt,
			committedEnd,
			committedEnds,
			createRefusal,
			bidRefusals,
			admissions,
			admissionForBid,
			relays: [...relays].sort(),
		})
	}

	auctions.sort((a, b) => b.createdAt - a.createdAt || a.canonicalEventId.localeCompare(b.canonicalEventId))

	// ---- state commitments ----------------------------------------------
	// The identity includes `time`. Several commitments at one unchanged height
	// (the ephemeral heartbeat, and today the 1 s publisher) share
	// `(validator, height, app_hash)`; without `time` they collapse to one, the
	// *first* seen wins, and the newest chain time is lost — which would make the
	// clock as stale as the oldest tick at that height. A `null` time is its own
	// identity: "no time" is not the same tick as any concrete one.
	const commitmentByKey = new Map<string, { commitment: ParsedArenaStateCommitment; relays: Set<string> }>()
	for (const event of commitmentEvents) {
		const key = `${event.commitment.validatorPubkey ?? ''}\u0000${event.commitment.height}\u0000${event.commitment.appHash}\u0000${event.commitment.time ?? 'no-time'}`
		const prior = commitmentByKey.get(key)
		if (prior === undefined) commitmentByKey.set(key, { commitment: event.commitment, relays: new Set(event.relays) })
		else for (const relay of event.relays) prior.relays.add(relay)
	}
	const stateCommitments: ArenaStateCommitmentView[] = [...commitmentByKey.values()]
		.map((entry) => ({ ...entry.commitment, relays: [...entry.relays].sort() }))
		// height desc, then time desc (the newest chain time at a height wins),
		// then the validator key as the final, stable tie-break. A commitment with
		// no `time` sorts last at its height: an unknown time never claims the
		// front over a stated one.
		.sort((a, b) => {
			if (a.height !== b.height) return b.height - a.height
			if (a.time !== b.time) {
				if (a.time === null) return 1
				if (b.time === null) return -1
				return b.time - a.time
			}
			return (a.validatorPubkey ?? '').localeCompare(b.validatorPubkey ?? '')
		})
	const highestCommitment = stateCommitments[0] ?? null

	// ---- divergence (the equivocation signal the REPLY note asks for) ----
	const commitmentForks: ArenaCommitmentFork[] = []
	const commitmentByHeight = new Map<number, ArenaCommitmentFork>()
	for (const entry of commitmentByKey.values()) {
		const { height, appHash, validatorPubkey } = entry.commitment
		const fork = commitmentByHeight.get(height) ?? { height, byRelay: {} }
		for (const relay of entry.relays) {
			const list = fork.byRelay[relay] ?? []
			if (!list.includes(appHash)) list.push(appHash)
			fork.byRelay[relay] = list.sort()
		}
		if (validatorPubkey === null) continue
		commitmentByHeight.set(height, fork)
	}
	for (const fork of commitmentByHeight.values()) {
		const shapes = new Set(Object.values(fork.byRelay).map((hashes) => hashes.join('|')))
		if (Object.keys(fork.byRelay).length > 1 && shapes.size > 1) {
			commitmentForks.push({ height: fork.height, byRelay: fork.byRelay })
		}
	}
	commitmentForks.sort((a, b) => b.height - a.height)

	const verdictDivergence: ArenaVerdictDivergence[] = []
	const verdictsByAuctionId = new Map<string, Record<string, string[]>>()
	for (const event of verdictEvents) {
		const auctionId = event.verdict.auctionId
		const byRelay = verdictsByAuctionId.get(auctionId) ?? {}
		for (const relay of event.relays) {
			const list = byRelay[relay] ?? []
			if (!list.includes(event.verdict.outcome)) list.push(event.verdict.outcome)
			byRelay[relay] = list.sort()
		}
		verdictsByAuctionId.set(auctionId, byRelay)
	}
	for (const [auctionId, byRelay] of verdictsByAuctionId) {
		const relayCount = Object.keys(byRelay).length
		const shapes = new Set(Object.values(byRelay).map((outcomes) => outcomes.join('|')))
		if (relayCount > 1 && shapes.size > 1) verdictDivergence.push({ auctionId, byRelay })
	}
	verdictDivergence.sort((a, b) => a.auctionId.localeCompare(b.auctionId))

	const boundedRefusals = refusalList.slice(0, MAX_REFUSALS)

	return {
		auctions,
		orphanVerdicts,
		orphanReceipts,
		orphanLotStates,
		orphanAdmissions,
		refusedCreates,
		stateCommitments,
		highestCommitment,
		commitmentForks,
		verdictDivergence,
		rejectedCreates,
		refusals: boundedRefusals,
		health,
	}
}

// =========================================================================
// The multi-relay read
// =========================================================================

/** How many refusals a snapshot carries before the list is truncated. */
export const MAX_REFUSALS = 200

export interface ArenaRelayOpenOptions {
	/** Aborts this relay's subscription. */
	signal?: AbortSignal
	/** A bounded read: the source should end at its caught-up marker rather than stay open. */
	bounded?: boolean
}

/**
 * Opens one relay's stream. The production shape is
 * `(filters, opts) => createWebRelayReadContext(store, [url]).stream(filters, opts)`,
 * so the transport stays the SDK's (`AGENTS.md:85-87`) and this module stays
 * pure enough to test with a fake that never touches a socket.
 */
export type ArenaRelayOpen = (
	filters: readonly EventFilter[],
	options: ArenaRelayOpenOptions,
) => AsyncIterable<EventStreamItem<NostrEventLike>>

export type ArenaRelayOpenFactory = (relayUrl: string) => ArenaRelayOpen

export interface ArenaAuctionReadInit {
	/** Every relay to read from. One subscription each; empty is legal and answers "nothing". */
	relays: readonly string[]
	openRelay: ArenaRelayOpenFactory
	/**
	 * The read's deadline, in ms — and, besides a caller abort, the only thing
	 * that ends a live read. Every relay connection stays open until then; a relay
	 * that has not answered by then is dropped and reported `'timeout'`, and the
	 * read returns everything that arrived. The production transport is given the
	 * same full bound, so there is no second, per-relay deadline. Defaults to
	 * 8000.
	 */
	deadlineMs?: number
	/**
	 * The subscription filters. Defaults to {@link arenaAuctionFilters} (the whole
	 * arena); a lot detail passes {@link arenaLotFilters} so the read resolves one
	 * lot instead of the firehose.
	 */
	filters?: readonly EventFilter[]
	/**
	 * Filters that only become knowable **after** an event has been read — a
	 * lot's create event id, which its bids' indexed `#e` tag needs. Called with
	 * every event the read has decoded so far; the first non-empty set is
	 * subscribed once per relay as a second REQ, and the read's caught-up waits
	 * for it. Absent → one subscription per relay, exactly as before.
	 */
	followUpFilters?: (events: readonly ArenaAuctionEvent[]) => readonly EventFilter[]
}

export type ArenaReadStreamItem =
	| { type: 'events'; events: ArenaAuctionEvent[] }
	| { type: 'refused'; refusals: ArenaRefusedEvent[] }
	| { type: 'caught-up'; health: ArenaReadHealth }

export interface ArenaAuctionRead {
	/**
	 * Live read: opens synchronously, delivers decoded events in batches as
	 * relays produce them (optimistic lazy-loading), and ends at its deadline — or
	 * a caller abort — with one final `caught-up` carrying the health. Every relay
	 * connection stays open until then, so a relay that has signalled EOSE is
	 * still read and a late event is still applied to the model. A relay the
	 * transport gave up on but which then answers is counted as answered.
	 */
	events(options?: { signal?: AbortSignal }): AsyncIterable<ArenaReadStreamItem>
	/**
	 * Bounded read: collect to `caught-up` (or the deadline, or an abort) and
	 * project. Resolves with partial data rather than rejecting when relays
	 * fail — see `health`.
	 */
	snapshot(options?: { signal?: AbortSignal }): Promise<ArenaAuctionSnapshot>
	/** Abort every open subscription. */
	close(): void
}

const DEFAULT_DEADLINE_MS = 8000

interface QueueEvent {
	kind: 'event'
	relay: string
	event: ArenaAuctionEvent
}
interface QueueRefusal {
	kind: 'refusal'
	relay: string
	refusal: ArenaRefusedEvent
}
interface QueueSettled {
	kind: 'settled'
	relay: string
}
interface QueueWake {
	kind: 'wake'
}
type QueueItem = QueueEvent | QueueRefusal | QueueSettled | QueueWake

/** The per-relay mutable health the pumps write into. */
interface MutableHealth {
	url: string
	status: ArenaRelayStatus
	events: number
	refusals: number
	eose: boolean
	error: string | null
	/** The read boundary was reached for this relay (once per relay, for health). */
	settled: boolean
	/** The transport gave up on this relay (its never-EOSE fallback), which is not an answer. */
	givenUp: boolean
}

export function createArenaAuctionRead(init: ArenaAuctionReadInit): ArenaAuctionRead {
	const relays = [...init.relays]
	const deadlineMs = init.deadlineMs ?? DEFAULT_DEADLINE_MS
	const controllers = new Set<AbortController>()

	function run(options: { signal?: AbortSignal; bounded?: boolean }): AsyncIterable<ArenaReadStreamItem> {
		const bounded = options.bounded === true

		return {
			async *[Symbol.asyncIterator]() {
				const controller = new AbortController()
				controllers.add(controller)
				const onCallerAbort = () => {
					controller.abort()
					push({ kind: 'wake' })
				}
				if (options.signal?.aborted) controller.abort()
				else options.signal?.addEventListener('abort', onCallerAbort)

				const queue: QueueItem[] = []
				let wake: (() => void) | null = null
				let allDone = relays.length === 0
				let caughtUpEmitted = false
				let aborted = controller.signal.aborted
				// The one thing that ends a live read: its deadline (or a caller abort).
				// A settled subscription is *not* an end — see the settle marker below.
				let deadlineFired = false

				function push(item: QueueItem): void {
					queue.push(item)
					wake?.()
					wake = null
				}

				function wait(): Promise<void> {
					return new Promise<void>((resolve) => {
						wake = resolve
					})
				}

				const mutable = new Map<string, MutableHealth>()
				for (const url of relays) {
					mutable.set(url, { url, status: 'ok', events: 0, refusals: 0, eose: false, error: null, settled: false, givenUp: false })
				}
				let doneCount = 0
				// Subscriptions, not relays: a follow-up filter opens a second REQ on
				// the same relay, and the caught-up marker must wait for every REQ that
				// was opened — otherwise a bounded read closes before the follow-up's
				// bids arrive. Without `followUpFilters` the two counts are identical.
				let openSubscriptions = 0
				let settledSubscriptions = 0
				const subscriptions = new Set<{ url: string; settled: boolean }>()
				/** Filter sets already subscribed: the base set, plus every follow-up. */
				const openedFilters = new Set<string>()
				const seenEvents: ArenaAuctionEvent[] = []
				const seenIds = new Set<string>()

				function healthSnapshot(): ArenaReadHealth {
					aborted = controller.signal.aborted
					return summarizeHealth([...mutable.values()], aborted)
				}

				/**
				 * One settle per relay: the read boundary is reached once for health, so a
				 * relay's own teardown cannot upgrade a `timeout` it never earned. The
				 * caught-up marker counts *subscriptions* instead (see below).
				 */
				function settle(url: string, status: ArenaRelayStatus, error: string | null = null): void {
					const entry = mutable.get(url)
					if (entry === undefined || entry.settled) return
					entry.settled = true
					entry.status = status
					entry.error = error
					push({ kind: 'settled', relay: url })
				}

				/**
				 * A relay that **answered**: settle it `'ok'`, or upgrade a relay already
				 * given up on (`'timeout'`, `'refused'`, `'unreachable'`) when it answers
				 * late — the answer is a fact, the give-up was a guess. Only an event or
				 * an EOSE reaches here; a stream merely ending does not, so a relay
				 * dropped at the deadline cannot be upgraded by its own teardown.
				 */
				function answer(url: string): void {
					const entry = mutable.get(url)
					if (entry === undefined) return
					if (!entry.settled) {
						settle(url, 'ok')
						return
					}
					if (entry.status === 'ok') return
					entry.status = 'ok'
					entry.error = null
					push({ kind: 'settled', relay: url })
				}

				/**
				 * A relay the **transport classified**: it refused the subscription, or it
				 * could not be reached. That is a fact about the relay, so it settles an
				 * unsettled one and it upgrades the estimate the deadline already recorded
				 * (`'timeout'`/`'closed'`) — the give-up was a guess, the classification is a
				 * fact. `answer()` is this same rule for "yes".
				 */
				function classify(url: string, status: 'refused' | 'unreachable', error: string | null = null): void {
					const entry = mutable.get(url)
					if (entry === undefined) return
					if (entry.settled && entry.status !== 'timeout' && entry.status !== 'closed') return
					entry.settled = true
					entry.status = status
					entry.error = error
					push({ kind: 'settled', relay: url })
				}

				/** Mark one subscription's boundary reached; the caught-up gate counts these. */
				function markSubscriptionSettled(subscription: { url: string; settled: boolean }): void {
					if (subscription.settled) return
					subscription.settled = true
					settledSubscriptions += 1
				}

				/**
				 * A relay's accounting when the read **stops waiting** on it: `'ok'` when it
				 * delivered anything on any REQ, `'timeout'` when it has said nothing at all.
				 */
				function stopWaiting(entry: MutableHealth): void {
					if (entry.settled) return
					settle(entry.url, entry.eose || entry.events > 0 ? 'ok' : 'timeout')
				}

				/**
				 * A second REQ for a filter set that only became knowable after an
				 * event was read (`init.followUpFilters`). One subscription per distinct
				 * set per relay; the base set is already open and never repeated. Called
				 * before the event is pushed, so the caught-up gate counts the new REQ
				 * before the main loop may drain the batch.
				 */
				function openFollowUps(event: ArenaAuctionEvent): void {
					const followUp = init.followUpFilters
					if (followUp === undefined) return
					if (seenIds.has(event.id)) return
					seenIds.add(event.id)
					seenEvents.push(event)
					const filters = followUp(seenEvents)
					if (filters.length === 0) return
					const key = JSON.stringify(filters)
					if (openedFilters.has(key)) return
					openedFilters.add(key)
					for (const url of relays) {
						// A relay that refused the base subscription (or that could not be
						// reached) cannot serve a follow-up REQ either: opening one asks a
						// closed door, and the refusal is already a settled fact.
						const entry = mutable.get(url)
						if (entry !== undefined && (entry.status === 'refused' || entry.status === 'unreachable' || entry.status === 'error')) continue
						pump(url, filters)
					}
					// A follow-up opened after the base pumps ended: the read is not done.
					allDone = false
				}

				function pump(url: string, filters: readonly EventFilter[]): void {
					const entry = mutable.get(url)
					const subscription = { url, settled: false }
					subscriptions.add(subscription)
					openSubscriptions += 1
					void (async () => {
						try {
							const source = init.openRelay(url)
							for await (const item of source(filters, {
								signal: controller.signal,
								bounded,
							})) {
								// The deadline ends the read: a relay that keeps
								// delivering must not keep the drain alive past it. (A
								// pump blocked on a quiet relay is ended by the loop's
								// own `deadlineFired` check instead.)
								if (controller.signal.aborted || deadlineFired) break
								if (item.type === 'caught-up') {
									// "Settled" is what this marker means: for a one-relay
									// context it fires when that relay reached EOSE *or* when the
									// transport's own never-EOSE timer gave up. EOSE is reported
									// literally; `answered` is what a caller should trust, because
									// a relay that delivered events plainly answered even if its
									// transport never surfaces EOSE (measured on ws://, 2026-11-13).
									const eoseReported = item.info.eose.length > 0
									if (entry !== undefined) entry.eose = eoseReported
									// A bounded read that returns without throwing counts as answered:
									// the transport's bounded path swallows a connection failure into
									// an empty answer (measured on a dead port, 2026-11-13), so a
									// bounded read cannot tell "empty" from "unreachable". A live read can.
									if (bounded) {
										settle(url, 'ok')
										markSubscriptionSettled(subscription)
										return
									}
									// Live read: a relay that has actually spoken is settled here.
									// A relay that refused the subscription, or that could not be
									// reached, has also answered — with "no" — and is a settled fact
									// about it, so it must not hold the read open
									// (`sdk/core/event-store/read.ts`, `CaughtUpInfo.refused` /
									// `.unreachable`). A relay the transport merely gave up on but
									// which is still connected and silent is *not* settled: it could
									// still answer. Measured 2026-11-19 on the live page: the app
									// relay's first kind-1440 EVENT arrived at 8759 ms, after the
									// transport's 8 s fallback; recording that relay `timeout` closed
									// the read and the notice said no relay answered for a lot that
									// exists.
									if (eoseReported || (entry?.events ?? 0) > 0) {
										answer(url)
										// The relay answered this REQ; its boundary is reached even
										// though the live stream keeps delivering.
										markSubscriptionSettled(subscription)
									} else {
										const refusal = item.info.refused?.find((fact) => fact.relay === url)
										if (refusal !== undefined) {
											classify(url, 'refused', refusal.reason)
											markSubscriptionSettled(subscription)
										} else if (item.info.unreachable?.includes(url) === true) {
											classify(url, 'unreachable')
											markSubscriptionSettled(subscription)
										} else if (entry !== undefined) entry.givenUp = true
									}
									continue
								}
								const decoded = decodeArenaEvent(item.event, url)
								if (entry !== undefined) {
									if (decoded.ok) entry.events += 1
									else entry.refusals += 1
								}
								if (decoded.ok) {
									openFollowUps(decoded.event)
									push({ kind: 'event', relay: url, event: decoded.event })
									// A relay the transport had given up on that then delivers has
									// answered: the late event is the answer.
									if (entry?.givenUp === true) answer(url)
								} else push({ kind: 'refusal', relay: url, refusal: decoded.refusal })
							}
							if (bounded && entry !== undefined) entry.eose = true
							const answeredOnEnd = bounded || entry?.eose === true || (entry?.events ?? 0) > 0
							// The stream ended without an EOSE and without an event. That is
							// **not** an answer: a transport that failed to connect records
							// `unreachable` for the relay itself before its stream ends, so an
							// unclassified end here stays `'closed'` (silence) and the deadline
							// decides — never an upgrade to "answered".
							settle(url, answeredOnEnd ? 'ok' : 'closed')
							markSubscriptionSettled(subscription)
						} catch (error) {
							settle(url, 'error', error instanceof Error ? error.message : String(error))
							markSubscriptionSettled(subscription)
						} finally {
							markSubscriptionSettled(subscription)
							doneCount += 1
							allDone = doneCount >= openSubscriptions
							push({ kind: 'wake' })
						}
					})()
				}

				// Empty relay list: answer immediately and honestly.
				if (relays.length === 0) {
					caughtUpEmitted = true
					yield { type: 'caught-up', health: healthSnapshot() }
					controllers.delete(controller)
					options.signal?.removeEventListener('abort', onCallerAbort)
					return
				}

				// The deadline ends the read. Everything that has arrived is already on
				// the queue and will be drained by the loop below; the read then stops
				// consuming — its sockets are torn down by the `finally`. Until then the
				// relay connections stay open for the full `deadlineMs`, which is why a
				// relay that signalled EOSE and then stayed quiet is still read.
				const deadline = setTimeout(() => {
					// A relay that delivered events (or an EOSE) answered, even when its
					// transport never surfaced the EOSE — settling it `timeout` is what
					// made a read that received events report `no-relays`.
					for (const entry of mutable.values()) stopWaiting(entry)
					// A follow-up REQ that never answered must not hold the read open past
					// its deadline either; its subscription is dropped with the read.
					for (const subscription of subscriptions) markSubscriptionSettled(subscription)
					deadlineFired = true
					push({ kind: 'wake' })
				}, deadlineMs)

				const baseFilters = init.filters ?? arenaAuctionFilters()
				openedFilters.add(JSON.stringify(baseFilters))
				for (const url of relays) pump(url, baseFilters)

				try {
					while (true) {
						aborted = controller.signal.aborted
						if (controller.signal.aborted && !caughtUpEmitted) {
							for (const entry of mutable.values()) if (!entry.settled) settle(entry.url, 'closed')
							for (const subscription of subscriptions) markSubscriptionSettled(subscription)
						}
						if (queue.length === 0) {
							// `allDone` is every pump having ended on its own; for a live
							// read the pumps are held open by design, so `deadlineFired`
							// is the normal exit: no subscription ending can shorten it.
							if (allDone || deadlineFired) break
							await wait()
							continue
						}

						const batch = queue.splice(0, queue.length)
						const events: ArenaAuctionEvent[] = []
						const refusals: ArenaRefusedEvent[] = []

						for (const item of batch) {
							if (item.kind === 'event') events.push(item.event)
							else if (item.kind === 'refusal') refusals.push(item.refusal)
						}

						if (events.length > 0) yield { type: 'events', events }
						if (refusals.length > 0) yield { type: 'refused', refusals }

						// The **bounded** read is the one that ends on a marker: a paginated
						// snapshot has no live budget to spend, and every subscription that
						// was opened — the base one per relay and any follow-up — reaching
						// its boundary is its completeness signal. The live read does not
						// end here: a relay that has signalled EOSE may still deliver, so its
						// connection stays open and the read ends at its deadline (or a
						// caller abort). No subscription ending shortens a live read.
						if (bounded && settledSubscriptions >= openSubscriptions) break
					}

					if (!caughtUpEmitted) {
						caughtUpEmitted = true
						yield { type: 'caught-up', health: healthSnapshot() }
					}
				} finally {
					clearTimeout(deadline)
					controller.abort()
					controllers.delete(controller)
					options.signal?.removeEventListener('abort', onCallerAbort)
					allDone = true
				}
			},
		}
	}

	return {
		events(options) {
			return run({ signal: options?.signal, bounded: false })
		},

		async snapshot(options) {
			const byId = new Map<string, ArenaAuctionEvent>()
			const refusals: ArenaRefusedEvent[] = []
			let health = emptyHealth(relays)
			for await (const item of run({ signal: options?.signal, bounded: true })) {
				if (item.type === 'events') {
					for (const event of item.events) {
						const prior = byId.get(event.id)
						if (prior === undefined) byId.set(event.id, event)
						else for (const relay of event.relays) if (!prior.relays.includes(relay)) prior.relays.push(relay)
					}
				} else if (item.type === 'refused') {
					refusals.push(...item.refusals)
				} else {
					health = item.health
					break
				}
			}
			return projectArenaEvents([...byId.values()], health, refusals)
		},

		close() {
			for (const controller of controllers) controller.abort()
			controllers.clear()
		},
	}
}

// =========================================================================
// The web host's wiring — the only part that touches a transport
// =========================================================================

export interface WebArenaAuctionReadInit {
	/** Every relay to read from; typically `webRelayPolicy('query')`. */
	relays: readonly string[]
	/** The shared event store. Admission stays the store's job (`sdk/AGENTS.md:42-45`). */
	store: EventStorePort<Event>
	deadlineMs?: number
	/** The subscription filters. Defaults to the whole arena ({@link arenaAuctionFilters}). */
	filters?: readonly EventFilter[]
	/** Filters that only become knowable after an event is read ({@link arenaLotFollowUpFilters}). */
	followUpFilters?: (events: readonly ArenaAuctionEvent[]) => readonly EventFilter[]
}

// There is deliberately **no** per-relay transport margin. The transport's
// never-EOSE fallback is given the read's own full `deadlineMs`, so a relay's
// connection is held open for exactly as long as the read is. A shorter,
// per-relay bound was a second deadline: it let one relay's settle end a read
// whose other relays could still deliver.

/**
 * The production read: one `EventReadContext` **per relay** over the SDK seam
 * (`platform/web/sdkNostrIo.ts` → `sdk/core/nostr-io`), which is what makes the
 * per-relay diff possible. This is the only import of a transport in this
 * module, and it is deliberately at the edge rather than inside the reducer.
 */
export function createWebArenaAuctionRead(init: WebArenaAuctionReadInit): ArenaAuctionRead {
	const deadlineMs = init.deadlineMs ?? DEFAULT_DEADLINE_MS
	return createArenaAuctionRead({
		relays: init.relays,
		deadlineMs,
		filters: init.filters,
		followUpFilters: init.followUpFilters,
		openRelay: (url) => {
			const context = createWebRelayReadContext(init.store, [url], {
				// One bound for the whole read: the transport's never-EOSE fallback
				// lands on the read's own deadline, so a relay that has said nothing
				// is read for exactly as long as the read lives.
				deadlineMs,
			})
			return (filters, options) => context.stream(filters, options)
		},
	})
}
