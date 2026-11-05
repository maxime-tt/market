import { RelayPool } from 'applesauce-relay'
import { RELAY_URL } from './runtime'
import { RelayPoolAdapter } from './ndk-adapter'
import type { PoolPort } from '@sdk/core/nostr-io/ts/types'

/**
 * Module-level singleton for the issuer's RelayPool.
 *
 * The issuer process owns one RelayPool pointed at the configured app
 * relay (`RELAY_URL`).  The pool is lazy — first call creates and
 * connects it.
 */

let invoicePool: RelayPool | null = null
let invoicePoolConnectPromise: Promise<RelayPool> | null = null
let invoicePoolAdapter: RelayPoolAdapter | null = null
let invoicePoolRelayUrl: string | null = null

/**
 * Ensure the RelayPool is connected and return it for callers that need
 * applesauce-relay-specific methods (e.g. getUser / fetchProfile in lightning.ts).
 */
export async function ensureInvoicePoolConnected(): Promise<RelayPool> {
	if (!RELAY_URL) {
		throw new Error('Missing RELAY_URL')
	}
	if (!invoicePool) {
		invoicePool = new RelayPool()
		invoicePoolRelayUrl = RELAY_URL
		invoicePool.relay(RELAY_URL) // connects lazily on first use
	}
	if (!invoicePoolConnectPromise) {
		invoicePoolConnectPromise = Promise.resolve()
			.then(async () => {
				// Trigger relay connection by accessing it
				await invoicePool!.relay(RELAY_URL!)
				return invoicePool!
			})
			.catch((error) => {
				invoicePoolConnectPromise = null
				throw error
			})
	}
	await invoicePoolConnectPromise
	return invoicePool
}

/**
 * Return a PoolPort backed by the RelayPool instance (lazy-connects if needed).
 *
 * This is the preferred access path for all I/O that does not require
 * applesauce-relay-specific methods (getUser, fetchProfile, etc.).
 */
export async function getPoolPort(): Promise<PoolPort> {
	await ensureInvoicePoolConnected()
	if (!invoicePoolAdapter) {
		invoicePoolAdapter = new RelayPoolAdapter(invoicePool!)
	}
	return invoicePoolAdapter
}

/**
 * Create a fresh PoolPort backed by a new RelayPool at the given
 * relay URLs.  Unlike getPoolPort(), this does NOT reuse the singleton —
 * it is used for per-URL isolation (zap relays, per-init relay).
 */
export async function createPoolPort(relayUrls: string[]): Promise<PoolPort> {
	if (relayUrls.length === 0) {
		throw new Error('createPoolPort requires at least one relay URL')
	}
	const pool = new RelayPool()
	// Pre-connect all relays
	for (const url of relayUrls) {
		pool.relay(url)
	}
	return new RelayPoolAdapter(pool)
}
