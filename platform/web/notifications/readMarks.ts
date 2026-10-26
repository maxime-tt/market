/**
 * platform/web/notifications/readMarks.ts — the app's read-state layer: the read MARKS of the notification
 * mechanism, persisted one watermark per stream through the `ReadMarkPort`.
 *
 * THE RULING THIS IMPLEMENTS. Read state is **derived, never stored**. The notification source is authoritative,
 * the notification records are derived from it, and the only thing that survives a reload is the read MARKS —
 * one watermark per stream: the timestamp of the newest item the user has read. The in-memory read model is the
 * mechanism's `PassiveLedger`; the durable record is the `ReadMarkPort` (A6). Nothing here stores counts.
 *
 * WHY A LAYER RATHER THAN CALLING THE LEDGER DIRECTLY. Three things the raw ledger cannot express on its own:
 *
 *   1. **The app's family-global marks.** The legacy store kept a *per-family* "global" mark beside each
 *      per-subject map (`lastSeenTimestamps.auctionBids` beside `auctionBidsByAuction`), and a no-key mark
 *      raised only its own family's global. The mechanism has ONE `globalLastSeen` across every family, so a
 *      family global cannot be its `globalLastSeen` without leaking one family's "mark all seen" into another.
 *      Verified, not assumed: nothing in the app calls `ledger.markAllSeen`, so `globalLastSeen` stays 0 and
 *      `ledger.lastSeen(scope)` reduces to the scope's own mark. This layer therefore stores each family's
 *      global as its OWN stream — the bare family prefix (`auction-bids`, `messages`, …), which no count scope
 *      uses because every count scope carries a `:` — and composes the legacy `max(global, scope)` itself.
 *      That reproduces the legacy relation exactly: keyed read = max(family mark, subject mark); no-key read =
 *      family mark.
 *
 *   2. **Hydration must not clear counts.** `ledger.markSeen` is the user action: it zeroes the badge and moves
 *      the mark together. Replaying a persisted mark at boot must NOT clear a count the user has not read, so
 *      hydration uses the additive `ledger.hydrateMark` (mark only, monotonic, count untouched).
 *
 *   3. **The async port against synchronous consumers.** `ReadMarkPort.get`/`set` are promises, but the
 *      monitor's `since:` queries, the row predicates and the badge maths all read synchronously during render
 *      and event handling. So reads are served from the in-memory ledger — seeded SYNCHRONOUSLY at module load
 *      from the same storage the port writes to — and the async port hydrates/heals afterwards. A read never
 *      awaits; a write updates memory synchronously and enqueues its port write.
 *
 * FIRST LOAD AFTER THE CUTOVER. The legacy store persisted its marks under `nostr-market:notifications` as
 * `{ lastSeenTimestamps }`. That blob is read synchronously at module load and replayed into the ledger with
 * `hydrateMark`, and each of its marks is written into the port where the port is absent or lower. So a user
 * who had read marks before C4 keeps every one of them: no order, message, bid or comment is re-notified. The
 * replay is monotonic and idempotent, so running it on every load is safe — a mark already in the port at or
 * above the legacy value is left alone.
 *
 * ORDERING AND REFUSAL.
 *   - Reads happen against memory, so there is no read/write race inside the app: a mark set on click is
 *     visible to the next synchronous read in the same tick.
 *   - Writes are serialised per stream by a promise chain, so two writes to one stream cannot interleave their
 *     read-modify-write in the port. The port itself is monotonic, so an out-of-order or duplicate write can
 *     never lower a mark.
 *   - A port rejection (`ReadMarkError`, code `storage-failure`/`invalid-mark`) is caught and logged; the mark
 *     stays applied in memory for the session. That is the legacy behaviour — `saveToStorage` swallowed a
 *     quota/private-mode failure and the badge still cleared — and it means the mark is lost on the next reload
 *     exactly as a legacy storage failure lost it. A rejection never rolls the in-memory mark back and never
 *     escapes into a click handler.
 */
