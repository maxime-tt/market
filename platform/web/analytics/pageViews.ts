/**
 * Page views, and nothing else.
 *
 * Owner ruling (2026-11-12): analytics may report **route-level page views**
 * from this instance and nothing more. No pubkeys, no listing ids, no prices,
 * no search terms. Search demand is measured inside our own search service,
 * server-side, because a client script cannot see a term that travels in a POST
 * body — and because a term is exactly the kind of thing that must not leave.
 *
 * The payload is therefore one path, with the query string removed. `?q=art`
 * is a search term; `?p=<listing>` is a listing id; both are PII-adjacent and
 * both are dropped before anything is sent.
 *
 * Disabled means silent: with no configuration the reporter does nothing and
 * renders nothing. There is no built-in fallback id, no sample number, and no
 * placeholder count anywhere in this module — a made-up figure is worse than
 * no figure.
 */

/** The route config the server advertises. Unset in the environment means off. */
export interface AnalyticsConfig {
	enabled: boolean
	/** Umami script origin, e.g. `https://analytics.example.org`. */
	src?: string
	/** The site id the instance reports as. */
	websiteId?: string
}

const ANALYTICS_CONFIG_PATH = '/api/analytics'

/** The one field a page view is allowed to carry. Query and hash are removed. */
export function toPageViewPath(url: string): string {
	const withoutHash = url.split('#')[0] ?? ''
	const pathname = withoutHash.split('?')[0] ?? ''
	return pathname.length > 0 ? pathname : '/'
}

export interface PageViewPayload {
	/** Umami's event shape: a pageview with a bare path. */
	type: 'pageview'
	payload: { website: string; url: string }
}

/** Builds the payload, or `null` when analytics is off. Pure, so it is testable. */
export function buildPageViewPayload(config: AnalyticsConfig, url: string): PageViewPayload | null {
	if (!config.enabled || !config.src || !config.websiteId) return null
	return { type: 'pageview', payload: { website: config.websiteId, url: toPageViewPath(url) } }
}

export interface PageViewReporter {
	/** Records one navigation. Awaitable so tests can settle it. */
	record(url: string): Promise<void>
}

export function createPageViewReporter(
	config: AnalyticsConfig,
	fetchImpl: typeof fetch = fetch,
): PageViewReporter {
	const target = config.enabled && config.src ? `${config.src.replace(/\/+$/, '')}/api/send` : null
	return {
		async record(url: string) {
			const body = buildPageViewPayload(config, url)
			if (!body || !target) return
			try {
				await fetchImpl(target, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
					keepalive: true,
				})
			} catch {
				// Analytics is never allowed to break a navigation.
			}
		},
	}
}

let cached: Promise<AnalyticsConfig> | null = null

/** Reads the instance's own switch once; a failure means off, never a guess. */
export function loadAnalyticsConfig(fetchImpl: typeof fetch = fetch): Promise<AnalyticsConfig> {
	if (!cached) {
		cached = fetchImpl(ANALYTICS_CONFIG_PATH)
			.then(async (response) => (response.ok ? ((await response.json()) as AnalyticsConfig) : { enabled: false }))
			.catch(() => ({ enabled: false }))
	}
	return cached
}
