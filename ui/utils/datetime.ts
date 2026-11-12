/**
 * Pure `datetime-local` string helpers shared across `ui/`.
 *
 * Extracted from the `auction-editor` monolith (T6.3 slice S1). No React, no
 * state, no I/O — `utils` is the leaf layer, so these live here rather than in
 * an auction module. The `datetime-local` input format has no timezone suffix,
 * so the string is interpreted in the browser's local zone on parse.
 */

/** Zero-pads a number to at least two digits. */
export function pad2(n: number): string {
	return n.toString().padStart(2, '0')
}

/** Formats a `Date` as a `datetime-local` input value (`YYYY-MM-DDTHH:MM:SS`). */
export function toDatetimeLocal(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** Parses a `datetime-local` input value to unix seconds, or `null` when empty or unparseable. */
export function parseDatetimeLocalSeconds(value: string): number | null {
	if (!value) return null
	const ts = new Date(value).getTime()
	return Number.isNaN(ts) ? null : Math.floor(ts / 1000)
}
