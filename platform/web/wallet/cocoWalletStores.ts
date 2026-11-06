/**
 * platform/web/wallet/cocoWalletStores.ts — the two durable stores the Coco wallet host binding needs:
 * the host's own command store (`WalletOperationStore`) and the Coco wrapper's leg store
 * (`CocoLegStore`).
 *
 * Both are backed by localStorage so that a cashu leg's durable state survives a page reload — which is
 * the whole point of the leg record: the melt quote id and the engine's operation id are retained
 * BEFORE the proofs are spent, so a reload in the middle of a melt is reconciled against the record
 * rather than re-melted. The key pattern mirrors `payments/payAggregatorStore.ts` (the project's
 * existing localStorage home for the other rails' leg records).
 *
 * Both enforce their contract's CAS discipline in the write path and reject a stale revision with the
 * SDK's own typed error, so a second writer can never silently overwrite a settled leg. The immutable
 * identity check on the command store is the same one the SDK's reference store applies: a command's
 * declared intent may not change under a later revision.
 */
import { WalletCommandConflictError, WalletStaleWriterError } from '@sdk/core/cashu-wrapper'
import type {
	CocoLegKey,
	CocoLegRecord,
	CocoLegStore,
	WalletAccount,
	WalletOperationRecord,
	WalletOperationStore,
} from '@sdk/core/cashu-wrapper'

// ---------------------------------------------------------------------------
// The wallet host's command store
// ---------------------------------------------------------------------------

const OPERATIONS_STORAGE_KEY = 'market_wallet_operation_records_v1'

const readOperations = (): Record<string, WalletOperationRecord> => {
	try {
		const raw = localStorage.getItem(OPERATIONS_STORAGE_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch {
		return {}
	}
}

const writeOperations = (records: Record<string, WalletOperationRecord>): void => {
	try {
		localStorage.setItem(OPERATIONS_STORAGE_KEY, JSON.stringify(records))
	} catch {
		// best-effort persistence, exactly as the other rails' stores
	}
}

const copyOperation = (record: WalletOperationRecord): WalletOperationRecord => ({
	...record,
	account: { ...record.account },
	money: { ...record.money },
	plan: [...record.plan],
	completedSteps: [...record.completedSteps],
})

const sameAccount = (left: WalletAccount, right: WalletAccount): boolean =>
	left.accountId === right.accountId && left.environmentId === right.environmentId

/**
 * The command's immutable identity: none of these may differ between revisions, so a store that finds a
 * difference refuses the write rather than letting a later revision re-point the command's money.
 */
const sameImmutableIdentity = (left: WalletOperationRecord, right: WalletOperationRecord): boolean =>
	left.commandId === right.commandId &&
	left.applicationId === right.applicationId &&
	left.operationKind === right.operationKind &&
	sameAccount(left.account, right.account) &&
	left.money.mintUrl === right.money.mintUrl &&
	left.money.unit === right.money.unit &&
	left.money.amount === right.money.amount &&
	left.intentFingerprint === right.intentFingerprint &&
	left.plan.length === right.plan.length &&
	left.plan.every((step, index) => step === right.plan[index]) &&
	left.createdAt === right.createdAt

/**
 * Durable `WalletOperationStore` backed by localStorage.
 *
 * It keeps one record per command id, mirrors every committed revision to localStorage, and refuses a
 * write whose revision is not the expected one or whose immutable identity differs.
 */
export class LocalWalletOperationStore implements WalletOperationStore {
	private readonly records = new Map<string, WalletOperationRecord>()

	constructor() {
		const stored = readOperations()
		for (const [commandId, record] of Object.entries(stored)) {
			this.records.set(commandId, copyOperation(record))
		}
	}

	async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
		const current = this.records.get(record.commandId)
		if (current) return { record: copyOperation(current), created: false }
		const candidate = copyOperation(record)
		this.records.set(record.commandId, candidate)
		writeOperations(Object.fromEntries(this.records))
		return { record: copyOperation(candidate), created: true }
	}

	async get(commandId: string): Promise<WalletOperationRecord | null> {
		const record = this.records.get(commandId)
		return record ? copyOperation(record) : null
	}

	async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
		return [...this.records.values()].filter((record) => !account || sameAccount(record.account, account)).map(copyOperation)
	}

	async compareAndSet(commandId: string, expectedRevision: number, next: WalletOperationRecord): Promise<WalletOperationRecord> {
		const current = this.records.get(commandId)
		if (!current || current.revision !== expectedRevision) throw new WalletStaleWriterError(commandId)
		if (!sameImmutableIdentity(current, next)) throw new WalletCommandConflictError(commandId)
		if (next.revision !== expectedRevision + 1) throw new WalletStaleWriterError(commandId)
		const committed = copyOperation(next)
		this.records.set(commandId, committed)
		writeOperations(Object.fromEntries(this.records))
		return copyOperation(committed)
	}
}

