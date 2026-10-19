/**
 * nwc-wrapper/ts/types.ts — the NIP-47 rail's own types and the port it injects.
 *
 * `#c90403` the library is taken as an injected port and never called directly: this file declares the
 * `NwcSession` interface every call goes through and the rail's seam outcomes; `#0643db` this wrapper
 * implements the contract's port over the NIP-47 rail, and the port's vocabulary itself is obtained from the
 * ancestor, the funds contract, and never restated here.
 */
import type { FundsAuthorityKind, FundsOperations, FundsProgress, FundsRung, FundsStep, FundsWitness } from '../../funds-contract/ts/index'

/**
 * `#6ce62a` NwcLegKind — the rail's one leg kind: the NIP-47 session against a remote wallet.
 */
export type NwcLegKind = 'nip47-session'

/**
 * `#6ce62a` NwcLegOperationsDeclaration — the subset of the port's operations the leg has, in the port's
 * canonical order.
 */
export interface NwcLegOperationsDeclaration {
	readonly kind: NwcLegKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
}

/**
 * `#cd4679` NwcFallbackStep — the declared order in which an ambiguous outcome is resolved.
 */
export type NwcFallbackStep = 'payment-reply' | 'lookup-invoice' | 'list-transactions' | 'unresolved'

/**
 * `#b8c987` NwcSessionStatus — the session lifecycle state the module reads from its injected session.
 */
export type NwcSessionStatus = 'closed' | 'connected' | 'reconnecting'

/**
 * `#cd4679` NwcOutcome — what one seam call yields. It distinguishes a reply, a no-answer (a timeout or a
 * dropped socket) and a transport or library failure, so a silence is never read as a negative settlement.
 */
export type NwcOutcome<T> =
	| { readonly kind: 'reply'; readonly body: T }
	| { readonly kind: 'no-reply' }
	| { readonly kind: 'transport-error'; readonly reason: string }
	| { readonly kind: 'error'; readonly code: NwcErrorCode; readonly recoverable: boolean }

/**
 * `#92cbfa` NwcPaymentBody — a `pay_invoice` reply body: a preimage may or may not be present, and only a
 * preimage validated against the payment hash settles.
 */
export interface NwcPaymentBody {
	readonly preimage?: string
}

/**
 * `#92cbfa` NwcTransactionBody — a look-up or a scanned transaction: the wallet's declared state, carrying a
 * preimage only when it has one.
 */
export interface NwcTransactionBody {
	readonly state: 'settled' | 'pending' | 'failed' | 'accepted'
	readonly preimage?: string
}

/**
 * `#d843ee` NwcErrorCode — the small taxonomy the rest of the system acts on: every library error is collapsed
 * into one of these by the module's classifier, and the module states which members are recoverable.
 */
export type NwcErrorCode = 'unreachable' | 'rejected' | 'expired' | 'insufficient_balance' | 'ambiguous'

/**
 * `#c90403` NwcSession — the injected library port. Every call to the NIP-47 library goes through this
 * interface, so the module opens no network of its own and no test needs a relay or a wallet.
 * `#7af452` the `pay_invoice` leg carries the module's own abort `signal`: the module owns the wait and
 * fires the abort at the bound, and the session honours it, so the timeout is the module's and not a
 * library default the caller cannot reach.
 */
export interface NwcSession {
	status(): NwcSessionStatus
	/** establish or re-establish the relay session */
	connect(): Promise<void>
	/** tear the session down */
	close(): Promise<void>
	/**
	 * `#7af452` publish the prepared `pay_invoice` request and await the one reply the library returns for
	 * that invoice, bounded by `timeoutMs`. The caller signals `signal` when the bound passes; the session
	 * must then stop waiting and answer `no-reply` — never a settlement. The request event id is carried as
	 * the leg's durable local reference only: the installed library does not let a caller own the id it
	 * signs on the wire, so the session cannot correlate the reply to it.
	 */
	submitPay(request: {
		readonly requestEventId: string
		readonly invoice: string
		readonly timeoutMs: number
		readonly signal: AbortSignal
	}): Promise<NwcOutcome<NwcPaymentBody>>
	/** the authority a bare reply is not: look an invoice up by its payment hash */
	lookup(request: { readonly paymentHash: string; readonly timeoutMs: number }): Promise<NwcOutcome<NwcTransactionBody>>
	/** the last fallback before `unresolved`: find the transaction naming the payment hash */
	findTransaction(request: { readonly paymentHash: string; readonly timeoutMs: number }): Promise<NwcOutcome<NwcTransactionBody>>
}

