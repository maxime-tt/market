/**
 * platform/web/wallet/cocoWalletHost.ts — the Coco wallet **host binding**: the `EngineHost` the cashu
 * rail needs, built over the engine the app already has.
 *
 * Until this module existed, `payments/payAggregator.ts` recorded the gap in its own words: "Cashu /
 * coco needs an `EngineHost` port (the mint engine binding required by `sdk/core/cashu-wrapper`'s
 * `CocoPortAdapter.requireHost()` — methods run(), get(), recover())." The wrapper's `CocoWalletHost`
 * is that host; it needs a `runtimeFactory`, a `store`, its `adapters` and an injected `now`. This
 * module supplies the binding between that host and this app's own wallet:
 *
 *   - **the engine is the app's**, never a new one: `sdk/config/cashu.ts` initialises the coco `Manager`
 *     (`initializeCoco`) and holds it on `cashuState.manager`, and the deposit/withdraw hosts drive it
 *     through `cashuActions`. The binding reads that live manager per call, through an injected
 *     {@link CocoWalletEngineSource} — it constructs no manager, opens no seed and owns no repository.
 *     The engine surface is declared STRUCTURALLY below rather than imported, so the pin's `Manager`
 *     satisfies it without this module depending on the package at runtime (the composition point hands
 *     the instance in) and a fake can drive every test.
 *   - **`now` is injected**, as `WalletHostOptions` requires.
 *   - the melt/lifecycle calls are the ones the app already makes (`manager.quotes.melt.create` →
 *     `manager.ops.melt.prepare` → `manager.ops.melt.execute`, exactly as `cashuActions.melt` and the
 *     withdraw host drive the rail), with one deliberate difference: `prepare` reserves the proofs
 *     BEFORE the boundary, so the leg's durable reference exists before anything is spent — which is
 *     what the wrapper's `obtain`/`submit` split requires.
 *
 * Everything here is mechanism. The composition point (`payments/payAggregatorInstance.ts`) supplies the
 * live engine accessor, the account identity and the app's reconciler declaration.
 */
import { CocoWalletHost, CocoWalletPortAdapter } from '@sdk/core/cashu-wrapper'
import type {
	CocoEngineOperation,
	CocoEngineOperationState,
	CocoLegStore,
	CocoMeltQuote,
	CocoMeltRail,
	CocoMeltResult,
	CocoOperationPort,
	CocoReconcilerStatus,
	CocoWalletRuntime,
	CocoWalletRuntimeFactory,
	WalletAccount,
	WalletBalance,
	WalletBalanceQuery,
	WalletOperationStore,
} from '@sdk/core/cashu-wrapper'

/** The rail's method: the one melt this binding drives. */
const MELT_METHOD = 'bolt11' as const
/** one millisecond is 1000 microseconds; the mint reports quote expiry in SECONDS (NUT-05). */
const SECONDS_TO_MILLISECONDS = 1000

/**
 * `CocoWalletBindingError` — the binding's own closed failure surface. Every code is a stable string a
 * caller may branch on; the message names the field or the state, never a key, a seed or a preimage.
 */
export class CocoWalletBindingError extends Error {
	readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'CocoWalletBindingError'
		this.code = code
	}
}

// ---------------------------------------------------------------------------
// The engine surface, declared structurally
// ---------------------------------------------------------------------------

/** A cashu-ts `Amount`, narrowed to the one read this binding needs. */
export interface CocoEngineAmount {
	toNumber(): number
}

/** One melt operation as the app's engine reports it (coco's `MeltOperation`, narrowed). */
export interface CocoEngineMeltOperation {
	readonly id: string
	readonly state: string
	/** the mint's melt quote id, where the operation carries one */
	readonly quoteId?: string
	/** present once the operation is finalized: the settling preimage where the mint gave one */
	readonly finalizedData?: { readonly preimage?: string }
}

/** One canonical melt quote as the app's engine reports it (coco's `MeltQuote<'bolt11'>`, narrowed). */
export interface CocoEngineMeltQuote {
	readonly quoteId: string
	/** the mint's ABSOLUTE expiry in Unix SECONDS (NUT-05), converted at this boundary */
	readonly expiry: number
	/** the mint's own state vocabulary: `UNPAID` / `PENDING` / `PAID` */
	readonly state: string
	readonly amount: CocoEngineAmount
	readonly payment_preimage?: string | null
}

