/**
 * Deposit identity preservation across a paid-or-uncertain close — review
 * contract item 3 for PR #1235 (blocker 3).
 *
 * Invariants under test:
 *  1. `cancelDeposit({ preserveRecovery: true })` keeps the deposit/quote
 *     identity so `checkDepositNow()` / `retryDepositConfirmation()` can
 *     still reconcile the SAME mint quote without creating a new funding
 *     session.
 *  2. Default `cancelDeposit()` still fully clears the session
 *     (backward compatibility).
 *  3. The `success`/`error` listeners `startDeposit` attaches are
 *     identity-guarded: a late event from deposit #1 must not corrupt
 *     deposit #2's status.
 *
 * The deposit engine is coco's mint quote (`@/lib/wallet/depositQuote`), so the stimulus is
 * coco's own event bus rather than a stand-in deposit object: a quote is marked paid (coco's
 * processor then issues it when the check nudges it), issued outright, or left unpaid so the
 * check's window closes. "The same quote" is asserted **by quote id** — which is what
 * `preserveRecovery` actually protects: a fresh funding session would show up as a second
 * `createMintQuote` call and a different id.
 *
 * The tests drive the real store actions with an in-memory wallet mock and an in-memory coco —
 * zero external network calls (ADR-0005). The mock invoice is a checksum-valid bolt11 string for
 * 2000 sats (taken from light-bolt11-decoder's own fixtures) so `startDeposit`'s real invoice
 * validation path (`extractInvoiceAmountSats` + `validateAuctionDepositInvoiceQuote`) executes
 * as in production.
 */
import { afterEach, describe, expect, test } from 'bun:test'

// The deposit session now lives on the coco-backed store, so no module mock can shadow it:
// `auctionBidPublishRetry.test.ts` mocks `@/lib/stores/walletOps`, not this module.
import { cashuActions, cashuStore } from '../stores/cashu'

const TEST_MINT = 'https://mint.example.test'
/** Checksum-valid bolt11 invoice encoding a 2,000 sat amount. */
const BOLT11_INVOICE_2000_SATS =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'

type QuoteState = 'UNPAID' | 'PAID' | 'ISSUED'

/** One mint quote the fake coco handed out, in creation order. */
interface QuoteControl {
	readonly quoteId: string
	/** The mint reports the quote paid; coco's processor issues it on the next nudge. */
	markPaid: () => void
	/** The mint issues the quote outright. */
	emitIssued: () => void
}

/**
 * An in-memory coco: a quote repository and one event bus, which is all the deposit adapter
 * reads. Nothing here reaches the network, so the store's real flow runs end to end while the
 * mint stays fictional.
 */
const installFakeCoco = () => {
	let handler: ((payload: { mintUrl: string; quoteId: string; quote: { state: QuoteState } }) => void) | undefined
	const issued = new Set<string>()
	const paid = new Set<string>()
	const quotes: QuoteControl[] = []
	let created = 0
	let expireNextQuote = false

	const emit = (quoteId: string, state: QuoteState) => handler?.({ mintUrl: TEST_MINT, quoteId, quote: { state } })

	const manager = {
		quotes: {
			// coco 2.0 keeps canonical quotes under `quotes.mint`.
			mint: {
				create: async () => {
					created += 1
					const quoteId = `mock-quote-${created}`
					quotes.push({
						quoteId,
						markPaid: () => paid.add(quoteId),
						emitIssued: () => {
							issued.add(quoteId)
							emit(quoteId, 'ISSUED')
						},
					})
					// The engine reads a quote's window once, when it is created — so a quote can only
					// be born already expired, which is how a mint that never saw the payment looks.
					const expiry = expireNextQuote ? Math.floor(Date.now() / 1000) - 1 : Math.floor(Date.now() / 1000) + 3600
					expireNextQuote = false
					return { quoteId, request: BOLT11_INVOICE_2000_SATS, expiry }
				},
			},
		},
		// coco 2.0 moved the processor nudge onto the manager, and reports quote observations on
		// `mint-quote:updated`. A quote the test marked paid is issued when the engine nudges.
		requeuePaidMintQuotes: async () => {
			for (const quote of quotes) {
				if (!paid.has(quote.quoteId) || issued.has(quote.quoteId)) continue
				quote.emitIssued()
			}
			return { requeued: [] }
		},
		on: (_event: string, next: typeof handler) => {
			handler = next
			return () => {
				handler = undefined
			}
		},
	}

	cashuStore.setState((s) => ({ ...s, manager: manager as never, status: 'ready' }))

	return {
		quotes,
		get createdQuotes() {
			return created
		},
		expireNextQuote: () => {
			expireNextQuote = true
		},
	}
}

