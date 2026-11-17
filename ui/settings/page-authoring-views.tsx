import { FileText, LayoutTemplate, Plus, Route, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '../primitives/badge'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { EmptyState } from '../shared/empty-state'
import { ErrorState } from '../shared/error-state'
import { LoadingState } from '../shared/loading-state'
import { Notice } from '../shared/notice'
import { StatusBadge } from '../shared/status-badge'
import { cn } from '../utils/cn'

/**
 * Presentational pieces of the page-authoring surface (ADR-0007: `ui/` owns
 * components, the host assembles them).
 *
 * The page list, the new-page form and the page picker. Every component is
 * driven by props and renders exactly the state it is given: "you have no pages
 * yet", "the pages could not be read" and "here are your pages" are three
 * different renderings — never one list that quietly falls back to empty,
 * because an empty picker on a read that failed leads an admin to create a
 * duplicate page. The picker is the one place this cluster owns state: a search
 * string, which is a property of the control, not of the data.
 *
 * The row and label shapes are declared here rather than imported from
 * `platform/`, so `ui/` keeps its independence from the host; the authoring
 * view model (`PageLabel`) is structurally the same shape.
 *
 * Deviation from the ADR-0007 §1c checklist: the label chip carries no `ref`.
 * It is a composite of two primitives with no single root element a caller could
 * meaningfully focus, and nothing in this product forwards one; every other
 * component here exposes `ref` on its root.
 */

/** A page as the UI names it — the `PageLabel` the host's view model produces. */
export interface PageLabelView {
	name: string
	authorLabel: string
	enabled: boolean
	isDefault: boolean
}

/** One row of the picker: a page label plus the address it points at. */
export interface PickerPage extends PageLabelView {
	/** The page's `d` — its name and its address. */
	d: string
	/** The document's `title` tag, when it has one. */
	title: string | null
}

/**
 * Name, author and state, as chips.
 *
 * The storefront page is shown by its label ("Storefront"), not by the raw
 * reserved tag, so a list of pages reads as a list of things the author made.
 */
export function PageLabelChips({ label, className }: { label: PageLabelView; className?: string }) {
	return (
		<span className={cn('flex flex-wrap items-center gap-1.5', className)}>
			<Badge variant={label.isDefault ? 'secondary' : 'outline'} data-testid="page-name-chip">
				{label.name}
			</Badge>
			<span className="text-text-mid text-xs">{label.authorLabel}</span>
			<StatusBadge status={label.enabled ? 'live' : 'off'} tone={label.enabled ? 'success' : 'neutral'} />
		</span>
	)
}

/** The list is being read: say so, and do not draw an empty list underneath. */
export function PagesLoading({ className }: { className?: string }) {
	return <LoadingState variant="skeleton" rows={3} label="Loading your pages…" className={className} />
}

/** The pages could not be read: say so, and do not pretend it is empty. */
export function PagesError({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
	return (
		<ErrorState
			title="Could not read your pages"
			message={message}
			onRetry={onRetry}
			retryTestId="pages-retry"
			className={className}
		/>
	)
}

/** The author has no pages: an empty list is the truth here. */
export function PagesEmpty({ onCreate, className }: { onCreate?: () => void; className?: string }) {
	return (
		<EmptyState
			icon={<FileText />}
			title="No pages yet"
			description="A page is a document you publish under a path of this app. Create one, then point a route at it."
			action={onCreate ? <Button onClick={onCreate}>New page</Button> : undefined}
			className={className}
		/>
	)
}

export interface PagesListProps {
	pages: PickerPage[]
	/** How many pages the read's cap left out. Zero when the list is complete. */
	dropped: number
	/** `d` of the page whose editor is being opened, if any. */
	pendingD?: string | null
	onEdit?: (page: PickerPage) => void
	className?: string
}

/** The author's pages, newest first. */
export function PagesList({ pages, dropped, pendingD = null, onEdit, className }: PagesListProps) {
	return (
		<div className={cn('space-y-3', className)} data-testid="pages-list">
			{pages.map((page) => (
				<div key={page.d} className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-4" data-page-d={page.d}>
					<div className="min-w-0 space-y-1">
						<PageLabelChips label={page} />
						{page.title && <p className="text-sm">{page.title}</p>}
						<p className="text-text-mid text-xs">{page.d}</p>
					</div>
					{onEdit && (
						<Button variant="outline" size="sm" onClick={() => onEdit(page)} disabled={pendingD === page.d}>
							Edit page
						</Button>
					)}
				</div>
			))}

			{dropped > 0 && (
				<p className="text-text-mid text-xs" data-testid="pages-dropped">
					{dropped} more {dropped === 1 ? 'page was' : 'pages were'} not listed. The list shows the most recently published pages first.
				</p>
			)}
		</div>
	)
}

export interface NewPageFormProps {
	/** The name being typed. */
	value: string
	/** The sentence `validatePageName` returned for it, or null. */
	error: string | null
	/** A non-blocking notice, e.g. that the name already exists. */
	notice: string | null
	pending: boolean
	onChange: (value: string) => void
	onSubmit: () => void
	className?: string
}

/**
 * The whole new-page flow: a name, and nothing else.
 *
 * The name becomes the page's `d` and the default path it is published under,
 * which is why the form says it cannot be changed later — a page's address is
 * its identity. Nothing here adds a block to the document: the editor the author
 * lands in decides what the page contains.
 */
export function NewPageForm({ value, error, notice, pending, onChange, onSubmit, className }: NewPageFormProps) {
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Plus className="h-5 w-5" />
					New page
				</CardTitle>
				<CardDescription>Name the page. The name is its address, and it is also the default path it is published under.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="new-page-name">Page name</Label>
					<Input
						id="new-page-name"
						value={value}
						disabled={pending}
						placeholder="featured-13-11-2026"
						aria-invalid={error ? true : undefined}
						onChange={(event) => onChange(event.target.value)}
					/>
					<p className="text-text-mid text-xs">
						One lowercase name, 3–30 characters: letters, digits, "-" or "_". It becomes the address of this page and cannot be
						changed later.
					</p>
				</div>

				{error && (
					<p role="alert" className="text-sm text-error">
						{error}
					</p>
				)}

				{!error && notice && (
					<Notice tone="info" compact>
						{notice}
					</Notice>
				)}

				<Button onClick={onSubmit} disabled={pending}>
					Create page
				</Button>
			</CardContent>
		</Card>
	)
}

/** The address of a page the picker is showing by hand, because the list cannot. */
export interface PickerAddress {
	d: string
	authorLabel: string
}

export interface PagePickerProps {
	pages: PickerPage[]
	loading: boolean
	/** Non-null when the read failed. The picker then shows no list at all. */
	error: string | null
	onRetry?: () => void
	/** `d` of the selected page, if one is selected. */
	selectedD: string | null
	/** The binding's current target when the list cannot show it (another author's page, or unreadable). */
	currentTarget?: PickerAddress | null
	onSelect: (page: PickerPage) => void
	/** Optional escape: leave to create a new page, pre-filled with the path name. */
	onCreatePage?: () => void
	/** The advanced paste field: any author's page, by address. */
	advanced: { author: string; d: string }
	onAdvancedChange: (field: 'author' | 'd', value: string) => void
	onAdvancedApply: () => void
	advancedError?: string | null
	disabled?: boolean
	className?: string
}

/**
 * Pick a page you own — or, under Advanced, point at any author's page.
 *
 * The list is searchable rather than a `<select>`: an author with hundreds of
 * pages cannot scroll a native dropdown, and the owner's scale is hundreds. The
 * picker never claims a page is servable — a page can be in this list and still
 * be unpublished, and it says "pointing at this page" and nothing more.
 */
export function PagePicker({
	pages,
	loading,
	error,
	onRetry,
	selectedD,
	currentTarget = null,
	onSelect,
	onCreatePage,
	advanced,
	onAdvancedChange,
	onAdvancedApply,
	advancedError = null,
	disabled = false,
	className,
}: PagePickerProps) {
	const [query, setQuery] = useState('')

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase()
		if (needle.length === 0) return pages
		return pages.filter((page) => page.name.toLowerCase().includes(needle) || (page.title ?? '').toLowerCase().includes(needle))
	}, [pages, query])

	// A target the list cannot show is still the current selection; it is
	// rendered by address rather than as "nothing selected".
	const targetNotListed = Boolean(currentTarget && currentTarget.d === selectedD && !pages.some((page) => page.d === currentTarget.d))

	return (
		<div className={cn('space-y-3', className)} data-testid="page-picker">
			{loading ? (
				<LoadingState variant="skeleton" rows={2} label="Loading your pages…" />
			) : error ? (
				<PagesError message={error} onRetry={onRetry} />
			) : (
				<>
					{targetNotListed && currentTarget && (
						<Notice tone="info" compact>
							Currently pointing at <strong>{currentTarget.d}</strong> by {currentTarget.authorLabel}. It is not in your list, so it stays
							selected until you pick another.
						</Notice>
					)}

					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-mid" aria-hidden="true" />
						<Input
							id="page-picker-search"
							value={query}
							disabled={disabled}
							placeholder="Search your pages"
							aria-label="Search your pages"
							className="pl-9"
							onChange={(event) => setQuery(event.target.value)}
						/>
					</div>

					{filtered.length === 0 ? (
						<p className="text-text-mid text-sm" data-testid="page-picker-empty">
							{pages.length === 0 ? 'You have no pages yet.' : 'No page matches that search.'}
						</p>
					) : (
						<div className="space-y-2" role="group" aria-label="Your pages" data-testid="page-picker-list">
							{filtered.map((page) => (
								<button
									key={page.d}
									type="button"
									disabled={disabled}
									aria-pressed={page.d === selectedD}
									data-page-d={page.d}
									onClick={() => onSelect(page)}
									className={cn(
										'flex w-full flex-wrap items-center justify-between gap-2 rounded border p-3 text-left transition-colors',
										page.d === selectedD ? 'border-primary bg-surface-hover' : 'border-border hover:bg-surface-hover',
									)}
								>
									<span className="min-w-0 space-y-1">
										<PageLabelChips label={page} />
										{page.title && <span className="block text-sm">{page.title}</span>}
										<span className="block text-text-mid text-xs">{page.d}</span>
									</span>
									{page.d === selectedD && <Badge variant="default">Selected</Badge>}
								</button>
							))}
						</div>
					)}

					{onCreatePage && (
						<Button variant="outline" size="sm" onClick={onCreatePage} disabled={disabled} data-testid="page-picker-create">
							<LayoutTemplate className="h-3.5 w-3.5" />
							Create a new page instead
						</Button>
					)}
				</>
			)}

			<details className="rounded border border-border p-3">
				<summary className="cursor-pointer text-sm font-medium">Advanced: point at another author&rsquo;s page</summary>
				<div className="space-y-3 pt-3">
					<p className="text-text-mid text-xs">
						The routing table can point at any author&rsquo;s page. Paste the address here only when the page is not yours.
					</p>
					<div className="space-y-2">
						<Label htmlFor="picker-author">Page author</Label>
						<Input
							id="picker-author"
							value={advanced.author}
							disabled={disabled}
							placeholder="npub1… or 64-character hex pubkey"
							onChange={(event) => onAdvancedChange('author', event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="picker-d">Page name (d tag)</Label>
						<Input
							id="picker-d"
							value={advanced.d}
							disabled={disabled}
							placeholder="storefront-page"
							onChange={(event) => onAdvancedChange('d', event.target.value)}
						/>
					</div>
					{advancedError && (
						<p role="alert" className="text-sm text-error">
							{advancedError}
						</p>
					)}
					<Button variant="outline" size="sm" onClick={onAdvancedApply} disabled={disabled} data-testid="picker-advanced-apply">
						<Route className="h-3.5 w-3.5" />
						Point at this address
					</Button>
				</div>
			</details>
		</div>
	)
}
