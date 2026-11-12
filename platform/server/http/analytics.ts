/**
 * `/api/analytics` — what this instance is allowed to report.
 *
 * Owner ruling (2026-11-12): page views only, from this instance, with no PII,
 * no listing ids, no prices and no search terms. The switch is environment-only
 * so a deployment cannot turn analytics on by editing a page: both values must
 * be present, and when either is missing the endpoint answers `{enabled:false}`
 * and the client sends nothing.
 */

import type { BunRoutes } from './types'

type Env = Record<string, string | undefined>

export const ANALYTICS_CONFIG_PATH = '/api/analytics'
export const ANALYTICS_SRC_ENV = 'ANALYTICS_SCRIPT_URL'
export const ANALYTICS_WEBSITE_ENV = 'ANALYTICS_WEBSITE_ID'

export interface AnalyticsConfigResponse {
	enabled: boolean
	src?: string
	websiteId?: string
}

export function readAnalyticsConfig(env: Env = process.env): AnalyticsConfigResponse {
	const src = env[ANALYTICS_SRC_ENV]?.trim()
	const websiteId = env[ANALYTICS_WEBSITE_ENV]?.trim()
	if (!src || !websiteId) return { enabled: false }
	return { enabled: true, src, websiteId }
}

export function buildAnalyticsRoutes(env: Env = process.env): BunRoutes {
	return {
		[ANALYTICS_CONFIG_PATH]: {
			GET: () => Response.json(readAnalyticsConfig(env), { headers: { 'cache-control': 'no-store' } }),
		},
	}
}
