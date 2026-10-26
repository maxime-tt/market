export const SATS_PER_BTC = 100000000
export const MIN_CONVERTIBLE_AMOUNT = 0.0001

/** Rates from a ContextVM `get_btc_price` result, or null when it carries an error or no rates. */
export function readContextVmBtcRates(result: { rates?: unknown; error?: unknown } | null | undefined): Record<string, number> | null {
	if (!result?.rates || result.error) return null
	return result.rates as Record<string, number>
}

/** Yadio `/exrates/BTC` responses nest the rate table under `BTC`; a null body throws like the inline read did. */
export function readYadioBtcRates(data: { BTC?: Record<string, number> }): Record<string, number> | undefined {
	return data.BTC
}

export function selectExchangeRate<C extends string>(rates: Record<C, number> | null | undefined, currency: C): number {
	if (!rates || !rates[currency]) {
		throw new Error(`Exchange rate not available for ${currency}`)
	}
	return rates[currency]
}

/** Missing currency, zero/NaN amounts and amounts at or below 0.0001 are not converted. */
export function isConvertibleAmount(currency: string, amount: number): boolean {
	return !(!currency || !amount || amount <= MIN_CONVERTIBLE_AMOUNT)
}

export function isSatsCurrency(currency: string): boolean {
	return ['sats', 'sat'].includes(currency.toLowerCase())
}

/** `rate` is the price of 1 BTC in the source currency. */
export function convertFiatToSats(amount: number, rate: number): number {
	return (amount / rate) * SATS_PER_BTC
}

/**
 * Host-supplied rate sources (store drain D1, slice 4). `fetchContextVmRates` is the ContextVM call
 * (and its client/cache); `fetchYadioRates` is the HTTP fallback. Both stay on the host because they
 * own a relay pool / a `fetch`, and the read model keeps only the precedence and the error contract.
 */
export interface BtcExchangeRatesPort {
	fetchContextVmRates(): Promise<Record<string, number> | null>
	fetchYadioRates(): Promise<Record<string, number> | null>
}

/**
 * ContextVM first, Yadio fallback; a failure in BOTH is the one error the caller sees. Same precedence
 * and same message as the pre-drain `fetchBtcExchangeRates`. A port that answers `null`/`undefined`
 * yields that value, matching the historical reader (which cast the Yadio miss through).
 */
export async function readBtcExchangeRatesWorkflow(port: BtcExchangeRatesPort): Promise<Record<string, number>> {
	let rates: Record<string, number> | null = await port.fetchContextVmRates()

	if (!rates) {
		console.info('Falling back to Yadio BTC rates')
		try {
			rates = await port.fetchYadioRates()
		} catch (error) {
			console.error('Failed to fetch BTC exchange rates (ContextVM + Yadio fallback):', error)
			throw new Error('Failed to fetch BTC exchange rates')
		}
	}

	return rates as Record<string, number>
}
