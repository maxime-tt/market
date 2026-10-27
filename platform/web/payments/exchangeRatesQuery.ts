/**
 * platform/web/payments/exchangeRatesQuery.ts — the React binding for BTC exchange rates
 * (store drain D1, slice 4).
 *
 * The precedence/error contract (`readBtcExchangeRatesWorkflow`) and the rate parsers live
 * framework-free in `sdk/commerce/payments/exchangeRates`; this file owns the HTTP fetch, the ContextVM
 * client singleton and its cache, the react-query options and hooks. The ContextVM client itself
 * (`PlebianCurrencyClient`, `nostr-tools` + `SimplePool`) moved to
 * `sdk/commerce/payments/ctxcnClient.ts` in the same slice; `src/lib/ctxcn-client.ts` is a shim over it.
 * Config constants come from `@sdk/config/constants`; the app-relay URL from
 * `@platform/web/readContext`, so this binding has no `platform -> src` import. Query keys are
 * literal-identical to the pre-drain values.
 */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { CURRENCIES, getCurrencyServerRelays } from '@sdk/config/constants'
import { configStore } from '@sdk/config/app-config'
import { PlebianCurrencyClient } from '@sdk/commerce/payments/ctxcnClient'
import {
	convertFiatToSats,
	isConvertibleAmount,
	isSatsCurrency,
	readBtcExchangeRatesWorkflow,
	readContextVmBtcRates,
	readYadioBtcRates,
	selectExchangeRate,
	type BtcExchangeRatesPort,
} from '@sdk/commerce/payments/exchangeRates'
import { currencyKeys } from '@sdk/core/query/queryKeyFactory'
import { getAppRelayUrl } from '@platform/web/readContext'

export type SupportedCurrency = (typeof CURRENCIES)[number]

export const CURRENCY_CACHE_CONFIG = {
	STALE_TIME: 1000 * 60 * 5,
	RETRY_DELAY: 1000,
	RETRY_COUNT: 2,
	RESOLVE_TIMEOUT: 5000,
} as const

let currencyClient: PlebianCurrencyClient | null = null
let currencyClientInitPromise: Promise<any> | null = null

async function getCurrencyClient(): Promise<PlebianCurrencyClient> {
	if (currencyClient) return currencyClient
	if (currencyClientInitPromise) return currencyClientInitPromise

	currencyClientInitPromise = (async () => {
		try {
			const privateKey = crypto.getRandomValues(new Uint8Array(32))

			const mainRelay = typeof window !== 'undefined' ? getAppRelayUrl() : undefined
			// Stage-gated. `getCurrencyServerRelays` returns the public CVM
			// relay list only for production — staging/dev get `[]` so the
			// browser doesn't open WebSockets to `relay.contextvm.org` etc.
			// from non-prod deploys. `configStore.get().config.stage` is
			// populated from `/api/config`, which already resolved before
			// `getCurrencyClient` is invoked (the call below also reads
			// `configStore.get().config.cvmServerPubkey` from the same
			// snapshot).
			const stage = configStore.get().config.stage
			const cvmRelays = getCurrencyServerRelays(stage)
			const relays = mainRelay ? [mainRelay, ...cvmRelays] : cvmRelays

			const client = new PlebianCurrencyClient({
				privateKey,
				relays,
				serverPubkey: configStore.get().config.cvmServerPubkey,
			})

			currencyClient = client
			return client
		} catch (error) {
			console.warn('Failed to initialize ContextVM currency client:', error)
			currencyClientInitPromise = null
			return null
		}
	})()

	return currencyClientInitPromise
}

const CONTEXTVM_CALL_TIMEOUT = 5000

