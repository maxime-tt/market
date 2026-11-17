import { Pencil, Shield, ShieldCheck, Trash2, Users } from 'lucide-react'
import {
	AddTeamMemberCard,
	RoleActionButtons,
	SettingsAccessDenied,
	SettingsLoadingSkeleton,
	SettingsMobileHeader,
	SettingsPageHeader,
	TeamPermissionsCard,
	TeamRoleSection,
} from '@ui/settings/operator-settings-views'
import { ProfileWalletCheckView } from '@ui/settings/profile-wallet-check-view'
import { RelayCardView, RelayManagerView } from '@ui/settings/relay-manager-views'
import { NewPageForm, PageLabelChips, PagePicker, PagesEmpty, PagesError, PagesList, PagesLoading } from '@ui/settings/page-authoring-views'
import {
	RouteBindingsEmpty,
	RouteBindingsError,
	RouteBindingsList,
	RouteCreateForm,
	RouteEditCard,
	RouteRemovalConfirm,
} from '@ui/settings/route-authoring-views'
import type { WidgetLibrary } from '../libraries'

/**
 * Operator settings views drained into ui/settings.
 *
 * The views are presentation-only (icons, copy, host-rendered rows), so every
 * entry is a literal render. `SettingsPageHeader` composes the desktop-only
 * `PageHeader` band (`hidden lg:flex`), while `SettingsMobileHeader` is its
 * `lg:hidden` counterpart — the spec asserts both across viewports.
 */

/** Stand-in for the host's user search combobox; the search slot is a plain node. */
const searchInput = <input type="text" placeholder="Search users" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />

const memberActions = [
	{ label: 'Edit Role', icon: Pencil, tone: 'text-info', onSelect: () => {} },
	{ label: 'Remove Role', icon: Trash2, tone: 'text-destructive', onSelect: () => {} },
]

/** Fixed authoring fixtures: the harness renders one deterministic state. */
const pickerPages = [
	{
		name: 'Storefront',
		authorLabel: 'npub1merchant…',
		enabled: true,
		isDefault: true,
		d: 'storefront-page',
		title: 'The merchant storefront',
	},
	{
		name: 'featured-13-11-2026',
		authorLabel: 'npub1merchant…',
		enabled: false,
		isDefault: false,
		d: 'featured-13-11-2026',
		title: null,
	},
]

const bindingRows = [
	{
		path: 'featured',
		targetLabel: 'page npub1merchant… / featured-13-11-2026',
		pageName: 'featured-13-11-2026',
		pageAuthorLabel: 'npub1merchant…',
		updatedAtLabel: '13 Nov 2026',
		updatedByLabel: 'npub1admin…',
		warning: null,
		author: 'a'.repeat(64),
		d: 'featured-13-11-2026',
	},
	{
		path: 'shop',
		targetLabel: 'page npub1merchant… / storefront-page',
		pageName: 'Storefront',
		pageAuthorLabel: 'npub1merchant…',
		updatedAtLabel: '12 Nov 2026',
		updatedByLabel: 'npub1admin…',
		warning: 'shop is also a page compiled into this build.',
		author: 'a'.repeat(64),
		d: 'storefront-page',
	},
]

const pickerProps = {
	pages: pickerPages,
	loading: false,
	error: null,
	selectedD: null,
	onSelect: () => {},
	advanced: { author: '', d: '' },
	onAdvancedChange: () => {},
	onAdvancedApply: () => {},
}

