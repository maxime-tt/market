/**
 * The Catalogue detail's live wiring: the auctions protocol client, pointed at
 * the app's own origin and signing with the signed-in user's real signer.
 *
 * Everything here is composition, not protocol: `protocol/client.ts` owns the
 * wire shapes and `protocol/httpPorts.ts` owns the HTTP transport. This module
 * only supplies the two things a browser has that a test does not — the
 * same-origin fetch and the active Nostr signer — and the custodial bid
 * sequence from the handover's §7, trimmed to the funding mode the demo runs.
 *
 * `funding_mode` on the demo is `custodial_reservation_v1`: a bid reserves the
 * sats with the coordinator, then publishes a `KindBid` carrying that receipt.
 * Mint-backed modes need the browser Cashu lock + two signed outcome templates,
 * which is a separate surface; asking for one here fails loudly rather than
 * publishing an inert bid that looks accepted.
 */

import { getActiveSignerCapability } from '@platform/web/auth/authStore'
import {
	createAuctionsProtocolClient,
	type AuctionsProtocolClient,
	type AuctionsProtocolPorts,
	type SignedEvent,
} from '../protocol/client'
import { createHttpPorts } from '../protocol/httpPorts'

/**
 * Sign with the auth session's live capability.
 *
 * Read lazily on every call, not captured at construction: a signer can be
 * switched (NIP-46 reconnect, key change) between page load and a bid, and a
 * stale captured signer would sign for the wrong identity — precisely the drift
 * `auctionPublishBid.ts` guards against before publishing.
 */
export function createSignerPort(): AuctionsProtocolPorts['sign'] {
	return async (template) => {
		const capability = getActiveSignerCapability()
		if (!capability) throw new Error('Sign in to place a bid')
		return (await capability.signEvent(template)) as SignedEvent
	}
}

/** Same-origin ports (no base) plus the app signer; the shape the browser uses. */
export function createCatalogueProtocolClient(): AuctionsProtocolClient {
	const ports: AuctionsProtocolPorts = {
		...createHttpPorts(),
		sign: createSignerPort(),
	}
	return createAuctionsProtocolClient(ports)
}

export interface CustodialBidInput {
	auctionId: string
	/** The bidder's committed pubkey; the reservation receipt is bound to it. */
	bidder: string
	/** The DELTA this bid adds, already resolved from the bidder's chosen total. */
	delta: number
	/** The auction's committed funding mode; only the custodial path is wired. */
	fundingMode: string
}

/**
 * The custodial bid sequence (§7): reserve, then publish the `KindBid` carrying
 * the receipt. Returns the signed event so the caller can surface its id.
 */
export async function placeCustodialBid(
	client: AuctionsProtocolClient,
	input: CustodialBidInput,
): Promise<SignedEvent> {
	if (input.fundingMode !== 'custodial_reservation_v1') {
		throw new Error(
			`This surface only places custodial-reservation bids; this lot funds with ${input.fundingMode}.`,
		)
	}
	const reservation = await client.reserve({
		auctionId: input.auctionId,
		bidder: input.bidder,
		amount: input.delta,
	})
	return client.placeBid({ auctionId: input.auctionId, amountDelta: input.delta, reservation })
}
