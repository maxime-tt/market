import { AlertTriangle, Eye, Link2, Pencil, RefreshCw, Route, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { EmptyState } from '../shared/empty-state'
import { Notice } from '../shared/notice'
import { cn } from '../utils/cn'

/**
 * Presentational pieces of the route-authoring surface (ADR-0007: `ui/` owns
 * components, the route assembles them).
 *
 * Every component here is driven by props and renders exactly the state it is
 * given. "No paths are bound yet", "the table could not be read" and "here are
 * the bindings" are three different renderings — never one list that quietly
 * falls back to empty, because an empty list on a table that failed to load is
 * a lie about what the instance serves.
 *
 * The authoring view model is structurally the same shape, but the row and form
 * shapes are declared here rather than imported from `platform/`, so `ui/` keeps
 * its independence from the host.
 *
 * The two flows — create a route, edit a route — are `RouteCreateForm` and
 * `RouteEditCard`; both compose `RouteBindingForm`, which owns the field layout
 * (the path, and the slot the page picker is rendered into). The picker itself
 * is not here: it needs a relay read, so the host renders it and passes it in.
 */

/** One binding, already resolved to display strings by the view model. */
export interface RouteBindingRow {
	path: string
	/** The raw address, e.g. `page deadbeef…cafe / storefront-page`. */
	targetLabel: string
	/** The page's name as a human reads it; empty for a non-page target. */
	pageName: string
	/** The page author as a human reads it; empty for a non-page target. */
	pageAuthorLabel: string
	updatedAtLabel: string
	updatedByLabel: string
	warning: string | null
	author: string
	d: string
}

export interface RouteBindingFormProps {
	title: string
	description: string
	path: string
	onPathChange: (value: string) => void
	/** The page picker, rendered by the host because it owns the relay read. */
	pagePicker: ReactNode
	errors: string[]
	/** A non-blocking, pre-submit notice — e.g. that the path is compiled in. */
	notice?: string | null
	pending: boolean
	submitLabel: string
	/** True when the form is retargeting an existing binding: the path is fixed. */
	editing: boolean
	onSubmit: () => void
	onCancel?: () => void
	className?: string
}

export function RouteBindingForm({
	title,
	description,
	path,
	onPathChange,
	pagePicker,
	errors,
	notice = null,
	pending,
	submitLabel,
	editing,
	onSubmit,
	onCancel,
	className,
}: RouteBindingFormProps) {
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Link2 className="h-5 w-5" />
					{title}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="route-path">Path</Label>
					<Input
						id="route-path"
						value={path}
						disabled={editing || pending}
						placeholder="shop"
						onChange={(event) => onPathChange(event.target.value)}
					/>
					<p className="text-text-mid text-xs">
						{editing
							? 'A path cannot be renamed in place. Remove this binding and create the new path.'
							: 'One lowercase name, 3–30 characters: letters, digits, "-" or "_". It becomes the URL: /your-name.'}
					</p>
				</div>

				<div className="space-y-2">
					<Label>Page</Label>
					{pagePicker}
					<p className="text-text-mid text-xs">
						The path is pointed at this page. It is not moved or copied, and pointing at it does not publish it.
					</p>
				</div>

				{notice && (
					<Notice tone="warning" compact>
						{notice}
					</Notice>
				)}

				{errors.length > 0 && (
					<div role="alert" className="space-y-1 rounded border border-error/40 bg-error/5 p-3 text-sm">
						{errors.map((error) => (
							<p key={error} className="text-error">
								{error}
							</p>
						))}
					</div>
				)}

				<div className="flex gap-2">
					<Button onClick={onSubmit} disabled={pending}>
						{submitLabel}
					</Button>
					{onCancel && (
						<Button variant="outline" onClick={onCancel} disabled={pending}>
							Cancel
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	)
}

/** Create a route: a path, and the page it should serve. */
export function RouteCreateForm({
	path,
	onPathChange,
	pagePicker,
	errors,
	notice,
	pending,
	onSubmit,
	className,
}: {
	path: string
	onPathChange: (value: string) => void
	pagePicker: ReactNode
	errors: string[]
	notice?: string | null
	pending: boolean
	onSubmit: () => void
	className?: string
}) {
	return (
		<RouteBindingForm
			title="Create a route"
			description="Point a path at a page you have published. The page is not moved or copied."
			path={path}
			onPathChange={onPathChange}
			pagePicker={pagePicker}
			errors={errors}
			notice={notice}
			pending={pending}
			submitLabel="Bind path"
			editing={false}
			onSubmit={onSubmit}
			className={className}
		/>
	)
}

/** Edit a route: the path is its address and stays put; the page is editable. */
export function RouteEditCard({
	path,
	pagePicker,
	errors,
	pending,
	onSubmit,
	onCancel,
	className,
}: {
	path: string
	pagePicker: ReactNode
	errors: string[]
	pending: boolean
	onSubmit: () => void
	onCancel?: () => void
	className?: string
}) {
	return (
		<RouteBindingForm
			title={`Edit /${path}`}
			description="Choose the page this path should serve. The path itself stays the same."
			path={path}
			onPathChange={() => {}}
			pagePicker={pagePicker}
			errors={errors}
			pending={pending}
			submitLabel="Save target"
			editing
			onSubmit={onSubmit}
			onCancel={onCancel}
			className={className}
		/>
	)
}

export interface RouteBindingsListProps {
	rows: RouteBindingRow[]
	/** Path whose removal is in flight, if any. */
	pendingPath: string | null
	onEdit?: (row: RouteBindingRow) => void
	onRemove?: (row: RouteBindingRow) => void
	/** Opens the page this binding points at, in its editor. */
	onEditPage?: (row: RouteBindingRow) => void
	className?: string
}

export function RouteBindingsList({ rows, pendingPath, onEdit, onRemove, onEditPage, className }: RouteBindingsListProps) {
	return (
		<div className={cn('space-y-3', className)}>
			{rows.map((row) => {
				const pending = pendingPath === row.path
				return (
					<div key={row.path} className="space-y-2 rounded border border-border-default p-4" data-route-path={row.path}>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<p className="font-medium">
									<Route className="mr-1 inline h-4 w-4" />/{row.path}
								</p>
								{row.pageName && (
									<p className="text-sm">
										<strong>{row.pageName}</strong> <span className="text-text-mid">({row.pageAuthorLabel})</span>
									</p>
								)}
								<p className="text-text-mid text-xs">{row.targetLabel}</p>
								<p className="text-text-mid text-xs">
									Updated {row.updatedAtLabel} by {row.updatedByLabel}
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button variant="outline" size="sm" asChild>
									<a href={`/${row.path}`} target="_blank" rel="noopener noreferrer">
										<Eye className="h-3 w-3" />
										View page
									</a>
								</Button>
								{onEditPage && row.d && (
									<Button variant="outline" size="sm" onClick={() => onEditPage(row)} disabled={pending}>
										<Pencil className="h-3 w-3" />
										Edit page
									</Button>
								)}
								{onEdit && (
									<Button variant="outline" size="sm" onClick={() => onEdit(row)} disabled={pending}>
										Edit target
									</Button>
								)}
								{onRemove && (
									<Button variant="outline" size="sm" onClick={() => onRemove(row)} disabled={pending} aria-label={`Remove ${row.path}`}>
										<Trash2 className="h-3 w-3" />
										Remove
									</Button>
								)}
							</div>
						</div>

						{row.warning && (
							<p className="flex items-start gap-2 rounded bg-warning-muted p-2 text-warning-muted-foreground text-xs">
								<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
								<span>
									<strong>{row.path}</strong> is also a page compiled into this build. The binding wins — the compiled page is not
									reachable at this path while the binding exists.
								</span>
							</p>
						)}
					</div>
				)
			})}
		</div>
	)
}

/** The table answered, and it has no bindings: say so, plainly. */
export function RouteBindingsEmpty() {
	return (
		<EmptyState
			icon={<Route />}
			title="No paths are bound yet"
			description="Every path currently resolves to the app's own pages. You can point one at a published storefront page to serve it at a path."
		/>
	)
}

/** The table could not be read: say so, and do not pretend it is empty. */
export function RouteBindingsError({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<Card>
			<CardContent className="space-y-3 p-6">
				<div role="alert" className="flex items-start gap-2">
					<X className="mt-0.5 h-4 w-4 shrink-0 text-error" />
					<div>
						<p className="font-medium">Could not read the routing table</p>
						<p className="text-text-mid text-sm">{message}</p>
					</div>
				</div>
				{onRetry && (
					<Button variant="outline" size="sm" onClick={onRetry}>
						<RefreshCw className="h-3 w-3" />
						Try again
					</Button>
				)}
			</CardContent>
		</Card>
	)
}

/** Removing a binding takes a URL away; it asks first. */
export function RouteRemovalConfirm({
	path,
	pending,
	onConfirm,
	onCancel,
}: {
	path: string
	pending: boolean
	onConfirm: () => void
	onCancel: () => void
}) {
	return (
		<Card>
			<CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
				<p className="text-sm">
					Remove the binding on <strong>/{path}</strong>? The page it points at is not deleted, but{' '}
					<strong>/{path}</strong> stops resolving to it.
				</p>
				<div className="flex gap-2">
					<Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
						<Trash2 className="h-3 w-3" />
						Remove binding
					</Button>
					<Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
						Keep it
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}
