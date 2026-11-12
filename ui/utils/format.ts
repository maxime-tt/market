/**
 * Pure numeric formatters shared across `ui/`.
 *
 * `formatSats` is the canonical sats formatter. It reproduces the exact
 * behaviour of the hand-maintained copies discovery-v2 found
 * (`Math.round(sats).toLocaleString()`), so adopting it is behaviour-preserving
 * for the in-scope `ui/` call sites.
 */
export function formatSats(sats: number): string {
	return Math.round(sats).toLocaleString()
}

/**
 * `formatSats` plus the unit suffix, e.g. `12,000 sats`.
 *
 * The hand-maintained copies discovery-v2 found appended " sats" at the call
 * site; this keeps the suffix in one place while delegating the number to the
 * canonical formatter, so there is still one implementation of sats formatting.
 */
export function formatSatsWithUnit(sats: number): string {
	return `${formatSats(sats)} sats`
}

/**
 * The unit a listing's own currency code renders as: `SATS`/`SAT` (and an
 * absent code, the historical sats listing) spell as the lowercase `sats`, and
 * every other code (`USD`, `EUR`, `BTC`, …) renders as written.
 *
 * The spelling lives here because a price tag's third element is the only place
 * the real unit is stated — a renderer that hardcodes "sats" states a unit the
 * author never wrote.
 */
export function formatPriceUnit(currency: string | undefined): string {
	if (!currency) return 'sats'
	const upper = currency.toUpperCase()
	return upper === 'SATS' || upper === 'SAT' ? 'sats' : upper
}
