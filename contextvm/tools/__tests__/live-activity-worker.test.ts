import { describe, test, expect, beforeEach } from 'bun:test'
import type { Filter, NostrEvent } from 'nostr-tools'
import {
	countParticipants,
	fetchRecentArenaCreates,
	getIntervalMs,
	getLookbackDays,
	pollAndUpdateLiveActivities,
	resetDedupMap,
	getDedupMap,
	type LiveActivityWorkerContext,
} from '../live-activity-worker'
import { buildLiveActivityDTag } from '@sdk/core/nostr/nip53'

// The live auction family the worker now targets (the arena 1440 create kind).
const AUCTION_KIND = 1440
const ISSUER = 'f'.repeat(64)
const SELLER_A = 'a'.repeat(64)
const SELLER_B = 'b'.repeat(64)

/** A relay-pool stub: it answers every subscription with the handler's events, then EOSE. */
function stubPool(handler: (filters: Filter[]) => NostrEvent[]): LiveActivityWorkerContext['relayPool'] {
	return {
		subscribe: (filters: Filter[], onEvent: (event: NostrEvent) => void, onEose: () => void) => {
			for (const event of handler(filters)) onEvent(event)
			onEose()
			return Promise.resolve(() => {})
		},
		getRelayUrls: () => [],
	} as unknown as LiveActivityWorkerContext['relayPool']
}

function workerContext(relayPool: LiveActivityWorkerContext['relayPool']): LiveActivityWorkerContext {
	return { relayPool, signer: {} as never, issuerPubkey: ISSUER }
}

function arenaCreateEvent(overrides: Partial<NostrEvent> & { d?: string; content?: string } = {}): NostrEvent {
	const { d = 'lot-1', content = JSON.stringify({ auction_id: d, title: 'Lot', durationSec: 3600 }), ...rest } = overrides
	return {
		id: 'create-1',
		pubkey: SELLER_A,
		kind: AUCTION_KIND,
		created_at: Math.floor(Date.now() / 1000) - 60,
		sig: 'sig',
		tags: [['d', d]],
		content,
		...rest,
	} as NostrEvent
}

describe('live-activity-worker', () => {
	beforeEach(() => {
		resetDedupMap()
	})

	describe('countParticipants', () => {
		test('counts unique authors as total', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 20 },
				{ pubkey: 'user1', created_at: now - 30 },
			]
			const result = countParticipants(messages, now)
			expect(result.total).toBe(2)
		})

		test('counts recent authors as current (within 5min window)', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 100 },
				{ pubkey: 'user3', created_at: now - 200 },
			]
			const result = countParticipants(messages, now)
			expect(result.current).toBe(3)
		})

		test('excludes participants outside 5min window from current', () => {
			const now = 1000000
			const messages = [
				{ pubkey: 'user1', created_at: now - 10 },
				{ pubkey: 'user2', created_at: now - 600 },
			]
			const result = countParticipants(messages, now)
			expect(result.current).toBe(1)
			expect(result.total).toBe(2)
		})

		test('handles empty message list', () => {
			const result = countParticipants([], 1000000)
			expect(result.current).toBe(0)
			expect(result.total).toBe(0)
		})
	})

	describe('dedup key safety', () => {
		test('different sellers with same d tag do not collide', () => {
			const dedup = getDedupMap()
			const dTag = 'my-auction'

			const keyA = `${SELLER_A}:${dTag}`
			const keyB = `${SELLER_B}:${dTag}`

			dedup.set(keyA, {
				status: 'live' as const,
				currentParticipants: 5,
				totalParticipants: 10,
				updatedAt: 1000,
			})

			expect(dedup.has(keyA)).toBe(true)
			expect(dedup.has(keyB)).toBe(false)
		})
	})

	describe('buildLiveActivityDTag collision prevention', () => {
		test('same d tag from different sellers produces different activity d tags', () => {
			const coordA = `${AUCTION_KIND}:${SELLER_A}:my-auction`
			const coordB = `${AUCTION_KIND}:${SELLER_B}:my-auction`

			const dTagA = buildLiveActivityDTag(coordA)
			const dTagB = buildLiveActivityDTag(coordB)

			expect(dTagA).not.toBe(dTagB)
		})
	})

	describe('configuration', () => {
		test('getIntervalMs returns default when env not set', () => {
			const orig = process.env.LIVE_ACTIVITY_INTERVAL_MS
			delete process.env.LIVE_ACTIVITY_INTERVAL_MS
			expect(getIntervalMs()).toBe(60_000)
			if (orig) process.env.LIVE_ACTIVITY_INTERVAL_MS = orig
		})

		test('getIntervalMs returns custom value when env set', () => {
			const orig = process.env.LIVE_ACTIVITY_INTERVAL_MS
			process.env.LIVE_ACTIVITY_INTERVAL_MS = '30000'
			expect(getIntervalMs()).toBe(30_000)
			if (orig) process.env.LIVE_ACTIVITY_INTERVAL_MS = orig
		})

		test('getLookbackDays returns default when env not set', () => {
			const orig = process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
			delete process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
			expect(getLookbackDays()).toBe(7)
			if (orig) process.env.LIVE_ACTIVITY_LOOKBACK_DAYS = orig
		})
	})

	describe('arena discovery and publication', () => {
		test('discovers 1440 creates with no seller-opt-in live_chat tag', async () => {
			const seen: Filter[][] = []
			const pool = {
				subscribe: (filters: Filter[], _onEvent: unknown, onEose: () => void) => {
					seen.push([...filters])
					onEose()
					return Promise.resolve(() => {})
				},
			} as unknown as LiveActivityWorkerContext['relayPool']

			await fetchRecentArenaCreates(workerContext(pool))

			expect(seen).toHaveLength(1)
			expect(seen[0][0].kinds).toEqual([1440])
			expect(seen[0][0]['#live_chat']).toBeUndefined()
		})

		test('publishes an activity keyed on 1440:<seller>:<d>, never a 30408 coordinate', async () => {
			const pool = stubPool((filters) => (filters[0]?.kinds?.includes(1440) ? [arenaCreateEvent()] : []))
			const published: Array<{ auctionCoord: string; startsAt: number; status: string }> = []

			const stats = await pollAndUpdateLiveActivities(workerContext(pool), {
				publishOverride: async (p) => {
					published.push({ auctionCoord: p.auctionCoord, startsAt: p.startsAt, status: p.status })
				},
			})

			expect(stats.created).toBe(1)
			expect(published[0].auctionCoord).toBe(`1440:${SELLER_A}:lot-1`)
			expect(published[0].auctionCoord.startsWith('30408')).toBe(false)
			expect(published[0].startsAt).toBeGreaterThan(0)
			expect(published[0].status).toBe('live')
		})

		test('skips a lot whose create-derived end has already passed', async () => {
			const ended = arenaCreateEvent({
				created_at: Math.floor(Date.now() / 1000) - 10_000,
				content: JSON.stringify({ auction_id: 'lot-1', durationSec: 60 }),
			})
			const pool = stubPool((filters) => (filters[0]?.kinds?.includes(1440) ? [ended] : []))
			const published: unknown[] = []

			const stats = await pollAndUpdateLiveActivities(workerContext(pool), {
				publishOverride: async (p) => {
					published.push(p)
				},
			})

			expect(published).toHaveLength(0)
			expect(stats.created).toBe(0)
		})
	})
})
