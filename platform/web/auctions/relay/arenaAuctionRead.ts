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
 * | every relay unreachable/errors  | each pump fails independently, nothing throws out of the read        | empty snapshot, `health.relays[*].status === 'error'` |
 * | one relay down, others healthy  | the dead pump ends, the others keep delivering; no stall             | full data; `health.relays[dead].status === 'error'`, `health.pending` names it |
 * | one relay slow / never EOSE     | it is dropped at `deadlineMs`, the others already delivered          | partial data at the deadline; that relay is `'timeout'`, in `health.pending` |
 * | one relay lying                 | its events go through the same gate as everyone's: wrong kind, bad JSON, missing anchor, a 1440 update that changes an immutable field | dropped and counted in `health.relays[relay].refusals` + `snapshot.refusals`; never in `auctions` |
 *
 * `health.answered` is the field that answers "did this relay answer?". Two
 * measured caveats, both pinned by tests rather than papered over:
 *
 * - the web transport does not always surface EOSE, so `health.eose` may be
 *   empty on a healthy read; a relay that delivered events is `answered`
 *   regardless;
 * - on a **bounded** read (`snapshot`) the transport's `fetchEvents` turns a
 *   connection failure into an empty array, so a silent relay is
 *   indistinguishable from an empty one. `events()` is the live read and keeps
 *   the distinction; reach for it when it matters.
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

