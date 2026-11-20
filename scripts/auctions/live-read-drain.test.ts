/**
 * `scripts/auctions/live-read-drain.test.ts` — the live A/B for the arena read's
 * **drain**: what the read itself delivers before the gate asks again, over the
 * real relay, the real transport and the real wiring.
 *
 * ## What it measures, and why the split is the point
 *
 * The arena list's cards are the lots the chain **accepted** (`followedAuctionViews`
 * → `isFollowedAuction`), and the acceptance is a kind-1449 `arena.createadmit.v1`
 * event. Kind 1449 is one window shared by three schemas the chain publishes in
 * bursts, and the relay answers the arena REQ filter by filter, so the admissions
 * are the **tail** of that one answer. The read's deadline used to cut that tail:
 * measured 2026-11-20, 30 of the 56 accepted lots were followed at the 8 s
 * deadline and 56 of 56 at a 30 s deadline. The drain (`arenaAuctionRead.ts`
 * `pump`, `ARENA_READ_DRAIN_*`) now ends the read's *wait* at the deadline and
 * then finishes reading what the transports had already delivered.
 *
 * So this probe reports, for one live read:
 *
 * - `readAdmissions` / `readFollowed` — the admissions the **read itself**
 *   delivered, and the cards the list would render from its own set alone, before
 *   `missingCreateAdmissions` runs. These are the numbers the fix moves: run the
 *   same probe against the read **without** the drain and compare.
 * - `gateAdmissions` / `finalFollowed` — what the gate then had to ask for, and
 *   the cards the page ends up with. The gate stays the safety net for whatever
 *   was still on the wire when the drain's quiet window closed.
 * - the admission **timeline** — when each admission batch arrived, in ms from the
 *   read's start, which is what shows whether the tail was in hand or in flight.
 *
 * A second case reads the live lot page's own lot (`d`, no seller) and reports its
 * bids, so a drain that reads more cannot have cost the lot page its bid list.
 *
 * ## Opt-in, and invisible to the ordinary suite
 *
 * `bun run test:unit` gathers `*.test.ts` under `contextvm sdk ui platform
 * styles` only. This file is under `scripts/`, so with `AUCTIONS_LIVE` unset the
 * unit suite is byte-identical to the tip it branched from. It is still
 * type-checked, and gated with `test.skipIf(!LIVE)`.
 *
 * ## Re-run
 *
 *     AUCTIONS_LIVE=1 bun test scripts/auctions/live-read-drain.test.ts
 *
 * `AUCTIONS_LIVE_RELAY` (default `wss://relay.playday.it`), `AUCTIONS_LIVE_LOT_D`,
 * `AUCTIONS_LIVE_DEADLINE_MS` (default 8000, the app's own) and
 * `AUCTIONS_LIVE_ADMIT_MS` (default 0 — the store's per-event admission cost,
 * emulated; see `ADMIT_MS`) override the knobs. Nothing is published: this probe
 * only reads.
 */
import { describe, expect, test } from 'bun:test'
import type { EventFilter, EventStorePort } from '@sdk/core'
import type { Event } from '@sdk/core/nostr-io'
import { createMemoryEventStore } from '@sdk/core/event-store'
import {
	arenaLotFilters,
	arenaLotFollowUpFilters,
	createWebArenaAuctionRead,
	followedAuctionViews,
	projectArenaEvents,
	unadmittedCreateIds,
	type ArenaAuctionEvent,
	type ArenaAuctionSnapshot,
	type ArenaReadHealth,
	type ArenaRefusedEvent,
} from '@platform/web/auctions/relay/arenaAuctionRead'

const LIVE = process.env.AUCTIONS_LIVE === '1'
const RELAY = process.env.AUCTIONS_LIVE_RELAY ?? 'wss://relay.playday.it'
const DEADLINE_MS = Number(process.env.AUCTIONS_LIVE_DEADLINE_MS ?? 8000)
/**
 * The store's admission cost, emulated. In the app this is IndexedDB-backed
 * (`createApplesauceEventStore` over `applesauce-indexeddb`), and it is the one
 * cost that makes the read slower than the relay: every event the read takes is
 * admitted before the next is pulled, so a store slower than the relay's delivery
 * leaves the rest of the answer in the transport's queue when the deadline fires.
 * That is the condition the drain exists for, and it is the condition to state
 * when reporting a run. Default 0: no emulation, the reference case.
 */
const ADMIT_MS = Number(process.env.AUCTIONS_LIVE_ADMIT_MS ?? 0)
/**
 * The drain's own bound: `ARENA_READ_DRAIN_CEILING_MS` + `ARENA_READ_DRAIN_QUIET_MS`
 * in `arenaAuctionRead.ts`, mirrored here as a literal on purpose — this probe is
 * also run against the read **without** the drain (the A/B's other arm), where the
 * constants do not exist.
 */
