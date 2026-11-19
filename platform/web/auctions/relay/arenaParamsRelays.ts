/**
 * platform/web/auctions/relay/arenaParamsRelays.ts — which relays the committee's
 * kind-1448 terms are read from. A plain module so both the bid host and the
 * wallet's chain-mint seed can share it without importing each other.
 */

/**
 * Where the escrow terms are read from: the instance relay alone, when there is one.
 *
 * Why: this instance's validator committee publishes its kind-1448 terms to the
 * instance relay. Reading every query relay broke bidding two ways: the bounded
 * read ends at the first relay that is caught up, so a fast empty public relay
 * ended it before the instance relay's terms arrived; and public relays carry
 * other committees' terms at higher heights, which the newest-height selection
 * would have preferred, locking a bid to a key this instance's validators do
 * not hold. Without an instance relay the query relays are the only option.
 */
export function arenaParamsRelays(appRelayUrl: string | undefined, queryRelays: readonly string[]): string[] {
	const pinned = appRelayUrl?.trim()
	return pinned ? [pinned] : [...queryRelays]
}