import {
	createMemoryReadMarkPort,
	createStorageReadMarkPort,
	type KeyValueStoragePort,
	type LedgerSnapshot,
	type Notifications,
	type ReadMarkPort,
} from '@sdk/core'
import { createLocalStorageKeyValuePort } from '@platform/web/storage/localStorageKeyValue'
import { appNotifications } from './instance'
import type { AppNotificationPayload, AppNotificationType } from './types'
import { notificationScopes } from './types'

/** The key the legacy store persisted `{ lastSeenTimestamps }` under — the seed source on the first load. */
export const LEGACY_READ_MARKS_STORAGE_KEY = 'nostr-market:notifications'

/** The port's key prefix. `createStorageReadMarkPort`'s default; repeated here so the sync seed reads the same keys. */
const READ_MARK_NAMESPACE = 'read-mark:'

/** The app instance type this layer is built over. */
type AppNotifications = Notifications<AppNotificationType, AppNotificationPayload>

/** A family's bare prefix — the key its legacy "global" mark is stored under. Count scopes all carry a `:`. */
const familyPrefix = (builder: string): string => (builder.endsWith(':') ? builder.slice(0, -1) : builder)

/**
 * The app's read-mark families. Every value is derived from the scope builder the producers write, so a rename
 * in `types.ts` cannot drift a mark away from the count it pairs with. A family's bare key holds its legacy
 * "global" mark; `<family>:<subject>` holds the per-subject mark.
 */
export const readMarkFamilies = {
	orders: notificationScopes.orders,
	purchases: notificationScopes.purchases,
	bidUpdates: notificationScopes.bidUpdates,
	messages: familyPrefix(notificationScopes.messages('')),
	auctionBids: familyPrefix(notificationScopes.auctionBids('')),
	auctionComments: familyPrefix(notificationScopes.auctionComments('')),
	auctionThreadComments: familyPrefix(notificationScopes.auctionThreadComments('')),
	productComments: familyPrefix(notificationScopes.productComments('')),
	auctionLive: familyPrefix(notificationScopes.auctionLive('')),
	auctionSettlement: familyPrefix(notificationScopes.auctionSettlement('')),
} as const

/** The legacy `lastSeenTimestamps` shape, as the old store persisted it. Absent fields degrade to 0/{}. */
interface LegacyLastSeenTimestamps {
	readonly orders?: number
	readonly purchases?: number
	readonly auctionBids?: number
	readonly auctionBidsByAuction?: Record<string, number>
	readonly auctionComments?: number
	readonly auctionCommentsByAuction?: Record<string, number>
	readonly auctionEventComments?: number
	readonly auctionEventCommentsByAuction?: Record<string, number>
	readonly productComments?: number
	readonly productCommentsByProduct?: Record<string, number>
	readonly auctionLive?: number
	readonly auctionLiveByAuction?: Record<string, number>
	readonly auctionSettlementBegins?: number
	readonly auctionSettlementBeginsByAuction?: Record<string, number>
	readonly bidUpdates?: number
	readonly messages?: Record<string, number>
}

/** The options a test (or a host with another storage) supplies; every default is the web host's real behaviour. */
export interface ReadMarksOptions {
	/** The persistence seam. Defaults to a localStorage-backed port under `read-mark:`. */
	readonly port?: ReadMarkPort
	/** The clock, in whole seconds. Defaults to `Math.floor(Date.now() / 1000)` — the instance's unit. */
	readonly now?: () => number
	/** Read a mark synchronously for the module-load seed. Defaults to `localStorage.getItem('read-mark:<s>')`. */
	readonly syncRead?: (stream: string) => number | null
	/** List the streams present in storage synchronously for the module-load seed. Defaults to the localStorage prefix scan. */
	readonly syncListStreams?: () => readonly string[]
	/** Read the legacy blob synchronously. Defaults to `localStorage.getItem(LEGACY_READ_MARKS_STORAGE_KEY)`. */
	readonly legacyRead?: () => string | null
}

