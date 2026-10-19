/**
 * nwc-wrapper/ts/wrapper.ts — the contract's port, implemented over the NIP-47 session rail.
 *
 * `#0643db` the wrapper implements the port: `obtain` writes the leg's durable reference before any request is
 * published, `submit` is the one irreversible step, and `reconcile` re-reads an authority and never submits.
 * `#6ce62a` the leg declares the subset of the port's operations it has; `#b8c987` the session lifecycle and
 * its reconnect policy are the module's; `#568e8d` so are the request-to-reply correlation and its timeout;
 * `#47312b` the durable reference — the request event id and the payment hash — is written before `submit`;
 * `#cd4679` an ambiguous outcome follows the declared fallback order and a silence is never a negative
 * settlement; `#92cbfa` only a validated preimage settles and the look-up is the authority a reply is not;
 * `#ff792b` the clock is injected and the reconcile deadline is absolute on the record; `#485e92` the
 * ceiling bounds the invoice's own decoded amount, never the caller's declaration; `#7af452` the request
 * event id is a durable local reference only and the wait is the module's, aborted at its bound.
 */
import { NwcWrapperError } from './errors'
import type {
	NwcFallbackStep,
	NwcLegCommand,
	NwcLegKind,
	NwcLegOperationsDeclaration,
	NwcLegRecord,
	NwcOutcome,
	NwcPaymentBody,
	NwcTransactionBody,
	NwcWrapperOptions,
} from './types'
import type {
	FundsAuthorityKind,
	FundsHandle,
	FundsOperations,
	FundsQuote,
	FundsRefusal,
	FundsStep,
	FundsWitness,
	FundsWitnessKind,
	WrapperRegistration,
} from '../../funds-contract/ts/index'

const METHOD = 'nip47'
const CONTRACT_PORT = 'funds-contract'
const AUTHORITY_KIND: FundsAuthorityKind = 'remote-and-observable'

/** The port's canonical order; every leg's plan is this order projected onto the leg's subset. */
const CANONICAL: readonly FundsStep[] = ['obtain', 'submit', 'reconcile']
const ALL_OPERATIONS: FundsOperations = ['obtain', 'submit', 'reconcile']

/** The port's operations the leg declares it has. This rail is a money-mover, so it has all three. */
const LEG_OPERATIONS: Record<NwcLegKind, FundsOperations> = {
	'nip47-session': ['obtain', 'submit', 'reconcile'],
}

const planFor = (operations: FundsOperations): readonly FundsStep[] => CANONICAL.filter((step) => operations.includes(step))

const LEG_KINDS = Object.keys(LEG_OPERATIONS) as NwcLegKind[]

const LEG_DECLARATIONS: readonly NwcLegOperationsDeclaration[] = LEG_KINDS.map((kind) => ({
	kind,
	operations: LEG_OPERATIONS[kind],
	plan: planFor(LEG_OPERATIONS[kind]),
}))

/** The witness kinds the rail can produce: a validated preimage (cryptographic) and the declared `ack`. */
const WITNESS_KINDS: readonly FundsWitnessKind[] = ['preimage', 'ack']

/**
 * `#cd4679` FALLBACK_ORDER — the declared order in which an ambiguous outcome is resolved: the payment reply,
 * then `lookup_invoice`, then the transaction scan, then an explicit `unresolved`.
 */
const FALLBACK_ORDER: readonly NwcFallbackStep[] = ['payment-reply', 'lookup-invoice', 'list-transactions', 'unresolved']

const handleFor = (record: NwcLegRecord): FundsHandle => ({
	wrapperId: record.wrapperId,
	legId: record.legId,
	progress: record.progress,
	rung: record.rung,
	witness: record.witness,
	unwitnessed: record.unwitnessed,
	reconcileDeadlineAt: record.reconcileDeadlineAt,
})

const refusal = (reason: string, field: string): FundsRefusal => ({ refused: true, reason, field })

/**
 * `#0643db` NwcWrapper — the contract's port over the NIP-47 session rail. The injected session, the leg store,
 * the codec, the clock and the id factory are all supplied by the composing app; the module opens no network of
 * its own (`#c90403`) and never touches the connection URI (`#006a58`).
 */
export class NwcWrapper {
	private readonly options: NwcWrapperOptions

