import { expect, test, type Page } from '@playwright/test'

/**
 * Theme switching and the tune panel. Proves the expanded ADR-0007 §1a-bis
 * contract: a theme is one token record (colours + fonts + the six tune
 * dimensions), and rotating/retuning it re-colours the subtree without a build.
 */

const PRESETS = ['Brand', 'Hedgerow', 'Salon', 'Vault', 'Ledger']

async function setRange(page: Page, testId: string, value: number | string) {
	await page.getByTestId(testId).evaluate((element, next) => {
		const input = element as HTMLInputElement
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
		setter?.call(input, String(next))
		input.dispatchEvent(new Event('input', { bubbles: true }))
		input.dispatchEvent(new Event('change', { bubbles: true }))
	}, value)
}

function token(page: Page, name: string) {
	return page
		.getByTestId('theme-switcher')
		.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), name)
}

test('rotates through the presets and re-resolves the primary token', async ({ page }) => {
	await page.goto('/?library=shared')

	const switcher = page.getByTestId('theme-switcher')
	const themeName = page.getByTestId('theme-name')

	await expect(themeName).toHaveText('Brand')
	const brandPrimary = await token(page, '--primary')
	expect(brandPrimary).not.toBe('')

	for (const preset of PRESETS.slice(1)) {
		await switcher.click()
		await expect(themeName).toHaveText(preset)
		expect(await token(page, '--primary')).not.toBe(brandPrimary)
	}

	// Cycling past the last preset returns to the baseline.
	await switcher.click()
	await expect(themeName).toHaveText('Brand')
	expect(await token(page, '--primary')).toBe(brandPrimary)
})

test('the tune panel drives radius, shadow, glass, texture and hand-made tokens', async ({ page }) => {
	await page.goto('/?library=shared')

	// Hedgerow has a non-default radius so the reset assertion is meaningful.
	await page.getByTestId('theme-switcher').click()
	await expect(page.getByTestId('theme-name')).toHaveText('Hedgerow')

	const card = page.locator('[data-slot="stat-card"]').first()
	const radiusBefore = await card.evaluate((element) => getComputedStyle(element).borderRadius)
	const shadowBefore = await card.evaluate((element) => getComputedStyle(element).boxShadow)

	await setRange(page, 'tune-radius', 24)
	await expect.poll(async () => token(page, '--radius')).toBe('24px')
	const radiusAfter = await card.evaluate((element) => getComputedStyle(element).borderRadius)
	expect(radiusAfter).not.toBe(radiusBefore)

	await setRange(page, 'tune-shadow', 0.15)
	await expect.poll(async () => token(page, '--shadow-scale')).toBe('0.15')
	const shadowAfter = await card.evaluate((element) => getComputedStyle(element).boxShadow)
	expect(shadowAfter).not.toBe(shadowBefore)

	await setRange(page, 'tune-glass', 1)
	await expect.poll(async () => token(page, '--glass')).toBe('1')

	await setRange(page, 'tune-handmade', 1)
	await expect.poll(async () => token(page, '--handmade')).toBe('1')

	const wrapper = page.locator('.theme-new.grain').first()
	await setRange(page, 'tune-texture', 0)
	await expect.poll(async () => token(page, '--grain')).toBe('0')
	const grainOff = await wrapper.evaluate((element) => Number(getComputedStyle(element, '::after').opacity))
	await setRange(page, 'tune-texture', 1)
	await expect.poll(async () => token(page, '--grain')).toBe('1')
	const grainOn = await wrapper.evaluate((element) => Number(getComputedStyle(element, '::after').opacity))
	expect(grainOn).toBeGreaterThan(grainOff)

	await page.getByTestId('tune-reset').click()
	await expect.poll(async () => token(page, '--radius')).toBe('14px')
})

test('surprise and export produce a portable theme record', async ({ page }) => {
	await page.goto('/?library=shared')

	await page.getByTestId('tune-surprise').click()
	await expect(page.getByTestId('theme-json')).toHaveCount(0)

	await page.getByTestId('tune-export').click()
	const json = page.getByTestId('theme-json')
	await expect(json).toBeVisible()
	await expect(json).toContainText('"kind": "plebeian.ui-theme"')
	await expect(json).toContainText('"preset": "Brand"')
	await expect(json).toContainText('"--radius"')
})
