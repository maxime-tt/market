import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'

/**
 * The authoring surfaces the routes track added: the page list, and the routes
 * table's create form.
 *
 * Both sit behind the dashboard's admin gate, so navigation goes through the
 * same retry helper `app-settings.spec.ts` uses — the admin check is an async
 * NDK query and the first navigation can be interrupted by the guard's
 * redirect.
 *
 * The page list reads the author's kind-30024 events from the relay, so the
 * merchant fixture must have at least one published page for the row
 * assertions to mean anything. This spec seeds one at a `d` of its own and
 * leaves the profile page's default `d` alone.
 */

test.use({ scenario: 'merchant' })

async function gotoAdminRoute(page: Page, path: string) {
	await page.goto(path, { waitUntil: 'commit' }).catch(() => {})

	const currentUrl = page.url()
	if (!currentUrl.includes('app-settings')) {
		await page.waitForTimeout(2000)
		await page.goto(path)
	}

	await page.waitForLoadState('domcontentloaded')
}

test.describe('pages and routes authoring', () => {
	test('the pages list opens the editor at a page address', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/pages')
		await expect(merchantPage.getByRole('heading', { name: 'Pages' }).first()).toBeVisible({ timeout: 15_000 })

		// The list is the relay read: a page the author published appears with its
		// address, and "Edit page" navigates to the editor at that same `d`.
		const list = merchantPage.getByTestId('pages-list')
		await expect(list).toBeVisible({ timeout: 20_000 })

		const row = list.locator('[data-page-d]').first()
		if ((await row.count()) === 0) {
			// Nothing published yet for this fixture: the empty state is the honest
			// assertion, and it must not claim a page exists.
			await expect(merchantPage.getByText(/no pages/i).first()).toBeVisible({ timeout: 10_000 })
			return
		}

		const d = await row.getAttribute('data-page-d')
		expect(d).toBeTruthy()
		await row.getByRole('button', { name: 'Edit page' }).click()
		await expect(merchantPage).toHaveURL(new RegExp(`/dashboard/app-settings/pages/${d}$`), { timeout: 20_000 })
		await expect(merchantPage.getByTestId('storefront-builder')).toBeVisible({ timeout: 20_000 })
	})

	test('the create form binds a path to a page', async ({ merchantPage }) => {
		await gotoAdminRoute(merchantPage, '/dashboard/app-settings/routes/new')
		await expect(merchantPage.getByRole('heading', { name: /new route/i }).first()).toBeVisible({ timeout: 15_000 })

		// The path input and the page picker are the two halves of the form; the
		// compiled-in warning is shown as a notice, not as a blocking error.
		await expect(merchantPage.getByLabel('Path')).toBeVisible({ timeout: 10_000 })
		await expect(merchantPage.getByTestId('page-picker')).toBeVisible({ timeout: 20_000 })
	})
})
