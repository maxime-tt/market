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
 * The engine settles on `mint-quote:state-changed` for its own quote id. Two things feed that
 * channel: the wallet's own `mint-quote:updated` observations, and — because the wallet's watch
 * cannot see every payment, see {@link DepositMintQuoteClient} — the deposit's own read of the
 * mint. `check()` nudges both (through `requeuePaidMintQuotes`) and then waits on the event.
 *
 * The timeout rejection carries the same message the NIP-60 deposit path classifies, so a
 * caller can keep mapping "we ran out of patience" to `awaiting_confirmation_retry` rather than
 * to a failure. `getDepositConfirmationTimeoutMessage` is the only place that string is built.
 */

import type { MintQuoteBolt11Response } from '@cashu/cashu-ts'

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

/**
 * The mint's answer for one BOLT11 quote, in the shape the wallet's own import consumes.
 *
 * `payload` is the mint's response verbatim: `manager.quotes.mint.import` persists it as the
 * wallet's canonical record of the quote, so it is passed through untouched rather than
 * re-derived here.
 */
export interface MintQuoteObservation {
	readonly state: DepositQuoteState
	readonly payload: MintQuoteBolt11Response
}

/**
 * The mint side of a deposit: create the invoice, then read the mint's own state of the quote.
 *
 * The deposit reads the mint itself because the wallet's own watch cannot see this payment. A
 * BOLT11 mint quote settles within the same second as it was created whenever the mint pays it
 * immediately (a FakeWallet-backed mint — the local e2e mint and the deployed one — does), so
 * the quote's `updated_at` does not advance between the `UNPAID` and the `PAID` observation.
 * coco 2.0 classifies a changed accounting under an unchanged `updated_at` as
 * `ignored-conflicting-accounting` and keeps the stale `UNPAID` record: no `mint-quote:updated`
 * is emitted, `requeuePaidMintQuotes` has no operation to re-offer, and `ops.mint.prepare`
 * refuses with a zero claimable amount. A wallet that only waits therefore never redeems the
 * quote, and the deposit times out while the payment sits paid at the mint.
 *
 * So the deposit asks the mint, and hands a paid observation to the wallet itself
 * ({@link CocoMintQuoteManager.quotes.mint.import}) — as the FIRST record of that quote it is
 * accepted, and the wallet's own operation processor redeems it from there.
 */
export interface DepositMintQuoteClient {
	/** Create a BOLT11 quote at the mint. The wallet must hold no record of it yet. */
	createMintQuote(input: { mintUrl: string; amount: number }): Promise<{
		quoteId: string
		request: string
		expiry?: number
	}>
	/** Read the mint's own state of the quote, including the payload the wallet's import consumes. */
	checkMintQuote(input: { mintUrl: string; quoteId: string }): Promise<MintQuoteObservation>
}

/**
 * The coco 2.0 surface {@link toCocoDepositManager} uses for the wallet side of a deposit,
 * declared structurally so this module keeps its coco-free contract (the real `@cashu/coco-core`
 * `Manager` satisfies it).
 *
 * Redemption lives in coco's mint *operation* lifecycle, and that lifecycle is driven from the
 * canonical quote: `quotes.mint.import` is the one call that records the mint's observation, and
 * coco's operation processor claims a paid quote from that record on its own.
 * `requeuePaidMintQuotes` re-offers a quote the wallet already tracks to the same processor.
 */
export interface CocoMintQuoteManager {
	quotes: {
		mint: {
			import(input: { mintUrl: string; method: 'bolt11'; quote: MintQuoteBolt11Response }): Promise<unknown>
		}
	}
	requeuePaidMintQuotes(mintUrl?: string): Promise<{ requeued: string[] }>
	on(
		event: 'mint-quote:updated',
		handler: (payload: { mintUrl: string; quoteId: string; quote: { state?: DepositQuoteState } }) => void,
	): () => void
}

/** How {@link toCocoDepositManager} paces its own reads of the mint. */
export interface CocoDepositManagerOptions {
	/** How often the deposit re-reads the mint while a quote session is open. */
	readonly observeIntervalMs?: number
	/**
	 * How long one observation window lasts. The deposit re-arms it whenever the engine asks it to
	 * check, so a quote nobody is looking at costs a bounded number of reads rather than a
	 * perpetual poll.
	 */
	readonly observeWindowMs?: number
}

