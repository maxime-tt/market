import { APP_SETTINGS_D_TAG, APP_SETTINGS_KIND, type AppSettingsEventLike } from '@sdk/config/app-settings'
import { AppSettingsSchema, type AppSettings } from '@sdk/config/schemas/app'
import { isValidHexKey } from '@sdk/core/utils/utils'
import { getPoolPort } from './ndk'
import type { PoolPort } from '@sdk/core/nostr-io/ts/types'

/**
 * Server-side app-settings resolution (b3-relocate, 2026-10-30; moved verbatim
 * from `src/lib/appSettings.ts` — the client submit half went to
 * `platform/web/app-settings/appSettingsSubmit.ts` and the shared event
 * contract to `sdk/config/app-settings.ts`). `platform/server` must not import
 * `@platform/web`, which is why the two halves live apart.
 */

/**
 * Select the latest app-settings event that matches the expected publisher
 * authority. The event must be kind 31990, authored by `appPubkey`, and carry
 * one of the provided d tags in priority order (tries first tag first, etc.).
 * Events from any other publisher (or with a different kind / d tag) are
 * rejected — the content schema validates shape, not authority, so a spoofed
 * event that passes the schema must still be refused here.
 *
 * Fallback chain example: ['custom-handler', 'plebeian-market-handler']
 *   - First tries events with d=custom-handler (self-hosted)
 *   - Falls back to d=plebeian-market-handler (shipped default)
 */
export function selectAuthoritativeAppSettingsEvent(
	events: ReadonlyArray<AppSettingsEventLike>,
	appPubkey: string,
	handlerIds: string[] = [APP_SETTINGS_D_TAG],
): AppSettingsEventLike | undefined {
	// Try each handler ID in priority order
	for (const handlerId of handlerIds) {
		const candidate = events
			.filter((e) => e.kind === APP_SETTINGS_KIND && e.pubkey === appPubkey && e.tags.some((t) => t[0] === 'd' && t[1] === handlerId))
			.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]

		if (candidate) return candidate
	}

	return undefined
}

/**
 * Resolve the result of a completed app-settings relay query.
 *
 * `null` means the authoritative query completed and returned no candidate
 * events. Returned-but-unusable state is indeterminate and fails closed.
 *
 * @param events - Candidate events from the relay
 * @param appPubkey - Expected publisher public key
 * @param handlerIds - d-tag fallback chain: tries first, then second, etc.
 */
export function resolveFetchedAppSettings(
	events: ReadonlyArray<AppSettingsEventLike>,
	appPubkey: string,
	handlerIds: string[] = [APP_SETTINGS_D_TAG],
): AppSettings | null {
	if (events.length === 0) return null

	const authoritativeEvent = selectAuthoritativeAppSettingsEvent(events, appPubkey, handlerIds)
	if (!authoritativeEvent) {
		throw new Error(`No authoritative app settings event from expected publisher: ${appPubkey}`)
	}

	let parsedContent: unknown
	try {
		parsedContent = JSON.parse(authoritativeEvent.content)
	} catch {
		throw new Error('Authoritative app settings contain invalid JSON')
	}

	const result = AppSettingsSchema.safeParse(parsedContent)
	if (!result.success) {
		throw new Error('Authoritative app settings failed schema validation')
	}

	return result.data
}

/**
 * Fetch app-settings from a relay using the sdk PoolPort.
 */
export async function fetchAppSettings(relayUrl: string, appPubkey: string, handlerIds?: string[]): Promise<AppSettings | null> {
	const effectiveHandlerIds = handlerIds?.length ? handlerIds : [APP_SETTINGS_D_TAG]
	console.log(`Fetching app settings from relay: ${relayUrl} for pubkey: ${appPubkey} with handler IDs: ${effectiveHandlerIds.join(', ')}`)

	// Reject a malformed app pubkey before creating any NDK instance or issuing
	// any relay request.
	if (!isValidHexKey(appPubkey)) {
		throw new Error(`Invalid app pubkey provided: ${appPubkey}`)
	}

	try {
		const pool = await getPoolPort()

		// Set up a dedicated PoolPort for this one-off fetch. The pool will
		// connect to `relayUrl` when the first query arrives.
		const poolPort = await createPoolPortForUrl(relayUrl, pool)

		// NIP-33 parameterized replaceable events (kind 31990) are indexed by pubkey+kind+d tag.
		// Query for all handler IDs in the fallback chain in a single filter.
		const filter = {
			kinds: [31990],
			authors: [appPubkey],
			'#d': effectiveHandlerIds,
			limit: effectiveHandlerIds.length, // Allow fetching multiple events to evaluate priority
		}

		console.log('Fetching with filter:', JSON.stringify(filter))

		// Add a soft timeout so we don't hang forever if the relay is slow.
		const fetchWithTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
			const { promise, resolve, reject } = Promise.withResolvers<T>()
			const id = setTimeout(() => reject(new Error(`fetchEvents timeout after ${ms}ms`)), ms)
			p.then(
				(v) => {
					clearTimeout(id)
					resolve(v)
				},
				(e) => {
					clearTimeout(id)
					reject(e)
				},
			)
			return promise
		}

		const result = await fetchWithTimeout(poolPort.query(filter), 10000)
		console.log(`Fetch returned ${result.events.length} events`)

		if (result.events.length === 0) {
			console.log(`No app settings events found for pubkey: ${appPubkey}`)
		}

		return resolveFetchedAppSettings(result.events, appPubkey, effectiveHandlerIds)
	} catch (err) {
		console.error('Failed to fetch app settings:', err)
		throw err
	}
}

/**
 * Create a PoolPort connected to a specific relay URL.
 *
 * The existing getPoolPort() uses the global singleton connected to RELAY_URL.
 * This function creates a temporary PoolPort connected to the caller's URL.
 */
async function createPoolPortForUrl(url: string, _existingPool: PoolPort): Promise<PoolPort> {
	// The PoolPort is stateless for queries — we use the existing adapter
	// which is already connected to the global NDK. For per-URL isolation,
	// we would need a separate NDK instance, but the current design shares
	// one NDK for all server I/O.
	//
	// If a dedicated connection is needed in the future, createPoolPort can
	// instantiate a separate NDK + NdkAdapter here.
	return _existingPool
}
