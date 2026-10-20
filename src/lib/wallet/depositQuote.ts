/**
 * depositQuote.ts — the deposit lifecycle, on coco's own mint-quote events.
 *
 * A deposit is a mint quote and nothing else: the wallet asks the mint for a quote, the user
 * pays the invoice it returns, the mint reports the quote paid, and the wallet redeems it for
 * proofs. The states here are coco's and the mint's, not ours — `UNPAID`, `PAID`, `ISSUED` —
 * and this module's only job is to decide what each means for a *deposit*:
 *
 * - `ISSUED` is success: the proofs exist. Nothing weaker is.
 * - a quote that expired unpaid is a failure, and is reported as one.
 * - `PAID` and not yet `ISSUED` is neither. The payment has landed and redemption is still in
 *   flight, which is exactly the state the app renders as `awaiting_confirmation_retry` when
 *   the wait times out — wallet acknowledgement is not settlement (AGENTS.md), so this module
 *   never calls it success.
 *
 * coco 1.0's quote service has no single-quote read (`getMintQuote` lives on its repository, not
 * on `manager.quotes`), so the adapter is event-driven: it settles on
 * `mint-quote:state-changed` for its own quote id. `check()` nudges coco's processor with
 * `requeuePaidMintQuotes` — the same call a caller would otherwise make by hand — and then
 * waits on the event.
 *
 * The timeout rejection carries the same message the NIP-60 deposit path classifies, so a
 * caller can keep mapping "we ran out of patience" to `awaiting_confirmation_retry` rather than
 * to a failure. `getDepositConfirmationTimeoutMessage` is the only place that string is built.
 */

/** The states a BOLT11 mint quote moves through, as the mint reports them. */
export type DepositQuoteState = 'UNPAID' | 'PAID' | 'ISSUED'

/** The slice of coco's Manager the deposit path uses, so a fake can stand in for it. */
export interface CocoDepositManager {
	quotes: {
		createMintQuote(mintUrl: string, amount: number): Promise<{ quote: string; request: string; expiry?: number }>
		requeuePaidMintQuotes(mintUrl?: string): Promise<{ requeued: string[] }>
	}
	on(
		event: 'mint-quote:state-changed',
		handler: (payload: { mintUrl: string; quoteId: string; state: DepositQuoteState }) => void,
	): () => void
}

/** What a caller is told when a deposit resolves or fails. `undefined` means "settled". */
export type DepositListener = (error?: Error) => void

export interface CocoDepositQuote {
	/** The mint's quote id once `start()` has run. */
	readonly quoteId: string | null
	/** The BOLT11 invoice once `start()` has run. */
	readonly invoice: string | null
	/** Create the quote and return its invoice. Idempotent: a second call returns the same one. */
	start(): Promise<string | null>
	/** Subscribe to the deposit's outcome. Returns an unsubscribe function. */
	on(event: 'success' | 'error', handler: DepositListener): () => void
	/**
	 * Wait until the deposit is issued. Rejects on an expired quote, and rejects with the
	 * confirmation-timeout message when the wait runs out first.
	 */
	check(timeoutMs?: number): Promise<void>
	/** Drop the coco subscription. */
	dispose(): void
}

export interface CocoDepositQuoteOptions {
	readonly manager: CocoDepositManager
	readonly mintUrl: string
	readonly amount: number
	/** Unix milliseconds. Injected so the module never reads a host clock. */
	readonly now?: () => number
	/** How often `check()` re-reads its own state and the deadline. */
	readonly pollIntervalMs?: number
	/** Injected so tests do not really sleep. */
	readonly sleep?: (ms: number) => Promise<void>
}

/** The app's deposit confirmation window. Same value the NIP-60 path used. */
export const DEFAULT_DEPOSIT_CONFIRMATION_TIMEOUT_MS = 15_000

/** The label the timeout error carries; the caller classifies "we timed out" by this message. */
export const DEPOSIT_CONFIRMATION_TIMEOUT_LABEL = 'wallet acknowledgment and mint confirmation'

export const getDepositConfirmationTimeoutMessage = (timeoutMs: number): string =>
	`${DEPOSIT_CONFIRMATION_TIMEOUT_LABEL} timeout after ${timeoutMs}ms`

