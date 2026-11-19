/**
 * The deposit's own read of the mint — the seam that makes a paid quote redeemable.
 *
 * A FakeWallet-backed mint settles a BOLT11 quote in the same second the quote was created, so
 * the quote's `updated_at` does not advance between the unpaid and paid observations. The
 * wallet's own watcher rejects that observation as a conflicting accounting and keeps the stale
 * `UNPAID` record, so no `mint-quote:updated` ever fires: the deposit sits "paid at the mint,
 * unpaid in the wallet", times out, and never mints the proofs.
 *
 * `./depositQuote` therefore reads the mint itself (`DepositMintQuoteClient`) and hands a paid
 * observation to the wallet (`quotes.mint.import`), which — as the quote's FIRST record — is
 * accepted and redeemed. These tests pin exactly that:
 *
 *  - a paid quote observed by the deposit is handed to the wallet once and the deposit settles
 *    issued with the amount credited, on the event channel alone (no `check()`, no user nudge);
 *  - a quote the mint still reports unpaid is never handed to the wallet, and the deposit's
 *    confirmation window ends in the timeout every caller classifies as "unconfirmed";
 *  - repeated reads cannot hand the same quote to the wallet twice.
 *
 * Everything is in memory: a fake mint, a fake wallet behind it. Zero network calls (ADR-0005).
 */
import { describe, expect, test } from 'bun:test'
import { Amount, type MintQuoteBolt11Response } from '@cashu/cashu-ts'

import {
	type CocoMintQuoteManager,
	type DepositMintQuoteClient,
	type DepositQuoteState,
	getDepositConfirmationTimeoutMessage,
	createCocoDepositQuote,
	toCocoDepositManager,
} from '@sdk/commerce/payments/wallet/depositQuote'

const MINT = 'https://mint.example'
const AMOUNT = 21
const OBSERVE_INTERVAL_MS = 5

/**
 * A fake mint over a fake wallet. `markPaid()` is the Lightning payment landing at the mint;
 * handing a paid observation to the wallet mints the proofs and (by default) makes the mint
 * report the quote issued on the next read — the same order the real flow has.
 */
const rig = (options?: { issueOnImport?: boolean }) => {
	const issueOnImport = options?.issueOnImport ?? true
	let quoteState: DepositQuoteState = 'UNPAID'
	let created = 0
	let credited = 0
	const handedToWallet: MintQuoteBolt11Response[] = []

	const payloadFor = (quoteId: string): MintQuoteBolt11Response => ({
		quote: quoteId,
		request:
			'lnbc210n1p407q5g9qypqqqdqqxqrrsssp5srq0320ccygs3ppqy9wqs9mfhg9e7gszd22axl4wgg9cheft9mmspp5r0dpdgtyeqp43msjqyv3cz2ep4j9f48rkku937g3rwuqjw7jscwq7pqmr2lkuqmrsvmy0gkxyxmxdvzl6kvvrykty9xzfg28v3kmrqgrnkadml06nql5g8lj5alhxn9uy8y95f6fcv75txajwexcvf6aq9qp9762zx',
		unit: 'sat',
		method: 'bolt11',
		amount: Amount.from(AMOUNT),
		amount_paid: Amount.from(quoteState === 'UNPAID' ? 0 : AMOUNT),
		amount_issued: Amount.from(quoteState === 'ISSUED' ? AMOUNT : 0),
		updated_at: 1_700_000_000,
		expiry: null,
		state: quoteState,
	})

	/** The mint side: create the invoice, read the mint's own state of the quote. */
	const mintClient: DepositMintQuoteClient = {
		createMintQuote: async ({ mintUrl }) => {
			created += 1
			const quoteId = `quote-${created}`
			return { quoteId, request: payloadFor(quoteId).request, expiry: Math.floor(Date.now() / 1000) + 3600 }
		},
		checkMintQuote: async ({ quoteId }) => ({ state: quoteState, payload: payloadFor(quoteId) }),
	}

	/** The wallet side: recording what the deposit handed over, and what it credited. */
	const wallet: CocoMintQuoteManager = {
		quotes: {
			mint: {
				import: async ({ quote }) => {
					handedToWallet.push(quote)
					// The wallet minted the proofs from the paid observation.
					credited += Number(quote.amount_paid)
					if (issueOnImport) quoteState = 'ISSUED'
					return {}
				},
			},
		},
		requeuePaidMintQuotes: async () => ({ requeued: [] }),
		on: () => () => {},
	}

	return {
		mintClient,
		wallet,
		handedToWallet,
		createdQuotes: () => created,
		credited: () => credited,
		markPaid: () => {
			quoteState = 'PAID'
		},
		deposit: () =>
			createCocoDepositQuote({
				manager: toCocoDepositManager(wallet, mintClient, { observeIntervalMs: OBSERVE_INTERVAL_MS }),
				mintUrl: MINT,
				amount: AMOUNT,
			}),
	}
}

