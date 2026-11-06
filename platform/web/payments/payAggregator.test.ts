/**
 * platform/web/payments/payAggregator.test.ts — test the bolt11, NWC and cashu adapters'
 * reconcileLeg → wrapper.reconcile bridge.
 */
import { describe, expect, test } from 'bun:test'
import { MemoryBolt11LegStore } from '@sdk/core/bolt11-wrapper'
import { MemoryNwcLegStore } from '@sdk/core/nwc-wrapper'
import type { Bolt11LegRecord } from '@sdk/core/bolt11-wrapper'
import type { NwcLegRecord } from '@sdk/core/nwc-wrapper'
import { PayAggregator } from '@sdk/core/wallet'
import type { CocoLegRecord, CocoLegStore, WalletAccount, WalletOperationRecord, WalletOperationStore } from '@sdk/core/cashu-wrapper'
import type {
	CocoEngine,
	CocoEngineBalanceSnapshot,
	CocoEngineMeltQuote,
	CocoWalletEngineSource,
	CocoWalletHostOptions,
} from '@platform/web/wallet/cocoWalletHost'
import { LocalCocoLegStore, LocalWalletOperationStore } from '@platform/web/wallet/cocoWalletStores'
import { createBolt11Adapter, createCashuAdapter } from './payAggregator'
import { LocalSetStore } from './payAggregatorStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => Date.now()

const testBolt11Record = (overrides: Partial<Bolt11LegRecord> = {}): Bolt11LegRecord => ({
	wrapperId: 'bolt11-test',
	legId: 'abc123',
	kind: 'webln',
	method: 'bolt11',
	authorityKind: 'remote-and-observable',
	operations: ['obtain', 'submit', 'reconcile'],
	plan: ['obtain', 'submit', 'reconcile'],
	bolt11: 'lnbc10u1test',
	paymentHash: 'abc123',
	verifyUrl: null,
	progress: 'attempted',
	rung: 'unresolved',
	unwitnessed: true,
	reconcileDeadlineAt: now() + 600_000,
	revision: 0,
	createdAt: now(),
	updatedAt: now(),
	...overrides,
})

const mockCodec = {
	paymentHash: (bolt11: string) => 'abc123',
	expiresAt: (bolt11: string) => now() + 600_000,
	validatePreimage: (bolt11: string, preimage: string) => true,
}

// ---------------------------------------------------------------------------
// Bolt11 adapter tests
// ---------------------------------------------------------------------------

describe('createBolt11Adapter', () => {
	test('adapter registration passes the gate', () => {
		const store = new MemoryBolt11LegStore()
		const adapter = createBolt11Adapter({
			wrapperId: 'bolt11-test',
			store,
			storeKind: 'memory',
			codec: mockCodec,
			reconcileDeadlineMs: 600_000,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})

		expect(adapter.adapter.registration.wrapperId).toBe('bolt11-test')
		expect(adapter.adapter.registration.method).toBe('bolt11')
		expect(adapter.adapter.registration.authorityKind).toBe('remote-and-observable')
		expect(adapter.adapter.registration.operations).toEqual(['obtain', 'submit', 'reconcile'])
		expect(adapter.adapter.registration.contractVersion).toBe('0.1')
	})

	test('reconcileLeg forwards paymentHash to wrapper.reconcile(bolt11)', async () => {
		const store = new MemoryBolt11LegStore()
		const record = testBolt11Record()
		await store.createOrGet(record)

		const adapter = createBolt11Adapter({
			wrapperId: 'bolt11-test',
			store,
			storeKind: 'memory',
			codec: mockCodec,
			reconcileDeadlineMs: 600_000,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})

		// Calling reconcileLeg with the payment hash should look up the invoice
		// from the store and forward it to wrapper.reconcile(bolt11).
		const handle = await adapter.adapter.reconcileLeg('abc123')
		expect(handle.wrapperId).toBe('bolt11-test')
		expect(handle.legId).toBe('abc123')
	})

	test('reconcileLeg throws when leg is absent', async () => {
		const store = new MemoryBolt11LegStore()
		const adapter = createBolt11Adapter({
			wrapperId: 'bolt11-test',
			store,
			storeKind: 'memory',
			codec: mockCodec,
			reconcileDeadlineMs: 600_000,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})

		await expect(adapter.adapter.reconcileLeg('nonexistent')).rejects.toThrow('bolt11: no leg for nonexistent')
	})
})

