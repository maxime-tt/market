import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Route as RouteIcon, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/primitives/card'
import { ErrorState } from '@ui/shared/error-state'
import {
	RouteBindingsEmpty,
	RouteBindingsError,
	RouteBindingsList,
	RouteCreateForm,
	RouteEditCard,
	RouteRemovalConfirm,
} from '@ui/settings/route-authoring-views'
import {
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
} from '@ui/settings/operator-settings-views'
import { isCompiledInName } from '@sdk/config/routeNames'
import { useAmIAdmin } from '@platform/web/app-settings/appSettingsQuery'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { PagePickerField } from './pageAuthoringPage'
import { describeBindings, removeIntent, validateDraft, type BindingRow } from './routeAuthoring'
import { usePublishRouteIntent, useRouteTable } from './routeTableQuery'

/**
 * The route-authoring surface: the list of bindings, create a route, edit a
 * route.
 *
 * The components only orchestrate: the table comes from the server that serves
 * it, the row strings and the draft rules come from `routeAuthoring.ts`, the
 * page picker from `pageAuthoringPage.tsx`, and the rendering from
 * `ui/settings/route-authoring-views.tsx` (ADR-0007). The write is a signed
 * route intent through the one ingest; none of these pages talks to the file on
 * disk.
 *
 * Gating mirrors `/dashboard/app-settings`: `useAmIAdmin`, the same query the
 * dashboard nav and `useRootRedirects` already key on. The server still decides
 * — an editor who reached the endpoint would be accepted by the ingest's ACL,
 * and a non-admin is refused there regardless of what these pages show.
 */
const HEADER = { icon: RouteIcon, title: 'Routes', description: 'Point a path at a page you have published' }

/** `/dashboard/app-settings/routes` — the bindings, and the way to make one. */
export function RouteAuthoringPage() {
	useDashboardTitle('Routes')

	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)
	const table = useRouteTable()
	const publish = usePublishRouteIntent()
	const navigate = useNavigate()

	const [confirmingRemove, setConfirmingRemove] = useState<BindingRow | null>(null)
	const [removingPath, setRemovingPath] = useState<string | null>(null)

	const bindings = table.data?.bindings ?? []
	const rows = useMemo(() => describeBindings(bindings, table.data?.warnings ?? []), [bindings, table.data])

	const remove = useCallback(
		async (row: BindingRow) => {
			setRemovingPath(row.path)
			try {
				await publish.mutateAsync(removeIntent(row.path))
				toast.success(`Removed the binding on /${row.path}`)
				setConfirmingRemove(null)
			} catch (error) {
				toast.error(error instanceof Error ? error.message : String(error))
			} finally {
				setRemovingPath(null)
			}
		},
		[publish],
	)

	if (isLoadingAdmin) return <SettingsLoadingSkeleton />

	if (!amIAdmin) {
		return <SettingsAccessDenied header={HEADER} message="Only an admin can change which page a path serves." />
	}

	return (
		<div>
			<SettingsPageHeader {...HEADER} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...HEADER} />

				<Card>
					<CardHeader className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>What this changes</CardTitle>
							<CardDescription>
								A binding points one path at one stored page and takes effect on the next request this instance serves. The routing table on
								disk is changed by the signed change, and the table is re-validated as a whole before it is written.
							</CardDescription>
						</div>
						<Button onClick={() => void navigate({ to: '/dashboard/app-settings/routes/new' })}>New route</Button>
					</CardHeader>
					{table.data && (
						<CardContent>
							<p className="text-text-mid text-xs">
								Table version {table.data.version}, revision {table.data.seq}.{' '}
								{table.data.default ? <>Unmatched paths fall back to /{table.data.default}.</> : 'Unmatched paths are 404.'}
							</p>
						</CardContent>
					)}
				</Card>

				{table.isLoading ? (
					<SettingsLoadingSkeleton />
				) : table.isError ? (
					<RouteBindingsError
						message={table.error instanceof Error ? table.error.message : String(table.error)}
						onRetry={() => void table.refetch()}
					/>
				) : rows.length === 0 ? (
					<Card>
						<CardContent className="p-6">
							<RouteBindingsEmpty />
						</CardContent>
					</Card>
				) : (
					<Card>
						<CardHeader>
							<CardTitle>Bound paths</CardTitle>
							<CardDescription>
								{rows.length} {rows.length === 1 ? 'binding' : 'bindings'} on this instance.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<RouteBindingsList
								rows={rows}
								pendingPath={removingPath}
								onEdit={(row) => void navigate({ to: '/dashboard/app-settings/routes/$path', params: { path: row.path } })}
								onEditPage={(row) => void navigate({ to: '/dashboard/app-settings/pages/$d', params: { d: row.d } })}
								onRemove={(row) => setConfirmingRemove(row)}
							/>
						</CardContent>
					</Card>
				)}

				{confirmingRemove && (
					<RouteRemovalConfirm
						path={confirmingRemove.path}
						pending={removingPath === confirmingRemove.path}
						onConfirm={() => void remove(confirmingRemove)}
						onCancel={() => setConfirmingRemove(null)}
					/>
				)}

				<p className="flex items-start gap-2 text-text-mid text-xs">
					<Shield className="mt-0.5 h-3 w-3 shrink-0" />
					The change is signed by your key and sent to this instance. The server checks the signature and your access level; a path owned by
					the URL space (like <code>api</code>) or a multi-segment path is refused.
				</p>
			</div>
		</div>
	)
}

