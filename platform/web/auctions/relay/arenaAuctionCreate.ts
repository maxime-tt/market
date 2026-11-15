/**
 * `platform/web/auctions/relay/arenaAuctionCreate.ts` — the 1440 (arena create)
 * publish path.
 *
 * ## What this is
 *
 * One auction listing, on the settled protocol: build the create content and its tags
 * from validated form input, sign it with the **seller's** Nostr signer, offer it to the
 * same relay set the arena read reads, and report what each relay did. That is all. There
 * is no edit UI here, no bid, no settlement, no verdict.
 *
 * ## Why it is on the platform side
 *
 * `ui/AGENTS.md` — `ui/` may not import `@platform/…`, `nostr-tools` or publish;
 * `AGENTS.md:85-87` — all relay I/O routes through the SDK seam `sdk/core/nostr-io`, via
 * the web host `platform/web/sdkNostrIo.ts`. The caller injects the signer and the
 * publisher, so this module holds no key and opens no socket; the CMS binding in
 * `platform/web/auctions/auctionPublish.ts` supplies both.
 *
 * ## The wire shape, and where each field comes from
 *
 * ```
 * kind:     1440                          (regular kind: the relay replaces nothing)
 * tags:     ["d", <d>]                    the auction's identity within its seller
 *           ["e", <root event id>]        only on an edit: the version it supersedes
 * content:  {"auction_id":<d>, "title":…, "description":…, "image":…, "category":…,
 *            "name":…, "startPrice":…, "minIncrement":…, "mode":"fixed"|"antisnipe",
 *            "windowSec":…, "durationSec":…, "sellerWallet":…, "v4vSplit":[…]}
 * ```
 *
 * - **`auction_id` is the one snake_case key, and it is deliberate.** It is the identity
 *   written twice: the `d` tag and the content must agree or the event addresses two
 *   auctions at once (`arenaAuctionRead.ts` refuses it as `arena.bad_identity`). The read
 *   adapter that the CMS storefront lists through requires it, so a create without it is
 *   invisible to the very surface this path exists to feed. Nothing else on the wire is
 *   snake_case, and no field outside the settled list is written: the retired tag protocol
 *   (`price`, `starting_bid`, `bid_increment`, `reserve`, `auditors`, `p2pk_xpub`,
 *   `min_bid_curve`, `settlement_grace`, `settlement_policy`, `schema`, `shipping_option`,
 *   `spec`, `t`, `image` tags) is not emitted in any form. There is no dual publish.
 * - **Immutable fields** (`startPrice`, `minIncrement`, `mode`, `windowSec`, `durationSec`,
 *   `sellerWallet`, `v4vSplit`) are frozen at first publish. An edit copies them from the
 *   root and only takes the display fields (`title`, `description`, `image`, `category`,
 *   `name`) from the form — so a supersession cannot move the money or the clock by
 *   construction, and the read's `arena.immutable_field_changed` refusal is unreachable
 *   from this path.
 * - **`sellerWallet` is the wallet spend key's pubkey**, taken from the wallet seam
 *   (`walletOps.getAuctionBidWalletSigner()`), never the Nostr identity and never a
 *   substitute. When the seam answers `null` this path refuses with
 *   `create.no-seller-wallet` and publishes nothing.
 *
 * ## Honest reporting
 *
 * One ACK per relay, kept as it came. ≥1 accepted → `accepted` (presumed on the wire until
 * the read delivers it back); relays answered and all refused → `rejected`; no ACK at all
 * → **throws**, exactly as `publishArenaBid` does, because a zero-ACK publish is a publish
 * failure whatever the transport resolved with.
 */