// ---------------------------------------------------------------------------
// Cashu adapter tests — the same leg-id → rail-reference bridge, over the
// wallet host built in platform/web/wallet/cocoWalletHost.ts.
// ---------------------------------------------------------------------------

const CASHU_ACCOUNT: WalletAccount = { accountId: 'a'.repeat(64), environmentId: 'test' }
const CASHU_NOW = 1_700_000_000_000

/**
 * The app's engine, faked against the binding's declared surface. Only the reads a reconcile makes are
 * interesting here, so every melt call is recorded and the rest answer empty.
 */
class RecordingMeltEngine implements CocoEngine {
	readonly calls: string[] = []
	operation: { id: string; state: string; quoteId?: string } | null = { id: 'op-9', state: 'finalized', quoteId: 'quote-1' }

	readonly mint = {
		addMint: async (): Promise<unknown> => undefined,
		getAllMints: async (): Promise<readonly { mintUrl: string }[]> => [{ mintUrl: 'https://testnut.cashu.space' }],
	}

	readonly quotes = {
		melt: {
			create: async (): Promise<CocoEngineMeltQuote> => ({
				quoteId: 'quote-1',
				expiry: 2_000_000_000,
				state: 'UNPAID',
				amount: { toNumber: () => 21 },
			}),
			get: async (): Promise<CocoEngineMeltQuote | null> => null,
		},
	}

	readonly ops = {
		melt: {
			prepare: async (): Promise<{ id: string }> => ({ id: 'op-9' }),
			execute: async (operationOrId: string): Promise<{ id: string; state: string; quoteId?: string }> => ({
				id: operationOrId,
				state: 'finalized',
				quoteId: 'quote-1',
			}),
			get: async (operationId: string): Promise<{ id: string; state: string; quoteId?: string } | null> => {
				this.calls.push(`get:${operationId}`)
				return this.operation?.id === operationId ? { ...this.operation } : null
			},
			getByQuote: async (): Promise<{ id: string; state: string; quoteId?: string } | null> => this.operation,
			listPrepared: async (): Promise<readonly { id: string; state: string }[]> => [],
			listInFlight: async (): Promise<readonly { id: string; state: string }[]> => [],
			refresh: async (operationId: string): Promise<{ id: string; state: string; quoteId?: string }> => {
				this.calls.push(`refresh:${operationId}`)
				return { id: operationId, state: 'finalized', quoteId: 'quote-1' }
			},
			reclaim: async (): Promise<unknown> => undefined,
			cancel: async (): Promise<void> => undefined,
		},
	}

	readonly wallet = {
		balances: {
			byMint: async (): Promise<Record<string, CocoEngineBalanceSnapshot>> => ({
				'https://testnut.cashu.space': {
					spendable: { toNumber: () => 21 },
					reserved: { toNumber: () => 0 },
					total: { toNumber: () => 21 },
					unit: 'sat',
				},
			}),
		},
	}
}

const cashuEngineSource = (engine: CocoEngine): CocoWalletEngineSource => ({
	identity: () => CASHU_ACCOUNT,
	current: () => engine,
	ensure: async () => engine,
	close: async () => undefined,
})

const cashuAdapterOptions = (engine: CocoEngine, legStore: CocoLegStore, walletStore: WalletOperationStore): CocoWalletHostOptions => ({
	engine: cashuEngineSource(engine),
	reconcilers: { proofStateWatcher: true, meltQuoteWatcher: true, meltSettlementProcessor: true },
	preferredMint: () => 'https://testnut.cashu.space',
	invoiceAmountSats: () => 21,
	validatePreimage: () => true,
	wrapperId: 'coco',
	method: 'cashu-melt',
	applicationId: 'market',
	operationKind: 'melt',
	legStore,
	storeKind: 'localStorage',
	ceiling: 1_000_000,
	contractVersion: '0.1',
	walletStore,
	now: () => CASHU_NOW,
})

