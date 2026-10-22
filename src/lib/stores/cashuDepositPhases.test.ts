/**
 * The deposit lifecycle's DISTINCT states.
 *
 * A deposit that has been requested, one the user is paying, one the mint has paid but not yet
 * minted, one whose proofs exist, one whose quote expired, a failure, and a cancellation are
 * different things for the user and differently recoverable. This file pins that the store keeps
 * them apart (`depositPhase`) and that `depositStatus` is only a projection of them, never a
 * second authority that could disagree.
 *
 * The engine is coco's mint quote, so the stimulus is coco's own event bus with an in-memory
 * manager — zero external network calls (ADR-0005).
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { cashuActions, cashuStore, depositStatusForPhase, type CashuDepositPhase } from './cashu'

const TEST_MINT = 'https://mint.example.test'
/** Checksum-valid bolt11 invoice encoding a 2,000 sat amount. */
const BOLT11_INVOICE_2000_SATS =
	'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567'

type QuoteState = 'UNPAID' | 'PAID' | 'ISSUED'

/** An in-memory coco: a quote repository and one event bus, all the deposit adapter reads. */
const installFakeCoco = () => {
	let handler: ((payload: { mintUrl: string; quoteId: string; state: QuoteState }) => void) | undefined
	const issued = new Set<string>()
	const paid = new Set<string>()
	const quoteIds: string[] = []
	let created = 0
	let expireNextQuote = false

	const emit = (quoteId: string, state: QuoteState) => handler?.({ mintUrl: TEST_MINT, quoteId, state })

	const manager = {
		mint: {
			addMint: async () => {
				throw new Error('unavailable in this fake')
			},
		},
		quotes: {
			createMintQuote: async () => {
				created += 1
				const quoteId = `mock-quote-${created}`
				quoteIds.push(quoteId)
				const expiry = expireNextQuote ? Math.floor(Date.now() / 1000) - 1 : Math.floor(Date.now() / 1000) + 3600
				expireNextQuote = false
				return { quote: quoteId, request: BOLT11_INVOICE_2000_SATS, expiry }
			},
			requeuePaidMintQuotes: async () => {
				for (const quoteId of quoteIds) {
					if (!paid.has(quoteId) || issued.has(quoteId)) continue
					issued.add(quoteId)
					emit(quoteId, 'ISSUED')
				}
				return { requeued: [] }
			},
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
		latestQuoteId: () => quoteIds[quoteIds.length - 1],
		markPaidLatest: () => paid.add(quoteIds[quoteIds.length - 1]),
		emitPaidLatest: () => emit(quoteIds[quoteIds.length - 1], 'PAID'),
		emitIssuedLatest: () => {
			const id = quoteIds[quoteIds.length - 1]
			issued.add(id)
			emit(id, 'ISSUED')
		},
		expireNextQuote: () => {
			expireNextQuote = true
		},
	}
}

const resetStore = () =>
	cashuStore.setState((state) => ({
		...state,
		manager: null,
		status: 'idle',
		depositPhase: 'idle',
		depositStatus: 'idle',
		activeDeposit: null,
		depositInvoice: null,
		error: null,
	}))

afterEach(resetStore)

describe('deposit lifecycle — distinct phases, one projection', () => {
	test('every phase projects to a status, and the families stay distinct', () => {
		const projections: Record<CashuDepositPhase, ReturnType<typeof depositStatusForPhase>> = {
			idle: depositStatusForPhase('idle'),
			requested: depositStatusForPhase('requested'),
			waiting_payment: depositStatusForPhase('waiting_payment'),
			paid_unissued: depositStatusForPhase('paid_unissued'),
			unconfirmed: depositStatusForPhase('unconfirmed'),
			issued: depositStatusForPhase('issued'),
			expired: depositStatusForPhase('expired'),
			failed: depositStatusForPhase('failed'),
			cancelled: depositStatusForPhase('cancelled'),
		}

		expect(projections.idle).toBe('idle')
		expect(projections.cancelled).toBe('idle')
		// A payment still in flight is NOT success — the projection keeps the UI waiting.
		expect(projections.waiting_payment).toBe('pending')
		expect(projections.paid_unissued).toBe('pending')
		// The confirmation window running out is its own state, not a failure.
		expect(projections.unconfirmed).toBe('awaiting_confirmation_retry')
		// Only issued/proofs-exist is success.
		expect(projections.issued).toBe('success')
		expect(projections.expired).toBe('error')
		expect(projections.failed).toBe('error')

		// The distinct phases the legacy status collapsed are all reachable in the union.
		const waitingPhases: CashuDepositPhase[] = ['requested', 'waiting_payment', 'paid_unissued']
		expect(new Set(waitingPhases.map(depositStatusForPhase))).toEqual(new Set(['pending']))
	})
})

describe('deposit lifecycle — the store keeps the phases apart', () => {
	test('a started deposit moves requested → waiting_payment, then issued on success', async () => {
		const coco = installFakeCoco()

		const invoice = await cashuActions.startDeposit(2000, TEST_MINT)

		expect(invoice).toBe(BOLT11_INVOICE_2000_SATS)
		// While the invoice is on screen the phase is waiting_payment, projected to pending.
		expect(cashuStore.state.depositPhase).toBe('waiting_payment')
		expect(cashuStore.state.depositStatus).toBe('pending')

		coco.emitIssuedLatest()

		expect(cashuStore.state.depositPhase).toBe('issued')
		expect(cashuStore.state.depositStatus).toBe('success')
		expect(cashuStore.state.activeDeposit).toBeNull()
	})

	test('a paid-but-unissued quote is its own phase, not success and not failure', async () => {
		const coco = installFakeCoco()
		await cashuActions.startDeposit(2000, TEST_MINT)

		coco.emitPaidLatest()

		expect(cashuStore.state.depositPhase).toBe('paid_unissued')
		expect(cashuStore.state.depositStatus).toBe('pending')
		expect(cashuStore.state.activeDeposit).not.toBeNull()

		coco.emitIssuedLatest()
		expect(cashuStore.state.depositPhase).toBe('issued')
		expect(cashuStore.state.depositStatus).toBe('success')
	})

	test('a quote the mint let expire lands in expired, distinct from a failure', async () => {
		const coco = installFakeCoco()
		coco.expireNextQuote()

		await cashuActions.startDeposit(2000, TEST_MINT)
		const deposit = cashuStore.state.activeDeposit

		await deposit?.check(1).catch(() => undefined)

		expect(cashuStore.state.depositPhase).toBe('expired')
		// The projection is error, but the phase keeps the reason.
		expect(cashuStore.state.depositStatus).toBe('error')
		expect(cashuStore.state.error).toContain('expired')
	})

	test('cancelDeposit lands cancelled; preserveRecovery keeps the waiting phase intact', async () => {
		installFakeCoco()
		await cashuActions.startDeposit(2000, TEST_MINT)

		cashuActions.cancelDeposit({ preserveRecovery: true })
		expect(cashuStore.state.depositPhase).toBe('waiting_payment')
		expect(cashuStore.state.activeDeposit).not.toBeNull()

		cashuActions.cancelDeposit()
		expect(cashuStore.state.depositPhase).toBe('cancelled')
		expect(cashuStore.state.depositStatus).toBe('idle')
		expect(cashuStore.state.activeDeposit).toBeNull()
		expect(cashuStore.state.depositInvoice).toBeNull()
	})

	test('retryDepositConfirmation takes an unconfirmed session back to waiting_payment', async () => {
		installFakeCoco()
		await cashuActions.startDeposit(2000, TEST_MINT)

		cashuStore.setState((s) => ({ ...s, depositPhase: 'unconfirmed', depositStatus: 'awaiting_confirmation_retry' }))
		cashuActions.retryDepositConfirmation()

		expect(cashuStore.state.depositPhase).toBe('waiting_payment')
		expect(cashuStore.state.depositStatus).toBe('pending')
		expect(cashuStore.state.error).toBeNull()
	})

	test('an invalid amount is a failure, and never a session', async () => {
		installFakeCoco()
		const invoice = await cashuActions.startDeposit(0, TEST_MINT)

		expect(invoice).toBeNull()
		expect(cashuStore.state.depositPhase).toBe('failed')
		expect(cashuStore.state.error).toContain('positive integer')
	})
})
