/**
 * Listing-level analytics: which listings draw attention, which draw intent,
 * which are bought.
 *
 * Owner ruling (2026-11-12, revised): the recorded set is per-listing **views**,
 * per-listing **add-to-cart / bid intent** and per-listing **purchase**, keyed by
 * the listing's coordinate. Still excluded, by ruling:
 *
 *   - buyer pubkeys (an event names a listing, never a person);
 *   - wallet data of any kind;
 *   - free-text search terms — those stay server-side in our own search service.
 *
 * The seller appears only inside the coordinate, because that is what addresses
 * the listing; it is not an identity field for a visitor.
 *
 * **k-anonymity floor.** A listing with one view in a period is one person's
 * behaviour, not a statistic. Aggregates therefore drop any listing whose
 * total is below {@link K_ANONYMITY_FLOOR}, and the surviving counts are
 * bucketed so an exact small number cannot be read back out of a summary.
 */

import { loadAnalyticsConfig, type AnalyticsConfig } from './pageViews'

export const LISTING_EVENT_NAMES = ['listing_view', 'listing_intent', 'listing_purchase'] as const
export type ListingEventName = (typeof LISTING_EVENT_NAMES)[number]

/** Below this many events a listing is not reported at all. */
export const K_ANONYMITY_FLOOR = 5

export interface ListingEventRow {
	/** Listing coordinate, `30402:<seller pubkey>:<d>`. */
	coordinate: string
	name: ListingEventName
	/** Period bucket the row belongs to (the caller decides the bucket). */
	period: string
}

/** The payload sent to Umami. One coordinate, one event name, nothing else. */
export interface ListingEventPayload {
	type: 'event'
	payload: { website: string; name: ListingEventName; data: { coordinate: string } }
}

/** Builds the coordinate a listing event is keyed by: `30402:<seller>:<d>`. */
export function listingCoordinate(dTag: string, sellerPubkey: string): string {
	return `30402:${sellerPubkey}:${dTag}`
}

export function isListingCoordinate(value: string): boolean {
	// `30402:<64 hex>:<d>` — a `d` tag cannot contain a colon-separated pubkey,
	// but it may be long; only the first two separators are structural.
	const parts = value.split(':')
	return parts.length >= 3 && parts[0] === '30402' && /^[0-9a-f]{64}$/.test(parts[1] ?? '') && (parts[2] ?? '').length > 0
}

export function buildListingEventPayload(
	config: AnalyticsConfig,
	name: ListingEventName,
	coordinate: string,
): ListingEventPayload | null {
	if (!config.enabled || !config.src || !config.websiteId) return null
	if (!isListingCoordinate(coordinate)) return null
	return { type: 'event', payload: { website: config.websiteId, name, data: { coordinate } } }
}

/** One reported row. `count` is a bucket, never an exact small number. */
export interface ListingSummaryRow {
	coordinate: string
	name: ListingEventName
	/** `5–9`, `10–24`, `25–99`, `100+` — never a number below the floor. */
	bucket: string
	/** A representative count for sorting/aggregation (the bucket's floor). */
	count: number
}

const BUCKETS: Array<{ min: number; max: number; label: string }> = [
	{ min: K_ANONYMITY_FLOOR, max: 9, label: `${K_ANONYMITY_FLOOR}–9` },
	{ min: 10, max: 24, label: '10–24' },
	{ min: 25, max: 99, label: '25–99' },
	{ min: 100, max: Number.POSITIVE_INFINITY, label: '100+' },
]

/** The bucket a count falls in, or `null` when it is below the floor. */
export function bucketCount(count: number): { bucket: string; floor: number } | null {
	for (const bucket of BUCKETS) {
		if (count >= bucket.min && count <= bucket.max) return { bucket: bucket.label, floor: bucket.min }
	}
	return null
}

/**
 * Aggregates rows into reportable summaries. Rows below the floor disappear
 * entirely — a listing that had three views is not "3", it is absent.
 */
export function summarizeListingEvents(rows: ListingEventRow[]): ListingSummaryRow[] {
	const totals = new Map<string, number>()
	for (const row of rows) {
		const key = `${row.period}\u0000${row.coordinate}\u0000${row.name}`
		totals.set(key, (totals.get(key) ?? 0) + 1)
	}

	const summary: ListingSummaryRow[] = []
	for (const [key, count] of totals) {
		const [period, coordinate, name] = key.split('\u0000')
		const bucketed = bucketCount(count)
		if (!bucketed || !period || !coordinate || !name) continue
		summary.push({ coordinate, name: name as ListingEventName, bucket: bucketed.bucket, count: bucketed.floor })
	}
	return summary
}

export interface ListingEventRecorder {
	record(name: ListingEventName, coordinate: string): Promise<void>
}

export function createListingEventRecorder(
	config: AnalyticsConfig,
	fetchImpl: typeof fetch = fetch,
): ListingEventRecorder {
	const target = config.enabled && config.src ? `${config.src.replace(/\/+$/, '')}/api/send` : null
	return {
		async record(name, coordinate) {
			const body = buildListingEventPayload(config, name, coordinate)
			if (!body || !target) return
			try {
				await fetchImpl(target, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
					keepalive: true,
				})
			} catch {
				// Analytics never breaks a purchase, a bid or a page.
			}
		},
	}
}

let recorder: ListingEventRecorder | null = null

/** Fire-and-forget listing event; safe to call before the config has loaded. */
export function recordListingEvent(name: ListingEventName, coordinate: string): void {
	void loadAnalyticsConfig().then((config) => {
		recorder ??= createListingEventRecorder(config)
		void recorder.record(name, coordinate)
	})
}