const DRAIN_CAP_MS = 1100
/** The live lot the lot-page case reads, as the app's own route names it. */
const LOT_D = process.env.AUCTIONS_LIVE_LOT_D ?? '612a25ed-2562-4575-b780-ecfa98d7f35a'

/** The store the read admits into: the memory port, with an optional per-event admission cost. */
function readStore(admitMs: number): EventStorePort<Event> {
	const store = createMemoryEventStore<Event>()
	if (admitMs <= 0) return store
	return {
		...store,
		add: async (event) => {
			await new Promise<void>((resolve) => setTimeout(resolve, admitMs))
			return store.add(event)
		},
	}
}

/** The three schemas one kind-1449 window carries — what the tail of an answer can be. */
function kind1449Breakdown(events: readonly ArenaAuctionEvent[]): string {
	const count = (type: ArenaAuctionEvent['type']): number => events.filter((event) => event.type === type).length
	return `${count('create-admit')} create-admissions, ${count('bid-admit')} bid admissions, ${count('lot-state')} committed ends`
}

export interface LiveReadReport {
	/** Ms from the read's start to its own `caught-up` marker. */
	elapsedMs: number
	/** Creates the read decoded. */
	creates: number
	/** Create-admissions the read itself delivered — the number the drain moves. */
	readAdmissions: number
	/** Lots the chain accepted, from the read's own set alone. */
	readFollowed: number
	/** Admissions that arrived in the drain — after the first batch past the deadline. */
	drainAdmissions: number
	/** Lots followed from the events delivered *before* the drain, i.e. the old read's set. */
	preDrainFollowed: number
	/** Create-admissions `missingCreateAdmissions` then had to ask for. */
	gateAdmissions: number
	/** Lots the read's own set could not follow when the read reported. */
	gateAsked: number
	/** Lots followed once the gate's answer is merged — what the page renders. */
	finalFollowed: number
	/** Per decoded event type: how many arrived, and when the first and the last did. */
	arrivalProfile: { type: string; count: number; firstAtMs: number; lastAtMs: number }[]
	/** The kind-1449 window the read itself delivered, by schema. */
	window: string
	health: ArenaReadHealth
	auctions: ArenaAuctionSnapshot['auctions']
	refusals: ArenaRefusedEvent[]
}

/** One live read to its own caught-up marker, with the gate's top-up measured separately. */
async function readArena(options: {
	filters?: readonly EventFilter[]
	followUpFilters?: (events: readonly ArenaAuctionEvent[]) => readonly EventFilter[]
	deadlineMs?: number
	admitMs?: number
}): Promise<LiveReadReport> {
	const deadlineMs = options.deadlineMs ?? DEADLINE_MS
	const store = readStore(options.admitMs ?? ADMIT_MS)
	const read = createWebArenaAuctionRead({
		relays: [RELAY],
		store,
		deadlineMs,
		filters: options.filters,
		followUpFilters: options.followUpFilters,
	})

	const byId = new Map<string, ArenaAuctionEvent>()
	const refusals: ArenaRefusedEvent[] = []
	const arrivals = new Map<string, { count: number; firstAtMs: number; lastAtMs: number }>()
	const started = Date.now()
	let elapsedMs = 0
	let health = projectArenaEvents([]).health
	// The set the read held when its wait ended — the drain's own before-and-after.
	let preDrainFollowed: number | null = null
	let drainAdmissions = 0

	for await (const item of read.events()) {
		if (item.type === 'events') {
			const atMs = Date.now() - started
			let admits = 0
			const pastDeadline = atMs >= deadlineMs
			if (pastDeadline && preDrainFollowed === null) {
				preDrainFollowed = followedAuctionViews(projectArenaEvents([...byId.values()]).auctions).length
			}
			for (const event of item.events) {
				if (byId.has(event.id)) continue
				byId.set(event.id, event)
				if (event.type === 'create-admit') admits += 1
				const seen = arrivals.get(event.type)
				if (seen === undefined) arrivals.set(event.type, { count: 1, firstAtMs: atMs, lastAtMs: atMs })
				else {
					seen.count += 1
					seen.lastAtMs = atMs
				}
			}
			if (pastDeadline) drainAdmissions += admits
			continue
		}
		if (item.type === 'refused') {
			refusals.push(...item.refusals)
			continue
		}
		elapsedMs = Date.now() - started
		health = item.health
	}

	const readSet = [...byId.values()]
	const readSnapshot = projectArenaEvents(readSet, health, refusals)
	const readAdmissions = readSet.filter((event) => event.type === 'create-admit').length
	const readFollowed = followedAuctionViews(readSnapshot.auctions).length
	const gateAsked = unadmittedCreateIds(readSet).length

	// The gate's own ask — the page's step after the read reports (`collectAuctionListRead`).
	let gateAdmissions = 0
	if (gateAsked > 0) {
		const fetched = await read.missingCreateAdmissions(readSet, { deadlineMs: 1500 })
		gateAdmissions = fetched.events.filter((event) => event.type === 'create-admit').length
		for (const event of fetched.events) if (!byId.has(event.id)) byId.set(event.id, event)
		refusals.push(...fetched.refusals)
	}
	read.close()

	return {
		elapsedMs,
		creates: readSet.filter((event) => event.type === 'create').length,
		readAdmissions,
		readFollowed,
		drainAdmissions,
		preDrainFollowed: preDrainFollowed ?? readFollowed,
		gateAdmissions,
		gateAsked,
		finalFollowed: followedAuctionViews(projectArenaEvents([...byId.values()]).auctions).length,
		arrivalProfile: [...arrivals.entries()]
			.map(([type, seen]) => ({ type, ...seen }))
			.sort((left, right) => left.firstAtMs - right.firstAtMs),
		window: kind1449Breakdown(readSet),
		health,
		auctions: readSnapshot.auctions,
		refusals,
	}
}

