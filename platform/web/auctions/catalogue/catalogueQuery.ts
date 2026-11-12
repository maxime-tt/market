import { queryOptions } from '@tanstack/react-query'
import type { AuctionsState } from './protocol/client'

/**
 * The Catalogue read, over the app's own origin.
 *
 * `platform/server/http/auctionsProtocol.ts` proxies the loopback demo, so the
 * browser never needs to reach `127.0.0.1:8080` (which, in a visitor's browser,
 * is the visitor's own machine).
 *
 * Polling, not streaming: the backend exposes committed state as a document
 * (`GET /api/state`), and it publishes on a 1s block cadence. A 3s poll keeps a
 * countdown honest without holding a socket for a value that changes at most
 * once a second — and `last_consensus_time` from the document is what the UI
 * counts against, never the browser clock.
 */
export const catalogueKeys = {
	state: ['auctions-protocol', 'state'] as const,
}

export function auctionsStateQueryOptions() {
	return queryOptions({
		queryKey: catalogueKeys.state,
		queryFn: async (): Promise<AuctionsState> => {
			const response = await fetch('/api/auctions/state', { headers: { accept: 'application/json' } })
			if (!response.ok) throw new Error(`auction state read failed (${response.status})`)
			const body = (await response.json()) as { state: AuctionsState }
			return body.state
		},
		refetchInterval: 3000,
		staleTime: 1500,
	})
}
