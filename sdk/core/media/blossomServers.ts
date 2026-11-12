/**
 * The Blossom server list and its availability probes — the protocol half of the
 * media capability moved out of `src/lib/blossom.ts` (Wave G-a1.1).
 *
 * The list is the shipped tier-3 default: every entry names third-party
 * infrastructure the app happens to prefer, not a marketplace noun, so it lives
 * in `sdk/core/` per the AGENTS.md placement table (`D3.h2.media` precedent).
 * Instance-configured server lists (the `blossom_server` setting) are a future
 * `sdk/config` concern; the platform host re-exports this list as `BLOSSOM_SERVERS`
 * so the legacy consumers keep their names.
 */

/** A Blossom server as the shipped list knows it. */
export type BlossomServer = {
	name: string
	url: string
	plan: 'free' | 'paid' | 'public'
}

/** The six shipped default Blossom servers (the old `BLOSSOM_SERVERS`). */
export const DEFAULT_BLOSSOM_SERVERS: BlossomServer[] = [
	{ name: 'nostrcheck.me', url: 'https://nostrcheck.me', plan: 'public' },
	{ name: 'Primal', url: 'https://blossom.primal.net', plan: 'public' },
	{ name: 'Blossom Band', url: 'https://blossom.band', plan: 'paid' },
	{ name: '24242', url: 'https://24242.io', plan: 'public' },
	{ name: 'f7z Blossom', url: 'https://blossom.f7z.io', plan: 'public' },
	{ name: 'nostr.download', url: 'https://nostr.download', plan: 'public' },
]

/**
 * Check if a blossom server is available
 * @param serverUrl - Server URL to check
 * @param timeoutMs - Timeout in milliseconds
 * @returns True if server is available
 */
export async function checkBlossomServerAvailability(serverUrl: string, timeoutMs = 3000): Promise<boolean> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const normalizedUrl = serverUrl.replace(/\/$/, '')
		const response = await fetch(normalizedUrl, {
			method: 'HEAD',
			signal: controller.signal,
		})
		return response.ok
	} catch {
		return false
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Get available blossom servers by checking their availability
 * @param timeoutMs - Timeout for each server check
 * @returns Array of available server URLs
 */
export async function getAvailableBlossomServers(timeoutMs = 3000): Promise<BlossomServer[]> {
	const availabilityChecks = DEFAULT_BLOSSOM_SERVERS.map(async (server) => {
		const isAvailable = await checkBlossomServerAvailability(server.url, timeoutMs)
		return isAvailable ? server : null
	})

	const results = await Promise.all(availabilityChecks)
	return results.filter((server): server is BlossomServer => server !== null)
}