/** The melt slice of coco's `manager.ops.melt` this binding drives. */
export interface CocoEngineMeltOps {
	prepare(input: {
		readonly quote: { readonly mintUrl: string; readonly quoteId: string; readonly method: string }
	}): Promise<{ readonly id: string }>
	execute(operationOrId: string): Promise<CocoEngineMeltOperation>
	get(operationId: string): Promise<CocoEngineMeltOperation | null>
	getByQuote(input: { readonly mintUrl: string; readonly quoteId: string }): Promise<CocoEngineMeltOperation | null>
	listPrepared(): Promise<readonly CocoEngineMeltOperation[]>
	listInFlight(): Promise<readonly CocoEngineMeltOperation[]>
	refresh(operationId: string): Promise<CocoEngineMeltOperation>
	reclaim(operationId: string, reason?: string): Promise<unknown>
	cancel(operationId: string, reason?: string): Promise<void>
}

/** One per-mint balance snapshot as coco reports it (`BalancesByMint[...]`, narrowed). */
export interface CocoEngineBalanceSnapshot {
	readonly spendable: CocoEngineAmount
	readonly reserved: CocoEngineAmount
	readonly total: CocoEngineAmount
	readonly unit: string
}

/**
 * The slice of coco's `Manager` this binding reads. `sdk/config/cashu.ts`'s `CashuState.manager` is
 * exactly this, so the composition point can hand the live manager in without an adapter.
 */
export interface CocoEngine {
	readonly mint: {
		addMint(mintUrl: string, options?: { readonly trusted?: boolean }): Promise<unknown>
		getAllMints(): Promise<readonly { readonly mintUrl: string }[]>
	}
	readonly quotes: {
		readonly melt: {
			create(input: {
				readonly mintUrl: string
				readonly method: 'bolt11'
				readonly methodData: { readonly invoice: string; readonly amountSats?: number }
			}): Promise<CocoEngineMeltQuote>
			get(input: { readonly mintUrl: string; readonly quoteId: string }): Promise<CocoEngineMeltQuote | null>
		}
	}
	readonly ops: { readonly melt: CocoEngineMeltOps }
	readonly wallet: { readonly balances: { byMint(): Promise<Record<string, CocoEngineBalanceSnapshot>> } }
}

/**
 * `CocoWalletEngineSource` — where the binding finds the app's engine, and the account it belongs to.
 *
 * The app has one wallet per signed-in identity and it is created after sign-in and torn down on logout,
 * so the binding resolves it PER CALL rather than capturing a manager: a leg opened before a re-init
 * must use the engine that is live when it runs, never a stale one.
 */
export interface CocoWalletEngineSource {
	/** the signed-in identity the app's wallet belongs to, or null before the wallet is composed */
	identity(): WalletAccount | null
	/** the app's live engine, or null before `cashuActions.initialize()` has completed */
	current(): CocoEngine | null
	/** bring the app's wallet up (idempotent, the app's own `cashuActions.initialize()`) and return it */
	ensure(): Promise<CocoEngine | null>
	/** the app's own teardown for the account's wallet (`cashuActions.reset()`, which disposes the manager) */
	close(): Promise<void>
}

/** The mint URLs are compared the way the app compares them: one trailing slash, not all of them. */
const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const requireEngine = async (source: CocoWalletEngineSource): Promise<CocoEngine> => {
	const engine = source.current() ?? (await source.ensure())
	if (!engine) {
		throw new CocoWalletBindingError(
			'coco_engine_unavailable',
			'the app has no live cashu engine; the wallet is not signed in or not initialized',
		)
	}
	return engine
}

// ---------------------------------------------------------------------------
// The engine port the host's runtime declares
// ---------------------------------------------------------------------------

/**
 * `#b8ce55` The projection of coco's own operation states onto the declared `CocoEngineOperationState`
 * vocabulary. Five entries are the same state; `failed` is coco's "melt failed, proofs reclaimed" — the
 * declared vocabulary's `rolled_back`, "it has been reclaimed" — and is projected there rather than
 * invented as a sixth state.
 *
 * `init` and `rolling_back` are deliberately ABSENT: the port declares no pre-reservation state, and a
 * rollback in progress has no state that would not claim either a live payment or a completed reclaim.
 * A read of one of those fails closed ({@link projectOperation} throws, the wrapper's reconcile catches
 * it and leaves the leg unresolved) instead of reporting a state the engine cannot back.
 */
const ENGINE_STATES: Readonly<Record<string, CocoEngineOperationState>> = {
	prepared: 'prepared',
	executing: 'executing',
	pending: 'pending',
	finalized: 'finalized',
	rolled_back: 'rolled_back',
	failed: 'rolled_back',
}