import { getEventHash } from 'nostr-tools/pure'
import type { Event } from '@sdk/core/nostr-io'
import type { ArenaV4vSplitRow } from '@sdk/commerce/auctions/auctionPublishValidation'
import { ARENA_AUCTION_CREATE_KIND } from '@sdk/commerce/auctions/constants'
import {
	auctionFormToCreateInput,
	ArenaCreateRefusalError,
	getArenaCreateIssues,
	validateArenaCreateInput,
	type ArenaCreateValidationInput,
	type ArenaCreateValue,
} from '@sdk/commerce/auctions/auctionPublishValidation'
import type { ArenaAuctionMode, AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import { arenaAuctionCoordinate } from '@platform/web/auctions/relay/arenaAuctionRead'

// Re-exported so a caller of this path imports the refusal and its names from one place.
export { ArenaCreateRefusalError }
export type { ArenaCreateRefusal, ArenaCreateValidationInput } from '@sdk/commerce/auctions/auctionPublishValidation'

const HEX64 = /^[0-9a-f]{64}$/

// =========================================================================
// The content
// =========================================================================

/** The create content, exactly the settled protocol's fields. */
export interface ArenaCreateContent {
	/** The identity, repeated from the `d` tag. The read refuses a mismatch. */
	auction_id: string
	title: string
	description: string
	/** The lot's image URL. */
	image: string
	category: string
	/** The seller's display name for the lot. */
	name: string
	startPrice: number
	minIncrement: number
	mode: ArenaAuctionMode
	/** 0 for `fixed`; 60…900 for `antisnipe`. */
	windowSec: number
	durationSec: number
	/** The wallet spend key's pubkey, compressed-hex or x-only hex as the seam reports it. */
	sellerWallet: string
	v4vSplit: ArenaV4vSplitRow[]
}

/** The fields frozen at first publish: an edit may not move any of them. */
export const ARENA_CREATE_IMMUTABLE_FIELD_LIST = [
	'startPrice',
	'minIncrement',
	'mode',
	'windowSec',
	'durationSec',
	'sellerWallet',
	'v4vSplit',
] as const

/** What an edit supersedes: the root's event id and the root's content. */
export interface ArenaCreateEditRoot {
	/** The root 1440's event id (64 hex). Becomes the `e` tag. */
	eventId: string
	/** The root's create content — the source of every immutable field. */
	content: ArenaCreateContent
}

export interface ArenaCreateDraft {
	/** The `d` value. */
	d: string
	/** `1440:<seller>:<d>` — our own convention, since 1440 is not addressable. */
	coordinate: string
	content: ArenaCreateContent
	tags: string[][]
	/** The exact JSON the event will carry, so a caller can hash or log what it signs. */
	contentJson: string
}

export interface ArenaCreateBuildOptions {
	/** The seller's Nostr pubkey — the event's signer, and the coordinate's middle part. */
	sellerPubkey: string
	/** The wallet spend key's pubkey (`sellerWallet`), or null when the seam has none. */
	sellerWallet: string | null
	/** Present for a supersession: the root this version claims to replace. */
	editOf?: ArenaCreateEditRoot | null
}

const isHex64 = (value: unknown): value is string => typeof value === 'string' && HEX64.test(value)

/** Copy the immutable fields off the root, refusing a root that cannot supply them. */
function immutableFieldsOf(root: ArenaCreateContent, editEventId: string): Pick<
	ArenaCreateContent,
	'startPrice' | 'minIncrement' | 'mode' | 'windowSec' | 'durationSec' | 'sellerWallet' | 'v4vSplit'
> {
	if (!isHex64(editEventId)) {
		throw new ArenaCreateRefusalError(
			'create.bad-auction-id',
			`An edit's \`e\` must be the root event id (64 hex), got ${JSON.stringify(editEventId)}`,
		)
	}
	const missing = ARENA_CREATE_IMMUTABLE_FIELD_LIST.filter((field) => root[field] === undefined || root[field] === null)
	if (missing.length > 0) {
		throw new ArenaCreateRefusalError(
			'create.bad-auction-id',
			`The root create carries no ${missing.join(', ')}, so an edit cannot preserve them.`,
		)
	}
	return {
		startPrice: root.startPrice,
		minIncrement: root.minIncrement,
		mode: root.mode,
		windowSec: root.windowSec,
		durationSec: root.durationSec,
		sellerWallet: root.sellerWallet,
		v4vSplit: root.v4vSplit ?? [],
	}
}

/**
 * Pure: the draft for a create (or, with `editOf`, a supersession). Throws
 * `ArenaCreateRefusalError` — never guesses and never fills a missing field in.
 */
export function buildArenaCreateDraft(
	form: ArenaCreateValidationInput,
	options: ArenaCreateBuildOptions,
): ArenaCreateDraft {
	const value: ArenaCreateValue = validateArenaCreateInput(form, { sellerWallet: options.sellerWallet })
	const d = value.auctionId
	const edit = options.editOf ?? null

	const content: ArenaCreateContent = edit === null
		? {
				auction_id: d,
				title: value.title,
				description: value.description,
				image: value.image,
				category: value.category,
				name: value.name,
				startPrice: value.startPrice,
				minIncrement: value.minIncrement,
				mode: value.mode,
				windowSec: value.windowSec,
				durationSec: value.durationSec,
				sellerWallet: value.sellerWallet,
				v4vSplit: value.v4vSplit,
			}
		: {
				// Display is mutable; money, time and cryptography are not.
				auction_id: d,
				title: value.title,
				description: value.description,
				image: value.image,
				category: value.category,
				name: value.name,
				...immutableFieldsOf(edit.content, edit.eventId),
			}

	const tags: string[][] = edit === null ? [['d', d]] : [['d', d], ['e', edit.eventId]]

	return {
		d,
		coordinate: arenaAuctionCoordinate(options.sellerPubkey, d),
		content,
		tags,
		contentJson: JSON.stringify(content),
	}
}

/** The form's own entry point: the same draft, from the editor's state. */
export function buildArenaCreateDraftFromForm(
	formData: AuctionFormData,
	options: ArenaCreateBuildOptions,
): ArenaCreateDraft {
	return buildArenaCreateDraft(auctionFormToCreateInput(formData), options)
}

/**
 * The inline messages the editor renders. Never throws, and never consults the wallet
 * seam: `'not-checked-here'` stands in for the seller wallet so the editor can render
 * every *form* message while the publish path is the only place that asks the wallet and
 * refuses `create.no-seller-wallet`.
 */
export function arenaCreateFormIssues(formData: AuctionFormData) {
	return getArenaCreateIssues(auctionFormToCreateInput(formData), { sellerWallet: 'not-checked-here' })
}

// =========================================================================
// Signing and publishing
// =========================================================================

/** The event template the signer receives (the `nostr-tools` shape, without the id). */
export interface ArenaCreateTemplate {
	kind: number
	created_at: number
	tags: string[][]
	content: string
}

/** The seller's signer, as the host supplies it. Signs an event template, nothing else. */
export interface ArenaCreateSigner {
	/** The seller's pubkey, hex. The event must come back with this key. */
	pubkey: string
	sign(template: ArenaCreateTemplate): Promise<Event>
}

/** The publish seam: one ACK per targeted relay, as `NostrIo.publish` returns. */
export interface ArenaCreatePublisher {
	publish(event: Event): Promise<{ id: string; acks: { url: string; accepted: boolean; message?: string }[] }>
}

export interface ArenaCreatePublishOptions extends ArenaCreateBuildOptions {
	signer: ArenaCreateSigner
	publisher: ArenaCreatePublisher
	/** The relays the create is offered to — the same set the arena read subscribes to. */
	relays: readonly string[]
	/** Unix seconds. Injected so a test can pin it. */
	now: number
}

export interface ArenaCreatePublishResult {
	eventId: string
	/** The root id: the create's own id before any edit, else the root it supersedes. */
	rootId: string
	d: string
	coordinate: string
	content: ArenaCreateContent
	tags: string[][]
	outcome: 'accepted' | 'rejected'
	acceptedBy: string[]
	rejected: { url: string; message: string | null }[]
	totalRelays: number
}

/**
 * Build, sign and publish one 1440 create. Resolves with what the relays said; throws
 * `ArenaCreateRefusalError` for a refusal and a plain `Error` when no relay ACKed, so a
 * caller can never mistake an unpublished create for a listed one.
 */
export async function publishArenaCreate(
	form: ArenaCreateValidationInput,
	options: ArenaCreatePublishOptions,
): Promise<ArenaCreatePublishResult> {
	if (!isHex64(options.sellerPubkey)) {
		throw new Error(`The seller pubkey must be 64 hex, got ${JSON.stringify(options.sellerPubkey)}`)
	}
	if (options.signer.pubkey !== options.sellerPubkey) {
		throw new Error(`The signer is ${options.signer.pubkey}, not the seller ${options.sellerPubkey}: a create must be signed by its seller.`)
	}

	const draft = buildArenaCreateDraft(form, options)
	const template: ArenaCreateTemplate = {
		kind: ARENA_AUCTION_CREATE_KIND,
		created_at: options.now,
		tags: draft.tags,
		content: draft.contentJson,
	}

	// The id of the event that WILL be signed, from the template: a signer that returns a
	// different event (wrong key, mutated tags) is caught here, not published.
	let expectedId: string
	try {
		expectedId = getEventHash({ ...template, pubkey: options.signer.pubkey })
	} catch (error) {
		throw new Error(`The create template could not be hashed: ${error instanceof Error ? error.message : String(error)}`)
	}

	const event = await options.signer.sign(template)
	if (event.id !== expectedId || event.kind !== ARENA_AUCTION_CREATE_KIND) {
		throw new Error(
			`the signed create (${event.id}, kind ${event.kind}) is not the create that was validated (${expectedId}, kind ${ARENA_AUCTION_CREATE_KIND})`,
		)
	}

	const outcome = await options.publisher.publish(event)
	if (outcome.id !== event.id) {
		throw new Error(`the publish answered for ${outcome.id}, not for the create ${event.id}`)
	}

	const acceptedBy = outcome.acks.filter((ack) => ack.accepted).map((ack) => ack.url)
	const rejected = outcome.acks.filter((ack) => !ack.accepted).map((ack) => ({ url: ack.url, message: ack.message ?? null }))
	if (acceptedBy.length === 0) {
		const named = rejected.length > 0 ? rejected.map((r) => `${r.url}${r.message ? ` (${r.message})` : ''}`).join('; ') : 'no relay answered'
		throw new Error(`No relay accepted the auction create (kind ${ARENA_AUCTION_CREATE_KIND}, id ${event.id}): ${named}`)
	}

	return {
		eventId: event.id,
		rootId: options.editOf?.eventId ?? event.id,
		d: draft.d,
		coordinate: draft.coordinate,
		content: draft.content,
		tags: draft.tags,
		outcome: 'accepted',
		acceptedBy,
		rejected,
		totalRelays: options.relays.length,
	}
}