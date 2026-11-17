import type { SeriesMember } from './pageStore'
import type { SeriesTarget } from './routeFile'

/**
 * R3's resolution: a series path answers the **newest** page in the series.
 *
 * This module is the one and only caller of `pageStore.seriesMembers()` for
 * resolution. It sits *between* the routing file and the page store on purpose:
 * `resolve()` is pure and does no I/O, so it cannot walk the index itself, and
 * the page store is keyed by `(author, d)` and knows nothing about paths or
 * targets. `series.ts` is where the two meet, which is exactly the layering
 * `IMPLEMENTATION-PLAN.md:623` describes.
 *
 * It reads the newest-first list the store already maintains
 * (`pageStore.ts` sorts `createdAt` desc, then `eventId` desc) and returns the
 * first member whose page is still present. "Still present" is `store.has`,
 * which is one read — a member whose file is gone is skipped, not scanned for.
 *
 * The honest limit, restated: "newest" is the author-asserted `createdAt`. The
 * author can backdate, but the walk is scoped to `(series, target.author)`, so
 * that is a self-attack (`ARCHITECTURE.md` §5.3, recorded as accept).
 */

/** The slice of the page store this needs — so it is injectable and testable. */
export interface SeriesIndex {
	seriesMembers(series: string, author: string): SeriesMember[]
}

export type SeriesResolution =
	/** The newest present member. */
	| { outcome: 'found'; author: string; d: string }
	/** The series has no present member at all — an honest "empty", not an error. */
	| { outcome: 'empty' }

/**
 * Resolves a series target to its newest *present* member.
 *
 * The walk is scoped to `target.author` — never to "whoever tagged this
 * series". A page published by someone else with `t=featured` is a different
 * `(series, author)` key and is never consulted here.
 */
export function resolveSeries(
	target: SeriesTarget,
	index: SeriesIndex,
	store: { has(author: string, d: string): boolean },
): SeriesResolution {
	for (const member of index.seriesMembers(target.series, target.author)) {
		if (store.has(target.author, member.d)) return { outcome: 'found', author: target.author, d: member.d }
	}
	return { outcome: 'empty' }
}
