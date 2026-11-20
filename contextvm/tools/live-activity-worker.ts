import type { ApplesauceRelayPool } from '@contextvm/sdk'
import type { NostrSigner } from '@contextvm/sdk'
import type { NostrEvent, EventTemplate, Filter } from 'nostr-tools'
import {
	LIVE_ACTIVITY_KIND,
	LIVE_CHAT_KIND,
	buildLiveActivityTags,
	buildLiveActivityCoord,
	deriveLiveActivityStatus,
	type LiveActivityStatus,
} from '@sdk/core/nostr/nip53'
import { ARENA_AUCTION_CREATE_KIND, ARENA_LOT_STATE_KIND } from '@sdk/commerce/auctions/constants'
import {
	arenaAuctionCoordinate,
	canonicalArenaCreate,
	createDerivedEndSeconds,
	parseArenaCreateEvent,
	resolveArenaCreateVersions,
	ArenaLotStateError,
	parseArenaLotStateEvent,
	type ParsedArenaCreate,
	type ParsedArenaLotState,
} from '@sdk/commerce/auctions/arena'

export interface LiveActivityWorkerContext {
	relayPool: ApplesauceRelayPool
	signer: NostrSigner
	issuerPubkey: string
}

interface LiveActivityState {
	status: LiveActivityStatus
	currentParticipants: number
	totalParticipants: number
	updatedAt: number
}

const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_LOOKBACK_DAYS = 7
const PARTICIPANT_ACTIVE_WINDOW_S = 300
const MAX_AUCTIONS_PER_POLL = 500
const MAX_CHAT_MESSAGES_PER_ACTIVITY = 500

let dedupMap = new Map<string, LiveActivityState>()
let intervalHandle: ReturnType<typeof setInterval> | null = null
let discoveryUnsub: (() => void) | null = null

export function getIntervalMs(): number {
	const val = process.env.LIVE_ACTIVITY_INTERVAL_MS
	return val ? parseInt(val, 10) || DEFAULT_INTERVAL_MS : DEFAULT_INTERVAL_MS
}

export function getLookbackDays(): number {
	const val = process.env.LIVE_ACTIVITY_LOOKBACK_DAYS
	return val ? parseInt(val, 10) || DEFAULT_LOOKBACK_DAYS : DEFAULT_LOOKBACK_DAYS
}

export function resetDedupMap(): void {
	dedupMap = new Map()
}

export function getDedupMap(): Map<string, LiveActivityState> {
	return dedupMap
}

export function countParticipants(
	messages: Array<{ pubkey: string; created_at: number }>,
	now: number,
): { current: number; total: number } {
	const authors = new Set<string>()
	const recentAuthors = new Set<string>()
	const cutoff = now - PARTICIPANT_ACTIVE_WINDOW_S

	for (const msg of messages) {
		authors.add(msg.pubkey)
		if (msg.created_at >= cutoff) {
			recentAuthors.add(msg.pubkey)
		}
	}

	return { current: recentAuthors.size, total: authors.size }
}

async function fetchEventsUntilEose(relayPool: ApplesauceRelayPool, filters: Filter[], timeoutMs = 5000): Promise<NostrEvent[]> {
	return new Promise((resolve) => {
		const collected: NostrEvent[] = []
		let resolved = false

		const timer = setTimeout(() => {
			if (!resolved) {
				resolved = true
				unsub?.()
				resolve(collected)
			}
		}, timeoutMs)

		let unsub: (() => void) | undefined

		relayPool
			.subscribe(
				filters,
				(event) => {
					collected.push(event)
				},
				() => {
					if (!resolved) {
						resolved = true
						clearTimeout(timer)
						unsub?.()
						resolve(collected)
					}
				},
			)
			.then((fn) => {
				unsub = fn
			})
	})
}

/**
 * Discover the 1440 arena creates in the lookback window.
 *
 * The retired 30408 discovery asked for a seller-opt-in `#live_chat` tag; a
 * 1440 create has no such tag (`auctionForm.ts` records `enableLiveChat` among
 * the retired knobs). Ruling: **every** 1440 lot gets an activity, and the
 * worker decides open/ended per lot from the create's own end and the chain's
 * committed end ({@link committedEndsByCoordinate}).
 */
export async function fetchRecentArenaCreates(ctx: LiveActivityWorkerContext): Promise<NostrEvent[]> {
	const lookbackSeconds = getLookbackDays() * 86400
	const since = Math.floor(Date.now() / 1000) - lookbackSeconds

	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [ARENA_AUCTION_CREATE_KIND],
			since,
			limit: MAX_AUCTIONS_PER_POLL,
		},
	])
	return events
}

/**
 * The chain's **committed ends** (kind 1449) for the given lot coordinates,
 * indexed by coordinate with the **highest anchored height** kept per
 * coordinate — the chain's latest word on where the end is
 * (`sdk/commerce/auctions/arena/arenaLotState.ts`). A lot with no 1449 has no
 * committed end, which is not the same as its create-derived end.
 */
