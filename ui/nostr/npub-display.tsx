import type { Ref } from 'react'
import { truncateMiddle } from '../shared/truncated-text'
import { cn } from '../utils/cn'

/** Default characters kept at the head of a truncated npub. */
export const NPUB_HEAD = 10
/** Default characters kept at the tail of a truncated npub. */
export const NPUB_TAIL = 4

export interface TruncateNpubOptions {
	/** Characters kept from the start. Defaults to {@link NPUB_HEAD}. */
	head?: number
	/** Characters kept from the end. Defaults to {@link NPUB_TAIL}. */
	tail?: number
	/** Separator between the kept parts. Defaults to `'...'`. */
	separator?: string
}

/**
 * Middle-truncates an **already-encoded** npub for display.
 *
 * Pure and encoding-free on purpose: `ui/` may not import `nostr-tools`, so
 * converting a hex pubkey to an npub stays in the host (`@sdk/core/nostr/pubkeyDisplay`).
 * Before this helper there were six hand-written forks of the same slice/join,
 * using different head/tail lengths and both `..` and `...` as the separator —
 * the implementation is now shared while each call site keeps its own numbers.
 *
 * Delegates to `truncateMiddle` so `ui/` keeps exactly one truncation algorithm;
 * only the defaults and the separator differ.
 */
export function truncateNpub(npub: string, options: TruncateNpubOptions = {}): string {
	const { head = NPUB_HEAD, tail = NPUB_TAIL, separator = '...' } = options
	return truncateMiddle(npub, head, tail, separator)
}

export interface NpubDisplayProps {
	/** The encoded npub. Always preserved in `title` so the value stays readable. */
	npub: string
	/** Characters kept before the separator. */
	head?: number
	/** Characters kept after the separator. */
	tail?: number
	/** Separator between the kept parts. */
	separator?: string
	className?: string
	ref?: Ref<HTMLSpanElement>
}

/**
 * Canonical rendering for a truncated npub. The full value stays available via
 * the native `title` tooltip, so truncation never hides the underlying key.
 */
export function NpubDisplay({ npub, head, tail, separator, className, ref }: NpubDisplayProps) {
	return (
		<span ref={ref} title={npub} data-slot="npub-display" className={cn('lowercase', className)}>
			{truncateNpub(npub, { head, tail, separator })}
		</span>
	)
}
