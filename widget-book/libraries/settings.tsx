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
	],
}