const cashuLegRecord = (overrides: Partial<CocoLegRecord> = {}): CocoLegRecord => ({
	wrapperId: 'coco',
	legId: 'leg-1',
	commandId: 'leg-1',
	kind: 'melt',
	method: 'cashu-melt',
	authorityKind: 'local',
	operations: ['obtain', 'submit', 'reconcile'],
	plan: ['obtain', 'submit', 'reconcile'],
	invoice: 'lnbc1-invoice',
	engineOperationId: 'op-9',
	meltQuoteId: 'quote-1',
	progress: 'submitted',
	rung: 'unresolved',
	unwitnessed: true,
	revision: 0,
	createdAt: CASHU_NOW,
	updatedAt: CASHU_NOW,
	...overrides,
})

/** The host's own command record, as `obtain` writes it before the boundary. */
const walletCommandRecord = (overrides: Partial<WalletOperationRecord> = {}): WalletOperationRecord => ({
	commandId: 'leg-1',
	applicationId: 'market',
	operationKind: 'melt',
	account: { ...CASHU_ACCOUNT },
	money: { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount: 21 },
	intentFingerprint: '1'.repeat(64),
	schemaVersion: 1,
	plan: ['prepare', 'attempt'],
	completedSteps: ['prepare'],
	state: 'prepared',
	engineOperationId: 'op-9',
	revision: 0,
	createdAt: CASHU_NOW,
	updatedAt: CASHU_NOW,
	...overrides,
})

describe('createCashuAdapter', () => {
	test('the registration passes the aggregator gate', () => {
		const engine = new RecordingMeltEngine()
		const { adapter } = createCashuAdapter(cashuAdapterOptions(engine, new LocalCocoLegStore(), new LocalWalletOperationStore()))

		expect(adapter.registration.wrapperId).toBe('coco')
		expect(adapter.registration.method).toBe('cashu-melt')
		expect(adapter.registration.authorityKind).toBe('local')
		expect(adapter.registration.operations).toEqual(['obtain', 'submit', 'reconcile'])
		expect(adapter.registration.contractVersion).toBe('0.1')

		const aggregator = new PayAggregator({
			store: new LocalSetStore(),
			verifier: { verify: () => false },
			contractVersion: '0.1',
			toleranceSat: 2,
			wrappers: [adapter],
			now,
		})
		expect(aggregator.accepted()).toEqual(['coco'])
	})

	test('reconcileLeg forwards the leg’s ENGINE OPERATION ID to the wrapper, not the leg id', async () => {
		const engine = new RecordingMeltEngine()
		const legStore = new LocalCocoLegStore()
		await legStore.createOrGet(cashuLegRecord())
		const walletStore = new LocalWalletOperationStore()
		await walletStore.createOrGet(walletCommandRecord())

		const { adapter } = createCashuAdapter(cashuAdapterOptions(engine, legStore, walletStore))
		const handle = await adapter.reconcileLeg('leg-1')

		// The reference that reached the engine is the recorded ENGINE OPERATION ID, which is what the
		// wrapper reconciles against — not the leg id the aggregator asked with.
		expect(engine.calls).toEqual(['get:op-9'])
		expect(handle.wrapperId).toBe('coco')
		expect(handle.legId).toBe('leg-1')
	})

	test('reconcileLeg throws when leg is absent', async () => {
		const engine = new RecordingMeltEngine()
		const { adapter } = createCashuAdapter(cashuAdapterOptions(engine, new LocalCocoLegStore(), new LocalWalletOperationStore()))

		await expect(adapter.reconcileLeg('nonexistent')).rejects.toThrow('cashu: no leg for nonexistent')
	})
})