/**
 * `#92cbfa` NwcInvoiceCodec — the injected invoice codec: decode a payment hash, decode the invoice's own
 * amount, and validate a preimage against the hash. The market's own decoder is
 * `@getalby/lightning-tools`; the module imports neither.
 * `#485e92` `amountSat` is what the budget ceiling is checked against — the invoice's own amount, not the
 * caller's declaration — so an invoice whose amount cannot be decoded (`0` or a non-finite value) is a
 * fail-closed refusal and never a payment.
 */
export interface NwcInvoiceCodec {
	paymentHash(invoice: string): string
	/** the invoice's own amount in satoshis; `0` or non-finite means the amount cannot be decoded */
	amountSat(invoice: string): number
	validatePreimage(invoice: string, preimage: string): boolean
}

/**
 * `#47312b` NwcLegKey — the leg store's key: per wrapper and leg.
 */
export interface NwcLegKey {
	readonly wrapperId: string
	readonly legId: string
}

/**
 * `#47312b` NwcLegRecord — the wrapper's durable leg record. It binds the rail's durable reference — the
 * NIP-47 request event id the module assigned and the invoice's payment hash — written before `submit`. It
 * carries no connection URI and no secret.
 */
export interface NwcLegRecord {
	readonly wrapperId: string
	readonly legId: string
	readonly kind: NwcLegKind
	readonly method: string
	readonly authorityKind: FundsAuthorityKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
	/** the payable artifact */
	readonly invoice: string
	/** the invoice's payment hash — the other half of the durable reference */
	readonly paymentHash: string
	/** the NIP-47 request event id, assigned before submit and the reply's correlation key */
	readonly requestEventId: string
	readonly progress: FundsProgress
	readonly rung: FundsRung
	readonly witness?: FundsWitness
	/** explicit marker that no witness closes this leg — never an empty string */
	readonly unwitnessed: boolean
	/** absolute, computed from the injected clock; present because the authority is remote */
	readonly reconcileDeadlineAt: number
	readonly revision: number
	readonly createdAt: number
	readonly updatedAt: number
}

/**
 * `#47312b` NwcLegStore — the durable leg store the wrapper declares and the app injects: the wallet host's
 * store contract, generalised by key per wrapper and leg. `compareAndSet` MUST atomically reject any revision
 * other than `expectedRevision`.
 */
export interface NwcLegStore {
	createOrGet(record: NwcLegRecord): Promise<{ record: NwcLegRecord; created: boolean }>
	get(key: NwcLegKey): Promise<NwcLegRecord | null>
	list(wrapperId?: string): Promise<readonly NwcLegRecord[]>
	compareAndSet(key: NwcLegKey, expectedRevision: number, next: NwcLegRecord): Promise<NwcLegRecord>
}

/**
 * `#0643db` NwcLegCommand — what opens a leg. The rail's own parameters only: the app supplies the invoice to
 * pay. The durable reference is resolved from the invoice, so the command names no store.
 */
export interface NwcLegCommand {
	readonly kind: NwcLegKind
	readonly amountSat: number
	readonly invoice: string
	readonly description?: string
}

/**
 * `#006a58` NwcWrapperOptions — what the composing app injects: the durable store, the injected session, the
 * injected codec and clock, and an id factory. The connection URI is not here — it lives inside the injected
 * session and is never handed to this module.
 */
export interface NwcWrapperOptions {
	readonly wrapperId: string
	readonly store: NwcLegStore
	readonly storeKind: string
	readonly session: NwcSession
	readonly codec: NwcInvoiceCodec
	/** how many times a dropped or absent session is re-attempted before a call reads as unreachable */
	readonly reconnect: { readonly maxAttempts: number }
	/** the wait bound the registration declares and the leg record instantiates, in milliseconds */
	readonly reconcileDeadlineMs: number
	readonly ceiling: number
	readonly contractVersion: string
	/** the connection URI's private key stays inside the session; this factory only assigns a correlation id */
	readonly newId: () => string
	/** Unix milliseconds. Required so the module never reads a host clock global. */
	readonly now: () => number
}
