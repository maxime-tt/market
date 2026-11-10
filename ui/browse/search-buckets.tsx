/**
 * ui/browse/search-buckets.tsx — the narrowing buckets under a search, and the
 * disclosure for a scan that could not reach the whole set.
 *
 * A **bucket** is a narrowing option this app offers a person: a tag or a seller,
 * with a count measured over the documents the scan actually read. It is NOT a
 * facet — a facet is the search engine's own count, computed over a candidate
 * superset, and it over-reports (measured on `q=bitcoin`: facet 1197 against a
 * true 1100 for `bitcoin`, 242 against 199 for `clothing`). Rendering a facet
 * number here would put a figure on screen that is up to 22% wrong, so the pill
 * renders `bucket.count` and nothing else. The distinction is kept in the names
 * on purpose: whoever conflates the two will reach for `facetDistribution` and
 * re-introduce the wrong number.
 *
 * One mechanism for both kinds: choosing a bucket ADDS its value to the query,
 * and the value is what distinguishes a tag from a seller — a seller's value is
 * its pubkey. A seller bucket shows a person's display name, but narrows by the
 * key, so the same query write serves both and a chosen bucket can never replace
 * the search the person was in the middle of.
 */

import type { FC } from 'react'
import { cn } from '../utils/cn'

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Which dimension a bucket came from. `label_tags` and `category_tags` are both
 * shown as **tags** — the person narrowing sees one vocabulary — while `seller`
 * is its own group because its value is a pubkey and its label is a name.
 */
export type BucketDimension = 'label_tags' | 'category_tags' | 'seller'

/** One narrowing option, as the service derives it from the scanned documents. */
export interface Bucket {
	/** The dimension the value came from. */
	dimension: BucketDimension
	/**
	 * What choosing this bucket adds to the query: a tag, or a seller's pubkey.
	 * Never a display name — a name is not a search term the index knows.
	 */
	value: string
	/**
	 * Exact count of documents in the scanned set that carry this value. From
	 * the documents, never from a facet — see the file header.
	 */
	count: number
	/** `count / set size`, as the service computed it. Display-only here. */
	share?: number
	/** A seller bucket's display name. Ignored for tags, which label by value. */
	label?: string
}

// ---------------------------------------------------------------------------
// Active state — one rule, shared with the host
// ---------------------------------------------------------------------------

/** Escapes a value for use inside a regular expression. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether the query already contains this bucket's value.
 *
 * The comparison is whole-token, not substring: `art` must not read as active on
 * a search for `artisan`, and a multi-word value (`rare sats`) must match as a
 * phrase rather than by its first word. It is the same rule the search field
 * uses — the query is the only state there is, so a pill's active look cannot
 * drift from what the field says.
 */
