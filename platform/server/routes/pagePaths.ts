import { isValidRouteName } from '@sdk/config/routeNames'

/**
 * Per-page identity, the page-path grammar, and the one *opt-in* series
 * derivation — R1/R2/R3's path layer (`ruling-d8-multipage-and-lists.md` §2).
 *
 * This module is pure: no I/O, no store, no network. It imports exactly one
 * thing — the name grammar — and it is imported by both the server's routing
 * validator and the browser's publish path, so the grammar has one home
 * (`sdk/config/routeNames.ts`) and one copy of the rules that specialise it.
 *
 * The publishing side reaches this module from `platform/web/storefront/
 * storefrontPublish.ts`. That is precedent-consistent (the client already
 * imports runtime modules under `@platform/server`, e.g. `entry.tsx` imports
 * `@platform/server/routes/routeTable`), and it adds **no server-only runtime
 * dependency** to the client bundle: this file's whole import graph is
 * `@sdk/config/routeNames.ts`, which is explicitly read by the browser bundle
 * and the Bun server alike (`routeNames.ts:1-11`).
 */

/**
 * The tag a page declares series membership with.
 *
 * Single-letter (`t`) so a relay can index it (`#t` filters). It is the same
 * tag `appEvents.ts` already reads at ingest and `pageStore.put` records in the
 * series index — one spelling, end to end.
 */
export const PAGE_SERIES_TAG = 't'

/**
 * A page's `d` is the path segment it is reachable at, so it obeys the route
 * name grammar — `NAME_PATTERN` verbatim, imported rather than re-written.
 */
export function isValidPagePath(value: unknown): value is string {
	return isValidRouteName(value)
}

/** A series key is a route name too: it is `/featured`'s name. */
export function isValidSeriesTag(value: unknown): value is string {
	return isValidRouteName(value)
}

/**
 * The shape of a dated page name: `<series>-<dd>-<mm>-<yyyy>`.
 *
 * The date part is deliberately fixed (`dd-mm-yyyy`), **not** a general
 * `-<date>` suffix: a free-form suffix would make every dated page the member
 * of some series and let `/x` collide with `/x-13-11-2026` by accident. The
 * prefix is captured greedily so the *last* three dash-groups are the date.
 */
const DATED_PAGE_PATTERN = /^(.+)-(\d{2}-\d{2}-\d{4})$/

/**
 * Opt-in derivation: the series a dated page name belongs to, or `null`.
 *
 *   `featured-13-11-2026` → `'featured'`
 *   `featured`             → `null` (no dated suffix)
 *   `ab-13-11-2026`        → `null` (`ab` is not a valid series tag)
 *
 * It is **never applied silently**: the publish path does not call it, because
 * deriving a page's `t` tags from its `d` would make a naming convention join a
 * series without the author saying so (`IMPLEMENTATION-PLAN.md` §6, D15). This
 * function exists so a caller that *wants* the convention can ask for it.
 */
export function seriesForPath(dTag: string): string | null {
	const match = DATED_PAGE_PATTERN.exec(dTag)
	if (!match) return null
	const prefix = match[1]
	return isValidSeriesTag(prefix) ? prefix : null
}

/**
 * The series tags an event's tag list declares, deduped, invalid and empty
 * entries dropped. The publish side needs the deduped list to build the page's
 * own `t` tags without ever emitting a duplicate.
 */
export function readSeriesTags(tags: readonly string[][]): string[] {
	const series: string[] = []
	const seen = new Set<string>()
	for (const tag of tags) {
		if (tag[0] !== PAGE_SERIES_TAG) continue
		const value = tag[1]
		if (!isValidSeriesTag(value) || seen.has(value)) continue
		seen.add(value)
		series.push(value)
	}
	return series
}
