/**
 * gen_auctions.ts — the seed's arena auction fixtures (the 1440 series).
 *
 * A lot is a kind-1440 create whose content is the JSON contract the arena read
 * decodes (`platform/web/auctions/relay/arenaAuctionRead.ts` `createContentOf`),
 * and a bid is a kind-1441 carrying `content.auction` / `content.auction_id` /
 * `content.amount` plus the `e` (auction **root** event id) and `a`
 * (`1440:<seller>:<d>`) tags. This file emits exactly those shapes, and it builds
 * the create through the app's own builder — `buildArenaCreateDraft`
 * (`platform/web/auctions/relay/arenaAuctionCreate.ts`) — so a seeded lot is a lot
 * the app itself could have published: same validation, same content, same
 * coordinate convention.
 *
 * The retired `cashu_p2pk_bidder_path_v1` 30408 family is written nowhere here: no
 * 30408 listing, no 1023 bid, no 1025 path release. The kind numbers come from
 * `ARENA_AUCTION_KINDS` and never from a literal.
 *
 * There is no 1440 counterpart for the old 1025 path release (which is why none is
 * published): the arena has no path-release kind — settlement is the chain's, via
 * the validator-signed 1445 verdict — and the `a`-tag path-release read
 * (`sdk/commerce/auctions/auctionRead.ts` `fetchAuctionPathReleasesForList`) is a
 * 1025 subscription the arena read does not run.
 *
 * ## Seeded bids are unfunded fixtures
 *
 * A seeded bid carries the amount and the references that bind it to its lot, and
 * nothing else. A real 1441 also carries the bidder's escrow lock and its two
 * pre-signed outcome templates (`platform/web/auctions/relay/arenaBidPublish.ts`
 * `ArenaBidContent`); a seed cannot produce those — the locked proofs have to come
 * from a mint, and settlement of a seeded bid is impossible by construction.
 * Fabricating proof material would put invented data at the money layer, so the
 * fixtures stop at what the read surfaces actually use: `content.amount` and the
 * two bindings (`arenaAuctionRead.projectArenaEvents`, and
 * `auctionSurfacesRead.toAuctionDetailModel` for the bid list and positions). A
 * seeded bid is enough to make the bid list, the per-bidder positions and the
 * dashboards render; it is not a bid any validator or chain would accept.
 */

import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { PRODUCT_CATEGORIES } from '@sdk/config/constants'
import { ARENA_AUCTION_KINDS } from '@sdk/commerce/auctions/constants'
import { AUCTION_MAX_DURATION_SEC } from '@sdk/commerce/auctions/auctionPublishValidation'
import { buildArenaCreateDraft } from '@platform/web/auctions/relay/arenaAuctionCreate'

/** A seeded lot either runs now (`live`) or has already ended (`ended`). */
type AuctionStatus = 'live' | 'ended'

/**
 * One seeded lot: the unsigned kind-1440 create plus the fields the seed reads back
 * off it. The create carries no `start_at` / `end_at` tags — the arena's clock is
 * `created_at` plus `content.durationSec` (`auctionSurfacesRead.auctionEndsAt`).
 */
export type GeneratedAuctionData = {
	/** `ARENA_AUCTION_KINDS.create`. */
	kind: number
	/** The lot's start: the create's `created_at`. */
	created_at: number
	/** The serialised create content — the JSON `arenaAuctionRead.createContentOf` decodes. */
	content: string
	/** `[['d', <auctionId>]]`: the lot's identity, and nothing else. */
	tags: NDKTag[]
	/** The `d` value, repeated in the content as `auction_id`. */
	auctionId: string
	/** `1440:<seller>:<d>` (`arenaAuctionCoordinate`). */
	coordinate: string
	/** `created_at + durationSec` — when this lot ends. */
	endsAt: number
	/** `content.startPrice` — the opening price the seeded bid ladder climbs from. */
	startPrice: number
	/** `content.minIncrement` — the rise between one seeded bid and the next. */
	minIncrement: number
}

/** Shortest running time a live seed lot gets: 30 minutes. */
const MIN_LIVE_DURATION_SEC = 30 * 60

/**
 * Build one lot's create template.
 *
 * `status: 'ended'` back-dates the create so the lot's end has already passed, since
 * the end is derived from `created_at` and not from a tag. An `ended` fixture is how
 * the seed gives the dev instance lots that are past their window without waiting
 * for a real one to finish.
 */
