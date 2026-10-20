import { defineConfig } from '@playwright/test'

/**
 * Widget book test harness (ADR-0007 §1e).
 *
 * Run from the repository root:
 *   bun run widget-book:test
 *   LIBRARY=atoms bun run widget-book:dev
 */
export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:3100',
	},
	webServer: {
		// Playwright runs the command from this config's directory.
		command: 'bun run server.ts',
		url: 'http://localhost:3100',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
