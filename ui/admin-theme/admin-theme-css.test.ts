import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')
const adminCss = readFileSync(join(root, 'styles/admin-theme.css'), 'utf8')
const publicCss = readFileSync(join(root, 'styles/globals-new.css'), 'utf8')

function block(css: string, selector: string, firstToken = ''): Map<string, string> {
	const start = css.indexOf(`${selector} {${firstToken}`)
	if (start < 0) throw new Error(`no block for ${selector}`)
	const end = css.indexOf('\n}', start)
	const body = css.slice(start, end)
	const out = new Map<string, string>()
	for (const match of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) out.set(match[1]!, match[2]!.trim())
	return out
}

describe('admin-theme.css', () => {
	test('the live preview reset restores the public token values exactly', () => {
		const reset = block(adminCss, '.admin-console [data-storefront-theme]')
		const publicTokens = block(publicCss, '.theme-new')
		expect(reset.size).toBeGreaterThan(30)
		for (const [name, value] of reset) {
			if (name === '--font-heading') continue // declared in globals.css :root, not .theme-new
			expect({ name, value }).toEqual({ name, value: publicTokens.get(name) ?? '(missing)' })
		}
	})

	test('every role token the console rebinds is restored for the preview', () => {
		const console_ = block(adminCss, ':is(.admin-console, .admin-portal)', '\n\t--background:')
		const reset = block(adminCss, '.admin-console [data-storefront-theme]')
		for (const name of console_.keys()) {
			if (name.startsWith('--puck-') || name.startsWith('--radius')) continue
			expect({ name, restored: reset.has(name) }).toEqual({ name, restored: true })
		}
	})

	test('loads nothing from a third-party host', () => {
		expect(adminCss).not.toMatch(/url\(\s*['"]?https?:/i)
		expect(adminCss).not.toMatch(/@import\s+url/i)
	})
})
