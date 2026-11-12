import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// Tailwind's `@source '../ui'` (styles/globals.css) only resolves when the
// widget-book server runs from the repository root. Spawned from `widget-book/`
// the Tailwind pass emits the base theme with no utility classes, so every
// widget renders unstyled (and zero-height loading skeletons become invisible).
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The port is `WIDGET_BOOK_PORT` (default 3100), matching `server.ts`, so several
 * catalogues can be exercised at once — one per library — without colliding on a
 * single fixed port. `baseURL` and the spawned server read the same value, which
 * is what makes a per-library run independent of every other library's state.
 */
const port = Number(process.env.WIDGET_BOOK_PORT ?? 3100)
const baseURL = `http://localhost:${port}`

/**
 * Widget book test harness (ADR-0007 §1e).
 *
 * Run from the repository root:
 *   bun run widget-book:test
 *   LIBRARY=atoms bun run widget-book:dev
 *   WIDGET_BOOK_PORT=3111 bunx playwright test --config=widget-book/playwright.config.ts tests/atoms.spec.ts
 */
export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	reporter: [['list']],
	use: {
		baseURL,
	},
	webServer: {
		// Run from the repo root so the Tailwind content scan sees `ui/`.
		command: 'bun run widget-book/server.ts',
		cwd: repositoryRoot,
		env: { WIDGET_BOOK_PORT: String(port) },
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
