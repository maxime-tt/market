/**
 * nwc-wrapper/ts/wrapper.test.ts — the port's conformance suite.
 *
 * Test support, out of contract: it mints no statement. Every library call is a fake, the store is the
 * in-memory test store, and no network is touched, so the port is driven with no relay, wallet or node. The
 * suite also carries the negatives the contract implies — a bare acknowledgement must not settle, an
 * unanswered request must not become a negative settlement, a payment above the ceiling must not leave the box,
 * a reference must be durable before submit, and the deadline must not settle anything by itself.
 */
import { expect, test } from 'bun:test'
import { NwcWrapper, NwcWrapperError, MemoryNwcLegStore, classifyNwcFailure, NWC_ERROR_RECOVERABLE } from './index'
import type {
	NwcInvoiceCodec,
	NwcLegKey,
	NwcLegRecord,
	NwcLegStore,
	NwcOutcome,
	NwcPaymentBody,
	NwcSession,
	NwcSessionStatus,
	NwcTransactionBody,
} from './index'
import type { FundsQuote, FundsRefusal } from '../../funds-contract/ts/index'

/** The invoice's own amount is encoded in its `lnbc<digits>` prefix, so the fake codec can decode it. */
const sats = 1000
const invoice = `lnbc${sats}example`
const paymentHash = `hash:${invoice}`
const validPreimage = `pre:${invoice}`

/**
 * The codec, faked: a payment hash is `hash:<invoice>`; the amount is the `<digits>` of an `lnbc<digits>`
 * prefix — `0`, i.e. undecodable, when there is none; a preimage is valid iff it is `pre:<invoice>`.
 * `@getalby/lightning-tools` supplies the real decoder; the module imports neither.
 */
const codec: NwcInvoiceCodec = {
	paymentHash: (bolt11) => `hash:${bolt11}`,
	amountSat: (bolt11) => {
		const match = /^lnbc(\d+)/.exec(bolt11)
		return match ? Number(match[1]) : 0
	},
	validatePreimage: (bolt11, preimage) => preimage === `pre:${bolt11}`,
}

/** A store that records the order of its mutating calls, so "reference before the boundary" is provable. */
class RecordingStore implements NwcLegStore {
	private readonly inner = new MemoryNwcLegStore()
	constructor(private readonly events: string[]) {}
	async createOrGet(record: NwcLegRecord) {
		this.events.push('store.createOrGet')
		return this.inner.createOrGet(record)
	}
	async get(key: NwcLegKey) {
		return this.inner.get(key)
	}
	async list(wrapperId?: string) {
		return this.inner.list(wrapperId)
	}
	async compareAndSet(key: NwcLegKey, expectedRevision: number, next: NwcLegRecord) {
		this.events.push('store.compareAndSet')
		return this.inner.compareAndSet(key, expectedRevision, next)
	}
}

class FakeSession implements NwcSession {
	calls: string[] = []
	payOutcome: NwcOutcome<NwcPaymentBody> = { kind: 'no-reply' }
	lookupOutcome: NwcOutcome<NwcTransactionBody> = { kind: 'no-reply' }
	scanOutcome: NwcOutcome<NwcTransactionBody> = { kind: 'no-reply' }
	statusValue: NwcSessionStatus = 'connected'
	connectResult: NwcSessionStatus = 'connected'
	/** model a reply that never arrives: `submitPay` settles only when the module aborts it */
	neverAnswers = false
	/** records that the module's abort reached this seam — the proof the timeout fired */
	sawAbort = false
	/** the bound the module handed over, for the timeout test to assert on */
	lastTimeoutMs: number | null = null
	private readonly events: string[] | null
	constructor(events: string[] | null = null) {
		this.events = events
	}
	private note(name: string) {
		this.calls.push(name)
		this.events?.push(name)
	}
	status() {
		return this.statusValue
	}
	async connect() {
		this.note('connect')
		this.statusValue = this.connectResult
	}
	async close() {
		this.note('close')
	}
	async submitPay(request: {
		readonly requestEventId: string
		readonly invoice: string
		readonly timeoutMs: number
		readonly signal: AbortSignal
	}): Promise<NwcOutcome<NwcPaymentBody>> {
		this.note('submitPay')
		this.lastTimeoutMs = request.timeoutMs
		if (!this.neverAnswers) return this.payOutcome
		// a reply that never arrives: the promise does not settle until the module aborts it, and it then
		// answers `no-reply` — never a settlement.
		return new Promise<NwcOutcome<NwcPaymentBody>>((resolve) => {
			const onAbort = () => {
				this.sawAbort = true
				resolve({ kind: 'no-reply' })
			}
			if (request.signal.aborted) onAbort()
			else request.signal.addEventListener('abort', onAbort, { once: true })
		})
	}
	async lookup() {
		this.note('lookup')
		return this.lookupOutcome
	}
	async findTransaction() {
		this.note('findTransaction')
		return this.scanOutcome
	}
}

