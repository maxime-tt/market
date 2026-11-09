import { expect, test } from '@playwright/test'

/**
 * Permission-gated entity actions. Each entry is a literal `EntityPermissions`
 * object, so the spec asserts the armoury each role actually unlocks.
 */

test('renders the permissions library for every role', async ({ page }) => {
	await page.goto('/?library=permissions')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('permissions')
	await expect(page.getByTestId('library-permissions')).toBeVisible()

	for (const widget of ['EntityActionsMenuOwner', 'EntityActionsMenuOperator', 'EntityActionsMenuBuyer']) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('the owner menu offers the edit, blacklist, featured and test-label arms', async ({ page }) => {
	await page.goto('/?library=permissions')

	await page.getByTestId('widget-EntityActionsMenuOwner').getByRole('button', { name: 'Open menu' }).click()

	const menu = page.getByRole('menu')
	await expect(menu.getByRole('menuitem', { name: 'Edit product' })).toBeVisible()
	await expect(menu.getByRole('menuitem', { name: 'Blacklist product' })).toBeVisible()
	await expect(menu.getByRole('menuitem', { name: 'Set as featured' })).toBeVisible()
	await expect(menu.getByRole('menuitem', { name: 'Mark as test listing' })).toBeVisible()
})

test('the operator menu keeps moderation but not the owner-only edit arm', async ({ page }) => {
	await page.goto('/?library=permissions')

	await page.getByTestId('widget-EntityActionsMenuOperator').getByRole('button', { name: 'Open menu' }).click()

	const menu = page.getByRole('menu')
	await expect(menu.getByRole('menuitem', { name: 'Remove from blacklist' })).toBeVisible()
	await expect(menu.getByRole('menuitem', { name: 'Set as featured' })).toBeVisible()
	await expect(menu.getByRole('menuitem', { name: /^Edit / })).toHaveCount(0)
	await expect(menu.getByRole('menuitem', { name: /test listing/ })).toHaveCount(0)
})

test('the buyer menu renders nothing at all', async ({ page }) => {
	await page.goto('/?library=permissions')

	const buyer = page.getByTestId('widget-EntityActionsMenuBuyer')
	await expect(buyer.getByRole('button')).toHaveCount(0)
})
