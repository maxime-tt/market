import { describe, expect, test } from 'bun:test'

import {
	DEFAULT_DEPOSIT_CONFIRMATION_TIMEOUT_MS,
	type CocoDepositManager,
	type DepositQuoteState,
	createCocoDepositQuote,
	getDepositConfirmationTimeoutMessage,
} from './depositQuote'

const MINT = 'https://mint.example'
const QUOTE_ID = 'quote-1'
const INVOICE = 'lnbc1invoice'
const START_MS = 1_700_000_000_000

/**
 * A fake coco: one quote, a shared event bus, and an injected clock that only moves when the
 * adapter asks to sleep. `onSleep` is how a test makes the mint answer *during* a wait.
 */
const rig = (options?: { expirySeconds?: number; onSleep?: (emit: (state: DepositQuoteState) => void) => void }) => {
	let nowMs = START_MS
	let created = 0
	let requeued = 0
	let handler: ((payload: { mintUrl: string; quoteId: string; state: DepositQuoteState }) => void) | undefined
	let requeueFails = false

	const manager: CocoDepositManager = {
		quotes: {
			createMintQuote: async () => {
				created += 1
				return {
					quote: QUOTE_ID,
					request: INVOICE,
					expiry: options?.expirySeconds ?? Math.floor(START_MS / 1000) + 3600,
				}
			},
			requeuePaidMintQuotes: async () => {
				requeued += 1
				if (requeueFails) throw new Error('processor unavailable')
				return { requeued: [] }
			},
		},
		on: (_event, next) => {
			handler = next
			return () => {
				handler = undefined
			}
		},
	}

	const emit = (state: DepositQuoteState, quoteId = QUOTE_ID) => handler?.({ mintUrl: MINT, quoteId, state })

	const deposit = createCocoDepositQuote({
		manager,
		mintUrl: MINT,
		amount: 21,
		now: () => nowMs,
		pollIntervalMs: 250,
		sleep: async (ms) => {
			nowMs += ms
			options?.onSleep?.(emit)
		},
	})

	return {
		deposit,
		emit,
		get created() {
			return created
		},
		get requeued() {
			return requeued
		},
		get now() {
			return nowMs
		},
		failRequeue: () => {
			requeueFails = true
		},
	}
}

const codeOf = async (run: Promise<unknown>): Promise<string> => {
	try {
		await run
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
	throw new Error('expected the promise to reject')
}

describe('coco deposit quote — what a mint quote means for a deposit', () => {
	test('start creates exactly one quote and returns its invoice', async () => {
		const r = rig()
		expect(await r.deposit.start()).toBe(INVOICE)
		expect(await r.deposit.start()).toBe(INVOICE)
		expect(r.created).toBe(1)
		expect(r.deposit.quoteId).toBe(QUOTE_ID)
	})

	test('an ISSUED quote settles the deposit and fires success once', async () => {
		const r = rig()
		await r.deposit.start()

		const successes: Array<Error | undefined> = []
		r.deposit.on('success', (error) => successes.push(error))

		r.emit('ISSUED')
		r.emit('ISSUED')

		await expect(r.deposit.check(5_000)).resolves.toBeUndefined()
		expect(successes).toHaveLength(1)
		expect(successes[0]).toBeUndefined()
	})

	test('the state channel reports PAID before ISSUED, so "paid but not yet minted" is observable', async () => {
		const r = rig()
		await r.deposit.start()

		const states: DepositQuoteState[] = []
		r.deposit.on('state', (state) => states.push(state))

		r.emit('PAID')
		r.emit('ISSUED')

		// The subscribe-time replay of the current state, then every change after it.
		expect(states).toEqual(['UNPAID', 'PAID', 'ISSUED'])
	})

	test('a state subscriber that arrives after PAID still hears it', async () => {
		const r = rig()
		await r.deposit.start()
		r.emit('PAID')

		const states: DepositQuoteState[] = []
		const unsubscribe = r.deposit.on('state', (state) => states.push(state))

		expect(states).toEqual(['PAID'])

		unsubscribe()
		r.emit('ISSUED')
		expect(states).toEqual(['PAID'])
	})

	test('a paid quote is not success until it is issued', async () => {
		const r = rig({
			// The mint answers PAID first, then ISSUED — the redemption is in flight in between.
			onSleep: (emit) => {
				emit('PAID')
				emit('ISSUED')
			},
		})
		await r.deposit.start()

		await expect(r.deposit.check(5_000)).resolves.toBeUndefined()
	})

	test('an ISSUED event for another quote is ignored', async () => {
		const r = rig()
		await r.deposit.start()

		r.emit('ISSUED', 'some-other-quote')

		const message = await codeOf(r.deposit.check(1_000))
		expect(message).toBe(getDepositConfirmationTimeoutMessage(1_000))
	})

	test('an expired unpaid quote fails the deposit with a rejection, not success', async () => {
		// The quote is already past its expiry when the check begins (`expiry` is in seconds).
		const r = rig({ expirySeconds: Math.floor(START_MS / 1000) - 1 })
		await r.deposit.start()

		const errors: Array<Error | undefined> = []
		r.deposit.on('error', (error) => errors.push(error))

		const message = await codeOf(r.deposit.check(5_000))
		expect(message).toContain('expired')
		expect(errors).toHaveLength(1)
		expect(errors[0]?.message).toContain('expired')
	})

	test('running out of patience rejects with the confirmation-timeout message', async () => {
		const r = rig()
		await r.deposit.start()

		const message = await codeOf(r.deposit.check(1_000))

		// The exact shape the NIP-60 deposit path classifies as "retry confirmation".
		expect(message).toBe('wallet acknowledgment and mint confirmation timeout after 1000ms')
		expect(message).toBe(getDepositConfirmationTimeoutMessage(1_000))
		// The fake clock only advanced through the waits, never past the deadline.
		expect(r.now).toBeGreaterThanOrEqual(START_MS + 1_000)
	})

	test('a failing requeue does not turn a pending deposit into a failed one', async () => {
		const r = rig({ onSleep: (emit) => emit('ISSUED') })
		r.failRequeue()
		await r.deposit.start()

		await expect(r.deposit.check(5_000)).resolves.toBeUndefined()
		expect(r.requeued).toBe(1)
	})

	test('check before start is refused rather than waiting on nothing', async () => {
		const r = rig()
		const message = await codeOf(r.deposit.check(1_000))
		expect(message).toContain('has not been started')
	})
})

describe('deposit confirmation timeout', () => {
	test('the default window is the app fifteen seconds', () => {
		expect(DEFAULT_DEPOSIT_CONFIRMATION_TIMEOUT_MS).toBe(15_000)
	})

	test('the message names the window so a caller can classify it', () => {
		expect(getDepositConfirmationTimeoutMessage(15_000)).toBe('wallet acknowledgment and mint confirmation timeout after 15000ms')
	})
})