export function generateAuctionData(params: {
	sellerPubkey: string
	/** The seller's wallet spend key (`content.sellerWallet`) — the key an escrow would pay. */
	sellerWallet: string
	status?: AuctionStatus
	/** Pin the running time (the quick-settle fixture does). */
	durationSec?: number
	/** Pin the display title (the quick-settle fixture does). */
	title?: string
	/** Pin the display description (the quick-settle fixture does). */
	description?: string
}): GeneratedAuctionData {
	const now = Math.floor(Date.now() / 1000)
	const status = params.status ?? (Math.random() < 0.2 ? 'ended' : 'live')

	const durationSec =
		params.durationSec ??
		(status === 'ended'
			? faker.number.int({ min: MIN_LIVE_DURATION_SEC, max: 6 * 60 * 60 })
			: faker.number.int({ min: MIN_LIVE_DURATION_SEC, max: AUCTION_MAX_DURATION_SEC }))
	// An ended lot must have run its whole length and then some.
	const created_at = status === 'ended' ? now - durationSec - faker.number.int({ min: 5 * 60, max: 6 * 60 * 60 }) : now

	const draft = buildArenaCreateDraft(
		{
			auctionId: `auction_${faker.string.alphanumeric(10)}`,
			title: params.title ?? faker.commerce.productName(),
			description: params.description ?? faker.commerce.productDescription(),
			imageUrl: faker.image.urlPicsumPhotos({ width: 1200, height: 800 }),
			category: faker.helpers.arrayElement([...PRODUCT_CATEGORIES]),
			name: faker.commerce.productName(),
			startPrice: faker.number.int({ min: 500, max: 50_000 }),
			minIncrement: faker.number.int({ min: 50, max: 2_000 }),
			// Seeded lots are fixed-time. An anti-snipe lot moves its own end when a bid
			// lands inside the window, which would make the countdown fixtures argue with
			// themselves; a dev who wants that sets it in the editor. `windowSec` is 0 by
			// construction for `fixed`.
			mode: 'fixed',
			durationSec,
			// No committed split. The read maps an empty split to "none stated".
			v4vSplit: [],
		},
		{ sellerPubkey: params.sellerPubkey, sellerWallet: params.sellerWallet },
	)

	return {
		kind: ARENA_AUCTION_KINDS.create,
		created_at,
		content: draft.contentJson,
		tags: draft.tags as NDKTag[],
		auctionId: draft.d,
		coordinate: draft.coordinate,
		endsAt: created_at + durationSec,
		startPrice: draft.content.startPrice,
		minIncrement: draft.content.minIncrement,
	}
}

export async function createAuctionEvent(
	signer: NDKPrivateKeySigner,
	ndk: NDK,
	auctionData: GeneratedAuctionData,
): Promise<NDKEvent | null> {
	const event = new NDKEvent(ndk)
	event.kind = auctionData.kind
	event.content = auctionData.content
	event.tags = auctionData.tags
	event.created_at = auctionData.created_at

	try {
		await event.sign(signer)
		await event.publish()
		console.log(`Published arena lot ${auctionData.coordinate}`)
		return event
	} catch (error) {
		console.error('Failed to publish auction', error)
		return null
	}
}

/** Return shape from a successful seed bid. */
export type SeededBidResult = {
	bidEventId: string
	bidderPubkey: string
	amount: number
}

/**
 * The unsigned kind-1441 a seeded bid publishes. Pure, so a test can read the exact
 * shape the seed emits without a relay or a signer.
 */
export function buildAuctionBidTemplate(params: {
	/** The auction **root** event id — the `e` tag, and the read's second binding. */
	auctionRootEventId: string
	/** `1440:<seller>:<d>` — the `a` tag, and the read's first binding. */
	auctionCoordinate: string
	/** The lot's `d` — `content.auction_id`. */
	auctionId: string
	/** The bid's delta in sats — `content.amount`. */
	amount: number
	createdAt: number
}): { kind: number; created_at: number; content: string; tags: NDKTag[] } {
	return {
		kind: ARENA_AUCTION_KINDS.bid,
		created_at: params.createdAt,
		content: JSON.stringify({
			// The chain keys a lot by its coordinate (`arenaBidPublish.ArenaBidContent.auction`).
			auction: params.auctionCoordinate,
			auction_id: params.auctionId,
			amount: params.amount,
		}),
		tags: [
			['e', params.auctionRootEventId],
			['a', params.auctionCoordinate],
		],
	}
}

export async function createAuctionBidEvent(params: {
	signer: NDKPrivateKeySigner
	ndk: NDK
	auctionRootEventId: string
	auctionCoordinate: string
	auctionId: string
	amount: number
	createdAt?: number
}): Promise<SeededBidResult | null> {
	const template = buildAuctionBidTemplate({
		auctionRootEventId: params.auctionRootEventId,
		auctionCoordinate: params.auctionCoordinate,
		auctionId: params.auctionId,
		amount: params.amount,
		createdAt: params.createdAt ?? Math.floor(Date.now() / 1000),
	})

	try {
		const bidEvent = new NDKEvent(params.ndk)
		bidEvent.kind = template.kind
		bidEvent.created_at = template.created_at
		bidEvent.content = template.content
		bidEvent.tags = template.tags

		await bidEvent.sign(params.signer)
		await bidEvent.publish()
		console.log(`  ✓ Bid published: ${params.amount} sats by ${bidEvent.pubkey.slice(0, 8)}...`)
		return {
			bidEventId: bidEvent.id,
			bidderPubkey: bidEvent.pubkey,
			amount: params.amount,
		}
	} catch (error) {
		console.error('[seed] createAuctionBidEvent failed:', error instanceof Error ? error.message : error)
		return null
	}
}
