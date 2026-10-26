/**
 * Shim — the BTC exchange-rate read binding moved to `platform/web/payments/exchangeRatesQuery.ts`
 * (store drain D1, slice 4).
 *
 * The framework-free precedence/error contract (`readBtcExchangeRatesWorkflow`) and the rate parsers
 * live in `sdk/commerce/payments/exchangeRates`; the React binding keeps the HTTP fetch and the
 * ContextVM client singleton/cache and sources config from `@sdk/config/*` /
 * `platform/web/ndkReadContext.ts` instead of `@/lib/stores/config`. The ContextVM client itself moved
 * to `sdk/commerce/payments/ctxcnClient.ts`. Vacated path kept as a re-export so no call site breaks;
 * deleted in E1.
 */
export * from '@platform/web/payments/exchangeRatesQuery'
