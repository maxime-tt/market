/**
 * `scripts/auctions/liveArenaHarness.ts` — the shared plumbing every live
 * auction e2e drives the app's own paths through.
 *
 * These helpers were born in `live-funded-bid.test.ts` and are lifted here so a
 * second live walk (the Phase E lifecycle) reuses the same relay/chain/mint
 * plumbing rather than growing a second harness: one relay publisher, one
 * committed-state poller, one escrow-send seam, one wallet-tracking seam, one
 * receipt poller. `live-funded-bid.test.ts` keeps its own private copies
 * (unchanged) so this extraction cannot move that suite's numbers.
 *
 * Nothing here starts infrastructure. The chain gateway, the relay and the mint
 * must already be running; a caller passes their addresses in.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Proof, P2PKOptions } from '@cashu/cashu-ts'
import type { Event } from '@sdk/core/nostr-io'
import type { ArenaBidPublisher } from '@platform/web/auctions/relay/arenaBidPublish'
import type { ArenaEscrowSendManager } from '@platform/web/auctions/relay/arenaBidEscrow'
import { checkProofStateBatch } from '@sdk/commerce/payments/cashu/nut7'
import { hashToCurveHexFromString } from '@sdk/commerce/payments/cashu/hashToCurve'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export const nowSec = () => Math.floor(Date.now() / 1000)
export const xOnly = (compressed: string) => compressed.toLowerCase().slice(2)

// =========================================================================
// The relay publisher — the shape both publish paths expect
// =========================================================================

/** A relay publisher over a real socket, in the shape both publish paths expect. */
export function nostrPublisher(pool: SimplePool, relay: string): ArenaBidPublisher {
	return {
		publish: async (event: Event) => {
			try {
				await Promise.any(pool.publish([relay], event as unknown as Parameters<SimplePool['publish']>[1]))
				return { id: event.id, acks: [{ url: relay, accepted: true }] }
			} catch (error) {
				return {
					id: event.id,
					acks: [{ url: relay, accepted: false, message: error instanceof Error ? error.message : String(error) }],
				}
			}
		},
	}
}

// =========================================================================
// The chain's committed state
// =========================================================================

export interface ChainState {
	height: number
	time: number
	params: { groupKey?: string; mintUrl?: string; keysetId?: string }
	auctions: Record<string, Record<string, unknown>>
	bids: Record<string, Record<string, unknown>>
	rejections?: { height: number; time: number; kind: number; pubkey: string; event: string; reason: string }[] | null
}

export async function fetchChainState(url: string): Promise<ChainState> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`chain state answered ${response.status} at ${url}`)
	return (await response.json()) as ChainState
}

/**
 * Poll the chain's committed state on a **bounded** deadline. Returns the number
 * of polls it took, or throws naming the deadline it gave up at.
 */
export async function pollChainUntil(
	url: string,
	found: (state: ChainState) => boolean,
	deadlineMs: number,
	what: string,
): Promise<{ polls: number; state: ChainState }> {
	const deadline = Date.now() + deadlineMs
	let polls = 0
	let last: ChainState | null = null
	while (Date.now() < deadline) {
		last = await fetchChainState(url)
		polls += 1
		if (found(last)) return { polls, state: last }
		await sleep(1000)
	}
	throw new Error(
		`the chain did not commit ${what} within ${deadlineMs} ms (${polls} polls, last height ${last?.height ?? 'unknown'})`,
	)
}

// =========================================================================
// The escrow send seam — bound to a cashu-ts wallet, or to a tracked source
// =========================================================================

/** The escrow send port `arenaBidEscrow` declares, bound to a live cashu-ts wallet. */
export function escrowManagerOverCashu(wallet: import('@cashu/cashu-ts').Wallet, proofs: Proof[]): ArenaEscrowSendManager {
	let pending: { amount: number; options: P2PKOptions } | null = null
	return {
		mint: { addMint: async () => ({}) },
		ops: {
			send: {
				init: async (_mintUrl, amount, request) => {
					pending = { amount, options: request.methodData.options }
					return { id: 'escrow' }
				},
				prepare: async (operation) => operation,
				execute: async () => {
					if (pending === null) throw new Error('the escrow send was not initialized')
					const { amount, options } = pending
					const { send } = await wallet.send(amount, proofs, {}, { send: { type: 'p2pk', options } })
					pending = null
					return { token: { proofs: send } }
				},
			},
		},
	}
}

/** A wallet source over a cashu-ts wallet and its own proof list — the shape the rails read. */
export function trackedWallet(mintUrl: string, initial: Proof[]) {
	let held = [...initial]
	return {
		state: {
			dump: () => ({ proofs: [{ mint: mintUrl, proofs: held }] }),
			getProofs: (filter: { mint: string }) => (filter.mint === mintUrl ? held : []),
			update: async (update: { store: Proof[]; mint: string; destroy?: Proof[] }) => {
				const destroyed = new Set((update.destroy ?? []).map((proof) => proof.secret))
				held = [...held.filter((proof) => !destroyed.has(proof.secret)), ...update.store]
			},
		},
		getProofs: () => held,
		balance: () => held.reduce((sum, proof) => sum + proof.amount.toNumber(), 0),
	}
}

