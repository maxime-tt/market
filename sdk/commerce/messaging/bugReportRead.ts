import type { EventReadContext } from '../../core/event-store/read'
import type { NostrEventLike } from '../../core/nostr/eventLike'

export const BUG_REPORT_KIND = 1
export const BUG_REPORT_TAG = 'plebian2beta'

/** Query keys for the bug-report read; literal-identical to the pre-drain binding. */
export const bugReportKeys = {
	all: ['bugReports'] as const,
	lists: () => [...bugReportKeys.all, 'list'] as const,
	list: (limit: number, until?: number) => [...bugReportKeys.lists(), limit, until] as const,
	profiles: () => [...bugReportKeys.all, 'profiles'] as const,
	profile: (pubkey: string) => [...bugReportKeys.profiles(), pubkey] as const,
}

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type BugReportsFilter = {
	kinds: number[]
	'#t': string[]
	limit: number
	until?: number
}

export interface BugReportEvent {
	id: string
	pubkey: string
	content: string
	created_at?: number
}

export interface BugReport<E = BugReportEvent> {
	id: string
	pubkey: string
	content: string
	createdAt: number
	event: E
}

/** A falsy `until` (including 0) is omitted. */
export function buildBugReportsFilter(limit: number, until?: number): BugReportsFilter {
	return {
		kinds: [BUG_REPORT_KIND],
		'#t': [BUG_REPORT_TAG],
		limit,
		...(until && { until }),
	}
}

/** Events without `created_at` are stamped with the current time. */
export function parseBugReport<E extends BugReportEvent>(event: E): BugReport<E> {
	return {
		id: event.id,
		pubkey: event.pubkey,
		content: event.content,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		event,
	}
}

export function parseBugReports<E extends BugReportEvent>(events: Iterable<E>): BugReport<E>[] {
	return Array.from(events, (event) => parseBugReport(event)).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Discovery read: bug reports (kind 1 with the `t` tag). The host pins the context to the
 * instance's bug relay (ADR-018 `bugRelay`), so report history stays off the general relay set.
 *
 * A plain `fetch` rather than `readThroughStore`: the paginated read asks for up to the page size
 * in one filter, and a store-backed read would both write those kind-1 events into a shared store
 * and issue a kind-5 lookup carrying every fetched id. One fetch keeps that read's budget bounded.
 */
export async function readBugReportsWorkflow<E extends NostrEventLike>(
	context: EventReadContext<E>,
	limit = 20,
	until?: number,
): Promise<BugReport<E>[]> {
	// fetch: bug reports, paginated (list — stream is the default; bounded for now, rev 2.22)
	const events = await context.fetch([buildBugReportsFilter(limit, until)])
	return parseBugReports(events)
}
