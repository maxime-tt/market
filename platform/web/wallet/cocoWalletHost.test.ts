/**
 * platform/web/wallet/cocoWalletHost.test.ts — the Coco wallet host binding's conformance suite.
 *
 * It proves the three things the binding owes the cashu rail:
 *   1. the host composes over the APP'S OWN engine — every melt call is the app's own
 *      (`quotes.melt.create` → `ops.melt.prepare` → `ops.melt.execute`, the calls `cashuActions.melt`
 *      and the withdraw host make) and nothing here invents an engine;
 *   2. a missing or REFUSED host path fails closed — no engine, no signed-in identity, another
 *      account's identity, or an unattached port adapter all stop before anything is spent;
 *   3. the leg's declared amount and the mint's quote must be the same money.
 *
 * The engine is a fake implementing the binding's declared structural surface, so the suite runs with
 * no mint, no IndexedDB and no network — and asserts on the call log rather than on the mock's effects.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { CocoPortAdapterError, CocoWalletPortAdapter } from '@sdk/core/cashu-wrapper'
import type { CocoLegCommand, CocoLegStore, CocoReconcilerStatus, WalletAccount } from '@sdk/core/cashu-wrapper'
import type { FundsQuote, FundsRefusal } from '@sdk/core/funds-contract'
import { LocalCocoLegStore, LocalWalletOperationStore } from './cocoWalletStores'
import {
	CocoWalletBindingError,
	createCocoMeltRail,
	createCocoOperationPort,
	createCocoWalletHost,
	type CocoEngine,
	type CocoEngineBalanceSnapshot,
	type CocoEngineMeltQuote,
	type CocoWalletEngineSource,
	type CocoWalletHostOptions,
} from './cocoWalletHost'

const WRAPPER_ID = 'coco'
const METHOD = 'cashu-melt'
const APPLICATION_ID = 'market'
const OPERATION_KIND = 'melt'
const CONTRACT_VERSION = '1.0.0'
const CEILING = 1_000_000
const MINT = 'https://testnut.cashu.space'
const OTHER_MINT = 'https://other.example'
const ACCOUNT: WalletAccount = { accountId: 'a'.repeat(64), environmentId: 'test' }

const RECONCILERS: CocoReconcilerStatus = { proofStateWatcher: true, meltQuoteWatcher: true, meltSettlementProcessor: true }

const amount = (value: number): { toNumber: () => number } => ({ toNumber: () => value })

/**
 * The app's engine, faked against the binding's declared surface: every call is recorded, and each
 * melt state the rail has to project is settable so a test can drive one path at a time.
 */
class FakeCocoEngine implements CocoEngine {
	readonly calls: string[] = []
	mintUrls = [MINT]
	quoteId = 'quote-1'
	quoteState = 'UNPAID'
	quoteExpirySeconds = 2_000_000_000
	quoteAmount = 21
	quotePreimage: string | undefined = undefined
	preparedOperationId = 'op-1'
	executedState = 'finalized'
	executedPreimage: string | undefined = 'PREIMAGE'
	knownOperationIds = ['op-1']
	operationState = 'finalized'
	refreshedState = 'finalized'
	balances: Record<string, CocoEngineBalanceSnapshot> = {
		[MINT]: { spendable: amount(90), reserved: amount(3), total: amount(93), unit: 'sat' },
		[OTHER_MINT]: { spendable: amount(7), reserved: amount(0), total: amount(7), unit: 'sat' },
	}

	readonly mint = {
		addMint: async (mintUrl: string): Promise<unknown> => {
			this.calls.push(`addMint:${mintUrl}`)
			return { mintUrl }
		},
		getAllMints: async (): Promise<readonly { mintUrl: string }[]> => {
			this.calls.push('getAllMints')
			return this.mintUrls.map((mintUrl) => ({ mintUrl }))
		},
	}