/**
 * `#b8ce55` Project one engine operation into the declared port vocabulary. The engine is an injected
 * port, so nothing it returns is trusted: the id must be a non-empty string, the state must be one the
 * projection can express, and every optional field is emitted only when it carries a non-empty value.
 */
const projectOperation = (raw: CocoEngineMeltOperation): CocoEngineOperation => {
	if (typeof raw?.id !== 'string' || raw.id.length === 0) {
		throw new CocoWalletBindingError('coco_engine_operation_malformed', 'the engine returned a melt operation without an id')
	}
	const state = ENGINE_STATES[raw.state]
	if (!state) {
		throw new CocoWalletBindingError(
			'coco_engine_state_unmapped',
			`the engine returned a melt operation in state "${raw.state}", which the declared port cannot express`,
		)
	}
	const preimage =
		typeof raw.finalizedData?.preimage === 'string' && raw.finalizedData.preimage.length > 0 ? raw.finalizedData.preimage : undefined
	const meltQuoteId = typeof raw.quoteId === 'string' && raw.quoteId.length > 0 ? raw.quoteId : undefined
	return {
		id: raw.id,
		state,
		...(meltQuoteId ? { meltQuoteId } : {}),
		...(preimage ? { preimage } : {}),
	}
}

/**
 * `#b8ce55` The declared engine surface, over the app's own melt operations. `reclaim` returns void on
 * this pin, so the reclaimed operation is read back — an operation that cannot be read after a reclaim
 * is reported rather than assumed rolled back.
 */
export const createCocoOperationPort = (melt: CocoEngineMeltOps): CocoOperationPort => ({
	async get(operationId: string): Promise<CocoEngineOperation | null> {
		const raw = await melt.get(operationId)
		return raw ? projectOperation(raw) : null
	},
	async listPrepared(): Promise<readonly CocoEngineOperation[]> {
		return (await melt.listPrepared()).map(projectOperation)
	},
	async listInFlight(): Promise<readonly CocoEngineOperation[]> {
		return (await melt.listInFlight()).map(projectOperation)
	},
	async refresh(operationId: string): Promise<CocoEngineOperation> {
		return projectOperation(await melt.refresh(operationId))
	},
	async reclaim(operationId: string): Promise<CocoEngineOperation> {
		await melt.reclaim(operationId)
		const raw = await melt.get(operationId)
		if (!raw) {
			throw new CocoWalletBindingError(
				'coco_engine_operation_missing',
				`the engine reports no melt operation ${operationId} after a reclaim`,
			)
		}
		return projectOperation(raw)
	},
})

// ---------------------------------------------------------------------------
// The melt rail the port adapter injects
// ---------------------------------------------------------------------------

/** coco's quote state vocabulary (`MeltQuoteState`, uppercase) onto the rail's lowercase vocabulary. */
const QUOTE_STATES: Readonly<Record<string, CocoMeltQuote['state']>> = {
	UNPAID: 'unpaid',
	PENDING: 'pending',
	PAID: 'paid',
}

/**
 * `#badc9a` Project one canonical quote into the rail's own shape: the mint's absolute expiry converted
 * from the NUT-05 seconds it reports to the Unix milliseconds the rail declares, and the mint's state
 * normalized into the rail's closed vocabulary. An unknown state, or an expiry that is not a positive
 * timestamp, fails closed — a leg that cannot be dated or whose state cannot be read is not a leg this
 * rail may reconcile.
 *
 * The reference is a parameter, never derived here: it is the engine operation this quote's melt runs
 * as, and only the caller knows whether one is bound yet.
 */
const projectQuote = (raw: CocoEngineMeltQuote, engineOperationId: string): CocoMeltQuote => {
	const state = QUOTE_STATES[raw?.state]
	if (!state) {
		throw new CocoWalletBindingError('coco_quote_state_unmapped', 'the engine returned a melt quote in a state the rail cannot express')
	}
	const expiryAt =
		typeof raw.expiry === 'number' && Number.isFinite(raw.expiry) && raw.expiry > 0 ? raw.expiry * SECONDS_TO_MILLISECONDS : null
	if (expiryAt === null) {
		throw new CocoWalletBindingError('coco_quote_expiry_malformed', 'the engine returned a melt quote without a usable absolute expiry')
	}
	const preimage = typeof raw.payment_preimage === 'string' && raw.payment_preimage.length > 0 ? raw.payment_preimage : undefined
	return { quoteId: raw.quoteId, engineOperationId, expiryAt, state, ...(preimage ? { preimage } : {}) }
}

