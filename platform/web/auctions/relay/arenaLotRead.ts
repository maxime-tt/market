/**
 * `arenaLotRead.ts` — resolves a `/auctions/<d>` URL to the 1440 lot it names.
 *
 * ## Why a `d` alone is not enough
 *
 * A 1440's identity is `(seller, d)`, and the coordinate is
 * `1440:<seller>:<d>` (`arenaAuctionRead.ts:420-423`). The `d` tag is scoped to
 * its **seller**, so two unrelated sellers may both publish an auction with the
 * same `d` — `"lot-1"` under Alice and `"lot-1"` under Bob are two lots, not
 * one. The route's address only carries the `d` (that is what
 * `StorefrontBlockSlots.tsx:238-241` builds, and what `getAuctionId` reads), so
 * the read side has to decide what a bare `d` means.
 *
 * It must **not** guess. Three outcomes, no fourth:
 *
 * - exactly one seller published that `d` → that lot ({@link ArenaLotLookup.found});
 * - more than one did → {@link ArenaLotLookup.ambiguous}, all candidates, and
 *   the surface asks the reader to pick (an optional `?seller=<pubkey>` is the
 *   disambiguator, never a silent `[0]`);
 * - nobody did → {@link ArenaLotLookup.missing}.
 *
 * `missing` is a fact only when the read **settled**; while the read is
 * `loading` / `incomplete` / `no-relays` / `error` the same result means "not
 * read yet", and only the caller (which holds the read state) may say which.
 * This module returns the shape and never a sentence.
 *
 * Pure: no React, no relay, no store. It reads the already-projected snapshot.
 */

import type { ArenaAuctionSnapshot, ArenaAuctionView } from '@platform/web/auctions/relay/arenaAuctionRead'

export type ArenaLotLookup =
	/** Exactly one seller published this `d`; the route renders it. */
	| { kind: 'found'; view: ArenaAuctionView }
	/** More than one seller published this `d`; the route lists them and picks none. */
	| { kind: 'ambiguous'; candidates: ArenaAuctionView[] }
	/** No seller in the snapshot published this `d` (meaning depends on the read state). */
	| { kind: 'missing' }

/** Stable display order for candidates: the seller key decides, so the list never reshuffles between reads. */
function bySeller(a: ArenaAuctionView, b: ArenaAuctionView): number {
	return a.seller.localeCompare(b.seller) || a.coordinate.localeCompare(b.coordinate)
}

/** Every lot in the snapshot whose `d` matches, ordered by seller. */
export function arenasWithD(snapshot: ArenaAuctionSnapshot, d: string): ArenaAuctionView[] {
	return snapshot.auctions.filter((auction) => auction.d === d).sort(bySeller)
}

/**
 * Resolve a `d` (optionally scoped to one `seller`) against a projected
 * snapshot. `seller` is the `?seller=` disambiguator; `null`/empty means the
 * bare `d` address.
 */
export function resolveArenaLot(
	snapshot: ArenaAuctionSnapshot,
	d: string,
	seller: string | null = null,
): ArenaLotLookup {
	const byD = arenasWithD(snapshot, d)
	if (seller !== null && seller !== '') {
		const match = byD.find((auction) => auction.seller === seller)
		return match === undefined ? { kind: 'missing' } : { kind: 'found', view: match }
	}
	if (byD.length === 0) return { kind: 'missing' }
	if (byD.length === 1) return { kind: 'found', view: byD[0] }
	return { kind: 'ambiguous', candidates: byD }
}

/** The self-disambiguating address of one candidate: the same `d`, plus its seller. */
export function lotHref(d: string, seller: string): string {
	return `/auctions/${encodeURIComponent(d)}?seller=${encodeURIComponent(seller)}`
}