	readonly quotes = {
		melt: {
			create: async (input: {
				mintUrl: string
				method: 'bolt11'
				methodData: { invoice: string; amountSats?: number }
			}): Promise<CocoEngineMeltQuote> => {
				this.calls.push(`createQuote:${input.mintUrl}:${input.methodData.amountSats ?? 'from-invoice'}`)
				return {
					quoteId: this.quoteId,
					expiry: this.quoteExpirySeconds,
					state: this.quoteState,
					amount: amount(this.quoteAmount),
					payment_preimage: this.quotePreimage,
				}
			},
			get: async (input: { mintUrl: string; quoteId: string }): Promise<CocoEngineMeltQuote | null> => {
				this.calls.push(`getQuote:${input.mintUrl}:${input.quoteId}`)
				if (input.mintUrl !== MINT || input.quoteId !== this.quoteId) return null
				return {
					quoteId: this.quoteId,
					expiry: this.quoteExpirySeconds,
					state: this.quoteState,
					amount: amount(this.quoteAmount),
					payment_preimage: this.quotePreimage,
				}
			},
		},
	}

	readonly ops = {
		melt: {
			prepare: async (input: { quote: { mintUrl: string; quoteId: string; method: string } }): Promise<{ id: string }> => {
				this.calls.push(`prepare:${input.quote.mintUrl}:${input.quote.quoteId}`)
				this.knownOperationIds = [...new Set([...this.knownOperationIds, this.preparedOperationId])]
				return { id: this.preparedOperationId }
			},
			execute: async (
				operationOrId: string,
			): Promise<{ id: string; state: string; quoteId?: string; finalizedData?: { preimage?: string } }> => {
				this.calls.push(`execute:${operationOrId}`)
				return {
					id: operationOrId,
					state: this.executedState,
					quoteId: this.quoteId,
					...(this.executedPreimage ? { finalizedData: { preimage: this.executedPreimage } } : {}),
				}
			},
			get: async (operationId: string): Promise<{ id: string; state: string; quoteId?: string } | null> => {
				this.calls.push(`get:${operationId}`)
				return this.knownOperationIds.includes(operationId) ? { id: operationId, state: this.operationState, quoteId: this.quoteId } : null
			},
			getByQuote: async (input: { mintUrl: string; quoteId: string }): Promise<{ id: string; state: string; quoteId?: string } | null> => {
				this.calls.push(`getByQuote:${input.quoteId}`)
				if (input.mintUrl !== MINT || input.quoteId !== this.quoteId) return null
				return { id: this.preparedOperationId, state: this.operationState, quoteId: this.quoteId }
			},
			listPrepared: async (): Promise<readonly { id: string; state: string }[]> => {
				this.calls.push('listPrepared')
				return []
			},
			listInFlight: async (): Promise<readonly { id: string; state: string }[]> => {
				this.calls.push('listInFlight')
				return []
			},
			refresh: async (operationId: string): Promise<{ id: string; state: string; quoteId?: string }> => {
				this.calls.push(`refresh:${operationId}`)
				return { id: operationId, state: this.refreshedState, quoteId: this.quoteId }
			},
			reclaim: async (operationId: string): Promise<unknown> => {
				this.calls.push(`reclaim:${operationId}`)
				this.operationState = 'rolled_back'
				return undefined
			},
			cancel: async (operationId: string): Promise<void> => {
				this.calls.push(`cancel:${operationId}`)
			},
		},
	}

	readonly wallet = {
		balances: {
			byMint: async (): Promise<Record<string, CocoEngineBalanceSnapshot>> => {
				this.calls.push('byMint')
				return this.balances
			},
		},
	}
}

const engineSource = (engine: CocoEngine | null, overrides: Partial<CocoWalletEngineSource> = {}): CocoWalletEngineSource => ({
	identity: () => ACCOUNT,
	current: () => engine,
	ensure: async () => engine,
	close: async () => undefined,
	...overrides,
})