const asQuote = (quote: FundsQuote | FundsRefusal): FundsQuote => {
	if ('refused' in quote) throw new Error('expected a quote, got a refusal')
	return quote
}

const baseOptions = (store: NwcLegStore, session: NwcSession, now: () => number = () => 1_000_000) => ({
	wrapperId: 'w',
	store,
	storeKind: 'memory',
	session,
	codec,
	reconnect: { maxAttempts: 0 },
	reconcileDeadlineMs: 60_000,
	ceiling: 1_000_000,
	contractVersion: '0.1',
	newId: () => 'req-1',
	now,
})

const OPEN = { kind: 'nip47-session' as const, amountSat: sats, invoice }

test('obtain writes the leg with its durable reference before the request is published', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession(events)
	session.payOutcome = { kind: 'reply', body: { preimage: validPreimage } }
	const wrapper = new NwcWrapper(baseOptions(store, session))

	const quote = asQuote(await wrapper.obtain(OPEN))
	const stored = await store.get({ wrapperId: 'w', legId: quote.legId })
	expect(stored?.invoice).toBe(invoice)
	expect(stored?.paymentHash).toBe(paymentHash)
	expect(stored?.requestEventId).toBe('req-1')

	await wrapper.submit(quote, quote.reference)
	expect(events).toContain('store.createOrGet')
	expect(events).toContain('submitPay')
	expect(events.indexOf('store.createOrGet')).toBeLessThan(events.indexOf('submitPay'))
})

test('the pay reply settles only on a preimage validated against the payment hash', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.payOutcome = { kind: 'reply', body: { preimage: validPreimage } }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('preimage')
	expect(handle.unwitnessed).toBe(false)
})

test('a bare acknowledgement does not settle the leg', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.payOutcome = { kind: 'reply', body: {} }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('attested')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('ack')
})

test('an unanswered request is unresolved, never a negative settlement', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.payOutcome = { kind: 'no-reply' }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('unresolved')
	expect(handle.rung).not.toBe('abandoned')
	expect(handle.unwitnessed).toBe(true)
	expect(handle.witness).toBeUndefined()
})

test('a dropped socket is unresolved, never a negative settlement', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.payOutcome = { kind: 'transport-error', reason: 'socket closed' }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('unresolved')
	expect(handle.unwitnessed).toBe(true)
})

test('reconcile never submits and is idempotent, and the look-up settles', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.lookupOutcome = { kind: 'reply', body: { state: 'settled', preimage: validPreimage } }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))

	const first = await wrapper.reconcile(quote.reference)
	const second = await wrapper.reconcile(quote.reference)
	expect(first.rung).toBe('witnessed-settled')
	expect(second.rung).toBe('witnessed-settled')
	// the second reconcile is write-once: it does not re-ask the authority
	expect(session.calls.filter((c) => c === 'lookup').length).toBe(1)
	// reconcile published nothing, ever
	expect(session.calls).not.toContain('submitPay')
})

