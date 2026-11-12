import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

/**
 * Tone-token pairing guard.
 *
 * The theme exposes each UX tone as a family (`styles/globals.css`):
 *
 *   --{tone}                    solid fill      --{tone}-foreground        its label
 *   --{tone}-muted              pale fill       --{tone}-muted-foreground  its label
 *   --{tone}-border             the matching border
 *
 * A label only pairs with the fill it was measured against. `text-{tone}-foreground`
 * is the label for the SOLID fill; the label for the pale `-muted` fill is
 * `text-{tone}-muted-foreground`. The two happen to be the same value in light mode
 * (e.g. light `--info-foreground` == `--info-muted-foreground`), which is why 29
 * sites drifted; in dark mode `-foreground` stays near-black while `-muted` becomes a
 * dark surface and `-muted-foreground` becomes the light label, so a mispaired site
 * renders dark-on-dark.
 *
 * This test makes the pairing monotonic in the same way `check-ui-styles.sh` makes
 * raw palette monotonic: the next mispairing fails the unit gate instead of waiting
 * for a dark-mode review. Canonical usage: `shared/status-badge.tsx` and
 * `shared/notice.tsx`.
 *
 * Scope: `ui/**` minus generated `ui/primitives/**` (never hand-edit) and minus test
 * files. A pair is judged per *class string literal* — two different elements in one
 * file may legitimately use a muted fill and a solid label, so the check is per
 * literal, not per file.
 */

const UI_ROOT = resolve(import.meta.dir, '..')
const TONES = ['success', 'info', 'error', 'warning'] as const
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx|mts|cts)$/
/** Generated Shadcn primitives — ADR-0007 §1a: never hand-edit, so never judged. */
const GENERATED_DIR = `${resolve(UI_ROOT, 'primitives')}`

/** Every single-, double- or back-quoted literal body in the file. */
const LITERAL = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g

async function listSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name)
			if (entry.isDirectory()) {
				if (fullPath === GENERATED_DIR) return []
				return listSourceFiles(fullPath)
			}
			const extension = entry.name.slice(entry.name.lastIndexOf('.'))
			return SOURCE_EXTENSIONS.has(extension) && !TEST_FILE.test(entry.name) ? [fullPath] : []
		}),
	)
	return nested.flat()
}

describe('tone token pairing', () => {
	test('a -muted fill only ever carries its -muted-foreground label', async () => {
		const files = await listSourceFiles(UI_ROOT)
		const violations: string[] = []

		for (const file of files) {
			const source = await readFile(file, 'utf8')
			for (const match of source.matchAll(LITERAL)) {
				const literal = match[1] ?? match[2] ?? match[3] ?? ''
				for (const tone of TONES) {
					if (literal.includes(`bg-${tone}-muted`) && literal.includes(`text-${tone}-foreground`)) {
						violations.push(
							`${relative(UI_ROOT, file)} pairs bg-${tone}-muted with text-${tone}-foreground (use text-${tone}-muted-foreground)`,
						)
					}
				}
			}
		}

		expect(violations).toEqual([])
	})
})