const hostOptions = (engine: CocoWalletEngineSource, overrides: Partial<CocoWalletHostOptions> = {}): CocoWalletHostOptions => ({
	engine,
	reconcilers: RECONCILERS,
	preferredMint: () => MINT,
	invoiceAmountSats: () => 21,
	validatePreimage: () => true,
	wrapperId: WRAPPER_ID,
	method: METHOD,
	applicationId: APPLICATION_ID,
	operationKind: OPERATION_KIND,
	legStore: new LocalCocoLegStore(),
	storeKind: 'localStorage',
	ceiling: CEILING,
	contractVersion: CONTRACT_VERSION,
	walletStore: new LocalWalletOperationStore(),
	now: () => 1_700_000_000_000,
	...overrides,
})

const command = (overrides: Partial<CocoLegCommand> = {}): CocoLegCommand => ({
	legId: 'leg-1',
	applicationId: APPLICATION_ID,
	operationKind: OPERATION_KIND,
	account: { ...ACCOUNT },
	money: { mintUrl: MINT, unit: 'sat', amount: 21 },
	invoice: 'lnbc1-invoice',
	intentFingerprint: '1'.repeat(64),
	...overrides,
})

const quoteOf = (result: FundsQuote | FundsRefusal): FundsQuote => {
	if ('refused' in result) throw new Error(`expected a quote, got a refusal on ${result.field}`)
	return result
}

beforeEach(() => {
	if (typeof localStorage !== 'undefined') localStorage.clear()
})

describe('the host composes over the app’s own engine', () => {
	test('obtain claims the command, then creates the melt quote and prepares the operation on the app’s engine', async () => {
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine)))

		const quote = quoteOf(await portAdapter.obtain(command()))

		// The reference is the ENGINE's operation id — the durable reference the reconcile reads.
		expect(quote.reference).toBe('op-1')
		expect(quote.authorityKind).toBe('local')
		expect(quote.plan).toEqual(['obtain', 'submit', 'reconcile'])
		// The mint is trusted, the quote is created against the wallet's own mint, and the operation is
		// prepared — the app's own melt calls, in the app's own order.
		expect(engine.calls).toEqual(['getAllMints', `addMint:${MINT}`, `createQuote:${MINT}:from-invoice`, `prepare:${MINT}:quote-1`])
	})

	test('submit executes the operation that was prepared, and never prepares a second one', async () => {
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine)))

		const quote = quoteOf(await portAdapter.obtain(command()))
		engine.calls.length = 0

		const handle = await portAdapter.submit(quote, quote.reference)

		expect(engine.calls.filter((call) => call.startsWith('prepare'))).toEqual([])
		expect(engine.calls).toContain('execute:op-1')
		// The melt's own preimage is checked against the invoice, so the leg settles on the artifact.
		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('preimage')
	})

	test('a settled quote with no preimage settles only because the app declares the engine’s reconcilers on', async () => {
		const engine = new FakeCocoEngine()
		engine.executedPreimage = undefined
		engine.quotePreimage = undefined
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine)))
		const quote = quoteOf(await portAdapter.obtain(command()))

		const handle = await portAdapter.submit(quote, quote.reference)
		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('mint_quote_state')
	})

	test('balance is the app engine’s own per-mint snapshot, and the declared conservation identity holds', async () => {
		const engine = new FakeCocoEngine()
		const { host } = createCocoWalletHost(hostOptions(engineSource(engine)))

		const balance = await host.balance(ACCOUNT)

		expect(balance).toEqual({ available: 97, reserved: 3, locked: 0, pending: 0, unresolved: 0, total: 100 })
	})

	test('a scoped balance reads only the scoped mint', async () => {
		const engine = new FakeCocoEngine()
		const { host } = createCocoWalletHost(hostOptions(engineSource(engine)))

		const balance = await host.balance(ACCOUNT, { mintUrl: MINT })

		expect(balance).toEqual({ available: 90, reserved: 3, locked: 0, pending: 0, unresolved: 0, total: 93 })
	})

	test('reconcile drives the host’s recovery over the engine’s own operation, read by the reference', async () => {
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine)))
		const quote = quoteOf(await portAdapter.obtain(command()))
		engine.calls.length = 0

		const handle = await portAdapter.reconcile(quote.reference)

		expect(engine.calls).toContain('get:op-1')
		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('mint_quote_state')
	})
})