describe('live: the arena read finishes what it has before it ends', () => {
	test.skipIf(!LIVE)(
		'the list read delivers the admission tail itself, and the gate tops it up',
		async () => {
			const report = await readArena({})

			const relays = report.health.relays.map((relay) => `${relay.url} ${relay.status} (${relay.events} events)`)
			const admissions = report.arrivalProfile.find((seen) => seen.type === 'create-admit')
			console.log(
				[
					`live read of ${RELAY} at a ${DEADLINE_MS} ms deadline, ${ADMIT_MS} ms store admission cost`,
					`  ended after ${report.elapsedMs} ms; relays: ${relays.join(', ') || 'none'}`,
					`  the read decoded ${report.creates} creates; its kind-1449 window held ${report.window}`,
					`  at the deadline its own set followed ${report.preDrainFollowed} lots; after the drain ${report.readFollowed} — the drain read ${report.drainAdmissions} admissions`,
					`  it asks the gate for ${report.gateAsked} more; the gate fetched ${report.gateAdmissions} → the page renders ${report.finalFollowed} lots`,
					`  the read delivered ${report.readAdmissions} create-admissions${admissions === undefined ? '' : ` (its window ${admissions.firstAtMs}–${admissions.lastAtMs} ms)`}`,
					`  arrival order: ${report.arrivalProfile.map((seen) => `${seen.type} ${seen.count}@${seen.firstAtMs}–${seen.lastAtMs}ms`).join(', ')}`,
				].join('\n'),
			)

			// The read reached the relay and read something: an empty arena would make every
			// number below vacuous.
			expect(report.health.noRelaysReachable).toBe(false)
			expect(report.creates).toBeGreaterThan(0)
			// The deadline is still the contract: the drain is bounded by the read's own cap
			// (`ARENA_READ_DRAIN_CEILING_MS` + `ARENA_READ_DRAIN_QUIET_MS`), whatever the
			// transport and the store do.
			expect(report.elapsedMs).toBeLessThan(DEADLINE_MS + DRAIN_CAP_MS + 500)
			// The drain's own measure: the read's set carries acceptances, not just creates.
			expect(report.readAdmissions).toBeGreaterThan(0)
			// And the page is complete either way — the gate is the net, not the only path.
			expect(report.finalFollowed).toBeGreaterThanOrEqual(report.readFollowed)
		},
		60_000,
	)

	test.skipIf(!LIVE)(
		'the lot page’s own lot still resolves, with its bids',
		async () => {
			const report = await readArena({
				filters: arenaLotFilters(null, LOT_D),
				followUpFilters: arenaLotFollowUpFilters(null, LOT_D),
			})

			const auction = report.auctions[0]
			console.log(
				[
					`live lot read of d=${LOT_D} at a ${DEADLINE_MS} ms deadline`,
					`  ended after ${report.elapsedMs} ms; the read followed ${report.readFollowed} lot(s)`,
					`  bids: ${auction?.bids.length ?? 0}; bid admissions: ${auction?.admissions.length ?? 0}`,
				].join('\n'),
			)

			expect(auction).toBeDefined()
			expect(auction?.bids.length ?? 0).toBeGreaterThan(0)
		},
		60_000,
	)
})
