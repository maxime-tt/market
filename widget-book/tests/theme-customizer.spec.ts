import { expect, test, type Page } from '@playwright/test'

/**
 * The in-app theme customizer (`ui/theme/theme-customizer.tsx`): a launcher
 * that expands into the preset picker + TunePanel + portable theme record.
 * The demo in `widget-book/libraries/theme.tsx` owns the value and nests a
 * `ThemeMigrationWrapper`, so a preset or tune change repaints the sample.
 */

function token(page: Page, name: string) {
	return page
		.getByTestId('theme-customizer-demo')
		.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), name)
}

async function setRange(page: Page, testId: string, value: number | string) {
	await page.getByTestId(testId).evaluate((element, next) => {
		const input = element as HTMLInputElement
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
		setter?.call(input, String(next))
		input.dispatchEvent(new Event('input', { bubbles: true }))
		input.dispatchEvent(new Event('change', { bubbles: true }))
	}, value)
}

test('expands from the launcher and switches presets', async ({ page }) => {
	await page.goto('/?library=theme')

	const launcher = page.getByTestId('theme-customizer-launcher')
	const panel = page.getByTestId('theme-customizer-panel')

	await expect(launcher).toBeVisible()
	await expect(launcher).toHaveAttribute('aria-expanded', 'false')
	await expect(panel).toHaveCount(0)

	const normalize = (value: string) => value.replace(/0\./g, '.')
	const brandPrimary = normalize(await token(page, '--primary'))
	expect(brandPrimary).not.toBe('')

	await launcher.click()
	await expect(launcher).toHaveAttribute('aria-expanded', 'true')
	await expect(panel).toBeVisible()
	await expect(page.getByTestId('theme-customizer-preset')).toContainText('Brand')

	await page.getByTestId('theme-customizer-preset-Vault').click()
	await expect(page.getByTestId('theme-customizer-preset')).toContainText('Vault')
	expect(normalize(await token(page, '--primary'))).not.toBe(brandPrimary)

	await launcher.click()
	await expect(panel).toHaveCount(0)
})

test('the embedded TunePanel drives the sample tokens and exports a record', async ({ page }) => {
	await page.goto('/?library=theme')
	await page.getByTestId('theme-customizer-launcher').click()

	const radiusBefore = await page.getByTestId('theme-customizer-demo').evaluate((element) => getComputedStyle(element).borderTopLeftRadius)

	await setRange(page, 'tune-radius', 24)
	await expect.poll(async () => token(page, '--radius')).toBe('24px')
	const radiusAfter = await page.getByTestId('theme-customizer-demo').evaluate((element) => getComputedStyle(element).borderTopLeftRadius)
	expect(radiusAfter).not.toBe(radiusBefore)

	await page.getByTestId('tune-export').click()
	const json = page.getByTestId('theme-customizer-json')
	await expect(json).toBeVisible()
	await expect(json).toContainText('"kind": "plebeian.ui-theme"')
	await expect(json).toContainText('"--radius"')
})