describe('a missing or refused host path fails closed', () => {
	test('no live engine: the runtime factory refuses and nothing is asked of the mint', async () => {
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(null)))

		const failure = await portAdapter.obtain(command()).catch((error: unknown) => error)

		expect(failure).toBeInstanceOf(CocoWalletBindingError)
		expect((failure as CocoWalletBindingError).code).toBe('coco_engine_unavailable')
		expect(engine.calls).toEqual([])
	})

	test('no signed-in identity: the runtime is refused', async () => {
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine, { identity: () => null })))

		const failure = await portAdapter.obtain(command()).catch((error: unknown) => error)

		expect((failure as CocoWalletBindingError).code).toBe('coco_no_account')
		expect(engine.calls).toEqual([])
	})

	test('another account’s identity: the runtime is refused rather than answered for', async () => {
		const engine = new FakeCocoEngine()
		const other: WalletAccount = { accountId: 'b'.repeat(64), environmentId: 'test' }
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine, { identity: () => other })))

		const failure = await portAdapter.obtain(command()).catch((error: unknown) => error)

		expect((failure as CocoWalletBindingError).code).toBe('coco_account_mismatch')
		expect(engine.calls).toEqual([])
	})

	test('an adapter with no host reports the wrapper’s own coco_not_attached refusal', async () => {
		const engine = new FakeCocoEngine()
		const portAdapter = new CocoWalletPortAdapter({
			wrapperId: WRAPPER_ID,
			method: METHOD,
			applicationId: APPLICATION_ID,
			operationKind: OPERATION_KIND,
			store: new LocalCocoLegStore(),
			storeKind: 'localStorage',
			rail: createCocoMeltRail({
				engine: engineSource(engine),
				preferredMint: () => MINT,
				invoiceAmountSats: () => 21,
				validatePreimage: () => true,
			}),
			ceiling: CEILING,
			contractVersion: CONTRACT_VERSION,
			now: () => 1_700_000_000_000,
		})

		const failure = await portAdapter.obtain(command()).catch((error: unknown) => error)

		expect(failure).toBeInstanceOf(CocoPortAdapterError)
		expect((failure as CocoPortAdapterError).code).toBe('coco_not_attached')
		expect(engine.calls).toEqual([])
	})

	test('the wallet holds no mint and names no default: the rail refuses before anything is asked', async () => {
		const engine = new FakeCocoEngine()
		engine.mintUrls = []
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine), { preferredMint: () => null }))

		const result = await portAdapter.obtain(command())

		expect('refused' in result).toBe(true)
		expect(engine.calls.filter((call) => call.startsWith('createQuote'))).toEqual([])
	})
})

describe('the leg’s amount and the mint’s quote must be the same money', () => {
	test('a quote for another amount is refused before the operation is prepared', async () => {
		const engine = new FakeCocoEngine()
		engine.quoteAmount = 100
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine)))

		const result = await portAdapter.obtain(command())

		expect('refused' in result).toBe(true)
		expect(engine.calls.filter((call) => call.startsWith('prepare'))).toEqual([])
	})

	test('an amountless invoice declares the leg’s amount, an amountful one never does', async () => {
		const engine = new FakeCocoEngine()
		const rail = createCocoMeltRail({
			engine: engineSource(engine),
			preferredMint: () => MINT,
			invoiceAmountSats: (invoice) => (invoice === 'lnbc1-amountless' ? null : 21),
			validatePreimage: () => true,
		})

		await rail.quote({ invoice: 'lnbc1-amountless', amountSat: 21 })
		await rail.quote({ invoice: 'lnbc1-amountful', amountSat: 21 })

		expect(engine.calls).toContain(`createQuote:${MINT}:21`)
		expect(engine.calls).toContain(`createQuote:${MINT}:from-invoice`)
	})
})

