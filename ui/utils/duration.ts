/**
 * Pure duration and absolute-time formatters shared across `ui/`.
 *
 * Extracted from the `auction-editor` monolith (T6.3 slice S1). No React, no
 * state, no I/O — `utils` is the leaf layer. `formatAbsolute` is locale-aware;
 * `formatAbsoluteCompact` is the fixed-width tick-label variant for charts.
 */

/** Human-readable duration, e.g. `1 day 2 hours`, `45 minutes`, `0 minutes`. */
export function formatDuration(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 minutes'
	const days = Math.floor(totalSeconds / 86400)
	const hours = Math.floor((totalSeconds % 86400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const parts: string[] = []
	if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
	if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
	if (days === 0 && minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
	return parts.length > 0 ? parts.join(' ') : '< 1 minute'
}

/** Locale-aware absolute time for a unix-seconds timestamp; `—` when falsy. */
export function formatAbsolute(tsSeconds: number): string {
	if (!tsSeconds) return '—'
	return new Date(tsSeconds * 1000).toLocaleString()
}

/**
 * Compact absolute-time formatter for inline tick labels. Returns `HH:MM`
 * when the checkpoint is on the current day, `MM/DD HH:MM` otherwise. The
 * full locale-aware formatting still lives on {@link formatAbsolute} for any
 * hover / copy contexts that need it.
 */
export function formatAbsoluteCompact(tsSeconds: number): string {
	if (!tsSeconds) return ''
	const d = new Date(tsSeconds * 1000)
	const hh = String(d.getHours()).padStart(2, '0')
	const mm = String(d.getMinutes()).padStart(2, '0')
	const today = new Date()
	const sameDay = d.toDateString() === today.toDateString()
	if (sameDay) return `${hh}:${mm}`
	const month = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${month}/${day} ${hh}:${mm}`
}
