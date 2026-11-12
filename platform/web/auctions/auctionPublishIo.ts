/**
 * platform/web/auctions/auctionPublishIo.ts — the relay publish helpers shared by every auction
 * publish module (listing, claim, path release, bid, settlement).
 *
 * These are the seam wrappers, not auction logic: `publishRequired` fails closed on a zero-ACK
 * publish, the two gift-wrap/marker variants keep their own accepted-relay checks, and
 * `resolveAuctionClaimBuyerPubkey` is the identity the public claim marker is written with. They
 * live beside the publish bindings so each moved section re-uses one copy instead of re-implementing
 * the fail-closed contract.
 *
 * `tagBidError` is here for the same reason: both the bid and the settlement paths wrap a step
 * failure with the step name, and a shared home keeps the settlement module from importing the bid
 * module (or the aggregator) just for the wrapper.
 */
import { getUser, publishNostrEvent } from '@platform/web/ndkPublishContext'
import type { NostrEvent, PublishOptions } from '@platform/web/ndkPublishContext'

export const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

/**
 * Wrap an error thrown from a specific step of the bid flow with a tag that
 * names the step. Makes the eventual toast unambiguous about whether the
 * rate limit / failure came from the mint, the issuer, or the relay.
 */
export const tagBidError = (step: string, cause: unknown): Error => {
	const detail = cause instanceof Error ? cause.message : String(cause)
	const tagged = new Error(`[${step}] ${detail}`)
	if (cause instanceof Error && cause.stack) {
		tagged.stack = cause.stack
	}
	return tagged
}

/**
 * Publish through the seam and fail closed on zero relay ACKs.
 *
 * `io.ts` documents an empty `publishedRelays` as "no relay accepted it, which
 * callers must treat as a publish failure". That is enforced for free by the
 * NDK bridge (it throws `NDKPublishError` below `requiredRelayCount = 1`), but
 * the applesauce adapter RESOLVES with the ACK-filtered set
 * (`io-applesauce.ts`), so an unchecked call reports a zero-ACK publish as a
 * success. This wrapper makes the contract adapter-independent (review
 * 2026-09-18, item 4). `publishRequiredPrivateGiftWrap` /
 * `publishAuctionClaimMarkerToPrivateRelays` keep their own checks because they
 * need the accepted relay URLs.
 */
export async function publishRequired(event: NostrEvent, options?: PublishOptions): Promise<void> {
	const result = await publishNostrEvent(event, options)
	if (result.publishedRelays.size === 0) {
		throw new Error(`No relay accepted the event (kind ${event.kind}, id ${event.id}) — treating as a publish failure`)
	}
}

export async function publishRequiredPrivateGiftWrap(event: NostrEvent): Promise<string[]> {
	const result = await publishNostrEvent(event)
	if (result.publishedRelays.size === 0) {
		throw new Error('Encrypted auction claim details could not be published')
	}
	return Array.from(result.publishedRelays)
}

export async function publishAuctionClaimMarkerToPrivateRelays(event: NostrEvent, privateRelayUrls: string[]): Promise<void> {
	const result = await publishNostrEvent(event, { relayUrls: privateRelayUrls })
	if (result.publishedRelays.size === 0) {
		throw new Error('Auction claim marker could not be published to the private claim relays')
	}
}

/**
 * Resolve the buyer identity written into the public claim marker.
 *
 * The base implementation compared `ndk.activeUser?.pubkey` against the active
 * signer's pubkey and threw "Active user does not match active signer."; the
 * seam exposes identity only through `getUser()`, which is itself
 * signer-derived (`@/lib/stores/ndk` `getUser()` → the active signer's user).
 * The two values therefore cannot diverge through the seam today, so the
 * comparison is vacuous here rather than removed. The identity property that
 * actually matters — the pubkey written into the public marker is the identity
 * that encrypted the private claim — holds because
 * `createPrivateAuctionClaimMessageForActiveSigner` (platform/web/ndkReadContext.ts,
 * over the sdk private-claim module) produces the gift wrap from the same active
 * signer. The #1252 signer migration re-points `getUser()`; if it ever makes
 * identity independent of the signer, that migration MUST re-establish the
 * cross-account assertion (review 2026-09-18, item 5).
 */
export async function resolveAuctionClaimBuyerPubkey(): Promise<string> {
	const user = await getUser()
	const signerPubkey = user?.pubkey ?? ''
	if (!HEX_PUBKEY_RE.test(signerPubkey)) throw new Error('Active signer pubkey is not a 32-byte hex Nostr pubkey.')

	return signerPubkey
}
