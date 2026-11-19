/**
 * depositMintQuoteClient.ts — the mint side of a deposit, over cashu-ts.
 *
 * The deposit needs two things only the mint can answer: the BOLT11 invoice for a new quote, and
 * whether that quote has been paid. `./depositQuote` explains why the deposit asks the mint
 * itself instead of waiting for the wallet's own watch to report the payment (a mint that
 * settles a quote within its creation second never advances the quote's `updated_at`, and the
 * wallet's observation of that payment is rejected as a conflicting accounting).
 *
 * Both calls are the plain NUT-04 endpoints every wallet uses — the same ones the wallet itself
 * calls — so this module is a thin, stateless reader rather than a second wallet: it holds no
 * keys, no proofs and no counters. The mint's response is returned verbatim, because it is what
 * `manager.quotes.mint.import` persists as the wallet's canonical record of the quote.
 *
 * One cashu-ts `Wallet` per mint is cached: it is only a request client here, and the cache
 * keeps two reads of the same quote on the same connection pool.
 */
import { Mint, Wallet } from '@cashu/cashu-ts'
import type { DepositMintQuoteClient, MintQuoteObservation } from './depositQuote'

/** One trailing slash, not all of them — the same normalization the store's mint list uses. */
const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

/** A client that creates and checks BOLT11 mint quotes at the mint itself (sat unit). */
export const createCashuMintQuoteClient = (): DepositMintQuoteClient => {
	const wallets = new Map<string, Wallet>()

	const walletFor = (mintUrl: string): Wallet => {
		const normalized = normalizeMintUrl(mintUrl)
		const cached = wallets.get(normalized)
		if (cached) return cached
		const wallet = new Wallet(new Mint(normalized))
		wallets.set(normalized, wallet)
		return wallet
	}

	return {
		createMintQuote: async ({ mintUrl, amount }) => {
			const quote = await walletFor(mintUrl).mint.createMintQuoteBolt11({ amount, unit: 'sat' })
			return {
				quoteId: quote.quote,
				request: quote.request,
				expiry: quote.expiry ?? undefined,
			}
		},

		checkMintQuote: async ({ mintUrl, quoteId }) => {
			const quote = await walletFor(mintUrl).mint.checkMintQuoteBolt11(quoteId)
			const observation: MintQuoteObservation = { state: quote.state, payload: quote }
			return observation
		},
	}
}
