import type NDK from '@nostr-dev-kit/ndk'
import { buildRelayListFilter, parseRelayListEvents, type RelayPreference } from '@sdk/core/relays'

/**
 * Read a user's NIP-65 relay list (kind 10002) with its read/write flags.
 *
 * The ndk instance is a **parameter** rather than something read out of the
 * stores, and this module imports no store at all. That is deliberate: the ndk
 * store needs this read during sign-in, and a `@/queries/*` module that imports
 * the store while the store imports it back is a cycle — the two together were
 * one of the groups holding the src/ retirement up. Callers supply the
 * connection they want the read to go through, and the "no NDK yet" guard stays
 * with whoever owns that connection.
 *
 * @param ndk The connection to read through.
 * @param userPubkey The pubkey whose relay list to read.
 * @returns The parsed relay preferences (empty when the user has published none).
 */
export async function fetchUserRelayListWithPreferences(ndk: NDK, userPubkey: string): Promise<RelayPreference[]> {
	const events = await ndk.fetchEvents(buildRelayListFilter(userPubkey))
	return parseRelayListEvents(events)
}
