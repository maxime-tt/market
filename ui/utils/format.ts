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