/** `/dashboard/app-settings/routes/new` — pick a path, pick a page, bind. */
export function RouteCreatePage() {
	useDashboardTitle('New route')

	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin, currentUserPubkey } = useAmIAdmin(config?.appPublicKey)
	const table = useRouteTable()
	const publish = usePublishRouteIntent()
	const navigate = useNavigate()

	const [path, setPath] = useState('')
	const [page, setPage] = useState({ author: '', d: '' })
	const [errors, setErrors] = useState<string[]>([])

	const boundPaths = useMemo(() => (table.data?.bindings ?? []).map((binding) => binding.path), [table.data])

	// The compile-in collision, before the write rather than only after it. The
	// server's own warning still arrives with the result; this is the notice the
	// admin can act on while the form is still open.
	const notice = useMemo(() => {
		const trimmed = path.trim()
		if (!isCompiledInName(trimmed)) return null
		return `${trimmed} is also a page compiled into this build. The binding wins — the compiled page is not reachable at this path while the binding exists.`
	}, [path])

	const submit = useCallback(async () => {
		const validation = validateDraft({ path, author: page.author, d: page.d }, boundPaths)
		if (!validation.intent) {
			setErrors(validation.errors)
			return
		}
		setErrors([])
		try {
			const result = await publish.mutateAsync(validation.intent)
			const warning = result.warnings.find((entry) => entry.path === validation.intent?.path)
			toast.success(`Bound /${validation.intent.path}` + (result.changed ? '' : ' — the table already matched, so nothing changed'))
			if (warning) toast.warning(`${validation.intent.path} also names a page compiled into this build; the binding wins.`)
			void navigate({ to: '/dashboard/app-settings/routes' })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			setErrors([message])
			toast.error(message)
		}
	}, [boundPaths, navigate, page, path, publish])

	if (isLoadingAdmin) return <SettingsLoadingSkeleton />

	if (!amIAdmin) {
		return <SettingsAccessDenied header={HEADER} message="Only an admin can change which page a path serves." />
	}

	return (
		<div>
			<SettingsPageHeader {...HEADER} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...HEADER} />

				<RouteCreateForm
					path={path}
					onPathChange={(value) => {
						setPath(value)
						if (errors.length > 0) setErrors([])
					}}
					pagePicker={
						<PagePickerField
							pubkey={currentUserPubkey ?? ''}
							author={page.author}
							d={page.d}
							onChange={setPage}
							// The escape hatch: a specific feed pointing at a page that does
							// not exist yet. The path is the obvious name for it, so the
							// hand-off pre-fills the new-page field with it.
							onCreatePage={() => void navigate({ to: '/dashboard/app-settings/pages', search: { name: path.trim() } })}
							disabled={publish.isPending}
						/>
					}
					errors={errors}
					notice={notice}
					pending={publish.isPending}
					onSubmit={() => void submit()}
				/>

				<p className="flex items-start gap-2 text-text-mid text-xs">
					<Shield className="mt-0.5 h-3 w-3 shrink-0" />
					The change is signed by your key and sent to this instance. The server checks the signature and your access level; a path owned by
					the URL space (like <code>api</code>) or a multi-segment path is refused.
				</p>
			</div>
		</div>
	)
}