describe('the engine port projects the engine’s own melt states', () => {
	test('every declared state maps, and a failed melt projects to the reclaimed terminal', async () => {
		const engine = new FakeCocoEngine()
		const port = createCocoOperationPort(engine.ops.melt)

		engine.operationState = 'prepared'
		expect((await port.get('op-1'))?.state).toBe('prepared')
		engine.operationState = 'executing'
		expect((await port.get('op-1'))?.state).toBe('executing')
		engine.operationState = 'pending'
		expect((await port.get('op-1'))?.state).toBe('pending')
		engine.operationState = 'finalized'
		expect((await port.get('op-1'))?.state).toBe('finalized')
		engine.operationState = 'rolled_back'
		expect((await port.get('op-1'))?.state).toBe('rolled_back')
		engine.operationState = 'failed'
		expect((await port.get('op-1'))?.state).toBe('rolled_back')
	})

	test('a state the declared port cannot express is refused, never guessed at', async () => {
		const engine = new FakeCocoEngine()
		const port = createCocoOperationPort(engine.ops.melt)

		engine.operationState = 'rolling_back'
		await expect(port.get('op-1')).rejects.toThrow()

		engine.operationState = 'init'
		await expect(port.get('op-1')).rejects.toThrow()
	})

	test('an absent operation is null, and a reclaim is read back rather than assumed', async () => {
		const engine = new FakeCocoEngine()
		const port = createCocoOperationPort(engine.ops.melt)

		expect(await port.get('missing')).toBeNull()
		expect((await port.reclaim('op-1')).state).toBe('rolled_back')
		expect(engine.calls).toEqual(['get:missing', 'reclaim:op-1', 'get:op-1'])
	})
})

describe('the rail reads the app’s own quote state', () => {
	test('the mint’s seconds become milliseconds and its state is normalized', async () => {
		const engine = new FakeCocoEngine()
		const rail = createCocoMeltRail({
			engine: engineSource(engine),
			preferredMint: () => MINT,
			invoiceAmountSats: () => 21,
			validatePreimage: () => true,
		})

		const quote = await rail.readQuote({ quoteId: 'quote-1' })

		expect(quote?.expiryAt).toBe(2_000_000_000_000)
		expect(quote?.state).toBe('unpaid')
	})

	test('a quote no mint holds is no answer, never a negative settlement', async () => {
		const engine = new FakeCocoEngine()
		const rail = createCocoMeltRail({
			engine: engineSource(engine),
			preferredMint: () => MINT,
			invoiceAmountSats: () => 21,
			validatePreimage: () => true,
		})

		const quote = await rail.readQuote({ quoteId: 'unknown' }).catch(() => 'refused')

		expect(quote).toBe('refused')
	})

	test('release cancels the operation the quote was prepared as', async () => {
		const engine = new FakeCocoEngine()
		const rail = createCocoMeltRail({
			engine: engineSource(engine),
			preferredMint: () => MINT,
			invoiceAmountSats: () => 21,
			validatePreimage: () => true,
		})

		if (!rail.release) throw new Error('the rail must expose release')
		await rail.release({ quoteId: 'quote-1' })

		expect(engine.calls).toContain('cancel:op-1')
	})
})

describe('the durable stores keep the host and the wrapper honest', () => {
	test('the leg store refuses a stale revision and keeps the leg it already holds', async () => {
		const store: CocoLegStore = new LocalCocoLegStore()
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine), { legStore: store }))
		await portAdapter.obtain(command())

		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
		expect(record?.engineOperationId).toBe('op-1')

		await expect(
			store.compareAndSet({ wrapperId: WRAPPER_ID, legId: 'leg-1' }, record!.revision + 5, { ...record!, revision: record!.revision + 6 }),
		).rejects.toThrow()
	})

	test('the host’s command store refuses a stale revision', async () => {
		const store = new LocalWalletOperationStore()
		const engine = new FakeCocoEngine()
		const { portAdapter } = createCocoWalletHost(hostOptions(engineSource(engine), { walletStore: store }))
		await portAdapter.obtain(command())

		const record = await store.get('leg-1')
		expect(record?.state).toBe('prepared')

		await expect(store.compareAndSet('leg-1', record!.revision + 5, { ...record!, revision: record!.revision + 6 })).rejects.toThrow()
	})
})