test('the look-up is the authority a bare reply is not: it promotes an acknowledged leg', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.payOutcome = { kind: 'reply', body: {} }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const acked = await wrapper.submit(quote, quote.reference)
	expect(acked.rung).toBe('attested')

	session.lookupOutcome = { kind: 'reply', body: { state: 'settled', preimage: validPreimage } }
	const settled = await wrapper.reconcile(quote.reference)
	expect(settled.rung).toBe('witnessed-settled')
	expect(settled.witness?.kind).toBe('preimage')
})

test('a declared look-up with no validating preimage reaches only attested', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.lookupOutcome = { kind: 'reply', body: { state: 'settled' } }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('attested')
	expect(handle.rung).not.toBe('witnessed-settled')
})

test('the fallback order reaches the transaction scan when the look-up answers nothing', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.lookupOutcome = { kind: 'no-reply' }
	session.scanOutcome = { kind: 'reply', body: { state: 'settled', preimage: validPreimage } }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.reconcile(quote.reference)
	expect(session.calls).toContain('lookup')
	expect(session.calls).toContain('findTransaction')
	expect(handle.rung).toBe('witnessed-settled')
})

test('a payment above the ceiling is refused before a request leaves the box', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	const wrapper = new NwcWrapper({ ...baseOptions(store, session), ceiling: 500 })

	const result = await wrapper.obtain({ kind: 'nip47-session', amountSat: 501, invoice })
	expect('refused' in result && result.refused).toBe(true)
	expect((result as FundsRefusal).reason).toBe('over-ceiling')
	// nothing was published and no leg was written
	expect(session.calls).toEqual([])
	expect(await store.list('w')).toEqual([])
})

test('the durable reference must exist before submit, or nothing is published', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	const wrapper = new NwcWrapper(baseOptions(store, session))
	// a quote for a leg that was never obtained: no durable reference exists
	const ghost: FundsQuote = {
		wrapperId: 'w',
		legId: 'hash:never-obtained',
		method: 'nip47',
		authorityKind: 'remote-and-observable',
		operations: ['obtain', 'submit', 'reconcile'],
		plan: ['obtain', 'submit', 'reconcile'],
		reference: 'hash:never-obtained',
	}
	let code = ''
	try {
		await wrapper.submit(ghost, ghost.reference)
	} catch (error) {
		code = (error as NwcWrapperError).code
	}
	expect(code).toBe('nwc_leg_unknown')
	expect(session.calls).toEqual([])
})

test('submit rejects a reference that does not match the record, and publishes nothing', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	let code = ''
	try {
		await wrapper.submit(quote, 'wrong-reference')
	} catch (error) {
		code = (error as NwcWrapperError).code
	}
	expect(code).toBe('nwc_reference_mismatch')
	expect(session.calls).not.toContain('submitPay')
})

test('a late cryptographic answer settles a still-open leg past the deadline', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	let clock = 1_000_000
	const wrapper = new NwcWrapper(baseOptions(store, session, () => clock))
	const quote = asQuote(await wrapper.obtain(OPEN))
	clock = 2_000_000 // past the 1_060_000 deadline
	session.lookupOutcome = { kind: 'reply', body: { state: 'settled', preimage: validPreimage } }
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('witnessed-settled')
})

test('the deadline does not settle anything by itself', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	let clock = 1_000_000
	const wrapper = new NwcWrapper(baseOptions(store, session, () => clock))
	const quote = asQuote(await wrapper.obtain(OPEN))
	clock = 2_000_000 // past the deadline, and no answer will come
	session.lookupOutcome = { kind: 'no-reply' }
	session.scanOutcome = { kind: 'no-reply' }
	const handle = await wrapper.reconcile(quote.reference)
	expect(handle.rung).toBe('unresolved')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.unwitnessed).toBe(true)
})

