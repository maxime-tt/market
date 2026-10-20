import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// Tailwind's `@source '../ui'` (styles/globals.css) only resolves when the
// widget-book server runs from the repository root. Spawned from `widget-book/`
// the Tailwind pass emits the base theme with no utility classes, so every
// widget renders unstyled (and zero-height loading skeletons become invisible).
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
		// Run from the repo root so the Tailwind content scan sees `ui/`.
		command: 'bun run widget-book/server.ts',
		cwd: repositoryRoot,
		url: 'http://localhost:3100',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