const DEFAULT_OBSERVE_INTERVAL_MS = 3_000
const DEFAULT_OBSERVE_WINDOW_MS = 60_000

/** One deposit watching one quote. */
interface DepositObservationSession {
	readonly mintUrl: string
	readonly quoteId: string
	/** The quote's own window, in Unix milliseconds, or `null` when the mint sets none. */
	readonly expiryAt: number | null
	state: DepositQuoteState
}

/**
 * Adapt coco 2.0's manager plus a mint-side client to the {@link CocoDepositManager} contract
 * this module settles on.
 *
 * The deposit engine is event-driven over a mint-quote state channel — a design from coco 1.0,
 * where `manager.quotes.createMintQuote` plus a `mint-quote:state-changed` event was the whole
 * surface. This factory is the seam: it creates the invoice at the mint, reads the mint's own
 * state into that channel (handing a paid observation to the wallet first, so redemption is
 * already in flight when `PAID` is announced), re-offers tracked quotes through
 * `requeuePaidMintQuotes`, and projects the wallet's `mint-quote:updated` observations into the
 * same channel. `ISSUED` keeps meaning exactly what it meant: the proofs exist.
 */
export const toCocoDepositManager = (
	manager: CocoMintQuoteManager,
	mintClient: DepositMintQuoteClient,
	options: CocoDepositManagerOptions = {},
): CocoDepositManager => {
	const observeIntervalMs = options.observeIntervalMs ?? DEFAULT_OBSERVE_INTERVAL_MS
	const observeWindowMs = options.observeWindowMs ?? DEFAULT_OBSERVE_WINDOW_MS

	const listeners: Array<(payload: { mintUrl: string; quoteId: string; state: DepositQuoteState }) => void> = []
	/** The one quote this deposit follows. A deposit is one quote by definition. */
	let session: DepositObservationSession | null = null
	let timer: ReturnType<typeof setTimeout> | null = null
	let observeUntil = 0
	/** Quotes whose paid observation already went to the wallet — never hand one over twice. */
	const handedOver = new Set<string>()
	/** The last state announced per quote, so the wallet's echo of a state we emitted is not repeated. */
	const announced = new Map<string, DepositQuoteState>()

	const announce = (active: DepositObservationSession, next: DepositQuoteState): void => {
		const key = `${active.mintUrl}::${active.quoteId}`
		if (announced.get(key) === next) return
		announced.set(key, next)
		active.state = next
		const payload = { mintUrl: active.mintUrl, quoteId: active.quoteId, state: next }
		for (const listener of listeners) {
			try {
				listener(payload)
			} catch (error) {
				console.error('[deposit] mint quote state listener threw:', error)
			}
		}
	}

	const stopTimer = (): void => {
		if (!timer) return
		clearTimeout(timer)
		timer = null
	}

	/** Read the mint once, hand a paid observation to the wallet, announce the state. */
	const observeOnce = async (): Promise<void> => {
		const active = session
		if (!active) return

		let observation: MintQuoteObservation
		try {
			observation = await mintClient.checkMintQuote({ mintUrl: active.mintUrl, quoteId: active.quoteId })
		} catch (error) {
			// A mint we cannot reach is not a failed deposit: the next read retries, and the
			// wallet's own event channel may still report the state.
			console.error('[deposit] reading the mint quote failed (will retry):', error)
			return
		}

		// The paid observation goes to the wallet BEFORE the state is announced: the engine
		// settles on `ISSUED`, which the mint reports only once the wallet has minted the proofs,
		// so the hand-off has to be in flight before anyone treats the payment as good.
		const key = `${active.mintUrl}::${active.quoteId}`
		if (observation.state !== 'UNPAID' && !handedOver.has(key)) {
			try {
				await manager.quotes.mint.import({ mintUrl: active.mintUrl, method: 'bolt11', quote: observation.payload })
				handedOver.add(key)
			} catch (error) {
				console.error('[deposit] handing the paid quote to the wallet failed (will retry):', error)
			}
		}

		// A newer deposit may have replaced the session while the mint was answering.
		if (session !== active) return
		announce(active, observation.state)
	}

	/** Whether the observer still has a reason to run. */
	const keepObserving = (): boolean => {
		const active = session
		if (!active) return false
		if (active.state === 'ISSUED') return false
		if (active.expiryAt !== null && Date.now() >= active.expiryAt) return false
		return Date.now() < observeUntil
	}

	const step = async (): Promise<void> => {
		await observeOnce()
		if (!keepObserving()) {
			stopTimer()
			return
		}
		timer = setTimeout(() => {
			timer = null
			void step()
		}, observeIntervalMs)
	}

	/** (Re)start one observation window, beginning with an immediate read. */
	const arm = async (): Promise<void> => {
		if (!session) return
		observeUntil = Date.now() + observeWindowMs
		stopTimer()
		await step()
	}

	return {
		quotes: {
			createMintQuote: async (mintUrl, amount) => {
				const quote = await mintClient.createMintQuote({ mintUrl, amount })
				announced.clear()
				handedOver.clear()
				session = {
					mintUrl,
					quoteId: quote.quoteId,
					expiryAt: typeof quote.expiry === 'number' ? quote.expiry * 1000 : null,
					state: 'UNPAID',
				}
				announced.set(`${mintUrl}::${quote.quoteId}`, 'UNPAID')
				void arm()
				return { quote: quote.quoteId, request: quote.request, expiry: quote.expiry }
			},
			requeuePaidMintQuotes: async (mintUrl) => {
				// The engine calls this at the start of every check, which is also the moment to look
				// at the mint again: a check that only nudged the wallet would miss the payment this
				// deposit exists to catch.
				await arm()
				return manager.requeuePaidMintQuotes(mintUrl)
			},
		},
		on: (_event, handler) => {
			listeners.push(handler)
			const stopProjecting = manager.on('mint-quote:updated', (payload) => {
				handler({ mintUrl: payload.mintUrl, quoteId: payload.quoteId, state: payload.quote.state ?? 'UNPAID' })
			})
			return () => {
				const index = listeners.indexOf(handler)
				if (index >= 0) listeners.splice(index, 1)
				stopProjecting()
				// The engine's last listener leaving is its `dispose()`: stop reading the mint.
				if (listeners.length === 0) {
					stopTimer()
					session = null
				}
			}
		},
	}
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
	 * Subscribe to every quote state the manager reports for THIS deposit, in order. `ISSUED` is
	 * also announced on the outcome channel; this channel exists so a caller can observe the
	 * intermediate `PAID` (the payment landed, redemption still in flight) rather than being
	 * forced to treat "not yet issued" as one undifferentiated wait.
	 */
	on(event: 'state', handler: (state: DepositQuoteState) => void): () => void
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
	const stateListeners: Array<(state: DepositQuoteState) => void> = []

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

	/** Announce a quote state to the state channel, and only to it. */
	const notifyState = (next: DepositQuoteState): void => {
		for (const listener of stateListeners) {
			try {
				listener(next)
			} catch (listenerError) {
				console.error('[deposit] deposit state listener threw:', listenerError)
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
		notifyState(payload.state)
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
			notifyState('UNPAID')
			return invoice
		},

		on: (event: 'success' | 'error' | 'state', handler: DepositListener | ((state: DepositQuoteState) => void)) => {
			if (event === 'state') {
				const stateHandler = handler as (state: DepositQuoteState) => void
				stateListeners.push(stateHandler)
				// A caller that subscribes after a state was reported still hears the latest one.
				if (state !== null) {
					try {
						stateHandler(state)
					} catch (listenerError) {
						console.error('[deposit] deposit state listener threw:', listenerError)
					}
				}
				return () => {
					const index = stateListeners.indexOf(stateHandler)
					if (index >= 0) stateListeners.splice(index, 1)
				}
			}

			const outcomeHandler = handler as DepositListener
			listeners.push({ event, handler: outcomeHandler })
			// A caller that subscribes after the outcome already landed still hears it.
			if (outcome === event) {
				try {
					outcomeHandler(outcomeError)
				} catch (listenerError) {
					console.error('[deposit] deposit listener threw:', listenerError)
				}
			}
			return () => {
				const index = listeners.findIndex((listener) => listener.event === event && listener.handler === outcomeHandler)
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
