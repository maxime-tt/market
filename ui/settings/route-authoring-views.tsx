import { AlertTriangle, Link2, RefreshCw, Route, Trash2, X } from 'lucide-react'
import { Button } from '../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../primitives/card'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { EmptyState } from '../shared/empty-state'

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
 * The row and draft shapes are declared here rather than imported from the
 * feature directory so `ui/` keeps its independence from `platform/`; the
 * authoring view model is structurally the same shape.
 */

/** One binding, already resolved to display strings by the view model. */
export interface RouteBindingRow {
	path: string
	targetLabel: string
	updatedAtLabel: string
	updatedByLabel: string
	warning: string | null
	author: string
	d: string
}

/** What the form holds while an admin types. */
export interface RouteBindingDraft {
	path: string
	author: string
	d: string
}

export interface RouteBindingFormProps {
	title: string
	description: string
	values: RouteBindingDraft
	errors: string[]
	pending: boolean
	submitLabel: string
	/** True when the form is retargeting an existing binding. */
	editing: boolean
	onChange: (field: keyof RouteBindingDraft, value: string) => void
	onSubmit: () => void
	onCancel?: () => void
}

export function RouteBindingForm({
	title,
	description,
	values,
	errors,
	pending,
	submitLabel,
	editing,
	onChange,
	onSubmit,
	onCancel,
}: RouteBindingFormProps) {
	return (
		<Card>
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
						value={values.path}
						disabled={editing || pending}
						placeholder="shop"
						onChange={(event) => onChange('path', event.target.value)}
					/>
					<p className="text-text-mid text-xs">
						{editing
							? 'A path cannot be renamed in place. Remove this binding and create the new path.'
							: 'One lowercase name, 3–30 characters: letters, digits, "-" or "_". It becomes the URL: /your-name.'}
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="route-author">Page author</Label>
					<Input
						id="route-author"
						value={values.author}
						disabled={pending}
						placeholder="npub1… or 64-character hex pubkey"
						onChange={(event) => onChange('author', event.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="route-d">Page d tag</Label>
					<Input
						id="route-d"
						value={values.d}
						disabled={pending}
						placeholder="storefront-page"
						onChange={(event) => onChange('d', event.target.value)}
					/>
					<p className="text-text-mid text-xs">The published page&rsquo;s identifier. A user storefront page uses “storefront-page”.</p>
				</div>

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

export interface RouteBindingsListProps {
	rows: RouteBindingRow[]
	/** Path whose removal is in flight, if any. */
	pendingPath: string | null
	onEdit?: (row: RouteBindingRow) => void
	onRemove?: (row: RouteBindingRow) => void
}

export function RouteBindingsList({ rows, pendingPath, onEdit, onRemove }: RouteBindingsListProps) {
	return (
		<div className="space-y-3">
			{rows.map((row) => {
				const pending = pendingPath === row.path
				return (
					<div key={row.path} className="space-y-2 rounded border border-black/10 p-4" data-route-path={row.path}>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<p className="font-medium">
									<Route className="mr-1 inline h-4 w-4" />/{row.path}
								</p>
								<p className="text-text-mid text-sm">{row.targetLabel}</p>
								<p className="text-text-mid text-xs">
									Updated {row.updatedAtLabel} by {row.updatedByLabel}
								</p>
							</div>
							<div className="flex gap-2">
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
							<p className="flex items-start gap-2 rounded bg-amber-50 p-2 text-amber-900 text-xs">
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
			description="Every path currently resolves to the app's own pages. Add a binding below to point one at a published storefront page."
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