import type { Ref } from 'react'
import { cn } from '../utils/cn'

/** Default characters kept at the head, e.g. the `npub1` prefix. */
export const TRUNCATED_TEXT_START = 8
/** Default characters kept at the tail. */
export const TRUNCATED_TEXT_END = 6
/** Default separator inserted where the string was cut. */
export const TRUNCATED_TEXT_ELLIPSIS = '…'

/**
 * Middle-truncates `text`, keeping `start` head characters and `end` tail
 * characters joined by `ellipsis`. Short strings are returned unchanged — never
 * padded, never re-escaped. This is the one implementation of middle
 * truncation in `ui/`; `truncateNpub` delegates to it with its own numbers and
 * separator rather than re-deriving the slice arithmetic.
 *
 * `end: 0` is head-only truncation. It is handled explicitly because
 * `text.slice(-0)` returns the whole string, which would otherwise append the
 * ellipsis to the full input.
 */
export function truncateMiddle(
	text: string,
	start = TRUNCATED_TEXT_START,
	end = TRUNCATED_TEXT_END,
	ellipsis = TRUNCATED_TEXT_ELLIPSIS,
): string {
	if (start < 0 || end < 0) return text
	if (end === 0) {
		return text.length <= start + ellipsis.length ? text : `${text.slice(0, start)}${ellipsis}`
	}
	// Nothing to gain from truncating when the kept parts already cover the string.
	if (text.length <= start + end + ellipsis.length) return text
	return `${text.slice(0, start)}${ellipsis}${text.slice(text.length - end)}`
}

export interface TruncatedTextProps {
	/** The full string. Always preserved in `title` so the value stays readable. */
	text: string
	/** Characters kept before the ellipsis. Defaults to {@link TRUNCATED_TEXT_START}. */
	start?: number
	/** Characters kept after the ellipsis. Defaults to {@link TRUNCATED_TEXT_END}. */
	end?: number
	/** Overrides the tooltip; defaults to the full `text`. */
	title?: string
	className?: string
	ref?: Ref<HTMLSpanElement>
}

/**
 * Canonical truncation primitive for identifiers that are too long to render in
 * full (npub/nsec keys, invoice ids, txids). The full value stays available via
 * the native `title` tooltip, so truncation never hides the underlying string.
 */
export function TruncatedText({ text, start, end, title, className, ref }: TruncatedTextProps) {
	const display = truncateMiddle(text, start, end)

	return (
		<span ref={ref} title={title ?? text} data-slot="truncated-text" className={cn('font-mono', className)}>
			{display}
		</span>
	)
}