/** `/dashboard/app-settings/routes/$path` — the path is fixed, the page is not. */
export function RouteEditPage({ path }: { path: string }) {
	useDashboardTitle(`Route: ${path}`)

	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin, currentUserPubkey } = useAmIAdmin(config?.appPublicKey)
	const table = useRouteTable()
	const publish = usePublishRouteIntent()
	const navigate = useNavigate()

	const rows = useMemo(() => describeBindings(table.data?.bindings ?? [], table.data?.warnings ?? []), [table.data])
	const row = useMemo(() => rows.find((candidate) => candidate.path === path) ?? null, [rows, path])

	const [page, setPage] = useState({ author: '', d: '' })
	const [errors, setErrors] = useState<string[]>([])
	// Seed the picker from the binding once per path. Re-seeding on every render
	// would fight the admin's own selection while the table query re-settles.
	const seededFor = useRef<string | null>(null)
	useEffect(() => {
		if (!row || seededFor.current === row.path) return
		seededFor.current = row.path
		setPage({ author: row.author, d: row.d })
	}, [row])

	const submit = useCallback(async () => {
		const validation = validateDraft(
			{ path, author: page.author, d: page.d },
			rows.map((candidate) => candidate.path),
			path,
		)
		if (!validation.intent) {
			setErrors(validation.errors)
			return
		}
		setErrors([])
		try {
			const result = await publish.mutateAsync(validation.intent)
			toast.success(`Updated /${path}` + (result.changed ? '' : ' — the table already matched, so nothing changed'))
			void navigate({ to: '/dashboard/app-settings/routes' })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			setErrors([message])
			toast.error(message)
		}
	}, [navigate, page, path, publish, rows])

	if (isLoadingAdmin) return <SettingsLoadingSkeleton />

	if (!amIAdmin) {
		return <SettingsAccessDenied header={HEADER} message="Only an admin can change which page a path serves." />
	}

	if (table.isLoading) return <SettingsLoadingSkeleton />

	if (table.isError) {
		return (
			<div className="p-4 lg:p-8">
				<RouteBindingsError
					message={table.error instanceof Error ? table.error.message : String(table.error)}
					onRetry={() => void table.refetch()}
				/>
			</div>
		)
	}

	if (!row) {
		return (
			<div className="p-4 lg:p-8">
				<ErrorState
					title={`Nothing is bound on /${path}`}
					message="This instance has no binding at that path. It may have been removed since this link was made."
				/>
			</div>
		)
	}

	return (
		<div>
			<SettingsPageHeader {...HEADER} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...HEADER} />

				<RouteEditCard
					path={path}
					pagePicker={
						<PagePickerField
							pubkey={currentUserPubkey ?? ''}
							author={page.author}
							d={page.d}
							onChange={setPage}
							disabled={publish.isPending}
						/>
					}
					errors={errors}
					pending={publish.isPending}
					onSubmit={() => void submit()}
					onCancel={() => void navigate({ to: '/dashboard/app-settings/routes' })}
				/>
			</div>
		</div>
	)
}
