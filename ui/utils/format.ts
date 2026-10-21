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