/** Wait for the deposit's own reads to settle it, with no `check()` and no user nudge. */
const settledWithoutNudging = (deposit: ReturnType<ReturnType<typeof rig>['deposit']>) => {
	const outcome = Promise.withResolvers<void>()
	const states: DepositQuoteState[] = []
	deposit.on('success', () => outcome.resolve())
	deposit.on('error', (error) => outcome.reject(error instanceof Error ? error : new Error('deposit failed')))
	deposit.on('state', (state) => states.push(state))
	return { outcome: outcome.promise, states }
}

describe("the deposit's own read of the mint", () => {
	test('a paid quote is handed to the wallet once and the deposit settles issued, with no nudge', async () => {
		const fake = rig()
		const deposit = fake.deposit()
		const { outcome, states } = settledWithoutNudging(deposit)

		try {
			const invoice = await deposit.start()
			expect(invoice).toBeTruthy()
			expect(fake.createdQuotes()).toBe(1)

			// The Lightning payment lands at the mint. Nothing else happens: no `check()`, no click.
			fake.markPaid()
			await outcome

			// The wallet was handed the mint's PAID observation — the first record of that quote —
			// and minted the amount from it.
			expect(fake.handedToWallet).toHaveLength(1)
			expect(fake.handedToWallet[0]?.state).toBe('PAID')
			expect(fake.credited()).toBe(AMOUNT)

			// The deposit's own definition of success: the mint reports the quote issued, after the
			// wallet minted. Paid is announced on the way, never treated as success.
			expect(states).toEqual(['UNPAID', 'PAID', 'ISSUED'])
		} finally {
			deposit.dispose()
		}
	})

	test('a quote the mint still reports unpaid is never handed to the wallet', async () => {
		const fake = rig()
		const deposit = fake.deposit()

		try {
			await deposit.start()
			expect(fake.createdQuotes()).toBe(1)

			// The mint is never paid. The deposit reads it, and nothing is handed over.
			const message = await deposit.check(40).then(
				() => 'settled',
				(error: unknown) => (error instanceof Error ? error.message : String(error)),
			)

			expect(message).toBe(getDepositConfirmationTimeoutMessage(40))
			expect(fake.handedToWallet).toHaveLength(0)
			expect(fake.credited()).toBe(0)
		} finally {
			deposit.dispose()
		}
	})

	test('repeated reads cannot hand the same quote to the wallet twice', async () => {
		// The wallet credits only once even when the mint keeps reporting the quote paid: this is
		// the mint's own view still saying PAID (a wallet whose redemption has not reported back),
		// so the deposit must not import the same quote again on every read.
		const fake = rig({ issueOnImport: false })
		const deposit = fake.deposit()

		try {
			await deposit.start()
			fake.markPaid()

			await deposit.check(40).catch(() => undefined)
			await deposit.check(40).catch(() => undefined)

			expect(fake.handedToWallet).toHaveLength(1)
			expect(fake.credited()).toBe(AMOUNT)
		} finally {
			deposit.dispose()
		}
	})
})