async function fetchFromContextVm(): Promise<Record<string, number> | null> {
	try {
		const client = await getCurrencyClient()
		if (!client) return null

		const startedAt = Date.now()
		console.info(`ContextVM BTC fetch starting (timeout ${CONTEXTVM_CALL_TIMEOUT}ms)`)
		const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CONTEXTVM_CALL_TIMEOUT))
		const callPromise = client.callTool({
			name: 'get_btc_price',
			arguments: {},
		})

		const result = await Promise.race([callPromise, timeout])
		if (result === null) {
			console.warn(`ContextVM call timed out after ${Date.now() - startedAt}ms`)
			return null
		}

		const contextVmRates = readContextVmBtcRates(result)
		if (!contextVmRates) {
			console.warn('ContextVM returned error:', result?.error ?? 'missing rates')
			return null
		}

		console.info(`ContextVM BTC fetch succeeded in ${Date.now() - startedAt}ms`)
		return contextVmRates
	} catch (error) {
		console.warn('ContextVM fetch failed:', error)
		return null
	}
}

/** The HTTP fallback and the ContextVM call stay on the host; the read model owns only the precedence. */
const createExchangeRatesPort = (): BtcExchangeRatesPort => ({
	fetchContextVmRates: fetchFromContextVm,
	fetchYadioRates: async () => {
		const response = await fetch('https://api.yadio.io/exrates/BTC')
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}
		const data = await response.json()
		return readYadioBtcRates(data) as Record<string, number> | null
	},
})

export const fetchBtcExchangeRates = async (): Promise<Record<SupportedCurrency, number>> =>
	(await readBtcExchangeRatesWorkflow(createExchangeRatesPort())) as Record<SupportedCurrency, number>

export const fetchCurrencyExchangeRate = async (currency: SupportedCurrency): Promise<number> => {
	const rates = await fetchBtcExchangeRates()
	return selectExchangeRate(rates, currency)
}

export const convertCurrencyToSats = async (currency: string, amount: number): Promise<number | null> => {
	if (!isConvertibleAmount(currency, amount)) return null

	if (isSatsCurrency(currency)) {
		return amount
	}

	try {
		const normalizedCurrency = currency.toUpperCase()

		if (CURRENCIES.includes(normalizedCurrency as SupportedCurrency)) {
			const rate = await fetchCurrencyExchangeRate(normalizedCurrency as SupportedCurrency)

			return convertFiatToSats(amount, rate)
		} else {
			console.warn(`Unsupported currency: ${currency}`)
			return null
		}
	} catch (error) {
		console.error(`Currency conversion failed for ${currency}:`, error)
		return null
	}
}

export const btcExchangeRatesQueryOptions = queryOptions({
	queryKey: currencyKeys.btc(),
	queryFn: fetchBtcExchangeRates,
	staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
})

export const currencyExchangeRateQueryOptions = (currency: SupportedCurrency) =>
	queryOptions({
		queryKey: currencyKeys.forCurrency(currency),
		queryFn: () => fetchCurrencyExchangeRate(currency),
		staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
		retry: CURRENCY_CACHE_CONFIG.RETRY_COUNT,
		retryDelay: CURRENCY_CACHE_CONFIG.RETRY_DELAY,
	})

export const currencyConversionQueryOptions = (currency: string, amount: number) =>
	queryOptions({
		queryKey: currencyKeys.conversion(currency, amount),
		queryFn: () => convertCurrencyToSats(currency, amount),
		enabled: Boolean(currency && amount > 0),
		staleTime: CURRENCY_CACHE_CONFIG.STALE_TIME,
		retry: CURRENCY_CACHE_CONFIG.RETRY_COUNT,
	})

export const useBtcExchangeRates = () => {
	return useQuery(btcExchangeRatesQueryOptions)
}

export const useCurrencyExchangeRate = (currency: SupportedCurrency) => {
	return useQuery(currencyExchangeRateQueryOptions(currency))
}

export const useCurrencyConversion = (currency: string, amount: number) => {
	return useQuery(currencyConversionQueryOptions(currency, amount))
}

export const createCurrencyConversionQuery = (fromCurrency: string, amount: number) =>
	useQuery(currencyConversionQueryOptions(fromCurrency, amount))
