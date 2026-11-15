/**
 * `sdk/commerce/auctions/auctionForm.ts` — the CMS auction-create form's data contract.
 *
 * The shape here is the **settled 1440 create** (MERGED-PROTOCOL-SPEC §8), not the
 * retired 30408 tag listing. Every field below either lands in the create content or is
 * the auction's identity; there are no knobs left over from the tag protocol. The one
 * field that is not part of the protocol at all is `auctionId`, which is the `d` tag —
 * the identity the create content repeats as `auction_id`.
 *
 * What used to be here and is gone (each was a 30408 tag with no home in a 1440):
 * `reserve`, `startAt`/`endAt` scheduling, `antiSnipeWindowMinutes` + `minBidCurveShape` +
 * `minBidCurvePeakMultiplier` (the floor curve), `settlementGracePreset`,
 * `auditorPubkey` (the `auditors` list), `trustedMints`, `specs`, `shippings`,
 * `isNSFW`, `enableLiveChat`, `summary`, `categories[]` and `pathIssuerPubkey`.
 * `trustedMints`/`specs`/`shippings` are not in the create at all — see
 * `auctionPublish.ts` for what happened to them.
 *
 * Numeric fields stay strings while the seller is typing; `auctionPublishValidation.ts`
 * is the single place that parses them, and it refuses by name rather than coercing.
 */

/** The protocol's two auction modes (`mode` in the create content). */
export type ArenaAuctionMode = 'fixed' | 'antisnipe'

/** The protocol's two V4V split roles (`v4vSplit[].role` in the create content). */
export type ArenaV4vSplitRole = 'validator' | 'v4v'

/**
 * One split row as the form holds it: `allocationBps` is a string until validation
 * parses it, because a typed basis-point total must be refused, not rounded.
 */
export interface AuctionV4vSplitRowInput {
	role: ArenaV4vSplitRole
	recipientPubkey: string
	allocationBps: string
}

/**
 * The auction-create form's state. One image, one category, one name: the create content
 * has a single `image`, a single `category` and a single `name`, so the form does too.
 */
export interface AuctionFormData {
	/** The `d` tag — the auction's identity within its seller. */
	auctionId: string
	title: string
	description: string
	/** The lot's image URL (`image` in the create content). */
	imageUrl: string
	/** Free-text category (`category` in the create content). */
	category: string
	/** The seller's display name for the lot (`name` in the create content). */
	name: string
	/** Opening price in sats → `startPrice`. */
	startPrice: string
	/** Minimum raise per bid in sats → `minIncrement`. */
	minIncrement: string
	mode: ArenaAuctionMode
	/**
	 * Anti-snipe window in **seconds** → `windowSec`. Only read when `mode` is
	 * `'antisnipe'`; a fixed-time auction publishes `windowSec: 0` and this field is
	 * not sent. The protocol's range is 60…900 and validation enforces it.
	 */
	windowSec: string
	/** How long the auction runs, in seconds → `durationSec` (20…259200). */
	durationSec: number
	/** The committed value split → `v4vSplit`. Empty means "no split", not "zero split". */
	v4vSplit: AuctionV4vSplitRowInput[]
}