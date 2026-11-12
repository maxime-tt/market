/**
 * `AuctionsProtocolPorts` over HTTP, for a browser.
 *
 * The relay binds the backend's loopback and is in memory, so a browser cannot
 * reach it. The backend's HTTP door (`POST /api/event`) takes the BARE signed
 * event and commits it without any relay listener — measured on the running
 * demo, where a bid posted over HTTP landed in `state.bids` with no observer
 * connected. `subscribe` therefore only needs to prove the transport, not to
 * hold a socket open; holding one would be theatre.
 *
 * Paths are same-origin: the app's `platform/server/http/auctionsProtocol.ts`
 * forwards them to the backend. Pass `base` to talk to the backend directly
 * (tests, scripts).
 */

import type {
	AuctionsConfig,
	AuctionsProtocolPorts,
	AuctionsState,
	SignedEvent,
} from './client'

/** Mirrors `platform/server/http/auctionsProtocol.ts`; kept local so the browser never imports server code. */
const STATE_PATH = '/state'
const CONFIG_PATH = '/config'
const EVENT_PATH = '/event'

export interface HttpPortsOptions {
	/** Origin to prefix every path with. Empty means same-origin (the browser case). */
	base?: string
	/**
	 * Where the three endpoints live. The app proxies them under
	 * `/api/auctions`; the backend itself serves `/api/state`, `/api/config`,
	 * `/api/event`. Tests and scripts point straight at the backend.
	 */
	apiBase?: string
}

export function createHttpPorts(options: HttpPortsOptions = {}): Omit<AuctionsProtocolPorts, 'sign'> {
	const base = options.base ?? ''
	const apiBase = options.apiBase ?? '/api/auctions'
	const url = (path: string): string => `${base}${apiBase}${path}`

	const readJson = async <T>(path: string): Promise<T> => {
		const response = await fetch(url(path))
		if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`)
		return (await response.json()) as T
	}

	return {
		// `fetch`, not a stream: one entity (the committed state document) read
		// once per action, per the read-seam doctrine's single-entity case.
		getState: () => readJson<AuctionsState>(STATE_PATH),
		getConfig: () => readJson<AuctionsConfig>(CONFIG_PATH),

		async subscribe() {
			// The HTTP door commits without a listener; a successful state read is
			// the proof that the transport works before anything is published.
			await readJson<AuctionsState>(STATE_PATH)
		},

		async publish(event: SignedEvent) {
			const response = await fetch(url(EVENT_PATH), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(event),
			})
			const body = await response.text()
			if (!response.ok) throw new Error(`publish -> ${response.status} ${body}`)
			// The door answers 200 with `{check_code, deliver_code, height, tx_hash}`.
			// A non-zero `check_code` is the chain REFUSING the event (e.g. "seller
			// payment key is invalid"), so a 200 alone is not acceptance — measured
			// on the demo, where such a body looked like success.
			let receipt: { check_code?: number; deliver_code?: number; tx_hash?: string } = {}
			try {
				receipt = JSON.parse(body) as typeof receipt
			} catch {
				throw new Error(`publish -> unreadable receipt: ${body.slice(0, 200)}`)
			}
			if (receipt.check_code !== 0) {
				throw new Error(`publish rejected by consensus: check_code=${receipt.check_code} ${body.slice(0, 200)}`)
			}
		},

		async post(path: string, body: unknown) {
			// `path` arrives already absolute (`/api/demo/reservation`): the protocol
			// client names its own route, so only the origin is prefixed here.
			const response = await fetch(`${base}${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			})
			if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`)
			return response.json()
		},
	}
}
