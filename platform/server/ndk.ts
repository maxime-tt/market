import NDK from '@nostr-dev-kit/ndk'
import { APP_PRIVATE_KEY, RELAY_URL } from './runtime'
import { NdkAdapter } from './ndk-adapter'
import type { PoolPort } from '@sdk/core/nostr-io/ts/types'

/**
 * Module-level singletons for the issuer's NDK.
 *
 * The issuer process owns one NDK instance pointed at the configured app
 * relay (`APP_RELAY_URL`).  The NDK is lazy — first call creates and
 * connects it.
 */

let invoiceNdk: NDK | null = null
let invoiceNdkConnectPromise: Promise<void> | null = null
let invoiceNdkAdapter: NdkAdapter | null = null

/**
 * Ensure the NDK client is connected and return it for callers that need
 * NDK-specific methods (e.g. getUser / fetchProfile in lightning.ts).
 */
export async function ensureInvoiceNdkConnected(): Promise<NDK> {
	if (!RELAY_URL) {
		throw new Error('Missing APP_RELAY_URL')
	}
	if (!invoiceNdk) {
		invoiceNdk = new NDK({ explicitRelayUrls: [RELAY_URL] })
	}
	if (!invoiceNdkConnectPromise) {
		invoiceNdkConnectPromise = invoiceNdk.connect().catch((error) => {
			invoiceNdkConnectPromise = null
			throw error
		})
	}
	await invoiceNdkConnectPromise
	return invoiceNdk
}

/**
 * Return a PoolPort backed by the NDK instance (lazy-connects if needed).
 *
 * This is the preferred access path for all I/O that does not require
 * NDK-specific methods (getUser, fetchProfile, etc.).
 */
export async function getPoolPort(): Promise<PoolPort> {
	await ensureInvoiceNdkConnected()
	if (!invoiceNdkAdapter) {
		invoiceNdkAdapter = new NdkAdapter(invoiceNdk)
	}
	return invoiceNdkAdapter
}
/**
 * Create a fresh PoolPort backed by a new NDK instance at the given
 * relay URLs.  Unlike getPoolPort(), this does NOT reuse the singleton —
 * it is used for per-URL isolation (zap relays, per-init relay).
 */
export async function createPoolPort(relayUrls: string[]): Promise<PoolPort> {
	if (relayUrls.length === 0) {
		throw new Error('createPoolPort requires at least one relay URL')
	}
	const ndk = new NDK({ explicitRelayUrls: relayUrls })
	await ndk.connect()
	return new NdkAdapter(ndk)
}