	constructor(options: NwcWrapperOptions) {
		if (typeof options.now !== 'function') {
			throw new NwcWrapperError('nwc_configuration', 'the wrapper requires an injected clock')
		}
		if (typeof options.newId !== 'function') {
			throw new NwcWrapperError('nwc_configuration', 'the wrapper requires an injected id factory')
		}
		if (!Number.isFinite(options.reconcileDeadlineMs) || options.reconcileDeadlineMs < 0) {
			throw new NwcWrapperError('nwc_configuration', 'reconcileDeadlineMs must be a non-negative number')
		}
		if (!Number.isFinite(options.reconnect.maxAttempts) || options.reconnect.maxAttempts < 0) {
			throw new NwcWrapperError('nwc_configuration', 'reconnect.maxAttempts must be a non-negative number')
		}
		if (!Number.isFinite(options.ceiling) || options.ceiling <= 0) {
			throw new NwcWrapperError('nwc_configuration', 'ceiling must be a positive number')
		}
		this.options = options
	}

	get wrapperId(): string {
		return this.options.wrapperId
	}

	/** The leg declares the subset of the port's operations it has (`#6ce62a`). */
	get declarations(): readonly NwcLegOperationsDeclaration[] {
		return LEG_DECLARATIONS
	}

	/** The fallback order an ambiguous outcome is resolved by (`#cd4679`). */
	get fallbackOrder(): readonly NwcFallbackStep[] {
		return FALLBACK_ORDER
	}

	/** The subset of the port's three operations the leg has, in the port's canonical order. */
	operationsFor(kind: NwcLegKind): FundsOperations {
		return LEG_OPERATIONS[kind]
	}

	/** The leg's declared plan: its operations projected onto the port's canonical order. */
	planFor(kind: NwcLegKind): readonly FundsStep[] {
		return planFor(LEG_OPERATIONS[kind])
	}

	/** The declaration the aggregator's acceptance gate validates (`#c997ae`). */
	get registration(): WrapperRegistration {
		return {
			wrapperId: this.options.wrapperId,
			method: METHOD,
			port: CONTRACT_PORT,
			authorityKind: AUTHORITY_KIND,
			operations: ALL_OPERATIONS,
			plan: planFor(ALL_OPERATIONS),
			store: 'nwc-leg-store',
			storeKind: this.options.storeKind,
			witnessKinds: WITNESS_KINDS,
			reconcileDeadlineMs: this.options.reconcileDeadlineMs,
			journalReference: { shape: 'nip47-request-event-id+payment-hash', writtenBefore: 'submit' },
			ceiling: this.options.ceiling,
			contractVersion: this.options.contractVersion,
		}
	}

	/**
	 * `#0643db` obtain — resolve the leg's durable reference (the invoice's payment hash and its own amount)
	 * and **write the leg record before any request is published**. `#4e3879` `#485e92` it holds the intent's
	 * ceiling against the **invoice's own decoded amount** — never the caller's `amountSat` — and refuses a
	 * payment above it before a request leaves the box: an invoice above the ceiling is `over-ceiling` even
	 * when the declared amount is below it, an invoice whose amount cannot be decoded is
	 * `undecodable-invoice` and is never passed, and a declared amount that disagrees with the invoice is the
	 * distinct `amount-mismatch`. `#47312b` the record it writes is the durable reference `submit` requires.
	 */
	async obtain(command: NwcLegCommand): Promise<FundsQuote | FundsRefusal> {
		if (!Number.isFinite(command.amountSat) || command.amountSat <= 0) {
			return refusal('invalid-amount', 'amountSat')
		}
		if (!command.invoice) return refusal('no-reference', 'invoice')

		// `#47312b` the durable reference is resolved from the invoice: its payment hash, and — `#485e92` —
		// its own amount, the number the ceiling bounds.
		let paymentHash: string
		let invoiceSat: number
		try {
			paymentHash = this.options.codec.paymentHash(command.invoice)
			invoiceSat = this.options.codec.amountSat(command.invoice)
		} catch {
			return refusal('undecodable-invoice', 'invoice')
		}
		if (!paymentHash) return refusal('undecodable-invoice', 'invoice')
		// `#485e92` an invoice whose amount the codec cannot decode is refused, never passed: a payment the
		// module cannot bound is not made.
		if (!Number.isFinite(invoiceSat) || invoiceSat <= 0) {
			return refusal('undecodable-invoice', 'invoice')
		}
		// `#485e92` the ceiling bounds the INVOICE's own amount, not the caller's declaration: an invoice
		// above the ceiling is refused `over-ceiling` even when the declared amount is below it.
		if (invoiceSat > this.options.ceiling) {
			return refusal('over-ceiling', 'invoice')
		}
		// `#485e92` a declared amount that disagrees with the invoice is its own named fault — `amount-mismatch`,
		// not `over-ceiling`: the two are different faults. The check is symmetric, so a declaration smaller
		// than the invoice (which, trusted, would let an over-declaration through) and one larger than it are
		// both refused, because the intent's number and the artifact's number must agree.
		if (command.amountSat !== invoiceSat) {
			return refusal('amount-mismatch', 'amountSat')
		}

		const now = this.options.now()
		const operations = this.operationsFor(command.kind)
		const record: NwcLegRecord = {
			wrapperId: this.options.wrapperId,
			legId: paymentHash,
			kind: command.kind,
			method: METHOD,
			authorityKind: AUTHORITY_KIND,
			operations,
			plan: planFor(operations),
			invoice: command.invoice,
			paymentHash,
			// `#568e8d` the correlation id is assigned here and recorded before submit publishes anything.
			requestEventId: this.options.newId(),
			progress: 'attempted',
			rung: 'unresolved',
			unwitnessed: true,
			reconcileDeadlineAt: now + this.options.reconcileDeadlineMs,
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}
		// The durable reference is written BEFORE the irreversible step: nothing is published unless this landed.
		const stored = await this.options.store.createOrGet(record)

		return {
			wrapperId: stored.record.wrapperId,
			legId: stored.record.legId,
			method: METHOD,
			authorityKind: AUTHORITY_KIND,
			operations: stored.record.operations,
			plan: stored.record.plan,
			reference: stored.record.paymentHash,
		}
	}