test('an unreachable session leaves the leg unresolved and publishes nothing', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.statusValue = 'closed'
	session.connectResult = 'closed'
	const wrapper = new NwcWrapper({ ...baseOptions(store, session), reconnect: { maxAttempts: 2 } })
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('unresolved')
	expect(session.calls).not.toContain('submitPay')
	// the reconnect policy was exercised up to its bound (initial + 2 attempts)
	expect(session.calls.filter((c) => c === 'connect').length).toBe(3)
})

test('the leg declares the port subset, its ordered plan and the fallback order', () => {
	const store = new MemoryNwcLegStore()
	const session = new FakeSession()
	const wrapper = new NwcWrapper(baseOptions(store, session))
	expect(wrapper.operationsFor('nip47-session')).toEqual(['obtain', 'submit', 'reconcile'])
	expect(wrapper.planFor('nip47-session')).toEqual(['obtain', 'submit', 'reconcile'])
	expect(wrapper.registration.operations).toEqual(['obtain', 'submit', 'reconcile'])
	expect(wrapper.registration.plan).toEqual(['obtain', 'submit', 'reconcile'])
	expect(wrapper.registration.authorityKind).toBe('remote-and-observable')
	expect(wrapper.fallbackOrder).toEqual(['payment-reply', 'lookup-invoice', 'list-transactions', 'unresolved'])
	const declaration = wrapper.declarations.find((d) => d.kind === 'nip47-session')
	expect(declaration ? [...declaration.operations] : []).toEqual([...wrapper.planFor('nip47-session')])
})

test('the connection URI secret never rides a record or a handle', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const record = await store.get({ wrapperId: 'w', legId: quote.legId })
	const handle = await wrapper.reconcile(quote.reference)

	const bearer = 'nostr+walletconnect://deadbeef?relay=wss&secret=topsecret'
	for (const object of [record, handle, quote]) {
		expect(Object.keys(object as object)).not.toContain('nostrWalletConnectUrl')
		expect(Object.keys(object as object)).not.toContain('secret')
		expect(JSON.stringify(object)).not.toContain(bearer)
		expect(JSON.stringify(object)).not.toContain('secret=')
	}
})

test('the error taxonomy collapses library errors and states which are recoverable', () => {
	const network = Object.assign(new Error('relay down'), { name: 'Nip47NetworkError' })
	expect(classifyNwcFailure(network)).toBe('unreachable')
	const timeout = Object.assign(new Error('no reply'), { name: 'Nip47ReplyTimeoutError' })
	expect(classifyNwcFailure(timeout)).toBe('ambiguous')
	const unaffordable = Object.assign(new Error('no funds'), { name: 'Nip47WalletError', code: 'INSUFFICIENT_BALANCE' })
	expect(classifyNwcFailure(unaffordable)).toBe('insufficient_balance')
	const refused = Object.assign(new Error('no'), { name: 'Nip47WalletError', code: 'RATE_LIMITED' })
	expect(classifyNwcFailure(refused)).toBe('rejected')
	expect(classifyNwcFailure(new Error('mystery'))).toBe('ambiguous')

	expect(NWC_ERROR_RECOVERABLE.unreachable).toBe(true)
	expect(NWC_ERROR_RECOVERABLE.ambiguous).toBe(true)
	expect(NWC_ERROR_RECOVERABLE.rejected).toBe(false)
	expect(NWC_ERROR_RECOVERABLE.expired).toBe(false)
	expect(NWC_ERROR_RECOVERABLE.insufficient_balance).toBe(false)
})

test('an invoice above the ceiling is refused even when the declared amount is below it', async () => {
	const store = new MemoryNwcLegStore()
	const session = new FakeSession()
	// the invoice carries 1000; the ceiling is 500 and the caller declares only 400 — below both. The
	// ceiling bounds the INVOICE (1000), not the declaration (400), so this is an over-ceiling refusal.
	const wrapper = new NwcWrapper({ ...baseOptions(store, session), ceiling: 500 })

	const result = await wrapper.obtain({ kind: 'nip47-session', amountSat: 400, invoice })
	expect('refused' in result && result.refused).toBe(true)
	expect((result as FundsRefusal).reason).toBe('over-ceiling')
	expect((result as FundsRefusal).reason).not.toBe('amount-mismatch')
	// nothing was published and no leg was written
	expect(session.calls).toEqual([])
	expect(await store.list('w')).toEqual([])
})