/** The layer's public surface — the legacy `notificationActions` read-state API, backed by the ledger + port. */
export interface ReadMarks {
	/** Rehydrate the port's marks into the ledger once. Idempotent; never throws. */
	hydrate(): Promise<void>
	/** Resolve when `hydrate()` has finished (resolved immediately if it never started). */
	whenHydrated(): Promise<void>
	/** Resolve when every queued port write has settled. For tests and a page-unload flush. */
	whenPersisted(): Promise<void>
	// Writes — the legacy `mark*Seen` actions. A mark zeroes its scope's count and stamps the watermark.
	markOrdersSeen(at?: number): void
	markMessagesSeen(pubkey?: string, at?: number): void
	markConversationSeen(pubkey: string, at?: number): void
	markPurchasesSeen(at?: number): void
	markAuctionBidsSeen(auctionKey?: string, at?: number): void
	markAuctionCommentsSeen(auctionKey?: string, at?: number): void
	markAuctionEventCommentsSeen(auctionKey?: string, at?: number): void
	markProductCommentsSeen(productKey?: string, at?: number): void
	markAuctionLiveSeen(auctionKey?: string, at?: number): void
	markAuctionSettlementBeginsSeen(auctionKey?: string, at?: number): void
	markBidUpdatesSeen(at?: number): void
	// Reads — the legacy `getLastSeen*` getters. Synchronous, from the in-memory ledger.
	getLastSeenOrders(): number
	getLastSeenForConversation(pubkey: string): number
	getLastSeenPurchases(): number
	getLastSeenAuctionBids(auctionKey?: string): number
	getLastSeenAuctionComments(auctionKey?: string): number
	getLastSeenAuctionEventComments(auctionKey?: string): number
	getLastSeenProductComments(productKey?: string): number
	getLastSeenAuctionLive(auctionKey?: string): number
	getLastSeenAuctionSettlementBegins(auctionKey?: string): number
	getLastSeenBidUpdates(): number
}

/** A scope's mark, floored by the ledger's global floor — the mechanism's own `lastSeen` relation. */
export function lastSeenOf(ledger: LedgerSnapshot, scope: string): number {
	return Math.max(ledger.globalLastSeen, ledger.lastSeenByScope[scope] ?? 0)
}

/** The legacy `getScopedLastSeen`: a keyed read is the max of the family mark and the subject mark. */
export function scopedLastSeenOf(ledger: LedgerSnapshot, family: string, scope?: string): number {
	const familyMark = lastSeenOf(ledger, family)
	if (!scope) return familyMark
	return Math.max(familyMark, lastSeenOf(ledger, scope))
}