const DEPOSIT_EXPIRED_MESSAGE = 'Deposit quote expired before payment reached the mint.'

/**
 * One deposit over one mint quote. Listeners are notified once per outcome, and `check()`
 * answers the same outcome whether it observed the state directly or was woken by an event.
 */
export const createCocoDepositQuote = (options: CocoDepositQuoteOptions): CocoDepositQuote => {
	const now = options.now ?? (() => Date.now())
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
	const pollIntervalMs = options.pollIntervalMs ?? 250

	let quoteId: string | null = null
	let invoice: string | null = null
	/** When the mint's quote stops being payable, in Unix milliseconds. */
	let expiryAt: number | null = null
	let state: DepositQuoteState | null = null
	let outcome: 'success' | 'error' | null = null
	let outcomeError: Error | undefined
	let disposed = false

	const listeners: Array<{ event: 'success' | 'error'; handler: DepositListener }> = []

	const notify = (event: 'success' | 'error', error?: Error): void => {
		for (const listener of listeners) {
			if (listener.event !== event) continue
			try {
				listener.handler(error)
			} catch (listenerError) {
				console.error('[deposit] deposit listener threw:', listenerError)
			}
		}
	}

	const settle = (event: 'success' | 'error', error?: Error): void => {
		if (outcome) return // write-once: the first outcome is the outcome
		outcome = event
		outcomeError = error
		notify(event, error)
	}

	// A quote is only this deposit's when it carries this deposit's id — coco's bus is shared
	// by every quote the wallet has open.
	const unsubscribe = options.manager.on('mint-quote:state-changed', (payload) => {
		if (disposed) return
		if (!quoteId || payload.mintUrl !== options.mintUrl || payload.quoteId !== quoteId) return
		state = payload.state
		if (payload.state === 'ISSUED') settle('success')
	})

	return {
		get quoteId() {
			return quoteId
		},
		get invoice() {
			return invoice
		},

		start: async () => {
			if (invoice) return invoice
			const quote = await options.manager.quotes.createMintQuote(options.mintUrl, options.amount)
			quoteId = quote.quote
			invoice = quote.request
			// The mint reports `expiry` in Unix seconds (NUT-04); this module works in ms.
			expiryAt = typeof quote.expiry === 'number' ? quote.expiry * 1000 : null
			state = 'UNPAID'
			return invoice
		},

		on: (event, handler) => {
			listeners.push({ event, handler })
			// A caller that subscribes after the outcome already landed still hears it.
			if (outcome === event) {
				try {
					handler(outcomeError)
				} catch (listenerError) {
					console.error('[deposit] deposit listener threw:', listenerError)
				}
			}
			return () => {
				const index = listeners.findIndex((listener) => listener.event === event && listener.handler === handler)
				if (index >= 0) listeners.splice(index, 1)
			}
		},

		check: async (timeoutMs = DEFAULT_DEPOSIT_CONFIRMATION_TIMEOUT_MS) => {
			if (!quoteId) throw new Error('Deposit has not been started.')

			const expired = new Error(DEPOSIT_EXPIRED_MESSAGE)
			const deadline = now() + timeoutMs

			// Ask coco to re-offer any paid-but-unredeemed quote to its processor. Best effort:
			// a nudge that fails must not turn a pending deposit into a failed one.
			try {
				await options.manager.quotes.requeuePaidMintQuotes(options.mintUrl)
			} catch (requeueError) {
				console.error('[deposit] requeueing paid quotes failed (non-fatal):', requeueError)
			}

			for (;;) {
				if (outcome === 'success') return
				if (outcome === 'error') throw outcomeError ?? new Error('Deposit failed.')

				const current = now()
				if (state === 'ISSUED') {
					settle('success')
					return
				}
				// Only an unpaid quote expires: a paid one is the mint's liability and will issue.
				if (state === 'UNPAID' && expiryAt !== null && current >= expiryAt) {
					settle('error', expired)
					throw expired
				}
				if (current >= deadline) {
					throw new Error(getDepositConfirmationTimeoutMessage(timeoutMs))
				}

				await sleep(Math.max(0, Math.min(pollIntervalMs, deadline - current)))
			}
		},

		dispose: () => {
			disposed = true
			listeners.length = 0
			unsubscribe()
		},
	}
}