export function isBucketActive(query: string, value: string): boolean {
	const needle = value.trim()
	if (!needle) return false
	return new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`, 'i').test(query.trim())
}

// ---------------------------------------------------------------------------
// The pill
// ---------------------------------------------------------------------------

interface BucketPillProps {
	label: string
	count: number
	active: boolean
	onChoose: () => void
	testId: string
}

/**
 * One bucket pill.
 *
 * It deliberately repeats the facet pill's role tokens (`TagFilterBadge`) rather
 * than importing that component: the bucket pill needs `aria-pressed` and a
 * stable per-bucket test id, which the facet pill does not carry, and loosening
 * the facet pill for this caller would put a second meaning on the widget the
 * widget-book renders. The visual tokens are identical, so the two lines still
 * read as one family.
 */
const BucketPill: FC<BucketPillProps> = ({ label, count, active, onChoose, testId }) => (
	<button
		type="button"
		data-slot="bucket-pill"
		data-testid={testId}
		aria-pressed={active}
		className={cn(
			'h-7',
			'px-3',
			'rounded-full',
			'border',
			'flex',
			'items-center',
			'gap-1.75',
			'text-xs',
			'cursor-pointer',
			'transition-colors',
			active ? 'bg-fill-ink border-fill-ink text-on-fill-ink' : 'border-border-default text-text-mid',
			active ? 'hover:bg-fill-ink-hover' : 'hover:text-text-high',
		)}
		onClick={onChoose}
	>
		<span className="truncate max-w-[16rem]">{label}</span>
		{/*
			The bucket's own count — the documents it was counted over. This is the
			one number on this row that must never be "simplified" to the service's
			facet count: the facet is computed over a candidate superset and
			over-reports by up to 22% (bitcoin 1197 vs 1100, clothing 242 vs 199).
		*/}
		<b className={cn('font-normal', 'opacity-60', 'font-variant-numeric-tabular-nums')}>{count.toLocaleString()}</b>
	</button>
)

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

/** The owner's cap: four subsets, four sellers. Display, not a market claim. */
const MAX_BUCKETS_PER_GROUP = 4

/**
 * Below this many pills there is no choice to offer. A search that yields one
 * bucket (`q=swimsuit`, 15 results) must not render a lone "narrowing"
 * affordance that only ever restates the query.
 */
const MIN_BUCKETS_TO_RENDER = 2

export interface SearchBucketLineProps {
	/** The service's buckets for this read, already ranked. Order is kept. */
	buckets: readonly Bucket[]
	/** The current query — a bucket is active when this already contains it. */
	query: string
	/**
	 * The one narrowing mechanism: add a bucket's value to the query. The host
	 * owns the write (and the duplicate guard), so the line cannot invent a
	 * second way to narrow.
	 */
	onNarrow: (value: string) => void
	/** How many buckets each group shows. Four by default, per the owner. */
	maxPerGroup?: number
	/** Extra classes for the root. */
	className?: string
}

/**
 * The bucket line: tag buckets and seller buckets, narrowing in place.
 *
 * Each group is capped and labelled, because a seller pill that shows only a
 * name and a number is indistinguishable from a tag. Groups with nothing in them
 * do not render — an empty "Sellers" heading is a claim about the set, and it
 * would be a false one.
 */
export const SearchBucketLine: FC<SearchBucketLineProps> = ({
	buckets,
	query,
	onNarrow,
	maxPerGroup = MAX_BUCKETS_PER_GROUP,
	className,
}) => {
	const tagBuckets = buckets.filter((bucket) => bucket.dimension !== 'seller').slice(0, maxPerGroup)
	const sellerBuckets = buckets.filter((bucket) => bucket.dimension === 'seller').slice(0, maxPerGroup)

	if (tagBuckets.length + sellerBuckets.length < MIN_BUCKETS_TO_RENDER) return null

	/**
	 * A seller bucket's label is its display name; without one, the pubkey's
	 * head is still a truthful identity (the cards fall back the same way), and
	 * never an invented name.
	 */
	const pill = (bucket: Bucket) => (
		<BucketPill
			key={`${bucket.dimension}:${bucket.value}`}
			label={bucket.dimension === 'seller' ? (bucket.label ?? bucket.value.slice(0, 8)) : bucket.value}
			count={bucket.count}
			active={isBucketActive(query, bucket.value)}
			onChoose={() => onNarrow(bucket.value)}
			testId={`widget-bucket-${bucket.dimension}-${bucket.value}`}
		/>
	)

	/** One labelled group. `group` is the data hook both the CSS and the tests key on. */
	const group = (name: 'tags' | 'sellers', heading: string, items: readonly Bucket[]) =>
		items.length === 0 ? null : (
			<div key={name} data-slot="bucket-group" data-group={name} className="flex items-center gap-2.5 min-w-0">
				<span className="text-[10.5px] tracking-[0.14em] uppercase text-text-mid flex-none">{heading}</span>
				<div className="flex flex-wrap items-center gap-2 min-w-0">{items.map(pill)}</div>
			</div>
		)

	return (
		<div data-slot="search-buckets" className={cn('mt-3', 'flex', 'flex-col', 'gap-2', className)}>
			{group('tags', 'Tags', tagBuckets)}
			{group('sellers', 'Sellers', sellerBuckets)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// The capped-scan disclosure
// ---------------------------------------------------------------------------

export interface ScanTruncationNoticeProps {
	/** The frame's own flag. `false` (or absent) renders nothing at all. */
	truncated: boolean
	/**
	 * How many documents the scan reached — the "first N" the buckets describe.
	 * Optional: a frame that declares truncation without stating its reach still
	 * gets disclosed, in a sentence that claims no number.
	 */
	scanned?: number
	/** What the index said the set was, when the frame stated it. */
	total?: number
	/**
	 * Focus the search field. The way past the cap is a narrower query, so the
	 * disclosure offers the field itself rather than a retry that would ask the
	 * same too-large question again.
	 */
	onRefine?: () => void
	/** Extra classes for the root. */
	className?: string
}

/**
 * Discloses that the scan was capped, and offers the only thing that helps.
 *
 * This is not an error and must never be styled as one: the results below are
 * real, and the buckets above are real — they simply describe the first N. The
 * line is always rendered when `truncated` is true (silence would let a person
 * read a partial set of buckets as the whole one), and it states the count it
 * actually reached, not the set size it could not read.
 */
export const ScanTruncationNotice: FC<ScanTruncationNoticeProps> = ({ truncated, scanned, total, onRefine, className }) => {
	if (!truncated) return null

	const reached = typeof scanned === 'number' ? scanned.toLocaleString() : undefined
	const size = reached && typeof total === 'number' && typeof scanned === 'number' && total > scanned ? total.toLocaleString() : undefined

	return (
		<div
			data-slot="scan-truncation"
			data-state="truncated"
			className={cn(
				'mt-3',
				'flex',
				'flex-wrap',
				'items-baseline',
				'gap-x-2',
				'gap-y-1',
				'text-xs',
				'leading-relaxed',
				'text-text-mid',
				className,
			)}
		>
			<span>
				{size && reached
					? `${size} results match, but the index scan reaches the first ${reached} — the buckets describe those ${reached}.`
					: reached
						? `The index scan reaches the first ${reached} results — the buckets describe those ${reached}.`
						: 'This search matches more than the index scan reaches — the buckets describe only the results it reached.'}{' '}
				Refining the search narrows the set below the cap and extends the reach.
			</span>
			{onRefine && (
				<button
					type="button"
					data-slot="scan-truncation-refine"
					data-testid="widget-scan-truncation-refine"
					className="underline underline-offset-2 text-text-high cursor-pointer transition-colors hover:text-text-high/80"
					onClick={onRefine}
				>
					Refine the search
				</button>
			)}
		</div>
	)
}
