/**
 * `arenaCreateAdmitFixture.ts` — a signed kind-1449 **create-admission**
 * (`arena.createadmit.v1`) event for tests, built to the chain's contract.
 *
 * The chain's own builder (`~/work/wt-validator` `chain/lotevents.go`
 * `BuildCreateAdmitEvent`) sets the `height`/`hash` tags to the content's
 * `accepted_height`/`block_hash`, and its parser refuses the event unless the
 * two copies are **equal** (`ParseCreateAdmitEvent`). This fixture does the
 * same, so every test that drives a real lot read is held to the anchor rule the
 * app now enforces — a create with no admission is a lot the app does not
 * follow (`arenaAuctionRead.ts` `isFollowedAuction`).
 *
 * The signer is a deterministic throwaway key; these events are never published.
 */
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { NostrEventLike } from '@sdk/core'
import {
	ARENA_AUCTION_CREATE_KIND,
	ARENA_CREATE_ADMIT_SCHEMA,
	ARENA_LOT_STATE_KIND,
	ARENA_REFUSED_KIND,
	ARENA_REFUSED_SCHEMA,
} from '@sdk/commerce/auctions/constants'

/** A deterministic test signer — the validator identity of every fixture admission. */
export const TEST_CREATE_ADMIT_SK = new Uint8Array(32).fill(41)
/** The fixture signer's public key (the `p` tag and the event pubkey). */
export const TEST_CREATE_ADMIT_PUB = getPublicKey(TEST_CREATE_ADMIT_SK)
/** A 64-hex anchor hash, so the reader's hex check accepts it. */
export const TEST_CREATE_ADMIT_HASH = 'f2b3a4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081'
/** The fixture anchor height — also the content's `accepted_height`. */
export const TEST_CREATE_ADMIT_HEIGHT = 4241

export interface CreateAdmitFixtureOver {
	/** The `d` of the coordinate; defaults to the create's own `d` tag. */
	d?: string
	/** The seller of the coordinate; defaults to the create's pubkey. */
	seller?: string
	/** The create the acceptance is about; defaults to the create's own id. */
	rootEventId?: string
	/** The acceptance height; defaults to {@link TEST_CREATE_ADMIT_HEIGHT}. */
	acceptedHeight?: number
	/** The event's `created_at`; defaults to 1000. */
	createdAt?: number
	/** The lot end the content names; defaults to 4600. */
	endTime?: number
	/** The lot's closing mode; defaults to `fixed`. */
	mode?: string
}

/**
 * The chain's signed create-admission for `create`: the positive fact the app
 * follows the lot on. Its coordinate is `1440:<seller>:<d>`.
 */
export function makeCreateAdmitEvent(create: NostrEventLike, over: CreateAdmitFixtureOver = {}): NostrEventLike {
	const d = over.d ?? create.tags.find((tag) => tag[0] === 'd')?.[1] ?? 'lot-1'
	const seller = over.seller ?? create.pubkey
	const coordinate = `1440:${seller}:${d}`
	const acceptedHeight = over.acceptedHeight ?? TEST_CREATE_ADMIT_HEIGHT
	const endTime = over.endTime ?? 4600
	return finalizeEvent(
		{
			kind: ARENA_LOT_STATE_KIND,
			created_at: over.createdAt ?? 1000,
			tags: [
				['e', over.rootEventId ?? create.id],
				['auction', coordinate],
				['height', String(acceptedHeight)],
				['hash', TEST_CREATE_ADMIT_HASH],
				['p', TEST_CREATE_ADMIT_PUB],
			],
			content: JSON.stringify({
				schema: ARENA_CREATE_ADMIT_SCHEMA,
				auction_id: coordinate,
				seller,
				root_event_id: over.rootEventId ?? create.id,
				accepted_height: acceptedHeight,
				block_hash: TEST_CREATE_ADMIT_HASH,
				end_time: endTime,
				original_end_time: endTime,
				mode: over.mode ?? 'fixed',
			}),
		},
		TEST_CREATE_ADMIT_SK,
	) as unknown as NostrEventLike
}

export interface CreateRefusalFixtureOver {
	/** The event id the refusal names; defaults to the create's own id. */
	eventId?: string
	/** The chain's own reason, verbatim. */
	reason?: string
	/** The anchored height; defaults to {@link TEST_CREATE_ADMIT_HEIGHT}. */
	height?: number
	/** The event's `created_at`; defaults to 1001 (after the admission). */
	createdAt?: number
}

/**
 * The chain's signed kind-1450 refusal of a create. By default it names
 * `create`'s own event id (so it is that lot's refusal); pass `eventId` to build
 * one that names a **different** create — the case a reader must not mistake for
 * this create's refusal.
 */
export function makeCreateRefusalEvent(create: NostrEventLike, over: CreateRefusalFixtureOver = {}): NostrEventLike {
	const eventId = over.eventId ?? create.id
	const height = over.height ?? TEST_CREATE_ADMIT_HEIGHT
	const reason = over.reason ?? 'title required (max 120 chars)'
	return finalizeEvent(
		{
			kind: ARENA_REFUSED_KIND,
			created_at: over.createdAt ?? 1001,
			tags: [
				['e', eventId],
				['height', String(height)],
				['hash', TEST_CREATE_ADMIT_HASH],
				['p', TEST_CREATE_ADMIT_PUB],
			],
			content: JSON.stringify({
				schema: ARENA_REFUSED_SCHEMA,
				event_id: eventId,
				kind: ARENA_AUCTION_CREATE_KIND,
				reason,
				height,
				block_hash: TEST_CREATE_ADMIT_HASH,
			}),
		},
		TEST_CREATE_ADMIT_SK,
	) as unknown as NostrEventLike
}
