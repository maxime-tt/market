/**
 * nwc-wrapper/ts/session.ts — the concrete NIP-47 session, over `@getalby/sdk`.
 *
 * `#c90403` this is the one file that imports the library; it implements the injected `NwcSession` interface so
 * the wrapper never calls the SDK directly. `#006a58` the connection URI embeds a private key: it is held only
 * in this class's private field, is never written to a record, a handle or a log, and the module is handed the
 * session rather than the URI. `#7af452` the adapter bounds its one `pay_invoice` at the module's wait: the
 * installed `payInvoice` exposes no abort signal and no timeout of its own, so the adapter races it against the
 * module's bound and its abort signal and answers `no-reply` when either fires — never a settlement.
 */
// `@getalby/sdk/nwc` — the package's own NIP-47 entry — rather than the package root, because the root's
// `dist/types/index.d.ts` re-exports the WebLN surface and so references `@webbtc/webln-types`, which is not
// installed in this tree (it is an unresolvable type-only module there, in the assembly too, where a module
// tsconfig's `skipLibCheck` hid it). The subpath exports the same `NWCClient` over the same code; only the
// type graph differs. Nothing else in this tree imports the package root, so no second bundle is loaded.
import { NWCClient } from '@getalby/sdk/nwc'
import { NWC_ERROR_RECOVERABLE, classifyNwcFailure } from './errors'
import type { NwcOutcome, NwcPaymentBody, NwcSession, NwcSessionStatus, NwcTransactionBody } from './types'

/**
 * `#006a58` GetalbyNwcSessionOptions — the connection URI, bearer material carried only by the injected
 * session and by nothing the module records or returns.
 */
export interface GetalbyNwcSessionOptions {
	readonly nostrWalletConnectUrl: string
}

const transactionBody = (state: NwcTransactionBody['state'], preimage?: string): NwcTransactionBody =>
	preimage ? { state, preimage } : { state }

/**
 * `#7af452` NwcBoundPassed — the module's wait passed before the payment answered. It is not a library error
 * and not a settlement: the adapter maps it to `no-reply` (a no-answer), never to a negative settlement.
 */
class NwcBoundPassed extends Error {
	constructor() {
		super('the module wait passed before the payment answered')
		this.name = 'NwcBoundPassed'
	}
}

/**
 * `#c90403` GetalbyNwcSession — the concrete session over `@getalby/sdk`, behind the injected `NwcSession`
 * interface. The wrapper talks only to the interface, so no test needs a relay or a wallet.
 */
export class GetalbyNwcSession implements NwcSession {
	private client: NWCClient | null = null

	constructor(private readonly options: GetalbyNwcSessionOptions) {}

	status(): NwcSessionStatus {
		if (!this.client) return 'closed'
		return this.client.connected ? 'connected' : 'reconnecting'
	}

	async connect(): Promise<void> {
		if (!this.client) {
			this.client = new NWCClient({ nostrWalletConnectUrl: this.options.nostrWalletConnectUrl })
		}
		// the SDK opens a relay lazily; negotiating the key proves the session is live
		await this.client.getPublicKey()
	}

	async close(): Promise<void> {
		this.client?.close()
		this.client = null
	}

	async submitPay(request: {
		readonly requestEventId: string
		readonly invoice: string
		readonly timeoutMs: number
		readonly signal: AbortSignal
	}): Promise<NwcOutcome<NwcPaymentBody>> {
		if (!this.client) return { kind: 'transport-error', reason: 'session is not connected' }
		try {
			// `#7af452` the installed `payInvoice` takes no abort signal and no timeout of its own, so the
			// adapter bounds the module's wait itself: it races the payment against the module's bound and its
			// abort signal and answers `no-reply` when either fires — a no-answer, never a settlement. The
			// request event id is carried by the leg as its durable local reference; the client signs its own
			// event id on the wire, so this adapter cannot correlate on the id it is handed.
			const reply = await this.bounded(this.client.payInvoice({ invoice: request.invoice }), request.timeoutMs, request.signal)
			const body: NwcPaymentBody = reply.preimage ? { preimage: reply.preimage } : {}
			return { kind: 'reply', body }
		} catch (error) {
			if (error instanceof NwcBoundPassed) return { kind: 'no-reply' }
			return this.failure(error)
		}
	}

	/**
	 * `#7af452` Race `work` against the module's own bound (`timeoutMs`) and its abort `signal`. The installed
	 * `payInvoice` exposes neither, so the adapter bounds the module's wait itself: it stops awaiting at the
	 * bound and answers `no-reply`; it cannot force the client to tear its relay subscription down early, and
	 * that limit is stated rather than hidden.
	 */
	private bounded<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined
			const cleanup = () => {
				if (timer !== undefined) clearTimeout(timer)
				signal.removeEventListener('abort', onAbort)
			}
			const onAbort = () => {
				cleanup()
				reject(new NwcBoundPassed())
			}
			if (signal.aborted) {
				onAbort()
				return
			}
			signal.addEventListener('abort', onAbort, { once: true })
			if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
				timer = setTimeout(onAbort, timeoutMs)
			}
			work.then(
				(value) => {
					cleanup()
					resolve(value)
				},
				(error) => {
					cleanup()
					reject(error)
				},
			)
		})
	}

	async lookup(request: { readonly paymentHash: string; readonly timeoutMs: number }): Promise<NwcOutcome<NwcTransactionBody>> {
		if (!this.client) return { kind: 'transport-error', reason: 'session is not connected' }
		try {
			const transaction = await this.client.lookupInvoice({ payment_hash: request.paymentHash })
			return { kind: 'reply', body: transactionBody(transaction.state, transaction.preimage) }
		} catch (error) {
			return this.failure(error)
		}
	}

	async findTransaction(request: { readonly paymentHash: string; readonly timeoutMs: number }): Promise<NwcOutcome<NwcTransactionBody>> {
		if (!this.client) return { kind: 'transport-error', reason: 'session is not connected' }
		try {
			const list = await this.client.listTransactions({ type: 'incoming', limit: 100 })
			const match = list.transactions.find((transaction) => transaction.payment_hash === request.paymentHash)
			if (!match) return { kind: 'no-reply' }
			return { kind: 'reply', body: transactionBody(match.state, match.preimage) }
		} catch (error) {
			return this.failure(error)
		}
	}

	/** Map a thrown library error onto the taxonomy; a timeout is a no-answer, never a negative settlement. */
	private failure(error: unknown): NwcOutcome<never> {
		const code = classifyNwcFailure(error)
		const name = ((error ?? {}) as { name?: unknown }).name
		if (typeof name === 'string' && name.includes('Timeout')) return { kind: 'no-reply' }
		return { kind: 'error', code, recoverable: NWC_ERROR_RECOVERABLE[code] }
	}
}