/** The escrow send port, bound to a tracked source so the change lands back in it. */
export function escrowManagerForSource(
	cashuWallet: import('@cashu/cashu-ts').Wallet,
	source: ReturnType<typeof trackedWallet>,
	mintUrl: string,
): ArenaEscrowSendManager {
	let pending: { amount: number; options: P2PKOptions } | null = null
	return {
		mint: { addMint: async () => ({}) },
		ops: {
			send: {
				init: async (_mintUrl, amount, request) => {
					pending = { amount, options: request.methodData.options }
					return { id: 'escrow' }
				},
				prepare: async (operation) => operation,
				execute: async () => {
					if (pending === null) throw new Error('the escrow send was not initialized')
					const { amount, options } = pending
					const held = source.getProofs()
					const { send, keep } = await cashuWallet.send(amount, held, {}, { send: { type: 'p2pk', options } })
					await source.state.update({ store: keep, mint: mintUrl, destroy: held })
					pending = null
					return { token: { proofs: send } }
				},
			},
		},
	}
}

// =========================================================================
// A minimal localStorage — so the claim's real user-scoped persistence runs
// =========================================================================

/**
 * A minimal `localStorage` so the claim's real user-scoped persistence
 * (`loadUserData`/`saveUserData`) runs under bun/node exactly as it does in the
 * browser. The record surviving between two claim runs IS the point.
 */
export function installLocalStorageShim(): void {
	const store = new Map<string, string>()
	;(globalThis as unknown as { localStorage: unknown }).localStorage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size
		},
	}
}

// =========================================================================
// The relay reads — receipts by bid id, and the mint's own proof states
// =========================================================================

/** One raw relay event, in the shape the receipt/verdict readers take. */
export interface RawRelayEvent {
	id: string
	pubkey: string
	kind: number
	created_at: number
	tags: string[][]
	content: string
	sig: string
}

/** Poll the relay for the receipt events whose `bid` tag is `bidId`, on a bounded deadline. */
export async function pollRelayForBidReceipts(
	pool: SimplePool,
	relay: string,
	kind: number,
	bidId: string,
	deadlineMs: number,
): Promise<{ polls: number; events: RawRelayEvent[] }> {
	const deadline = Date.now() + deadlineMs
	let polls = 0
	while (Date.now() < deadline) {
		const raw = await pool.querySync([relay], { kinds: [kind], limit: 100 }, { maxWait: 6000 })
		polls += 1
		const matches = raw.filter((event) => event.tags.some((tag) => tag[0] === 'bid' && tag[1] === bidId))
		if (matches.length > 0) {
			return {
				polls,
				events: matches.map((event) => ({
					id: event.id,
					pubkey: event.pubkey,
					kind: event.kind,
					created_at: event.created_at,
					tags: event.tags as string[][],
					content: event.content,
					sig: event.sig ?? '',
				})),
			}
		}
		await sleep(1000)
	}
	throw new Error(`no kind-${kind} receipt for bid ${bidId} arrived on ${relay} within ${deadlineMs} ms (${polls} polls)`)
}

/**
 * Ask the mint (NUT-07) for the state of these escrow proofs. `allSpent` is the
 * wire fact the walk needs: the committee's swap consumed the lock, so the
 * escrow really moved at the mint, not merely in the chain's bookkeeping.
 */
export async function checkProofsSpent(
	mintUrl: string,
	proofs: readonly { secret: string }[],
): Promise<{ ys: string[]; states: Map<string, string>; allSpent: boolean }> {
	const ys = proofs.map((proof) => hashToCurveHexFromString(proof.secret))
	const states = await checkProofStateBatch(mintUrl, ys)
	const allSpent = ys.every((y) => states.get(y.toLowerCase()) === 'spent')
	return { ys, states, allSpent }
}

/**
 * Whether the chain is advancing, read from the wire: fresh kind-1447
 * commitments across several distinct anchored heights. This is the one chain
 * signal the three-state bid diagnosis needs to tell "the chain did not accept
 * this bid" from "the chain is stuck".
 */
export async function readChainAdvancing(
	pool: SimplePool,
	relay: string,
	options: { now: number; freshWithinSec?: number; minDistinctHeights?: number; limit?: number } = { now: nowSec() },
): Promise<{ advancing: boolean; heights: number[]; newestTime: number | null; events: number }> {
	const raw = await pool.querySync([relay], { kinds: [1447], limit: options.limit ?? 80 }, { maxWait: 8000 })
	const heights = new Set<number>()
	let newestTime: number | null = null
	for (const event of raw) {
		const heightTag = event.tags.find((tag) => tag[0] === 'height')?.[1]
		if (heightTag !== undefined) {
			const parsed = Number(heightTag)
			if (Number.isInteger(parsed) && parsed > 0) heights.add(parsed)
		}
		if (newestTime === null || event.created_at > newestTime) newestTime = event.created_at
	}
	const fresh = options.freshWithinSec ?? 120
	const age = newestTime === null ? null : options.now - newestTime
	const advancing =
		heights.size >= (options.minDistinctHeights ?? 2) && age !== null && age >= 0 && age <= fresh
	return { advancing, heights: [...heights].sort((a, b) => a - b), newestTime, events: raw.length }
}