/** Let the engine's own await chain (quote lookup → nudge → event → settle) run to rest. */
const flushEngine = () => new Promise((resolve) => setTimeout(resolve, 25))

/**
 * Install a mock wallet plus a fake coco, then start a real `startDeposit` flow. The returned
 * handle lists the mint quotes the engine actually asked for, in creation order.
 *
 * `quoteExpired` makes the quote arrive past its window, i.e. a mint that never saw the payment.
 */
const startMockDeposit = async (options?: { quoteExpired?: boolean }): Promise<ReturnType<typeof installFakeCoco>> => {
	const coco = installFakeCoco()
	if (options?.quoteExpired) coco.expireNextQuote()
	cashuStore.setState((s) => ({
		...s,
		activeDeposit: null,
		depositInvoice: null,
		depositStatus: 'idle',
		depositPhase: 'idle',
		error: null,
	}))
	const invoice = await cashuActions.startDeposit(2000, TEST_MINT)
	expect(invoice).toBe(BOLT11_INVOICE_2000_SATS)
	return coco
}

afterEach(() => {
	cashuStore.setState((state) => ({
		...state,
		manager: null,
		status: 'idle',
		activeDeposit: null,
		depositInvoice: null,
		depositStatus: 'idle',
		depositPhase: 'idle',
		error: null,
	}))
})

describe('cancelDeposit preserveRecovery (PR #1235 blocker 3)', () => {
	test('keeps the quote identity so checkDepositNow reconciles the same quote', async () => {
		const coco = await startMockDeposit()
		const quote = coco.quotes[0]
		const deposit = cashuStore.state.activeDeposit

		expect(cashuStore.state.depositStatus).toBe('pending')
		expect(deposit?.quoteId).toBe(quote.quoteId)
		expect(cashuStore.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)

		// Paid-or-uncertain close, as DepositLightningModal performs it.
		cashuActions.cancelDeposit({ preserveRecovery: true })

		// Identity retained: the SAME quote can still be reconciled without a
		// fresh funding session.
		expect(cashuStore.state.activeDeposit).toBe(deposit as never)
		expect(cashuStore.state.activeDeposit?.quoteId).toBe(quote.quoteId)
		expect(cashuStore.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)
		expect(cashuStore.state.depositStatus).toBe('pending')

		// The mint finds the payment on the next check of the same quote.
		quote.markPaid()
		await cashuActions.checkDepositNow()

		// No second quote was ever asked for — that is what "the same payment" means.
		expect(coco.createdQuotes).toBe(1)
		expect(cashuStore.state.depositStatus).toBe('success')
		expect(cashuStore.state.activeDeposit).toBeNull()
	})

	test('keeps the quote identity so retryDepositConfirmation reconciles the same quote', async () => {
		const coco = await startMockDeposit()
		const quote = coco.quotes[0]
		const deposit = cashuStore.state.activeDeposit

		// Simulate the 15s confirmation timeout having lapsed.
		cashuStore.setState((s) => ({
			...s,
			depositStatus: 'awaiting_confirmation_retry',
			error: 'Payment confirmation timed out. Retry confirmation to check the mint again.',
		}))

		// Paid-or-uncertain close.
		cashuActions.cancelDeposit({ preserveRecovery: true })

		expect(cashuStore.state.activeDeposit).toBe(deposit as never)
		expect(cashuStore.state.depositStatus).toBe('awaiting_confirmation_retry')

		// The same quote is still retryable: retry re-enters pending and the
		// mint finds the payment.
		quote.markPaid()
		cashuActions.retryDepositConfirmation()
		await flushEngine()

		expect(coco.createdQuotes).toBe(1)
		expect(cashuStore.state.depositStatus).toBe('success')
		expect(cashuStore.state.activeDeposit).toBeNull()
	})

	test('resets only the transient error display, not the deposit identity', async () => {
		const coco = await startMockDeposit()
		const quote = coco.quotes[0]
		const deposit = cashuStore.state.activeDeposit

		cashuStore.setState((s) => ({ ...s, error: 'transient display noise' }))
		cashuActions.cancelDeposit({ preserveRecovery: true })

		expect(cashuStore.state.error).toBeNull()
		expect(cashuStore.state.activeDeposit).toBe(deposit as never)
		expect(cashuStore.state.activeDeposit?.quoteId).toBe(quote.quoteId)
		expect(cashuStore.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)
	})
})