export async function committedEndsByCoordinate(
	ctx: LiveActivityWorkerContext,
	coordinates: readonly string[],
): Promise<Map<string, ParsedArenaLotState>> {
	const byCoordinate = new Map<string, ParsedArenaLotState>()
	if (coordinates.length === 0) return byCoordinate

	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [ARENA_LOT_STATE_KIND],
			'#auction': [...coordinates],
			limit: MAX_AUCTIONS_PER_POLL * 2,
		},
	])

	for (const event of events) {
		try {
			const state = parseArenaLotStateEvent({
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at ?? 0,
				tags: event.tags,
				content: event.content,
				sig: event.sig ?? '',
			})
			const prior = byCoordinate.get(state.auctionId)
			if (prior === undefined || state.height > prior.height) byCoordinate.set(state.auctionId, state)
		} catch (error) {
			// A 1449 that does not verify is not a committed end; skip it, never guess.
			if (!(error instanceof ArenaLotStateError)) throw error
		}
	}

	return byCoordinate
}

export async function fetchExistingLiveActivity(ctx: LiveActivityWorkerContext, auctionCoord: string): Promise<NostrEvent | null> {
	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [LIVE_ACTIVITY_KIND],
			'#a': [auctionCoord],
			authors: [ctx.issuerPubkey],
			limit: 1,
		},
	])
	if (events.length === 0) return null

	events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	return events[0]
}

export async function fetchChatParticipants(
	ctx: LiveActivityWorkerContext,
	liveActivityCoord: string,
): Promise<Array<{ pubkey: string; created_at: number }>> {
	const events = await fetchEventsUntilEose(ctx.relayPool, [
		{
			kinds: [LIVE_CHAT_KIND],
			'#a': [liveActivityCoord],
			limit: MAX_CHAT_MESSAGES_PER_ACTIVITY,
		},
	])
	return events.map((e) => ({
		pubkey: e.pubkey,
		created_at: e.created_at ?? 0,
	}))
}

export async function publishLiveActivityUpdate(
	ctx: LiveActivityWorkerContext,
	params: {
		/** The `1440:<seller>:<d>` arena coordinate the activity is for; the `d` is derived from it. */
		auctionCoord: string
		sellerPubkey: string
		title: string
		summary: string
		image: string | undefined
		startsAt: number
		maxEndAt: number
		status: LiveActivityStatus
		relays: string[]
		categories: string[]
		currentParticipants: number
		totalParticipants: number
	},
): Promise<void> {
	const tags = buildLiveActivityTags({
		auctionCoord: params.auctionCoord,
		sellerPubkey: params.sellerPubkey,
		title: params.title,
		summary: params.summary,
		image: params.image,
		startsAt: params.startsAt,
		maxEndAt: params.maxEndAt,
		status: params.status,
		relays: params.relays,
		categories: params.categories,
	})

	tags.push(['current_participants', String(params.currentParticipants)])
	tags.push(['total_participants', String(params.totalParticipants)])

	const template: EventTemplate = {
		kind: LIVE_ACTIVITY_KIND,
		content: '',
		created_at: Math.floor(Date.now() / 1000),
		tags,
	}

	const signed = await ctx.signer.signEvent(template)
	await ctx.relayPool.publish(signed)
}

type PublishFn = (params: {
	/** The `1440:<seller>:<d>` arena coordinate the activity is for; the `d` is derived from it. */
	auctionCoord: string
	sellerPubkey: string
	title: string
	summary: string
	image: string | undefined
	startsAt: number
	maxEndAt: number
	status: LiveActivityStatus
	relays: string[]
	categories: string[]
	currentParticipants: number
	totalParticipants: number
}) => Promise<void>

