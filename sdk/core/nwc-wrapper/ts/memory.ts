/**
 * nwc-wrapper/ts/memory.ts — the test-only in-memory leg store.
 *
 * Test support, out of contract: it mints no statement and cites `#47312b` only as provenance — it implements
 * the leg-store contract that statement declares. Production composers provide a durable atomic
 * compare-and-set store; this one exists so the conformance suite can drive the port with no store of its own
 * and no live network.
 */
import { NwcWrapperError } from './errors'
import type { NwcLegKey, NwcLegRecord, NwcLegStore } from './types'

const copy = (record: NwcLegRecord): NwcLegRecord => ({
	...record,
	operations: [...record.operations] as NwcLegRecord['operations'],
	plan: [...record.plan],
	witness: record.witness ? { ...record.witness } : undefined,
})

const keyOf = (key: NwcLegKey): string => `${key.wrapperId}\u0000${key.legId}`

const sameKey = (record: NwcLegRecord, key: NwcLegKey): boolean => record.wrapperId === key.wrapperId && record.legId === key.legId

const sameImmutableIdentity = (left: NwcLegRecord, right: NwcLegRecord): boolean =>
	left.wrapperId === right.wrapperId &&
	left.legId === right.legId &&
	left.kind === right.kind &&
	left.method === right.method &&
	left.invoice === right.invoice &&
	left.paymentHash === right.paymentHash &&
	left.requestEventId === right.requestEventId &&
	left.createdAt === right.createdAt

/** `#47312b` MemoryNwcLegStore — a test-only leg store keyed per wrapper and leg, with a revision CAS. */
export class MemoryNwcLegStore implements NwcLegStore {
	private readonly records = new Map<string, NwcLegRecord>()

	async createOrGet(record: NwcLegRecord): Promise<{ record: NwcLegRecord; created: boolean }> {
		const current = this.records.get(keyOf(record))
		if (current) return { record: copy(current), created: false }
		this.records.set(keyOf(record), copy(record))
		return { record: copy(record), created: true }
	}

	async get(key: NwcLegKey): Promise<NwcLegRecord | null> {
		const record = this.records.get(keyOf(key))
		return record ? copy(record) : null
	}

	async list(wrapperId?: string): Promise<readonly NwcLegRecord[]> {
		return [...this.records.values()].filter((record) => !wrapperId || record.wrapperId === wrapperId).map(copy)
	}

	async compareAndSet(key: NwcLegKey, expectedRevision: number, next: NwcLegRecord): Promise<NwcLegRecord> {
		const current = this.records.get(keyOf(key))
		if (!current || current.revision !== expectedRevision) {
			throw new NwcWrapperError('nwc_stale_writer', `leg ${key.wrapperId}/${key.legId} is stale`)
		}
		if (!sameKey(next, key) || !sameImmutableIdentity(current, next)) {
			throw new NwcWrapperError('nwc_command_conflict', `leg ${key.wrapperId}/${key.legId} changed intent`)
		}
		if (next.revision !== expectedRevision + 1) {
			throw new NwcWrapperError('nwc_stale_writer', `leg ${key.wrapperId}/${key.legId} is stale`)
		}
		this.records.set(keyOf(key), copy(next))
		return copy(next)
	}
}
