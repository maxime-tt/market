import { getPoolPort } from './ndk'
import type { NostrEventLike } from '@sdk/core/nostr/eventLike'
import { getAppPublicKeyOrThrow } from './runtime'

/**
 * Resolve the app's Lightning identifier (lud16 / lud06) for outgoing zap
 * invoices. Source order:
 *   1. APP_LIGHTNING_ADDRESS / APP_LUD16 / APP_LN_ADDRESS / APP_LIGHTNING_IDENTIFIER env
 *   2. The app pubkey's Nostr profile (fetched, then cached for 5 min).
 */

let cachedAppLightningIdentifier: { value: string; fetchedAtMs: number } | null = null
const APP_LIGHTNING_IDENTIFIER_TTL_MS = 5 * 60 * 1000

export async function getAppLightningIdentifier(): Promise<string> {
	const envValue =
		process.env.APP_LIGHTNING_ADDRESS || process.env.APP_LUD16 || process.env.APP_LN_ADDRESS || process.env.APP_LIGHTNING_IDENTIFIER
	if (envValue && envValue.trim()) return envValue.trim()

	const now = Date.now()
	if (cachedAppLightningIdentifier && now - cachedAppLightningIdentifier.fetchedAtMs < APP_LIGHTNING_IDENTIFIER_TTL_MS) {
		return cachedAppLightningIdentifier.value
	}

	const poolPort = await getPoolPort()
	// Query kind 0 (profile) events for the app pubkey using PoolPort
	const result = await poolPort.query([{ kinds: [0], authors: [getAppPublicKeyOrThrow()] }])
	const profileEvent = result.events[0] as NostrEventLike | undefined

	if (!profileEvent || !profileEvent.content) {
		throw new Error('App does not have a Lightning Address configured (missing lud16/lud06 on app profile)')
	}

	const profile = JSON.parse(profileEvent.content)
	const identifier = profile.lud16 || profile.lud06
	if (!identifier) {
		throw new Error('App does not have a Lightning Address configured (missing lud16/lud06 on app profile)')
	}

	cachedAppLightningIdentifier = { value: identifier, fetchedAtMs: now }
	return identifier
}