import type { EventFilter, EventStorePort, EventStreamItem, NostrEventLike } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { createWebRelayReadContext } from '@platform/web/sdkNostrIo'
import {
	ARENA_AUCTION_BID_KIND,
	ARENA_AUCTION_CREATE_KIND,
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

// =========================================================================
// The immutable allow-list for a 1440 (decision §3, §4.3)
//
// "display is mutable; money, time and cryptography are not." All eleven
// fields below are frozen at first publish; `title` / `description` /
// `image_url` are deliberately absent, because those are the three that may be
// edited, including after the first bid.
// =========================================================================

export const ARENA_CREATE_IMMUTABLE_FIELDS = [
	'auction_id',
	'starting_bid',
	'min_increment',
	'reserve',
	'duration_seconds',
	'late_bid_window_seconds',
	'late_bid_extension_seconds',
	'max_total_extension_seconds',
	'locktime_seconds',
	'funding_mode',
	'seller_coco_payment_public_key',
] as const

export type ArenaCreateImmutableField = (typeof ARENA_CREATE_IMMUTABLE_FIELDS)[number]

/**
 * Which of the frozen fields are numbers on the wire. Compared numerically, so
 * `1000` and `"1000"` are the same value (a producer's type wobble is not a
 * field change); everything else is compared as a trimmed string, and
 * absent/empty collapses to `null`.
 */
const NUMERIC_IMMUTABLE_FIELDS: ReadonlySet<string> = new Set([
	'starting_bid',
	'min_increment',
	'reserve',
	'duration_seconds',
	'late_bid_window_seconds',
	'late_bid_extension_seconds',
	'max_total_extension_seconds',
	'locktime_seconds',
])

// =========================================================================
// Raw event → decoded event
// =========================================================================

/** The four kinds this read subscribes to, in the one place it writes them. */
export const ARENA_READ_KINDS = [
	ARENA_AUCTION_CREATE_KIND,
	ARENA_AUCTION_BID_KIND,
	ARENA_VERDICT_KIND,
	ARENA_STATE_COMMITMENT_KIND,
] as readonly number[]

/** The subscription filter: one filter, four kinds. Nothing else is ever requested. */
export function arenaAuctionFilters(): EventFilter[] {
	return [{ kinds: [...ARENA_READ_KINDS] }]
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

/** The create content (`KindCreate`, `platform/web/auctions/protocol/client.ts:198-229`), as read. */
export interface ArenaCreateContent {
	auctionId: string
	title: string | null
	description: string | null
	imageUrl: string | null
	startingBid: number | null
	minIncrement: number | null
	reserve: number | null
	durationSeconds: number | null
	lateBidWindowSeconds: number | null
	lateBidExtensionSeconds: number | null
	maxTotalExtensionSeconds: number | null
	locktimeSeconds: number | null
	fundingMode: string | null
	sellerCocoPaymentPublicKey: string | null
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

export type ArenaAuctionEvent =
	| ArenaCreateEvent
	| ArenaBidEvent
	| ArenaVerdictEvent
	| ArenaStateCommitmentEvent

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
		auctionId: asTrimmedString(content.auction_id) ?? '',
		title: asTrimmedString(content.title),
		description: asTrimmedString(content.description),
		imageUrl: asTrimmedString(content.image_url),
		startingBid: asFiniteNumber(content.starting_bid),
		minIncrement: asFiniteNumber(content.min_increment),
		reserve: asFiniteNumber(content.reserve),
		durationSeconds: asFiniteNumber(content.duration_seconds),
		lateBidWindowSeconds: asFiniteNumber(content.late_bid_window_seconds),
		lateBidExtensionSeconds: asFiniteNumber(content.late_bid_extension_seconds),
		maxTotalExtensionSeconds: asFiniteNumber(content.max_total_extension_seconds),
		locktimeSeconds: asFiniteNumber(content.locktime_seconds),
		fundingMode: asTrimmedString(content.funding_mode),
		sellerCocoPaymentPublicKey: asTrimmedString(content.seller_coco_payment_public_key),
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

function refuse(
	relay: string,
	event: NostrEventLike | null,
	reason: string,
	detail: string,
): { ok: false; refusal: ArenaRefusedEvent } {
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

		const auctionId = asTrimmedString(content.auction_id)
		if (auctionId === null) return refuse(relay, event, ARENA_REFUSAL_BAD_CONTENT, 'create content has no auction_id')

		const tagD = tagValue(event.tags, 'd')
		// `d` and `content.auction_id` are the same fact written twice; if they
		// disagree the event addresses two auctions and neither reading is safe.
		if (tagD !== null && tagD !== auctionId) {
			return refuse(
				relay,
				event,
				ARENA_REFUSAL_BAD_IDENTITY,
				`d tag ${JSON.stringify(tagD)} != content.auction_id ${JSON.stringify(auctionId)}`,
			)
		}

		return {
			ok: true,
			event: {
				...baseOf(event, relay),
				type: 'create',
				d: tagD ?? auctionId,
				auctionId,
				supersedes: tagValue(event.tags, 'e'),
				content_: createContentOf(content),
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

	// 1445 / 1447: stage 1 owns the shape and the mandatory anchor. A thrown
	// refusal here is the event's verdict, and it is the answer a client MUST
	// ignore an unanchored event with (`arenaAnchor.ts:8-13`).
	try {
		if (event.kind === ARENA_VERDICT_KIND) {
			const verdict = parseArenaVerdict({ kind: event.kind, tags: event.tags, content: event.content })
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

export type ArenaRelayStatus = 'ok' | 'timeout' | 'error' | 'closed'

export interface ArenaRelayHealth {
	url: string
	/** `ok`: answered. `timeout`: hit the deadline. `error`: the pump threw. `closed`: ended without EOSE. */
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
	/** Relays that neither answered nor produced data — the ones that stalled. */
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
	content: ArenaCreateContent
	/** How many 1440 versions exist, accepted or not — a display aid, not a count of anything authoritative. */
	versions: number
	bids: ArenaBidView[]
	/**
	 * Per-bidder position, summed from the bid **deltas**. A *derived view*, not
	 * an outcome: the authority on who won is the 1445 verdict, and the
	 * authority on whether money moved is the mint (`REPLY` §4.2).
	 */
	positions: Record<string, number>
	topBid: { bidder: string; total: number } | null
	/** Bids whose `amount` was not a finite number; the positions above are then incomplete. */
	bidsWithoutAmount: number
	verdicts: ParsedArenaVerdict[]
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

export interface ArenaAuctionSnapshot {
	/** Canonical auctions, `created_at` descending (tie: lowest event id first). */
	auctions: ArenaAuctionView[]
	/** Verdicts whose `auction` id matches no create this read saw. */
	orphanVerdicts: ParsedArenaVerdict[]
	/** State commitments, height descending then validator pubkey. */
	stateCommitments: ParsedArenaStateCommitment[]
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
	const answered = relays.filter((r) => r.status === 'ok').map((r) => r.url)
	const pending = relays.filter((r) => r.status !== 'ok').map((r) => r.url)
	return {
		relays,
		eose,
		answered,
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

	// ---- resolve 1440 versions ------------------------------------------
	const groups = new Map<string, ArenaCreateEvent[]>()
	for (const create of creates) {
		const key = auctionGroupKey(create.pubkey, create.d)
		const list = groups.get(key)
		if (list === undefined) groups.set(key, [create])
		else list.push(create)
	}

	const rejectedCreates: ArenaRejectedCreate[] = []
	const resolved = new Map<
		string,
		{ root: ArenaCreateEvent; canonical: ArenaCreateEvent; versions: number; coordinate: string }
	>()

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

	// ---- assemble views --------------------------------------------------
	const auctions: ArenaAuctionView[] = []
	for (const [key, entry] of resolved) {
		const auctionBids = [...(bidsByKey.get(key) ?? [])].sort(
			(a, b) => a.createdAt - b.createdAt || a.eventId.localeCompare(b.eventId),
		)
		const positions: Record<string, number> = {}
		let bidsWithoutAmount = 0
		for (const bid of auctionBids) {
			if (bid.amount === null) {
				bidsWithoutAmount += 1
				continue
			}
			positions[bid.bidder] = (positions[bid.bidder] ?? 0) + bid.amount
		}
		let topBid: { bidder: string; total: number } | null = null
		for (const [bidder, total] of Object.entries(positions)) {
			if (topBid === null || total > topBid.total || (total === topBid.total && bidder < topBid.bidder)) {
				topBid = { bidder, total }
			}
		}

		const verdicts = [...(verdictsByAuction.get(entry.coordinate) ?? [])].sort(
			(a, b) => b.height - a.height || (a.validatorPubkey ?? '').localeCompare(b.validatorPubkey ?? ''),
		)

		const relays = new Set<string>()
		for (const relay of entry.canonical.relays) relays.add(relay)
		for (const bid of auctionBids) for (const relay of bid.relays) relays.add(relay)

		auctions.push({
			coordinate: entry.coordinate,
			seller: entry.root.pubkey,
			d: entry.root.d,
			rootEventId: entry.root.id,
			canonicalEventId: entry.canonical.id,
			createdAt: entry.canonical.createdAt,
			content: entry.canonical.content_,
			versions: entry.versions,
			bids: auctionBids,
			positions,
			topBid,
			bidsWithoutAmount,
			verdicts,
			relays: [...relays].sort(),
		})
	}

	auctions.sort(
		(a, b) => b.createdAt - a.createdAt || a.canonicalEventId.localeCompare(b.canonicalEventId),
	)

	// ---- state commitments ----------------------------------------------
	const commitmentByKey = new Map<string, { commitment: ParsedArenaStateCommitment; relays: Set<string> }>()
	for (const event of commitmentEvents) {
		const key = `${event.commitment.validatorPubkey ?? ''}\u0000${event.commitment.height}\u0000${event.commitment.appHash}`
		const prior = commitmentByKey.get(key)
		if (prior === undefined) commitmentByKey.set(key, { commitment: event.commitment, relays: new Set(event.relays) })
		else for (const relay of event.relays) prior.relays.add(relay)
	}
	const stateCommitments = [...commitmentByKey.values()]
		.map((entry) => entry.commitment)
		.sort((a, b) => b.height - a.height || (a.validatorPubkey ?? '').localeCompare(b.validatorPubkey ?? ''))
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
	 * Per-relay settle deadline, in ms. A relay that has not answered by then is
	 * dropped and reported `'timeout'`; the read returns what it already has.
	 * Defaults to 8000, matching `createWebRelayReadContext`'s own default.
	 */
	deadlineMs?: number
}

export type ArenaReadStreamItem =
	| { type: 'events'; events: ArenaAuctionEvent[] }
	| { type: 'refused'; refusals: ArenaRefusedEvent[] }
	| { type: 'caught-up'; health: ArenaReadHealth }

export interface ArenaAuctionRead {
	/**
	 * Live read: opens synchronously, delivers decoded events in batches as
	 * relays produce them, emits one `caught-up` once every relay has answered
	 * or failed, then keeps delivering. Ends when aborted or `close()`d.
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
					mutable.set(url, { url, status: 'ok', events: 0, refusals: 0, eose: false, error: null })
				}
				let settledCount = 0
				let doneCount = 0

				function healthSnapshot(): ArenaReadHealth {
					aborted = controller.signal.aborted
					return summarizeHealth([...mutable.values()], aborted)
				}

				function settle(url: string, status: ArenaRelayStatus, error: string | null = null): void {
					const entry = mutable.get(url)
					if (entry === undefined || entry.status !== 'ok') return
					entry.status = status
					entry.error = error
					settledCount += 1
					push({ kind: 'settled', relay: url })
				}

				function pump(url: string): void {
					const entry = mutable.get(url)
					void (async () => {
						try {
							const source = init.openRelay(url)
							for await (const item of source(arenaAuctionFilters(), {
								signal: controller.signal,
								bounded,
							})) {
								if (controller.signal.aborted) break
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
									// the transport's `fetchEvents` swallows a connection failure into an
									// empty array (measured on a dead port, 2026-11-13), so a bounded
									// read cannot tell "empty" from "unreachable". A live read can.
									const answered = eoseReported || (entry?.events ?? 0) > 0 || bounded
									settle(url, answered ? 'ok' : 'timeout')
									if (bounded) return
									continue
								}
								const decoded = decodeArenaEvent(item.event, url)
								if (entry !== undefined) {
									if (decoded.ok) entry.events += 1
									else entry.refusals += 1
								}
								if (decoded.ok) push({ kind: 'event', relay: url, event: decoded.event })
								else push({ kind: 'refusal', relay: url, refusal: decoded.refusal })
							}
							if (bounded && entry !== undefined) entry.eose = true
							const answeredOnEnd = bounded || entry?.eose === true || (entry?.events ?? 0) > 0
							settle(url, answeredOnEnd ? 'ok' : 'closed')
						} catch (error) {
							settle(url, 'error', error instanceof Error ? error.message : String(error))
						} finally {
							doneCount += 1
							if (doneCount >= relays.length) allDone = true
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

				const deadline = setTimeout(() => {
					for (const entry of mutable.values()) {
						if (entry.status === 'ok' && !entry.eose) settle(entry.url, 'timeout')
					}
					push({ kind: 'wake' })
				}, deadlineMs)

				for (const url of relays) pump(url)

				try {
					while (true) {
						aborted = controller.signal.aborted
						if (controller.signal.aborted && !caughtUpEmitted) {
							for (const entry of mutable.values()) if (entry.status === 'ok') settle(entry.url, 'closed')
						}
						if (queue.length === 0) {
							if (allDone) break
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

						const settleMarker = settledCount >= relays.length
						if (settleMarker && !caughtUpEmitted) {
							caughtUpEmitted = true
							yield { type: 'caught-up', health: healthSnapshot() }
							if (bounded) break
						}
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
}

/**
 * The production read: one `EventReadContext` **per relay** over the SDK seam
 * (`platform/web/sdkNostrIo.ts` → `sdk/core/nostr-io`), which is what makes the
 * per-relay diff possible. This is the only import of a transport in this
 * module, and it is deliberately at the edge rather than inside the reducer.
 */
export function createWebArenaAuctionRead(init: WebArenaAuctionReadInit): ArenaAuctionRead {
	return createArenaAuctionRead({
		relays: init.relays,
		deadlineMs: init.deadlineMs,
		openRelay: (url) => {
			const context = createWebRelayReadContext(init.store, [url], {
				deadlineMs: init.deadlineMs ?? DEFAULT_DEADLINE_MS,
			})
			return (filters, options) => context.stream(filters, options)
		},
	})
}