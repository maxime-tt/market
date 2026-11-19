/**
 * platform/web/notifications/auctionReadFilters.ts — the relay filters the notification monitor
 * uses to read a lot's bids, a target's NIP-22 comments, and a lot's live activity.
 *
 * Why these are not the obvious `#a` filters
 * ------------------------------------------
 * The relay's event store indexes a tag only when the tag name is a single character AND the
 * value is at most 100 bytes (`fiatjaf.com/nostr/eventstore/boltdb/helpers.go`:
 * `if len(tag) < 2 || len(tag[0]) != 1 || len(tag[1]) == 0 || len(tag[1]) > 100 { continue }`),
 * and the query planner trusts that index instead of falling back to a scan. A single-letter tag
 * whose value is longer than the budget is therefore stored, indexed nowhere, and answered with a
 * confident zero.
 *
 * A lot's coordinate `1440:<64 hex>:<36-char uuid>` is 106 characters, so every `#a` read of a
 * lot is empty on such a relay. Each builder below answers with the identity the event really
 * carries and the relay really indexes:
 *
 *   - a 1441 bid carries `e` = the lot's **root create id** (64 hex → `indexTag32`), and its `#a`
 *     coordinate is both unindexable here and rejected by the client's filter guardrails;
 *   - a NIP-22 comment on a 1440 carries `E` = the **commented create version's id** (a 1440 is a
 *     regular kind, so it is never addressed by `A`/`a`; the root scope is the event id), one
 *     thread root per create version of the lot;
 *   - a 30311 live activity carries `d` = `buildLiveActivityDTag(<lot coordinate>)` — 20
 *     characters, derived deterministically from the lot it is for.
 *
 * A product (`30402:<seller>:<d>`) is addressable, so its comments carry `A`/`a` coordinates and
 * no `E` at all; those clauses stay as they are (they fit the budget while the `d` is at most 29
 * characters, which is the only form the relay can index).
 */
import { isAddressableKind } from 'nostr-tools/kinds'
import { buildLiveActivityDTag } from '@sdk/core/nostr/nip53'

/** Single-letter tag names these reads narrow on. */
export type AuctionScopeTagName = '#a' | '#A' | '#e' | '#E' | '#d'

/** One `#<tag>: [values]` clause of a relay REQ; no clause is emitted for an empty value list. */
export interface AuctionScopeTagFilter {
	tagName: AuctionScopeTagName
	values: string[]
}

const uniqueStrings = (values: readonly string[]): string[] => Array.from(new Set(values.filter(Boolean)))

/**
 * The filters that find a lot's 1441 bids: `#e` over every known root create id.
 *
 * No `#a` clause, for two measured reasons. A lot's coordinate is 106 characters, past the 100
 * the relay's tag index accepts, so the clause is answered with a zero. And NDK's filter
 * guardrails — enabled in `development` and `staging`, which is the deployed instance's stage —
 * treat an `#a` value naming a non-addressable kind (1440) as a fatal error
 * (`Filter[1].#a[0] uses non-addressable kind 1440 … #a filters are only for addressable events`),
 * which aborts the whole monitor initialization before any read is sent. A 1441 always carries
 * `e` = its lot's root create id (`sdk/commerce/auctions`, decision §4.2), so `#e` is complete for
 * a lot with a known root and there is nothing for `#a` to add.
 *
 * A lot whose root create id is not known emits no filter at all — never an empty `'#e': []`.
 */
export function auctionBidScopeFilters({ rootEventIds }: { rootEventIds?: readonly string[] }): AuctionScopeTagFilter[] {
	const rootValues = uniqueStrings(rootEventIds ?? [])
	return rootValues.length > 0 ? [{ tagName: '#e', values: rootValues }] : []
}

/**
 * The filters that find a target's NIP-22 comments, chosen by the target's kind:
 *
 *   - a regular target (a 1440 lot) is commented on with `E` = the target event's id, so the read
 *     is `#E` over every known create version of the lot. A 1440 is never addressed with `A`/`a`,
 *     so emitting those clauses would only add a REQ the relay can never answer;
 *   - an addressable target (a 30402 product) is commented on with `A`/`a` = its coordinate and
 *     never with `E`, so the read is the coordinate — `#a` for the parent scope and `#A` for the
 *     root scope.
 */
export function commentTargetScopeFilters({
	targetKind,
	targetEventIds,
	targetCoordinates,
}: {
	targetKind: number
	targetEventIds?: readonly string[]
	targetCoordinates?: readonly string[]
}): AuctionScopeTagFilter[] {
	const eventIds = uniqueStrings(targetEventIds ?? [])
	const coordinates = uniqueStrings(targetCoordinates ?? [])

	if (isAddressableKind(targetKind)) {
		const filters: AuctionScopeTagFilter[] = []
		if (coordinates.length > 0) filters.push({ tagName: '#a', values: coordinates })
		if (coordinates.length > 0) filters.push({ tagName: '#A', values: coordinates })
		return filters
	}

	return eventIds.length > 0 ? [{ tagName: '#E', values: eventIds }] : []
}

/**
 * The filters that find a lot's 30311 live activity: `#d` = the derived activity `d`, which the
 * producer computes from the same lot coordinate (`buildLiveActivityTags`). No `#a` clause: it
 * would name the 106-character lot coordinate, and every relay that can answer it can answer
 * `#d` too.
 */
export function liveActivityScopeFilters(auctionCoordinates: readonly string[]): AuctionScopeTagFilter[] {
	const dValues = uniqueStrings(auctionCoordinates.map(buildLiveActivityDTag))
	return dValues.length > 0 ? [{ tagName: '#d', values: dValues }] : []
}