/** A parsed non-negative finite mark, or `null`. Matches the port's own corrupt-value policy. */
function parseMark(raw: string | null | undefined): number | null {
	if (raw == null) return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** The default synchronous storage view — the same bytes the default port writes. Absent storage reads as empty. */
function defaultStorage(): Storage | undefined {
	try {
		return globalThis.localStorage as Storage | undefined
	} catch {
		return undefined
	}
}

/** Expand the legacy blob into `stream -> mark`, using the same family keys the mechanism counts under. */
export function expandLegacyMarks(lastSeen: LegacyLastSeenTimestamps | undefined): Map<string, number> {
	const marks = new Map<string, number>()
	const put = (stream: string, at: number | undefined) => {
		if (typeof at === 'number' && Number.isFinite(at) && at > 0) marks.set(stream, at)
	}
	const putFamily = (
		family: string,
		global: number | undefined,
		bySubject: Record<string, number> | undefined,
		builder: (key: string) => string,
	) => {
		put(family, global)
		for (const [key, at] of Object.entries(bySubject ?? {})) put(builder(key), at)
	}
	if (!lastSeen) return marks
	put(readMarkFamilies.orders, lastSeen.orders)
	put(readMarkFamilies.purchases, lastSeen.purchases)
	put(readMarkFamilies.bidUpdates, lastSeen.bidUpdates)
	for (const [pubkey, at] of Object.entries(lastSeen.messages ?? {})) put(notificationScopes.messages(pubkey), at)
	putFamily(readMarkFamilies.auctionBids, lastSeen.auctionBids, lastSeen.auctionBidsByAuction, notificationScopes.auctionBids)
	putFamily(
		readMarkFamilies.auctionComments,
		lastSeen.auctionComments,
		lastSeen.auctionCommentsByAuction,
		notificationScopes.auctionComments,
	)
	putFamily(
		readMarkFamilies.auctionThreadComments,
		lastSeen.auctionEventComments,
		lastSeen.auctionEventCommentsByAuction,
		notificationScopes.auctionThreadComments,
	)
	putFamily(
		readMarkFamilies.productComments,
		lastSeen.productComments,
		lastSeen.productCommentsByProduct,
		notificationScopes.productComments,
	)
	putFamily(readMarkFamilies.auctionLive, lastSeen.auctionLive, lastSeen.auctionLiveByAuction, notificationScopes.auctionLive)
	putFamily(
		readMarkFamilies.auctionSettlement,
		lastSeen.auctionSettlementBegins,
		lastSeen.auctionSettlementBeginsByAuction,
		notificationScopes.auctionSettlement,
	)
	return marks
}

/** Read and expand the legacy blob. A missing or corrupt blob is empty, matching the legacy loader. */
function readLegacyMarks(reader: () => string | null): Map<string, number> {
	try {
		const raw = reader()
		if (!raw) return new Map()
		const parsed = JSON.parse(raw) as { lastSeenTimestamps?: LegacyLastSeenTimestamps }
		return expandLegacyMarks(parsed.lastSeenTimestamps)
	} catch {
		return new Map()
	}
}

/** Scan the storage prefix synchronously for streams already persisted. */
function scanStreams(): readonly string[] {
	const storage = defaultStorage()
	if (!storage) return []
	const streams: string[] = []
	try {
		for (let index = 0; index < storage.length; index++) {
			const key = storage.key(index)
			if (key?.startsWith(READ_MARK_NAMESPACE)) streams.push(key.slice(READ_MARK_NAMESPACE.length))
		}
	} catch {
		return []
	}
	return streams
}

/**
 * Build the read-state layer over one notifications instance.
 *
 * The constructor seeds synchronously (so the first synchronous read is already correct) and starts the async
 * port hydration. `hydrate()` is idempotent and safe to call from boot.
 */
export function createReadMarks(notifications: AppNotifications, options: ReadMarksOptions = {}): ReadMarks {
	const now = options.now ?? (() => Math.floor(Date.now() / 1000))
	const port = options.port ?? createStorageReadMarkPort(createLocalStorageKeyValuePort())
	const syncRead =
		options.syncRead ??
		((stream: string) => {
			const storage = defaultStorage()
			if (!storage) return null
			try {
				return parseMark(storage.getItem(`${READ_MARK_NAMESPACE}${stream}`))
			} catch {
				return null
			}
		})
	const syncListStreams = options.syncListStreams ?? scanStreams
	const legacyRead =
		options.legacyRead ??
		(() => {
			const storage = defaultStorage()
			if (!storage) return null
			try {
				return storage.getItem(LEGACY_READ_MARKS_STORAGE_KEY)
			} catch {
				return null
			}
		})

	const ledger = notifications.ledger

	/** The legacy marks this layer seeds from, kept for the async port reconciliation. */
	const legacyMarks = readLegacyMarks(legacyRead)

	/**
	 * Synchronous seed — the first load's answer. Replay the port's stored marks and the legacy blob into the
	 * ledger before anything reads. `hydrateMark` is monotonic and never touches counts.
	 */
	const seedSynchronously = () => {
		for (const stream of syncListStreams()) {
			const stored = syncRead(stream)
			if (stored !== null) ledger.hydrateMark(stream, stored)
		}
		for (const [stream, at] of legacyMarks) ledger.hydrateMark(stream, at)
	}
	seedSynchronously()

	/** Per-stream write chains: two writes to one stream are ordered, never interleaved. */
	const writeChains = new Map<string, Promise<void>>()

	/** Persist one mark through the port, serialised per stream; a rejection is logged, never thrown. */
	const persist = (stream: string, at: number): Promise<void> => {
		const previous = writeChains.get(stream) ?? Promise.resolve()
		const next = previous.then(async () => {
			try {
				await port.set(stream, at)
			} catch (error) {
				console.error(`[readMarks] failed to persist the mark for "${stream}"; the mark stays in memory for this session`, error)
			}
		})
		writeChains.set(stream, next)
		return next
	}

	/** The in-memory mark for a stream — the ledger's own relation, global floor included. */
	const markOf = (scope: string): number => ledger.lastSeen(scope)

	/** Zero a scope's count and stamp its mark; the count is zeroed even when the stamp does not advance. */
	const mark = (scope: string, at: number) => {
		const stamp = Math.max(at, markOf(scope))
		ledger.markSeen(scope, stamp)
		void persist(scope, stamp)
	}

	/**
	 * A no-key mark: raise the family's own global stream and clear every subject scope in the family. The
	 * legacy action zeroed all of its family's counts and raised its family global; storing each subject mark at
	 * the same stamp is observationally identical for every read (all reads take the max) and makes a later
	 * keyed read agree with the badge.
	 */
	const markFamily = (family: string, at: number, hasGlobal: boolean) => {
		if (hasGlobal) mark(family, at)
		const prefix = `${family}:`
		for (const scope of ledger.scopes()) {
			if (scope === family || !scope.startsWith(prefix)) continue
			mark(scope, at)
		}
	}

	// ---- hydration -------------------------------------------------------------------------------------

	let hydration: Promise<void> | null = null
	const hydrate = (): Promise<void> => {
		if (hydration) return hydration
		hydration = (async () => {
			const streams = new Set<string>()
			for (const stream of syncListStreams()) streams.add(stream)
			for (const stream of ledger.scopes()) streams.add(stream)
			for (const stream of legacyMarks.keys()) streams.add(stream)
			for (const stream of streams) {
				try {
					const stored = await port.get(stream)
					const legacyAt = legacyMarks.get(stream)
					if (stored !== null && stored > markOf(stream)) ledger.hydrateMark(stream, stored)
					// Seed or heal the port from the legacy blob. `set` is monotonic, so a lower value is ignored.
					if (legacyAt !== undefined && (stored === null || legacyAt > stored)) await port.set(stream, legacyAt)
				} catch (error) {
					console.error(`[readMarks] failed to hydrate the mark for "${stream}"; the in-memory seed is kept`, error)
				}
			}
		})()
		return hydration
	}
	const whenHydrated = (): Promise<void> => hydration ?? Promise.resolve()
	const whenPersisted = (): Promise<void> => Promise.all([...writeChains.values()]).then(() => undefined)

	// Start hydration as the module/instance is composed. It resolves long before any producer runs; a read
	// that happens earlier is still correct because the synchronous seed already applied the same marks.
	void hydrate()

	// ---- writes ----------------------------------------------------------------------------------------

	const markKeyed = (builder: (key: string) => string, key: string, at: number) => mark(builder(key), at)

	return {
		hydrate,
		whenHydrated,
		whenPersisted,
		markOrdersSeen: (at = now()) => mark(readMarkFamilies.orders, at),
		markPurchasesSeen: (at = now()) => mark(readMarkFamilies.purchases, at),
		markBidUpdatesSeen: (at = now()) => mark(readMarkFamilies.bidUpdates, at),
		markMessagesSeen: (pubkey?: string, at = now()) => {
			if (pubkey) markKeyed(notificationScopes.messages, pubkey, at)
			else markFamily(readMarkFamilies.messages, at, false)
		},
		markConversationSeen: (pubkey: string, at = now()) => markKeyed(notificationScopes.messages, pubkey, at),
		markAuctionBidsSeen: (auctionKey?: string, at = now()) => {
			if (auctionKey) markKeyed(notificationScopes.auctionBids, auctionKey, at)
			else markFamily(readMarkFamilies.auctionBids, at, true)
		},
		markAuctionCommentsSeen: (auctionKey?: string, at = now()) => {
			if (auctionKey) markKeyed(notificationScopes.auctionComments, auctionKey, at)
			else markFamily(readMarkFamilies.auctionComments, at, true)
		},
		markAuctionEventCommentsSeen: (auctionKey?: string, at = now()) => {
			if (auctionKey) markKeyed(notificationScopes.auctionThreadComments, auctionKey, at)
			else markFamily(readMarkFamilies.auctionThreadComments, at, true)
		},
		markProductCommentsSeen: (productKey?: string, at = now()) => {
			if (productKey) markKeyed(notificationScopes.productComments, productKey, at)
			else markFamily(readMarkFamilies.productComments, at, true)
		},
		markAuctionLiveSeen: (auctionKey?: string, at = now()) => {
			if (auctionKey) markKeyed(notificationScopes.auctionLive, auctionKey, at)
			else markFamily(readMarkFamilies.auctionLive, at, true)
		},
		markAuctionSettlementBeginsSeen: (auctionKey?: string, at = now()) => {
			if (auctionKey) markKeyed(notificationScopes.auctionSettlement, auctionKey, at)
			else markFamily(readMarkFamilies.auctionSettlement, at, true)
		},

		// ---- reads — synchronous, from the in-memory ledger ------------------------------------------

		getLastSeenOrders: () => lastSeenOf(notifications.snapshot().ledger, readMarkFamilies.orders),
		getLastSeenForConversation: (pubkey: string) => lastSeenOf(notifications.snapshot().ledger, notificationScopes.messages(pubkey)),
		getLastSeenPurchases: () => lastSeenOf(notifications.snapshot().ledger, readMarkFamilies.purchases),
		getLastSeenBidUpdates: () => lastSeenOf(notifications.snapshot().ledger, readMarkFamilies.bidUpdates),
		getLastSeenAuctionBids: (auctionKey?: string) =>
			scopedLastSeenOf(
				notifications.snapshot().ledger,
				readMarkFamilies.auctionBids,
				auctionKey ? notificationScopes.auctionBids(auctionKey) : undefined,
			),
		getLastSeenAuctionComments: (auctionKey?: string) =>
			scopedLastSeenOf(
				notifications.snapshot().ledger,
				readMarkFamilies.auctionComments,
				auctionKey ? notificationScopes.auctionComments(auctionKey) : undefined,
			),
		getLastSeenAuctionEventComments: (auctionKey?: string) =>
			scopedLastSeenOf(
				notifications.snapshot().ledger,
				readMarkFamilies.auctionThreadComments,
				auctionKey ? notificationScopes.auctionThreadComments(auctionKey) : undefined,
			),
		getLastSeenProductComments: (productKey?: string) =>
			scopedLastSeenOf(
				notifications.snapshot().ledger,
				readMarkFamilies.productComments,
				productKey ? notificationScopes.productComments(productKey) : undefined,
			),
		getLastSeenAuctionLive: (auctionKey?: string) =>
			scopedLastSeenOf(
				notifications.snapshot().ledger,
				readMarkFamilies.auctionLive,
				auctionKey ? notificationScopes.auctionLive(auctionKey) : undefined,
			),
		getLastSeenAuctionSettlementBegins: (auctionKey?: string) =>
			scopedLastSeenOf(
				notifications.snapshot().ledger,
				readMarkFamilies.auctionSettlement,
				auctionKey ? notificationScopes.auctionSettlement(auctionKey) : undefined,
			),
	}
}

/** The app's read-state layer — one per browser session, over the shared instance and its localStorage port. */
export const readMarks: ReadMarks = createReadMarks(appNotifications)

/** Re-export the port factories so a host (and the tests) build a mark set the same way this layer does. */
export { createMemoryReadMarkPort }
export type { ReadMarkPort, KeyValueStoragePort }