	/**
	 * `#0643db` submit — the one irreversible step. `#b8c987` it first ensures the session is live (re-attempting
	 * the connection up to the policy bound) and, if the session cannot be brought up, returns the leg
	 * `unresolved` rather than publishing. It fails closed if the durable reference is absent, then publishes the
	 * request and reads the reply through the ladder (`#92cbfa`). `#7af452` the wait is the module's: the bound
	 * comes from the injected clock and the module aborts the session at it, so a payment that has not answered
	 * within the bound is `no-reply` — `unresolved`, never a settlement and never a negative settlement.
	 */
	async submit(quote: FundsQuote, reference: string): Promise<FundsHandle> {
		const record = await this.options.store.get({
			wrapperId: this.options.wrapperId,
			legId: quote.legId,
		})
		// `#47312b` no durable reference means nothing reaches the wallet: the reference must exist first.
		if (!record) throw new NwcWrapperError('nwc_leg_unknown', `no leg ${quote.legId}`)
		if (record.paymentHash !== reference) {
			throw new NwcWrapperError('nwc_reference_mismatch', `leg ${record.legId} does not carry that reference`)
		}
		if (!record.operations.includes('submit')) {
			throw new NwcWrapperError('nwc_operation_absent', `leg ${record.legId} declares no submit`)
		}

		// `#b8c987` the session lifecycle is the module's: bring it up, or leave the leg unresolved.
		if (!(await this.ensureConnected())) return handleFor(record)

		// `#7af452` the wait is the module's and it is real: the module owns the bound (from the injected
		// clock) and fires its own abort at it, so a payment that never answers is bounded here rather than by
		// a library default the caller cannot reach. The request event id is handed over as the leg's durable
		// local reference; the installed library does not let a caller own the id it signs, so this is not the
		// wire correlation key and the module does not claim it is.
		const wait = this.remainingWait(record)
		const controller = new AbortController()
		let timer: ReturnType<typeof setTimeout> | undefined
		const bound = new Promise<NwcOutcome<NwcPaymentBody>>((resolve) => {
			timer = setTimeout(() => {
				controller.abort()
				resolve({ kind: 'no-reply' })
			}, wait)
		})
		let outcome: NwcOutcome<NwcPaymentBody>
		try {
			outcome = await Promise.race([
				this.options.session.submitPay({
					requestEventId: record.requestEventId,
					invoice: record.invoice,
					timeoutMs: wait,
					signal: controller.signal,
				}),
				bound,
			])
		} finally {
			if (timer !== undefined) clearTimeout(timer)
		}
		return this.readOutcome(record, outcome, 'nip47')
	}