// ---------------------------------------------------------------------------
// The Coco wrapper's leg store
// ---------------------------------------------------------------------------

const LEGS_STORAGE_KEY = 'market_coco_leg_records_v1'

const readLegs = (): Record<string, CocoLegRecord> => {
	try {
		const raw = localStorage.getItem(LEGS_STORAGE_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch {
		return {}
	}
}

const writeLegs = (legs: Record<string, CocoLegRecord>): void => {
	try {
		localStorage.setItem(LEGS_STORAGE_KEY, JSON.stringify(legs))
	} catch {
		// best-effort persistence
	}
}

/** The leg store's key, the same shape the other rails' stores use: never a bare id. */
const legKeyOf = (key: CocoLegKey): string => `${key.wrapperId}\u0000${key.legId}`

const copyLeg = (record: CocoLegRecord): CocoLegRecord => ({
	...record,
	operations: [...record.operations] as CocoLegRecord['operations'],
	plan: [...record.plan],
	witness: record.witness ? { ...record.witness } : undefined,
})

/**
 * Durable `CocoLegStore` backed by localStorage.
 *
 * The leg record carries the leg's durable reference (the engine's operation id, the mint's melt quote
 * id and the quote's absolute expiry) and no bearer material, so persisting it is what lets a reconcile
 * after a reload read the engine's own operation instead of asking the mint again.
 */
export class LocalCocoLegStore implements CocoLegStore {
	private readonly legs = new Map<string, CocoLegRecord>()

	constructor() {
		const stored = readLegs()
		for (const [key, record] of Object.entries(stored)) {
			this.legs.set(key, copyLeg(record))
		}
	}

	async createOrGet(record: CocoLegRecord): Promise<{ record: CocoLegRecord; created: boolean }> {
		const existing = this.legs.get(legKeyOf({ wrapperId: record.wrapperId, legId: record.legId }))
		if (existing) return { record: copyLeg(existing), created: false }
		const candidate = copyLeg(record)
		this.legs.set(legKeyOf({ wrapperId: record.wrapperId, legId: record.legId }), candidate)
		writeLegs(Object.fromEntries(this.legs))
		return { record: copyLeg(candidate), created: true }
	}

	async get(key: CocoLegKey): Promise<CocoLegRecord | null> {
		const record = this.legs.get(legKeyOf(key))
		return record ? copyLeg(record) : null
	}

	async list(wrapperId?: string): Promise<readonly CocoLegRecord[]> {
		return [...this.legs.values()].filter((record) => !wrapperId || record.wrapperId === wrapperId).map(copyLeg)
	}

	async compareAndSet(key: CocoLegKey, expectedRevision: number, next: CocoLegRecord): Promise<CocoLegRecord> {
		const current = this.legs.get(legKeyOf(key))
		if (!current || current.revision !== expectedRevision || next.revision !== expectedRevision + 1) {
			throw new WalletStaleWriterError(key.legId)
		}
		const committed = copyLeg(next)
		this.legs.set(legKeyOf(key), committed)
		writeLegs(Object.fromEntries(this.legs))
		return copyLeg(committed)
	}
}