/** The amount the mint's quote is for, as a plain number. */
const quoteAmount = (raw: CocoEngineMeltQuote): number => {
	const amount = raw?.amount?.toNumber()
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
		throw new CocoWalletBindingError('coco_quote_amount_malformed', 'the engine returned a melt quote without a usable amount')
	}
	return amount
}

/**
 * Resolve the mint a quote belongs to. The rail's port carries only the quote id, and a quote id is
 * unique per mint rather than globally, so the mint is found by asking the wallet's own mint list which
 * one holds the quote. Exactly one answer is required: a quote that no mint holds cannot be melted, and
 * one that two mints hold must never be guessed between — both fail closed.
 */
const mintHoldingQuote = async (engine: CocoEngine, quoteId: string): Promise<string> => {
	const mints = await engine.mint.getAllMints()
	const holders: string[] = []
	for (const mint of mints) {
		const quote = await engine.quotes.melt.get({ mintUrl: mint.mintUrl, quoteId })
		if (quote) holders.push(mint.mintUrl)
	}
	if (holders.length === 0) {
		throw new CocoWalletBindingError('coco_quote_unknown', `no mint this wallet holds has melt quote ${quoteId}`)
	}
	if (holders.length > 1) {
		throw new CocoWalletBindingError('coco_quote_ambiguous', `more than one mint this wallet holds has melt quote ${quoteId}`)
	}
	return holders[0]!
}

export interface CocoMeltRailOptions {
	/** where the app's live engine is resolved, per call */
	readonly engine: CocoWalletEngineSource
	/** the mint a leg is opened against when the app holds no explicit choice: the wallet's own default */
	readonly preferredMint: () => string | null
	/** the invoice's own amount in sats, or null when the invoice carries none (NUT-11 amountless) */
	readonly invoiceAmountSats: (invoice: string) => number | null
	/** validate a preimage against the invoice's own payment hash — the app's own cryptographic check */
	readonly validatePreimage: (invoice: string, preimage: string) => boolean
}

/**
 * `#7a7f2d` The mint port the cashu wrapper injects, over the app's own coco engine.
 *
 * `quote` is the pre-boundary work: trust the mint, create the canonical melt quote and PREPARE the melt
 * operation against it, so the engine's operation id — the leg's durable reference — exists before any
 * proof is spent. `melt` then only EXECUTES the operation that was prepared: a second `prepare` would
 * reserve the proofs twice, so the boundary step resolves the already-prepared operation by its quote
 * and never prepares a new one. `readQuote` is the local re-ask of the canonical quote row, which
 * performs no network call of its own.
 */
