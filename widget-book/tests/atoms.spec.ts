import { expect, test } from '@playwright/test'

test('renders the atom library', async ({ page }) => {
	await page.goto('/?library=atoms')

	await expect(page.getByTestId('widget-book-selection')).toHaveText('atoms')
	await expect(page.getByTestId('library-atoms')).toBeVisible()

	for (const widget of ['SelectableBadge', 'ProgressBar', 'InfoTooltip', 'Pattern']) {
		await expect(page.getByTestId(`widget-${widget}`)).toBeVisible()
	}
})

test('shows the deterministic atom states', async ({ page }) => {
	await page.goto('/?library=atoms')

	await expect(page.getByTestId('widget-SelectableBadge')).toContainText('Unselected')
	await expect(page.getByTestId('widget-SelectableBadge')).toContainText('Selected')
	await expect(page.getByTestId('widget-ProgressBar')).toContainText('64%')
	await expect(page.getByTestId('widget-InfoTooltip').locator('button[aria-label="More information"]')).toBeVisible()
	await expect(page.getByTestId('widget-Pattern')).toBeVisible()
})
