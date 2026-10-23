import { expect, test } from '@playwright/test'

/**
 * Operator settings views. `SettingsPageHeader` composes the desktop-only
 * `PageHeader` band (`hidden lg:flex`), while `SettingsMobileHeader` is the
 * `lg:hidden` counterpart, so the two are asserted across viewports.
 */

const entryNames = [
	'SettingsPageHeader',
	'SettingsMobileHeader',
	'SettingsLoadingSkeleton',
	'SettingsAccessDenied',
	'RoleActionButtons',
	'RoleActionButtonsDisabled',
	'TeamRoleSection',
	'TeamRoleSectionEmpty',
	'AddTeamMemberCard',
	'TeamPermissionsCard',
	'TeamPermissionsCardAdministrator',
]

test('renders the settings library', async ({ page }) => {
	await page.goto('/?library=settings')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('settings')
	await expect(page.getByTestId('library-settings')).toBeVisible()

	for (const widget of entryNames) {
		// The mobile header is hidden at desktop width; every other entry is visible.
		if (widget === 'SettingsMobileHeader') {
			await expect(page.getByTestId(`widget-${widget}`)).toBeAttached()
		} else {
			await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
		}
	}
})

test('renders the desktop page header', async ({ page }) => {
	await page.goto('/?library=settings')

	const header = page.getByTestId('widget-SettingsPageHeader')
	await expect(header.locator('[data-slot="page-header"]')).toHaveClass(/lg:flex/)
	await expect(header).toContainText('Team')
	await expect(header).toContainText('Manage the operators who can run this marketplace.')
})

test.describe('mobile-only header', () => {
	test.use({ viewport: { width: 390, height: 844 } })

	test('shows the mobile header below lg', async ({ page }) => {
		await page.goto('/?library=settings')

		const mobile = page.getByTestId('widget-SettingsMobileHeader')
		await expect(mobile).toBeVisible()
		await expect(mobile).toContainText('Team')
		await expect(mobile).toContainText('Manage the operators who can run this marketplace.')
	})

	test('hides the desktop page header below lg', async ({ page }) => {
		await page.goto('/?library=settings')

		await expect(page.getByTestId('widget-SettingsPageHeader').locator('[data-slot="page-header"]')).toBeHidden()
	})
})

test('renders the loading skeleton rows', async ({ page }) => {
	await page.goto('/?library=settings')

	const skeleton = page.getByTestId('widget-SettingsLoadingSkeleton')
	await expect(skeleton.locator('[data-slot="loading-state"]')).toHaveCount(1)
	await expect(skeleton.locator('[data-slot="skeleton"]')).toHaveCount(3)
})

test('renders the access-denied card with the header and host message', async ({ page }) => {
	await page.goto('/?library=settings')

	const denied = page.getByTestId('widget-SettingsAccessDenied')
	await expect(denied).toContainText('Team')
	await expect(denied).toContainText('Access Denied')
	await expect(denied).toContainText('You need administrator privileges to manage the marketplace team.')
})

test('enables and disables the role action buttons', async ({ page }) => {
	await page.goto('/?library=settings')

	const actions = page.getByTestId('widget-RoleActionButtons')
	await expect(actions.getByRole('button', { name: 'Edit Role' })).toBeEnabled()
	await expect(actions.getByRole('button', { name: 'Remove Role' })).toBeEnabled()

	const disabled = page.getByTestId('widget-RoleActionButtonsDisabled')
	await expect(disabled.getByRole('button', { name: 'Edit Role' })).toBeDisabled()
	await expect(disabled.getByRole('button', { name: 'Remove Role' })).toBeDisabled()
})

test('renders the role section with members and the empty variant', async ({ page }) => {
	await page.goto('/?library=settings')

	const section = page.getByTestId('widget-TeamRoleSection')
	await expect(section).toContainText('Administrators')
	await expect(section).toContainText('Users with administrative privileges can manage the marketplace, products, and settings.')
	await expect(section).toContainText('satoshi')
	await expect(section).toContainText('alice')
	await expect(section.getByRole('button', { name: 'Edit Role' })).toHaveCount(2)

	const empty = page.getByTestId('widget-TeamRoleSectionEmpty')
	await expect(empty).toContainText('Editors')
	await expect(empty).toContainText('No editors found')
})

test('renders the add-member card for the admin role', async ({ page }) => {
	await page.goto('/?library=settings')

	const card = page.getByTestId('widget-AddTeamMemberCard')
	await expect(card).toContainText('Add Administrator')
	await expect(card).toContainText('Search for a user to add as administrator.')
	await expect(card.getByPlaceholder('Search users')).toBeVisible()
	await expect(card).toContainText('New administrators will have full access')
})

test('adapts the permissions card to the owner and administrator roles', async ({ page }) => {
	await page.goto('/?library=settings')

	const owner = page.getByTestId('widget-TeamPermissionsCard')
	await expect(owner).toContainText('Your Permissions')
	await expect(owner).toContainText('Owner')
	await expect(owner).toContainText('You have full control over the marketplace and can manage all administrators.')

	const admin = page.getByTestId('widget-TeamPermissionsCardAdministrator')
	await expect(admin).toContainText('Administrator')
	await expect(admin).toContainText('You can manage marketplace settings and content but cannot add/remove administrators.')
})