export const createCocoMeltRail = (options: CocoMeltRailOptions): CocoMeltRail => ({
	async quote(request: { readonly invoice: string; readonly amountSat: number }): Promise<CocoMeltQuote> {
		const engine = await requireEngine(options.engine)
		const mints = await engine.mint.getAllMints()
		const mintUrl = normalizeMintUrl(options.preferredMint() ?? mints[0]?.mintUrl ?? '')
		if (!mintUrl) {
			throw new CocoWalletBindingError('coco_mint_unknown', 'the wallet holds no mint and names no default, so no melt can be opened')
		}
		// Best effort, exactly as the app's own melt does: a mint coco already holds is not an error, and a
		// real problem surfaces on the quote call below rather than being hidden here.
		try {
			await engine.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// already known (or the engine refuses to re-add it) — the quote call is the authority
		}
		// cashu-ts refuses an explicit amount beside an invoice that already carries one, so the amount is
		// declared only for an amountless invoice and is otherwise the invoice's own.
		const invoiceAmount = options.invoiceAmountSats(request.invoice)
		const created = await engine.quotes.melt.create({
			mintUrl,
			method: MELT_METHOD,
			methodData: invoiceAmount === null ? { invoice: request.invoice, amountSats: request.amountSat } : { invoice: request.invoice },
		})
		// The leg's frozen amount and the quote the mint will melt must be the same money. A mismatch is
		// refused BEFORE the operation is prepared, so nothing is reserved for a leg that cannot be paid.
		const amount = quoteAmount(created)
		if (amount !== request.amountSat) {
			throw new CocoWalletBindingError(
				'coco_quote_amount_mismatch',
				`the mint's melt quote is for ${amount} sats but the leg declares ${request.amountSat}`,
			)
		}
		const prepared = await engine.ops.melt.prepare({ quote: { mintUrl, quoteId: created.quoteId, method: MELT_METHOD } })
		if (typeof prepared?.id !== 'string' || prepared.id.length === 0) {
			throw new CocoWalletBindingError('coco_engine_operation_missing', 'the engine prepared no melt operation for the quote')
		}
		return projectQuote(created, prepared.id)
	},

	async melt(request: { readonly quoteId: string; readonly invoice: string }): Promise<CocoMeltResult> {
		const engine = await requireEngine(options.engine)
		const mintUrl = await mintHoldingQuote(engine, request.quoteId)
		// The operation was prepared by `quote`; executing it re-reads its latest state first. A quote with
		// no prepared operation is refused rather than prepared here — preparing now would reserve a second
		// set of proofs for a leg that already has a reference.
		const prepared = await engine.ops.melt.getByQuote({ mintUrl, quoteId: request.quoteId })
		if (!prepared) {
			throw new CocoWalletBindingError(
				'coco_no_prepared_operation',
				`melt quote ${request.quoteId} has no prepared melt operation to execute`,
			)
		}
		const executed = await engine.ops.melt.execute(prepared.id)
		const state = executed.state
		if (state !== 'pending' && state !== 'finalized') {
			throw new CocoWalletBindingError(
				'coco_melt_state_unmapped',
				`the engine returned a melt in state "${state}", which the rail cannot express`,
			)
		}
		const preimage =
			typeof executed.finalizedData?.preimage === 'string' && executed.finalizedData.preimage.length > 0
				? executed.finalizedData.preimage
				: undefined
		return {
			quoteId: request.quoteId,
			engineOperationId: executed.id,
			state: state === 'finalized' ? 'paid' : 'pending',
			...(preimage ? { preimage } : {}),
		}
	},

	async readQuote(request: { readonly quoteId: string }): Promise<CocoMeltQuote | null> {
		const engine = await requireEngine(options.engine)
		const mintUrl = await mintHoldingQuote(engine, request.quoteId)
		const quote = await engine.quotes.melt.get({ mintUrl, quoteId: request.quoteId })
		// No row is "no answer", never a negative settlement; the wrapper reads the engine's own operation
		// alongside it and judges from both.
		if (!quote) return null
		// A quote read back is named by the operation bound to it; one with no operation bound yet has only
		// its own id, which is the same fail-closed fallback the wrapper's own `quoteFor` applies to a leg
		// that never obtained a reference.
		const bound = await engine.ops.melt.getByQuote({ mintUrl, quoteId: request.quoteId })
		return projectQuote(quote, bound?.id ?? quote.quoteId)
	},

	validatePreimage(invoice: string, preimage: string): boolean {
		return options.validatePreimage(invoice, preimage)
	},

	async release(request: { readonly quoteId: string }): Promise<void> {
		const engine = await requireEngine(options.engine)
		const mintUrl = await mintHoldingQuote(engine, request.quoteId)
		const prepared = await engine.ops.melt.getByQuote({ mintUrl, quoteId: request.quoteId })
		if (!prepared) return
		await engine.ops.melt.cancel(prepared.id, 'the command was cancelled before the boundary')
	},
})

// ---------------------------------------------------------------------------
// The runtime factory and the host binding
// ---------------------------------------------------------------------------

export interface CocoWalletRuntimeFactoryOptions {
	readonly engine: CocoWalletEngineSource
	/** the composing app's declaration of the engine's own reconcilers (`#09f049`) */
	readonly reconcilers: CocoReconcilerStatus
}

/**
 * `#f4028b` The balance projection. coco reports two DISJOINT states per mint — spendable and reserved —
 * and has no notion of the three states the declared `WalletBalance` also names, so those are empty
 * here rather than filled with a number the engine never reported; `total` is the sum of the states
 * this projection actually holds, so the declared conservation identity holds by construction.
 */
const balanceOver = async (engine: CocoEngine, query?: WalletBalanceQuery): Promise<WalletBalance> => {
	const byMint = await engine.wallet.balances.byMint()
	const scopeMint = query?.mintUrl ? normalizeMintUrl(query.mintUrl) : null
	const scopeUnit = query?.unit ? query.unit.toLowerCase() : null
	let available = 0
	let reserved = 0
	for (const [mintUrl, snapshot] of Object.entries(byMint)) {
		if (scopeMint && normalizeMintUrl(mintUrl) !== scopeMint) continue
		if (scopeUnit && snapshot.unit.toLowerCase() !== scopeUnit) continue
		available += snapshot.spendable.toNumber()
		reserved += snapshot.reserved.toNumber()
	}
	return { available, reserved, locked: 0, pending: 0, unresolved: 0, total: available + reserved }
}