test('an invoice whose amount cannot be decoded is refused, never passed', async () => {
	const store = new MemoryNwcLegStore()
	const session = new FakeSession()
	const wrapper = new NwcWrapper(baseOptions(store, session))

	// the codec decodes a payment hash for this string but no amount (no `lnbc<digits>` prefix)
	const result = await wrapper.obtain({ kind: 'nip47-session', amountSat: 1000, invoice: 'not-a-bolt11' })
	expect('refused' in result && result.refused).toBe(true)
	expect((result as FundsRefusal).reason).toBe('undecodable-invoice')
	expect(session.calls).toEqual([])
	expect(await store.list('w')).toEqual([])
})

test('a declared amount that disagrees with the invoice is refused with its own code, either direction', async () => {
	const store = new MemoryNwcLegStore()
	const session = new FakeSession()
	const wrapper = new NwcWrapper({ ...baseOptions(store, session), ceiling: 1_000_000 })

	// the invoice carries 1000; the caller declares 999 (smaller) — the under-declaration the ceiling
	// defect would have let through had it trusted the declaration.
	const smaller = await wrapper.obtain({ kind: 'nip47-session', amountSat: 999, invoice })
	expect('refused' in smaller && smaller.refused).toBe(true)
	expect((smaller as FundsRefusal).reason).toBe('amount-mismatch')
	// and the other direction: the invoice (1000) is smaller than a declaration of 1200.
	const larger = await wrapper.obtain({ kind: 'nip47-session', amountSat: 1200, invoice })
	expect('refused' in larger && larger.refused).toBe(true)
	expect((larger as FundsRefusal).reason).toBe('amount-mismatch')
	expect((larger as FundsRefusal).reason).not.toBe('over-ceiling')
	// neither direction published or wrote anything
	expect(session.calls).toEqual([])
	expect(await store.list('w')).toEqual([])
})

test('a payment that never answers is aborted at the bound and recorded unresolved, never settled', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	session.neverAnswers = true // the reply never arrives; only the module's abort ends the wait
	const wrapper = new NwcWrapper({ ...baseOptions(store, session), reconcileDeadlineMs: 40 })

	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)

	// the module drove the wait: it handed the computed bound to the session and fired its own abort at it
	expect(session.calls).toContain('submitPay')
	expect(session.lastTimeoutMs).toBe(40)
	expect(session.sawAbort).toBe(true) // the abort took effect at the seam, not merely the outcome
	// a no-answer is unresolved: never a settlement, and never a negative settlement
	expect(handle.rung).toBe('unresolved')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.rung).not.toBe('attested')
	expect(handle.rung).not.toBe('abandoned')
	expect(handle.unwitnessed).toBe(true)
	expect(handle.witness).toBeUndefined()
}, 3000)

test('a reply carrying a preimage that does not validate against the payment hash does not settle', async () => {
	const events: string[] = []
	const store = new RecordingStore(events)
	const session = new FakeSession()
	// a preimage for some other invoice: present, but not the one this leg's payment hash commits to
	session.payOutcome = { kind: 'reply', body: { preimage: 'pre:some-other-invoice' } }
	const wrapper = new NwcWrapper(baseOptions(store, session))
	const quote = asQuote(await wrapper.obtain(OPEN))
	const handle = await wrapper.submit(quote, quote.reference)
	expect(handle.rung).toBe('attested')
	expect(handle.rung).not.toBe('witnessed-settled')
	expect(handle.witness?.kind).toBe('ack')
})