	/**
	 * `#0643db` reconcile — idempotent, and it **never submits**. `#cd4679` it walks the declared fallback order
	 * (the look-up, then the transaction scan, then `unresolved`) and re-reads an authority only. A cryptographic
	 * settle already held is returned unchanged (write-once); a look-up that cannot conclude leaves the leg
	 * blocked (`unresolved`), never settled and never re-published.
	 */
	async reconcile(reference: string): Promise<FundsHandle> {
		const record = await this.options.store.get({
			wrapperId: this.options.wrapperId,
			legId: reference,
		})
		if (!record) throw new NwcWrapperError('nwc_leg_unknown', `reconcile: no leg ${reference}`)

		// Write-once: a cryptographic settlement is terminal and is never downgraded by a later observation.
		if (record.rung === 'witnessed-settled') return handleFor(record)

		// An unreachable session is a silence, and reconcile does not publish.
		if (!(await this.ensureConnected())) return handleFor(record)

		const wait = this.remainingWait(record)

		// `#cd4679` fallback 1 — the look-up by payment hash: the authority a bare reply is not.
		const looked = await this.options.session.lookup({ paymentHash: record.paymentHash, timeoutMs: wait })
		const fromLookup = await this.readOutcome(record, looked, 'lookup_invoice')
		if (fromLookup.rung === 'witnessed-settled' || fromLookup.rung === 'attested') return fromLookup

		// `#cd4679` fallback 2 — scan the wallet's transactions for the one naming the hash.
		const scanned = await this.options.session.findTransaction({
			paymentHash: record.paymentHash,
			timeoutMs: wait,
		})
		const fromScan = await this.readOutcome(record, scanned, 'list_transactions')
		if (fromScan.rung === 'witnessed-settled' || fromScan.rung === 'attested') return fromScan

		// `#cd4679` fallback 3 — no answer is `unresolved`: a witness may still arrive, and never a settlement.
		return handleFor(record)
	}

	/** `#b8c987` Bring the session up, re-attempting the connection up to the policy bound. */
	private async ensureConnected(): Promise<boolean> {
		if (this.options.session.status() === 'connected') return true
		const attempts = Math.max(0, Math.floor(this.options.reconnect.maxAttempts))
		for (let attempt = 0; attempt <= attempts; attempt += 1) {
			try {
				await this.options.session.connect()
			} catch {
				// a failed connect is re-attempted up to the policy bound
			}
			if (this.options.session.status() === 'connected') return true
		}
		return false
	}

	/** `#ff792b` The remaining wait, computed from the injected clock and the record's absolute deadline. */
	private remainingWait(record: NwcLegRecord): number {
		return Math.max(0, record.reconcileDeadlineAt - this.options.now())
	}

	/**
	 * `#92cbfa` Read one seam outcome through the ladder: a preimage validated against the payment hash settles
	 * (`witnessed-settled`); a declared settlement or acknowledgement with no validating preimage reaches only
	 * `attested`; a non-settled state, a no-answer, a transport error or a library error leaves the leg where it
	 * is — `unresolved`, never a negative settlement.
	 */
	private async readOutcome(
		record: NwcLegRecord,
		outcome: NwcOutcome<NwcPaymentBody | NwcTransactionBody>,
		source: string,
	): Promise<FundsHandle> {
		if (outcome.kind !== 'reply') return handleFor(record)
		const body = outcome.body
		const preimage = typeof body.preimage === 'string' && body.preimage.length > 0 ? body.preimage : undefined
		if (preimage && this.options.codec.validatePreimage(record.invoice, preimage)) {
			// `#92cbfa` a preimage validating against the payment hash settles the leg
			return this.settle(record, { kind: 'preimage', source, observedAt: this.options.now() })
		}
		const state = 'state' in body ? body.state : null
		if (state === null || state === 'settled') {
			// `#92cbfa` a declared settlement or acknowledgement with no validating preimage reaches only attested
			return this.attest(record, { kind: 'ack', source, observedAt: this.options.now() })
		}
		// a non-settled state is not a witness: the leg stays where it was
		return handleFor(record)
	}

	private async settle(record: NwcLegRecord, witness: FundsWitness): Promise<FundsHandle> {
		if (record.rung === 'witnessed-settled') return handleFor(record)
		const next: NwcLegRecord = {
			...record,
			progress: 'submitted',
			rung: 'witnessed-settled',
			witness,
			unwitnessed: false,
			revision: record.revision + 1,
			updatedAt: this.options.now(),
		}
		const stored = await this.options.store.compareAndSet({ wrapperId: record.wrapperId, legId: record.legId }, record.revision, next)
		return handleFor(stored)
	}

	private async attest(record: NwcLegRecord, witness: FundsWitness): Promise<FundsHandle> {
		if (record.rung === 'witnessed-settled') return handleFor(record)
		const next: NwcLegRecord = {
			...record,
			progress: 'submitted',
			rung: 'attested',
			witness,
			unwitnessed: false,
			revision: record.revision + 1,
			updatedAt: this.options.now(),
		}
		const stored = await this.options.store.compareAndSet({ wrapperId: record.wrapperId, legId: record.legId }, record.revision, next)
		return handleFor(stored)
	}
}