/**
 * `#f4028b` The runtime factory: one account-scoped runtime over the app's engine, or a fail-closed
 * refusal. It refuses when the app is not signed in and when the requested account is not the live
 * identity — a runtime that answered for another account would let one identity's proofs pay another's
 * leg, so it never opens one.
 *
 * `dispose` is the app's own teardown for that account's wallet (`cashuActions.reset()`, which disposes
 * the coco manager it created): the runtime is the thing that brought the wallet up, so it is the thing
 * that closes it when the host drops the account.
 */
export const createCocoWalletRuntimeFactory = (options: CocoWalletRuntimeFactoryOptions): CocoWalletRuntimeFactory => ({
	async open(account: WalletAccount): Promise<CocoWalletRuntime> {
		const identity = options.engine.identity()
		if (!identity) {
			throw new CocoWalletBindingError('coco_no_account', 'the cashu wallet has no signed-in account; refusing to open a runtime')
		}
		if (identity.accountId !== account.accountId || identity.environmentId !== account.environmentId) {
			throw new CocoWalletBindingError(
				'coco_account_mismatch',
				'refusing to open the cashu runtime for an account other than the signed-in one',
			)
		}
		const engine = await requireEngine(options.engine)
		return {
			account: { accountId: account.accountId, environmentId: account.environmentId },
			engine: createCocoOperationPort(engine.ops.melt),
			reconcilers: options.reconcilers,
			balance: (query?: WalletBalanceQuery): Promise<WalletBalance> => balanceOver(engine, query),
			dispose: () => options.engine.close(),
		}
	},
})

/**
 * Everything the host binding is composed from: the app's engine, the wrapper's declared identity, the
 * two durable stores and the injected clock. The composition point supplies all of it; nothing here
 * reaches for a module-level singleton.
 */
export interface CocoWalletHostOptions {
	readonly engine: CocoWalletEngineSource
	/** the composing app's declaration of the engine's own reconcilers (`#09f049`) */
	readonly reconcilers: CocoReconcilerStatus
	/** the mint a leg is opened against when the app holds no explicit choice */
	readonly preferredMint: () => string | null
	/** the invoice's own amount in sats, or null when the invoice carries none */
	readonly invoiceAmountSats: (invoice: string) => number | null
	readonly validatePreimage: (invoice: string, preimage: string) => boolean
	/** the wrapper's stable identity, as the aggregator's acceptance gate will read it */
	readonly wrapperId: string
	readonly method: string
	readonly applicationId: string
	readonly operationKind: string
	readonly legStore: CocoLegStore
	readonly storeKind: string
	readonly ceiling: number
	readonly contractVersion: string
	/** the host's own durable command store */
	readonly walletStore: WalletOperationStore
	/** Unix milliseconds. Required so the binding never reads a host clock global. */
	readonly now: () => number
}

/**
 * Build the app's `CocoWalletHost` over the injected engine binding, with the wrapper's port adapter as
 * its registered application adapter.
 *
 * The composition order is the wrapper's own: the host takes its adapters at construction, and the port
 * adapter attaches to the host AFTER it exists (`port.test.ts` composes them the same way). Both are
 * returned so a caller can reach the host it must dispose and the adapter whose registration the
 * aggregator's gate reads.
 */
export const createCocoWalletHost = (options: CocoWalletHostOptions): { host: CocoWalletHost; portAdapter: CocoWalletPortAdapter } => {
	const rail = createCocoMeltRail({
		engine: options.engine,
		preferredMint: options.preferredMint,
		invoiceAmountSats: options.invoiceAmountSats,
		validatePreimage: options.validatePreimage,
	})
	const portAdapter = new CocoWalletPortAdapter({
		wrapperId: options.wrapperId,
		method: options.method,
		applicationId: options.applicationId,
		operationKind: options.operationKind,
		store: options.legStore,
		storeKind: options.storeKind,
		rail,
		ceiling: options.ceiling,
		contractVersion: options.contractVersion,
		now: options.now,
	})
	const host = new CocoWalletHost({
		runtimeFactory: createCocoWalletRuntimeFactory({ engine: options.engine, reconcilers: options.reconcilers }),
		store: options.walletStore,
		adapters: [portAdapter.applicationAdapter],
		now: options.now,
	})
	portAdapter.attach(host)
	return { host, portAdapter }
}
