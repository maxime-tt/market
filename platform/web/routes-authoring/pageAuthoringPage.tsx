import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { StorefrontPageChrome } from '@sdk/commerce/storefront/storefrontPage'
import { FileText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/primitives/card'
import { ErrorState } from '@ui/shared/error-state'
import { LoadingState } from '@ui/shared/loading-state'
import {
	NewPageForm,
	PagePicker,
	PagesEmpty,
	PagesError,
	PagesList,
	PagesLoading,
	type PickerPage,
} from '@ui/settings/page-authoring-views'
import {
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
} from '@ui/settings/operator-settings-views'
import { useAmIAdmin } from '@platform/web/app-settings/appSettingsQuery'
import { useConfigQuery } from '@platform/web/config/publicConfigQuery'
import { useDashboardTitle } from '@platform/web/app/dashboardTitle'
import { StorefrontBuilder } from '@platform/web/storefront/LazyStorefrontBuilder'
import { describePage, pageNameNotice, validatePageName } from './pageIdentity'
import { useMyPages } from './pageListQuery'
import { resolveAuthor, shortPubkey } from './routeAuthoring'

/**
 * The pages surface: the author's page list, the new-page flow, the page editor,
 * and the picker the route forms point at a page with.
 *
 * The component only orchestrates. The rows and their labels come from
 * `pageIdentity.ts`, the read from `pageListQuery.ts`, the rendering from
 * `ui/settings/page-authoring-views.tsx` (ADR-0007), and the editor is the same
 * `StorefrontBuilder` the storefront tab uses — opened at this page's address.
 *
 * Creating a page writes nothing: it navigates to the editor at that `d`, and
 * the document only reaches a relay when the author presses Publish there. That
 * is why a page created and abandoned is never live.
 *
 * Gating mirrors `/dashboard/app-settings/routes`: `useAmIAdmin`, the same query
 * the dashboard nav already keys on. The server still decides — an editor who
 * reached the endpoint would be accepted by the ingest's ACL, and a non-admin is
 * refused there regardless of what this page shows.
 */

const HEADER = { icon: FileText, title: 'Pages', description: 'The pages you publish under paths of this app' }

/** The list's rows, as the picker wants them: a label plus its address. */
function toPickerPages(
	pubkey: string,
	pages: readonly { d: string; title: string | null; enabled: boolean; chrome: StorefrontPageChrome }[],
): PickerPage[] {
	return pages.map((page) => ({
		...describePage({ author: pubkey, d: page.d }, page.enabled, page.chrome),
		d: page.d,
		title: page.title,
	}))
}

/**
 * The page picker, wired to the author's page list.
 *
 * `author`/`d` are the draft's current target and always change together — they
 * are one page's coordinate. The host owns the relay read and the navigation;
 * the picker owns its search box and the advanced paste field's local state.
 */
export function PagePickerField({
	pubkey,
	author,
	d,
	onChange,
	onCreatePage,
	disabled,
}: {
	pubkey: string
	author: string
	d: string
	onChange: (next: { author: string; d: string }) => void
	onCreatePage?: () => void
	disabled?: boolean
}) {
	const pages = useMyPages(pubkey)
	const [advanced, setAdvanced] = useState({ author: '', d: '' })
	const [advancedError, setAdvancedError] = useState<string | null>(null)

	const options = useMemo(() => toPickerPages(pubkey, pages.data?.pages ?? []), [pubkey, pages.data])

	// The binding's current target when the list cannot show it: another author's
	// page, or one this read did not return. It stays the current selection
	// rather than silently rendering as "nothing selected".
	const currentTarget = useMemo(() => {
		if (!author || !d || options.some((page) => page.d === d)) return null
		return { d, authorLabel: shortPubkey(author) }
	}, [author, d, options])

	const applyAdvanced = useCallback(() => {
		const resolved = resolveAuthor(advanced.author)
		if (resolved.error || resolved.hex === null) {
			setAdvancedError('That is not an npub or a 64-character hex pubkey.')
			return
		}
		if (advanced.d.trim().length === 0) {
			setAdvancedError('Enter the page’s name (its d tag).')
			return
		}
		setAdvancedError(null)
		onChange({ author: resolved.hex, d: advanced.d.trim() })
	}, [advanced, onChange])

	return (
		<PagePicker
			pages={options}
			loading={pages.isLoading}
			error={pages.isError ? (pages.error instanceof Error ? pages.error.message : String(pages.error)) : null}
			onRetry={() => void pages.refetch()}
			selectedD={d || null}
			currentTarget={currentTarget}
			onSelect={(page) => onChange({ author: pubkey, d: page.d })}
			onCreatePage={onCreatePage}
			advanced={advanced}
			onAdvancedChange={(field, value) => {
				setAdvanced((current) => ({ ...current, [field]: value }))
				setAdvancedError(null)
			}}
			onAdvancedApply={applyAdvanced}
			advancedError={advancedError}
			disabled={disabled}
		/>
	)
}

/**
 * `/dashboard/app-settings/pages` — the author's pages, and the one action that
 * makes another: name it.
 */
export function PagesPage({ suggestedName }: { suggestedName?: string }) {
	useDashboardTitle('Pages')

	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin, currentUserPubkey } = useAmIAdmin(config?.appPublicKey)
	const pages = useMyPages(currentUserPubkey)
	const navigate = useNavigate()
	// The read and the label builder both need a pubkey; the query is disabled
	// without one, so the empty string only ever reaches a page that renders
	// nothing. Same narrowing the routes page uses for its picker.
	const pubkey = currentUserPubkey ?? ''

	const [name, setName] = useState(suggestedName ?? '')
	const [submitted, setSubmitted] = useState(false)

	// An empty field is not an error until the author has committed to it; once
	// they have typed, the sentence is worth showing immediately.
	const nameError = submitted || name.length > 0 ? validatePageName(name) : null
	const options = useMemo(() => toPickerPages(pubkey, pages.data?.pages ?? []), [pubkey, pages.data])
	const notice = useMemo(
		() =>
			nameError
				? null
				: pageNameNotice(
						name,
						options.map((page) => page.d),
					),
		[nameError, name, options],
	)

	const openPage = useCallback(
		(target: string) => {
			void navigate({ to: '/dashboard/app-settings/pages/$d', params: { d: target } })
		},
		[navigate],
	)

	const create = useCallback(() => {
		setSubmitted(true)
		if (validatePageName(name)) return
		openPage(name)
	}, [name, openPage])

	if (isLoadingAdmin) return <SettingsLoadingSkeleton />

	if (!amIAdmin) {
		return <SettingsAccessDenied header={HEADER} message="Only an admin can author this instance's pages." />
	}

	return (
		<div>
			<SettingsPageHeader {...HEADER} />
			<div className="space-y-6 p-4 lg:p-8">
				<SettingsMobileHeader {...HEADER} />

				<Card>
					<CardHeader>
						<CardTitle>Your pages</CardTitle>
						<CardDescription>
							A page is a document you own, addressed by its name. Publishing one puts it on relays and in this instance&rsquo;s store;
							pointing a route at it is what makes it reachable at a path.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{pages.isLoading ? (
							<PagesLoading />
						) : pages.isError ? (
							<PagesError
								message={pages.error instanceof Error ? pages.error.message : String(pages.error)}
								onRetry={() => void pages.refetch()}
							/>
						) : options.length === 0 ? (
							// The read succeeded and there are no pages — an honest empty
							// list, which is not what a failed read is allowed to look like.
							<PagesEmpty onCreate={() => document.getElementById('new-page-name')?.focus()} />
						) : (
							<PagesList pages={options} dropped={pages.data?.dropped ?? 0} onEdit={(page) => openPage(page.d)} />
						)}
					</CardContent>
				</Card>

				<NewPageForm value={name} error={nameError} notice={notice} pending={false} onChange={setName} onSubmit={create} />

				<p className="text-text-mid text-xs">
					The name is the page&rsquo;s address, and it is also the default path it is published under. It cannot be changed later, so pick
					one you can live with.
				</p>
			</div>
		</div>
	)
}

/** `/dashboard/app-settings/pages/$d` — the same editor, at this page's address. */
export function PageEditorPage({ d }: { d: string }) {
	useDashboardTitle(`Page: ${d}`)

	const { data: config } = useConfigQuery()
	const { amIAdmin, isLoading: isLoadingAdmin, currentUserPubkey } = useAmIAdmin(config?.appPublicKey)

	// A `d` typed straight into the URL is not necessarily an address this app can
	// publish at. Say so instead of handing an unpublishable address to the editor.
	const nameError = validatePageName(d)
	if (nameError) {
		return (
			<div className="p-4 lg:p-8">
				<ErrorState title="That is not a page address" message={nameError} />
			</div>
		)
	}

	if (isLoadingAdmin) return <SettingsLoadingSkeleton />

	if (!amIAdmin) {
		return <SettingsAccessDenied header={HEADER} message="Only an admin can author this instance's pages." />
	}

	if (!currentUserPubkey) return <LoadingState className="p-8" label="Loading your account…" />

	return <StorefrontBuilder pubkey={currentUserPubkey} dTag={d} />
}