export async function pollAndUpdateLiveActivities(
	ctx: LiveActivityWorkerContext,
	opts?: { publishOverride?: PublishFn },
): Promise<{
	checked: number
	created: number
	updated: number
	skipped: number
	errors: number
}> {
	const now = Math.floor(Date.now() / 1000)
	const stats = { checked: 0, created: 0, updated: 0, skipped: 0, errors: 0 }

	let creates: NostrEvent[]
	try {
		creates = await fetchRecentArenaCreates(ctx)
	} catch (err) {
		console.error('[live-activity-worker] Failed to fetch arena creates:', err)
		stats.errors++
		return stats
	}

	// Parse the 1440 creates and group them by `(seller, d)`. One create may have
	// several versions (1440 is a regular kind); `resolveArenaCreateVersions`
	// picks the root and the canonical version the same way the web read does.
	const parsedCreates: ParsedArenaCreate[] = []
	for (const event of creates) {
		const result = parseArenaCreateEvent({
			id: event.id,
			pubkey: event.pubkey,
			created_at: event.created_at ?? 0,
			tags: event.tags,
			content: event.content,
		})
		if (result.ok) parsedCreates.push(result.create)
	}

	const groups = new Map<string, ParsedArenaCreate[]>()
	for (const create of parsedCreates) {
		const key = `${create.pubkey}\u0000${create.d}`
		const list = groups.get(key)
		if (list === undefined) groups.set(key, [create])
		else list.push(create)
	}

	// The chain's committed ends for every discovered lot, in one query: a 1449
	// publishes the end a bid moved the lot to, and it is the authority over the
	// create-derived end. A failed query leaves the create-derived end in charge
	// for this poll — refreshed on the next one — never a guess.
	const coordinates = [...groups.values()].map((versions) => arenaAuctionCoordinate(versions[0].pubkey, versions[0].d))
	let committedEnds = new Map<string, ParsedArenaLotState>()
	try {
		committedEnds = await committedEndsByCoordinate(ctx, coordinates)
	} catch (err) {
		console.error('[live-activity-worker] Failed to fetch committed ends; using create-derived ends only:', err)
	}

	const publish = opts?.publishOverride ?? ((p) => publishLiveActivityUpdate(ctx, p))

	for (const versions of groups.values()) {
		stats.checked++
		try {
			const resolved = resolveArenaCreateVersions(versions)
			const root = resolved.root
			const canonical = canonicalArenaCreate(resolved)

			const sellerPubkey = root.pubkey
			const auctionCoord = arenaAuctionCoordinate(sellerPubkey, root.d)

			// `starts` is the root create's own `created_at`: a 1440 carries no
			// scheduled start (the 30408 `start_at`/`end_at` tags are gone).
			const startsAt = root.createdAt
			// `ends` is the committed end (1449) when the chain published one, else
			// the create-derived end (`created_at + durationSec`). The two are never
			// blurred (`ui/auction/arena/model.ts`, `endSource`).
			const committedEnd = committedEnds.get(auctionCoord)?.endTime ?? null
			const createDerivedEnd = createDerivedEndSeconds(root)
			const maxEndAt = committedEnd ?? createDerivedEnd ?? 0
			const status = deriveLiveActivityStatus(startsAt, maxEndAt, now)

			// Every OPEN lot gets an activity. A lot with no readable end, or whose
			// end has passed, is skipped — the worker does not refresh an activity
			// for a lot the chain has closed.
			if (maxEndAt === 0 || status === 'ended') continue

			const title = canonical.content.title ?? ''
			const summary = canonical.content.description ?? ''
			const image = canonical.content.image ?? undefined
			const categories: string[] = []

			// The activity's address, derived from the `1440:<seller>:<d>`
			// coordinate. Both this coordinate (the value chat messages carry in
			// their `a` tag) and the activity's own `d` stay inside the relay
			// tag-index budget — that is the whole point of the derivation. See
			// RELAY_TAG_INDEX_VALUE_MAX_LENGTH in `sdk/core/nostr/nip53.ts`.
			const liveActivityCoord = buildLiveActivityCoord(ctx.issuerPubkey, auctionCoord)

			const dedupKey = auctionCoord

			const existing = await fetchExistingLiveActivity(ctx, auctionCoord)

			let currentParticipants = 0
			let totalParticipants = 0
			if (existing) {
				const participants = await fetchChatParticipants(ctx, liveActivityCoord)
				const counts = countParticipants(participants, now)
				currentParticipants = counts.current
				totalParticipants = counts.total
			}

			const lastKnown = dedupMap.get(dedupKey)
			if (
				lastKnown &&
				lastKnown.status === status &&
				lastKnown.currentParticipants === currentParticipants &&
				lastKnown.totalParticipants === totalParticipants
			) {
				stats.skipped++
				continue
			}

			const relayUrls = ctx.relayPool.getRelayUrls()

			await publish({
				auctionCoord,
				sellerPubkey,
				title,
				summary,
				image,
				startsAt,
				maxEndAt,
				status,
				relays: relayUrls,
				categories,
				currentParticipants,
				totalParticipants,
			})

			dedupMap.set(dedupKey, {
				status,
				currentParticipants,
				totalParticipants,
				updatedAt: now,
			})

			if (existing) {
				stats.updated++
			} else {
				stats.created++
			}
		} catch (err) {
			console.error(`[live-activity-worker] Error processing lot:`, err)
			stats.errors++
		}
	}

	if (stats.created + stats.updated > 0) {
		console.log(
			`[live-activity-worker] Poll complete: ${stats.checked} checked, ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.errors} errors`,
		)
	}

	return stats
}

export function startLiveActivityWorker(ctx: LiveActivityWorkerContext, intervalMs?: number): void {
	const interval = intervalMs ?? getIntervalMs()

	console.log(`[live-activity-worker] Starting worker (interval: ${interval}ms, lookback: ${getLookbackDays()} days)`)

	const tick = async () => {
		try {
			await pollAndUpdateLiveActivities(ctx)
		} catch (err) {
			console.error('[live-activity-worker] Unexpected error in poll cycle:', err)
		}
	}

	tick()

	intervalHandle = setInterval(tick, interval)
}

export function stopLiveActivityWorker(): void {
	if (discoveryUnsub) {
		discoveryUnsub()
		discoveryUnsub = null
	}
	if (intervalHandle !== null) {
		clearInterval(intervalHandle)
		intervalHandle = null
		console.log('[live-activity-worker] Stopped')
	}
}
