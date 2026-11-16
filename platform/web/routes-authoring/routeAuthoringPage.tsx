import { useMemo, useState } from 'react'
import { Route as RouteIcon, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/primitives/card'
import {
	RouteBindingForm,
	RouteBindingsEmpty,
	RouteBindingsError,
	RouteBindingsList,
	RouteRemovalConfirm,
} from '@ui/settings/route-authoring-views'
import { SettingsAccessDenied, SettingsLoadingSkeleton, SettingsMobileHeader, SettingsPageHeader } from '@ui/settings/operator-settings-views'
import { useAmIAdmin } from '@platform/web/app-settings/appSettingsQuery'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { useStorefrontAddressPage } from '@platform/web/storefront/storefrontQuery'
import {
	EMPTY_DRAFT,
	describeBindings,
	draftFromRow,
	removeIntent,
	resolveAuthor,
	validateDraft,
	type BindingDraft,
	type BindingRow,
} from './routeAuthoring'
import { usePublishRouteIntent, useRouteTable } from './routeTableQuery'

/**
 * `/dashboard/app-settings/routes` — where an admin points a path at a page.
 *
 * The component only orchestrates: the table comes from the server that serves
 * it, the row strings and the draft rules come from `routeAuthoring.ts`, and the
 * rendering comes from `ui/settings/route-authoring-views.tsx` (ADR-0007). The
 * write is a signed route intent through the one ingest; this page never talks
 * to the file on disk.
 *
 * Gating mirrors `/dashboard/app-settings`: `useAmIAdmin`, the same query the
 * dashboard nav and `useRootRedirects` already key on. The server still decides
 * — an editor who reached the endpoint would be accepted by the ingest's ACL,
 * and a non-admin is refused there regardless of what this page shows.
 */
const HEADER = { icon: RouteIcon, title: 'Routes', description: 'Point a path at a published storefront page' }

export function RouteAuthoringPage() {
	useDashboardTitle('Routes')

	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin } = useAmIAdmin(config?.appPublicKey)
	const table = useRouteTable()
	const publish = usePublishRouteIntent()

	const [draft, setDraft] = useState<BindingDraft>(EMPTY_DRAFT)
	const [errors, setErrors] = useState<string[]>([])
	const [editingPath, setEditingPath] = useState<string | null>(null)
	const [confirmingRemove, setConfirmingRemove] = useState<BindingRow | null>(null)
	const [removingPath, setRemovingPath] = useState<string | null>(null)

	const bindings = table.data?.bindings ?? []
	const warnings = table.data?.warnings ?? []
	const rows = useMemo(() => describeBindings(bindings, warnings), [bindings, warnings])
	const boundPaths = useMemo(() => bindings.map((binding) => binding.path), [bindings])

	// A hint, never a gate: a binding may legitimately be authored before its
	// page is published (the serve path answers `binding-target-missing` until
	// it is). The read is the same one the storefront address route uses.
	const draftAuthor = resolveAuthor(draft.author).hex
	const draftPage = useStorefrontAddressPage(draftAuthor ?? undefined, draft.d.trim())
	const targetState =
		draftAuthor && draft.d.trim().length > 0
			? draftPage.isLoading
				? 'Looking for that page…'
				: draftPage.data?.page?.enabled
					? `Found a published page: “${draftPage.data.page.root.props.title}”.`
					: 'No published page answers that address yet. The binding will answer 500 until one does.'
			: null

	const resetForm = () => {
		setDraft(EMPTY_DRAFT)
		setErrors([])
		setEditingPath(null)
	}

	const onChange = (field: keyof BindingDraft, value: string) => {
		setDraft((current) => ({ ...current, [field]: value }))
		if (errors.length > 0) setErrors([])
	}

	const submit = async () => {
		const validation = validateDraft(draft, boundPaths, editingPath ?? undefined)
		if (!validation.intent) {
			setErrors(validation.errors)
			return
		}
		setErrors([])
		try {
			const result = await publish.mutateAsync(validation.intent)
			const warning = result.warnings.find((entry) => entry.path === validation.intent?.path)
			toast.success(
				`${editingPath ? 'Updated' : 'Bound'} /${validation.intent.path}` +
					(result.changed ? '' : ' — the table already matched, so nothing changed'),
			)
			if (warning) toast.warning(`${validation.intent.path} also names a page compiled into this build; the binding wins.`)
			resetForm()
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			setErrors([message])
			toast.error(message)
		}
	}

	const startEdit = (row: BindingRow) => {
		setEditingPath(row.path)
		setDraft(draftFromRow(row))
		setErrors([])
	}

	const remove = async (row: BindingRow) => {
		setRemovingPath(row.path)
		try {
			await publish.mutateAsync(removeIntent(row.path))
			toast.success(`Removed the binding on /${row.path}`)
			setConfirmingRemove(null)
			if (editingPath === row.path) resetForm()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error))
		} finally {
			setRemovingPath(null)
		}
	}

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
					<CardHeader>
						<CardTitle>What this changes</CardTitle>
						<CardDescription>
							A binding points one path at one stored page and takes effect on the next request this instance serves. The routing table
							on disk is changed by the signed change, and the table is re-validated as a whole before it is written.
						</CardDescription>
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
								onEdit={startEdit}
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

				<RouteBindingForm
					title={editingPath ? `Retarget /${editingPath}` : 'Bind a path'}
					description={
						editingPath
							? 'Choose the page this path should serve. The path itself stays the same.'
							: 'Point a path at a page you have published. The page is not moved or copied.'
					}
					values={draft}
					errors={errors}
					pending={publish.isPending}
					submitLabel={editingPath ? 'Save target' : 'Bind path'}
					editing={editingPath !== null}
					onChange={onChange}
					onSubmit={() => void submit()}
					onCancel={editingPath ? resetForm : undefined}
				/>

				{targetState && <p className="text-text-mid text-xs">{targetState}</p>}

				<p className="flex items-start gap-2 text-text-mid text-xs">
					<Shield className="mt-0.5 h-3 w-3 shrink-0" />
					The change is signed by your key and sent to this instance. The server checks the signature and your access level; a path
					owned by the URL space (like <code>api</code>) or a multi-segment path is refused.
				</p>
			</div>
		</div>
	)
}