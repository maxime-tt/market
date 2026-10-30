import type NDK from '@nostr-dev-kit/ndk'
import { NDKRelay, NDKRelayStatus } from '@nostr-dev-kit/ndk'
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

/** Relay connectivity as the settings view reports it (plain strings, no NDK type leaks to `ui/`). */
export type RelayConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/**
 * Classify one pool relay's live connectivity for the relay-manager view. The
 * retired `src/components/ui/relay-manager/RelayCard.tsx` derived the same
 * three states from `relay.connectivity.status` before rendering (CONNECTED /
 * CONNECTING / everything else as disconnected); the mapping lives here so the
 * host that consumes it can stay NDK-import-free. A relay that throws while
 * reporting (the original wrapped the same read) classifies as disconnected.
 *
 * @param relay A relay from `ndkActions.getRelays()` (an `NDKRelay`).
 */
export function relayConnectionStatus(relay: NDKRelay): RelayConnectionStatus {
	try {
		const status = relay.connectivity?.status
		if (status === NDKRelayStatus.CONNECTED) {
			return 'connected'
		}
		if (status === NDKRelayStatus.CONNECTING) {
			return 'connecting'
		}
		return 'disconnected'
	} catch {
		return 'disconnected'
	}
}
