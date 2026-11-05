/**
 * platform/web/payments/payAggregatorStore.ts — durable persistence for the pay aggregator's
 * SetStore (set records + indexes) and the bolt11 wrapper's Bolt11LegStore (leg records).
 *
 * Both are backed by localStorage so that set state and bolt11 leg records survive a page reload.
 * The key pattern mirrors `invoiceStorage.ts` (the project's existing localStorage home).
 */
import type { Bolt11LegKey, Bolt11LegRecord, Bolt11LegStore } from '@sdk/core/bolt11-wrapper'
import type { SetRecord, SetStore } from '@sdk/core/wallet'

// ---------------------------------------------------------------------------
// Set store persistence
// ---------------------------------------------------------------------------

const SET_STORAGE_KEY = 'market_pay_aggregator_sets_v1'

const readSets = (): Record<string, SetRecord> => {
	try {
		const raw = localStorage.getItem(SET_STORAGE_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch {
		return {}
	}
}

const writeSets = (sets: Record<string, SetRecord>) => {
	try {
		localStorage.setItem(SET_STORAGE_KEY, JSON.stringify(sets))
	} catch {
		// best-effort persistence
	}
}

const deepCopySet = (record: SetRecord): SetRecord => ({
	...record,
	legs: record.legs.map((leg) => ({
		...leg,
		operations: [...leg.operations],
		plan: [...leg.plan],
		witness: leg.witness ? { ...leg.witness } : undefined,
	})),
})

/**
 * Durable SetStore backed by localStorage.
 *
 * Persists set records, the hash-to-set index, and the refund index so that
 * set state survives a page reload. The CAS discipline (compareAndSet) is
 * enforced in-memory; the storage itself is best-effort JSON.
 */
export class LocalSetStore implements SetStore {
	private readonly sets = new Map<string, SetRecord>()
	private readonly byHash = new Map<string, { setId: string; legId: string }>()
	private readonly refunds = new Map<string, string>()

	constructor() {
		const stored = readSets()
		for (const [setId, record] of Object.entries(stored)) {
			this.sets.set(setId, deepCopySet(record))
		}
	}

	async createOrGet(record: SetRecord): Promise<{ record: SetRecord; created: boolean }> {
		const current = this.sets.get(record.setId)
		if (current) return { record: deepCopySet(current), created: false }
		this.sets.set(record.setId, deepCopySet(record))
		writeSets(Object.fromEntries(this.sets))
		return { record: deepCopySet(record), created: true }
	}

	async get(setId: string): Promise<SetRecord | null> {
		const record = this.sets.get(setId)
		return record ? deepCopySet(record) : null
	}

	async list(): Promise<readonly SetRecord[]> {
		return [...this.sets.values()].map(deepCopySet)
	}

	async compareAndSet(setId: string, expectedRevision: number, next: SetRecord): Promise<SetRecord> {
		const current = this.sets.get(setId)
		if (!current || current.revision !== expectedRevision) {
			throw new Error('pay_stale_writer')
		}
		if (next.revision !== expectedRevision + 1) {
			throw new Error('pay_stale_writer')
		}
		this.sets.set(setId, deepCopySet(next))
		writeSets(Object.fromEntries(this.sets))
		return deepCopySet(next)
	}

	async claimedLegByHash(paymentHash: string): Promise<{ setId: string; legId: string } | null> {
		return this.byHash.get(paymentHash) ?? null
	}

	async claimHash(paymentHash: string, setId: string, legId: string): Promise<void> {
		this.byHash.set(paymentHash, { setId, legId })
	}

	async refundForOrder(orderId: string): Promise<string | null> {
		return this.refunds.get(orderId) ?? null
	}

	async recordRefund(orderId: string, setId: string): Promise<void> {
		this.refunds.set(orderId, setId)
		writeSets(Object.fromEntries(this.sets))
	}

	/** Load a specific set by orderId — iterates persisted records to find matching sets. */
	async getByOrderId(orderId: string): Promise<SetRecord | null> {
		const records = await this.list()
		return records.find((r) => r.orderId === orderId && r.direction === 'purchase') ?? null
	}
}

// ---------------------------------------------------------------------------
// Bolt11 leg store persistence
// ---------------------------------------------------------------------------

const BOLT11_STORAGE_KEY = 'market_bolt11_legs_v1'

const readBolt11Legs = (): Record<string, Bolt11LegRecord> => {
	try {
		const raw = localStorage.getItem(BOLT11_STORAGE_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch {
		return {}
	}
}

const writeBolt11Legs = (legs: Record<string, Bolt11LegRecord>) => {
	try {
		localStorage.setItem(BOLT11_STORAGE_KEY, JSON.stringify(legs))
	} catch {
		// best-effort persistence
	}
}

const keyOf = (key: Bolt11LegKey): string => `${key.wrapperId}\u0000${key.legId}`

/**
 * Durable Bolt11LegStore backed by localStorage.
 *
 * Persists leg records so that the bolt11 wrapper can reconcile a leg
 * even after a page reload. The CAS discipline is enforced in-memory.
 */
export class LocalBolt11LegStore implements Bolt11LegStore {
	private readonly legs = new Map<string, Bolt11LegRecord>()

	constructor() {
		const stored = readBolt11Legs()
		for (const [legKey, record] of Object.entries(stored)) {
			this.legs.set(legKey, { ...record })
		}
	}

	async createOrGet(record: Bolt11LegRecord): Promise<{ record: Bolt11LegRecord; created: boolean }> {
		const existing = this.legs.get(keyOf({ wrapperId: record.wrapperId, legId: record.legId }))
		if (existing) return { record: { ...existing }, created: false }
		const copy = { ...record }
		this.legs.set(keyOf({ wrapperId: record.wrapperId, legId: record.legId }), copy)
		writeBolt11Legs(Object.fromEntries(this.legs))
		return { record: copy, created: true }
	}

	async get(key: Bolt11LegKey): Promise<Bolt11LegRecord | null> {
		const record = this.legs.get(keyOf(key))
		return record ? { ...record } : null
	}

	async list(wrapperId?: string): Promise<readonly Bolt11LegRecord[]> {
		return [...this.legs.values()]
			.filter((r) => !wrapperId || r.wrapperId === wrapperId)
			.map((r) => ({ ...r }))
	}

	async compareAndSet(key: Bolt11LegKey, expectedRevision: number, next: Bolt11LegRecord): Promise<Bolt11LegRecord> {
		const current = this.legs.get(keyOf(key))
		if (!current || current.revision !== expectedRevision) {
			throw new Error('bolt11_stale_writer')
		}
		if (next.revision !== expectedRevision + 1) {
			throw new Error('bolt11_stale_writer')
		}
		const copy = { ...next }
		this.legs.set(keyOf(key), copy)
		writeBolt11Legs(Object.fromEntries(this.legs))
		return copy
	}
}

// ---------------------------------------------------------------------------
// Public API: orderId → setId mapping for the orders view
// ---------------------------------------------------------------------------

const SET_MAPPING_KEY = 'market_set_order_mapping_v1'

const readSetMapping = (): Record<string, string> => {
	try {
		const raw = localStorage.getItem(SET_MAPPING_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch {
		return {}
	}
}

const writeSetMapping = (mapping: Record<string, string>) => {
	try {
		localStorage.setItem(SET_MAPPING_KEY, JSON.stringify(mapping))
	} catch {
		// best-effort
	}
}

/**
 * Map an orderId to its purchase setId so the orders view can locate the set.
 */
export function persistSetForOrder(orderId: string, setId: string): void {
	const mapping = readSetMapping()
	mapping[orderId] = setId
	writeSetMapping(mapping)
}

/**
 * Resolve the purchase setId for an orderId (used by the orders view).
 */
export function resolveSetIdForOrder(orderId: string): string | null {
	return readSetMapping()[orderId] ?? null
}