describe('cancelDeposit default (backward compat)', () => {
	test('with no options fully clears the deposit session', async () => {
		const coco = await startMockDeposit()
		expect(cashuStore.state.activeDeposit?.quoteId).toBe(coco.quotes[0].quoteId)

		cashuActions.cancelDeposit()

		expect(cashuStore.state.activeDeposit).toBeNull()
		expect(cashuStore.state.depositInvoice).toBeNull()
		expect(cashuStore.state.depositStatus).toBe('idle')
		expect(cashuStore.state.error).toBeNull()
	})

	test('with preserveRecovery explicitly false fully clears', async () => {
		const coco = await startMockDeposit()
		expect(cashuStore.state.activeDeposit?.quoteId).toBe(coco.quotes[0].quoteId)

		cashuActions.cancelDeposit({ preserveRecovery: false })

		expect(cashuStore.state.activeDeposit).toBeNull()
		expect(cashuStore.state.depositInvoice).toBeNull()
		expect(cashuStore.state.depositStatus).toBe('idle')
	})

	test('preserveRecovery on a terminal state has no recoverable quote and fully clears', async () => {
		const coco = await startMockDeposit()

		// Terminal success: the success listener already cleared the identity.
		coco.quotes[0].emitIssued()
		expect(cashuStore.state.depositStatus).toBe('success')
		expect(cashuStore.state.activeDeposit).toBeNull()

		cashuActions.cancelDeposit({ preserveRecovery: true })

		expect(cashuStore.state.depositStatus).toBe('idle')
		expect(cashuStore.state.activeDeposit).toBeNull()
		expect(cashuStore.state.depositInvoice).toBeNull()
	})
})

describe('deposit listener identity guard (stale session race)', () => {
	test('an unpaid quote whose check window closes reports failure', async () => {
		// The power check for the late-failure stimulus below: on the ACTIVE deposit, the same
		// call that the guard test makes must actually produce a failure. Without this, a guard
		// assertion could pass simply because nothing was ever emitted.
		const coco = await startMockDeposit({ quoteExpired: true })
		const deposit = cashuStore.state.activeDeposit

		await deposit?.check(1).catch(() => undefined)

		expect(coco.createdQuotes).toBe(1)
		expect(cashuStore.state.depositStatus).toBe('error')
		expect(cashuStore.state.error).not.toBeNull()
		expect(cashuStore.state.activeDeposit).toBeNull()
	})

	test('a late event from deposit #1 must not corrupt deposit #2 status', async () => {
		// Deposit #1's quote is born past its window (the mint never saw the payment), so the
		// late failure below is a real one rather than a call that quietly does nothing.
		const coco = await startMockDeposit({ quoteExpired: true })
		const quote1 = coco.quotes[0]
		const deposit1 = cashuStore.state.activeDeposit
		expect(deposit1).not.toBeNull()

		await cashuActions.startDeposit(2000, TEST_MINT)
		const quote2 = coco.quotes[1]
		const deposit2 = cashuStore.state.activeDeposit

		expect(deposit2?.quoteId).toBe(quote2.quoteId)
		expect(cashuStore.state.depositStatus).toBe('pending')

		// Deposit #1's stale listener fires — the identity guard rejects it.
		quote1.emitIssued()
		expect(cashuStore.state.depositStatus).toBe('pending')
		expect(cashuStore.state.activeDeposit).toBe(deposit2 as never)
		expect(cashuStore.state.depositInvoice).toBe(BOLT11_INVOICE_2000_SATS)

		// A late *failure* from the superseded session is rejected too: deposit #1's quote never
		// settles, so its check window closes and the engine reports failure. That failure
		// belongs to #1, and the guard must not let it land on #2.
		await deposit1?.check(1).catch(() => undefined)
		expect(cashuStore.state.depositStatus).toBe('pending')
		expect(cashuStore.state.error).toBeNull()
		expect(cashuStore.state.activeDeposit).toBe(deposit2 as never)

		// Deposit #2's own event still reconciles normally.
		quote2.emitIssued()
		expect(cashuStore.state.depositStatus).toBe('success')
		expect(cashuStore.state.activeDeposit).toBeNull()
	})

	test('stale deposit events after a default cancelDeposit cannot resurrect the deposit session', async () => {
		const coco = await startMockDeposit()
		const quote1 = coco.quotes[0]

		cashuActions.cancelDeposit()
		expect(cashuStore.state.depositStatus).toBe('idle')

		quote1.emitIssued()

		expect(cashuStore.state.depositStatus).toBe('idle')
		expect(cashuStore.state.activeDeposit).toBeNull()
		expect(cashuStore.state.depositInvoice).toBeNull()
		expect(cashuStore.state.error).toBeNull()
	})
})