export const settings: WidgetLibrary = {
	name: 'settings',
	entries: [
		{
			name: 'SettingsPageHeader',
			render: () => <SettingsPageHeader icon={Users} title="Team" description="Manage the operators who can run this marketplace." />,
		},
		{
			name: 'SettingsMobileHeader',
			render: () => <SettingsMobileHeader icon={Users} title="Team" description="Manage the operators who can run this marketplace." />,
		},
		{
			name: 'SettingsLoadingSkeleton',
			render: () => (
				<div className="max-w-md">
					<SettingsLoadingSkeleton />
				</div>
			),
		},
		{
			name: 'SettingsAccessDenied',
			render: () => (
				<SettingsAccessDenied
					header={{ icon: Shield, title: 'Team', description: 'Manage the operators who can run this marketplace.' }}
					message="You need administrator privileges to manage the marketplace team."
				/>
			),
		},
		{
			name: 'RoleActionButtons',
			render: () => (
				<div className="flex gap-2">
					<RoleActionButtons actions={memberActions} disabled={false} />
				</div>
			),
		},
		{
			name: 'RoleActionButtonsDisabled',
			render: () => (
				<div className="flex gap-2">
					<RoleActionButtons actions={memberActions} disabled />
				</div>
			),
		},
		{
			name: 'TeamRoleSection',
			render: () => (
				<div className="max-w-md">
					<TeamRoleSection
						role="admin"
						members={[
							{
								key: 'satoshi',
								content: (
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium">satoshi</span>
										<RoleActionButtons actions={memberActions} disabled={false} />
									</div>
								),
							},
							{
								key: 'alice',
								content: (
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium">alice</span>
										<RoleActionButtons actions={memberActions} disabled={false} />
									</div>
								),
							},
						]}
					/>
				</div>
			),
		},
		{
			name: 'TeamRoleSectionEmpty',
			render: () => (
				<div className="max-w-md">
					<TeamRoleSection role="editor" members={[]} />
				</div>
			),
		},
		{
			name: 'AddTeamMemberCard',
			render: () => (
				<div className="max-w-md">
					<AddTeamMemberCard role="admin" search={searchInput} />
				</div>
			),
		},
		{
			name: 'TeamPermissionsCard',
			render: () => (
				<div className="max-w-sm">
					<TeamPermissionsCard isOwner />
				</div>
			),
		},
		{
			name: 'TeamPermissionsCardAdministrator',
			render: () => (
				<div className="max-w-sm">
					<TeamPermissionsCard isOwner={false} />
				</div>
			),
		},
		{
			name: 'ProfileWalletCheckLoading',
			render: () => (
				<div className="max-w-xl">
					<ProfileWalletCheckView isLoading hasLud16={false} lud16={null} instanceName="Marketplace" />
				</div>
			),
		},
		{
			name: 'ProfileWalletCheckLud16',
			render: () => (
				<div className="max-w-xl">
					<ProfileWalletCheckView isLoading={false} hasLud16 lud16="satoshi@getalby.com" instanceName="Marketplace" />
				</div>
			),
		},
		{
			name: 'ProfileWalletCheckNoLud16',
			render: () => (
				<div className="max-w-xl">
					<ProfileWalletCheckView isLoading={false} hasLud16={false} lud16={null} instanceName="Marketplace" />
				</div>
			),
		},
		{
			name: 'RelayCardView',
			render: () => (
				<div className="max-w-xl space-y-2">
					<RelayCardView url="wss://relay.example.com" type="explicit" status="connected" onRemove={() => {}} />
					<RelayCardView url="wss://backup.example.org" type="outbox" status="connecting" onRemove={() => {}} />
					<RelayCardView url="not-a-url" type="outbox" status="disconnected" onRemove={() => {}} />
				</div>
			),
		},
		{
			name: 'RelayManagerView',
			render: () => (
				<div className="max-w-xl">
					<RelayManagerView
						ndkReady
						showNostrSync
						relayListLoading={false}
						preferencesLoading={false}
						preferencesPending={false}
						saving={false}
						hasUnsavedChanges
						includeAppDefaults
						onLoadFromNostr={() => {}}
						onSaveToNostr={() => {}}
						onToggleAppDefaults={() => {}}
						newRelayUrl=""
						onNewRelayUrlChange={() => {}}
						onAddRelay={() => {}}
						addingRelay={false}
						onConnectToDefaults={() => {}}
						explicitRelays={[
							{ url: 'wss://relay.example.com', status: 'connected' },
							{ url: 'wss://backup.example.org', status: 'connecting' },
						]}
						outboxRelays={[{ url: 'wss://discovered.example.net', status: 'disconnected' }]}
						onRemoveRelay={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'RelayManagerViewSignedOut',
			render: () => (
				<div className="max-w-xl">
					<RelayManagerView
						ndkReady
						showNostrSync={false}
						relayListLoading={false}
						preferencesLoading={false}
						preferencesPending={false}
						saving={false}
						hasUnsavedChanges={false}
						includeAppDefaults
						onLoadFromNostr={() => {}}
						onSaveToNostr={() => {}}
						onToggleAppDefaults={() => {}}
						newRelayUrl=""
						onNewRelayUrlChange={() => {}}
						onAddRelay={() => {}}
						addingRelay={false}
						onConnectToDefaults={() => {}}
						explicitRelays={[]}
						outboxRelays={[]}
						onRemoveRelay={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'PageLabelChips',
			render: () => (
				<div className="flex flex-col gap-2">
					<PageLabelChips label={{ name: 'Storefront', authorLabel: 'npub1merchant…', enabled: true, isDefault: true }} />
					<PageLabelChips label={{ name: 'featured-13-11-2026', authorLabel: 'npub1merchant…', enabled: false, isDefault: false }} />
				</div>
			),
		},
		{
			name: 'PagesList',
			render: () => (
				<div className="max-w-2xl">
					<PagesList pages={pickerPages} dropped={0} onEdit={() => {}} />
				</div>
			),
		},
		{
			name: 'PagesListTruncated',
			render: () => (
				<div className="max-w-2xl">
					<PagesList pages={pickerPages.slice(0, 1)} dropped={7} onEdit={() => {}} />
				</div>
			),
		},
		{
			name: 'PagesLoading',
			render: () => <PagesLoading className="max-w-2xl" />,
		},
		{
			name: 'PagesError',
			render: () => <PagesError className="max-w-2xl" message="The relay did not answer." onRetry={() => {}} />,
		},
		{
			name: 'PagesEmpty',
			render: () => <PagesEmpty className="max-w-2xl" onCreate={() => {}} />,
		},
		{
			name: 'NewPageForm',
			render: () => (
				<div className="max-w-xl">
					<NewPageForm value="" error={null} notice={null} pending={false} onChange={() => {}} onSubmit={() => {}} />
				</div>
			),
		},
		{
			name: 'NewPageFormError',
			render: () => (
				<div className="max-w-xl">
					<NewPageForm
						value="Storefront"
						error="The name is reserved for the storefront page."
						notice={null}
						pending={false}
						onChange={() => {}}
						onSubmit={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'PagePicker',
			render: () => (
				<div className="max-w-xl">
					<PagePicker
						pages={pickerPages}
						loading={false}
						error={null}
						selectedD="featured-13-11-2026"
						onSelect={() => {}}
						advanced={{ author: '', d: '' }}
						onAdvancedChange={() => {}}
						onAdvancedApply={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'RouteBindingsList',
			render: () => (
				<div className="max-w-2xl">
					<RouteBindingsList rows={bindingRows} pendingPath={null} onEdit={() => {}} onRemove={() => {}} onEditPage={() => {}} />
				</div>
			),
		},
		{
			name: 'RouteBindingsEmpty',
			render: () => <RouteBindingsEmpty />,
		},
		{
			name: 'RouteBindingsError',
			render: () => <RouteBindingsError message="The routing table could not be read." onRetry={() => {}} />,
		},
		{
			name: 'RouteCreateForm',
			render: () => (
				<div className="max-w-xl">
					<RouteCreateForm
						path="featured"
						onPathChange={() => {}}
						pagePicker={<PagePicker {...pickerProps} />}
						errors={[]}
						pending={false}
						onSubmit={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'RouteCreateFormNotice',
			render: () => (
				<div className="max-w-xl">
					<RouteCreateForm
						path="shop"
						onPathChange={() => {}}
						pagePicker={<PagePicker {...pickerProps} />}
						errors={[]}
						notice="This path is also a page compiled into this build. The binding wins while it exists."
						pending={false}
						onSubmit={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'RouteEditCard',
			render: () => (
				<div className="max-w-xl">
					<RouteEditCard
						path="featured"
						pagePicker={<PagePicker {...pickerProps} />}
						errors={[]}
						pending={false}
						onSubmit={() => {}}
						onCancel={() => {}}
					/>
				</div>
			),
		},
		{
			name: 'RouteRemovalConfirm',
			render: () => <RouteRemovalConfirm path="featured" pending={false} onConfirm={() => {}} onCancel={() => {}} />,
		},
	],
}
